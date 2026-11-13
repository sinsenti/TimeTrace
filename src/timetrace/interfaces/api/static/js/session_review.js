/**
 * Sessions Review List & Inspector Modal
 */

let sessionReviewListGeneration = 0;
function sessionReviewListStatus(message) {
    const status = document.getElementById('session_rev_list_status');
    if (status) status.textContent = message;
}
async function loadAllSessionsReview() {
    const generation = ++sessionReviewListGeneration;
    sessionReviewListStatus('Loading sessions…');
    try {
        const rows = await api.get('/sessions') || [];
        const metadata = await Promise.allSettled([
            api.get('/api/tasks?status=all'), api.get('/rating-entries?target_type=session&target_id=all')
        ]);
        if (generation !== sessionReviewListGeneration) return false;
        const old = new Map(allRevisionSessions.map(session => [String(session.id), session]));
        const [tasks, ratings] = metadata;
        const tasksMap = new Map(tasks.status === 'fulfilled' ? (tasks.value || []).map(task => [String(task.id), task]) : []);
        const reviewed = new Set(ratings.status === 'fulfilled' ? (ratings.value || []).filter(entry => !entry.dismissed).map(entry => String(entry.target_id)) : []);
        allRevisionSessions = rows.map(session => {
            const previous = old.get(String(session.id));
            const attachedTask = tasks.status === 'fulfilled' ? tasksMap.get(String(session.task_id)) : previous?.attachedTask;
            const isReviewed = ratings.status === 'fulfilled' ? reviewed.has(String(session.id)) : previous?.is_reviewed ?? null;
            const exemptionKnown = !session.task_id || tasks.status === 'fulfilled' || previous?.is_exempt != null;
            const isExempt = session.review_skipped === true || attachedTask?.requires_session_review === false
                ? true : exemptionKnown ? false : null;
            return {...session, attachedTask, is_reviewed:isReviewed, is_exempt:isExempt,
                is_missed:isReviewed === false && isExempt === false,
                classification_stale:tasks.status !== 'fulfilled' || ratings.status !== 'fulfilled'};
        }).sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
        filterSessionsReviewList();
        const failed = metadata.some(result => result.status === 'rejected');
        sessionReviewListStatus(failed ? 'Review metadata unavailable. Last-known states are retained where available; refresh to retry.' : '');
        return !failed;
    } catch (error) {
        if (generation === sessionReviewListGeneration) sessionReviewListStatus(`Could not load sessions: ${error.message}. Refresh to retry; last-known rows are retained.`);
        return false;
    }
}
function setSessionReviewFilter(filter) {
    currentSessionReviewFilter = filter;
    for (const value of ['all', 'reviewed', 'missed', 'dismissed']) {
        const button = document.getElementById(`sess_filter_${value}`);
        if (button) button.setAttribute('aria-pressed', String(value === filter));
    }
    filterSessionsReviewList();
}
function sessionReviewText(tag, text, className = '') {
    const element = document.createElement(tag);
    element.textContent = String(text ?? '');
    element.className = className;
    return element;
}
function filterSessionsReviewList() {
    const query = (document.getElementById('session_rev_search')?.value || '').trim().toLowerCase();
    const container = document.getElementById('sessions_review_list');
    if (!container) return;
    const filtered = allRevisionSessions.filter(session => {
        if (currentSessionReviewFilter === 'reviewed' && !session.is_reviewed) return false;
        if (currentSessionReviewFilter === 'missed' && !session.is_missed) return false;
        if (currentSessionReviewFilter === 'dismissed' && !session.is_exempt) return false;
        return !query || [session.notes, session.tags, session.attachedTask?.title].some(text => String(text || '').toLowerCase().includes(query));
    });
    const badge = document.getElementById('session_rev_count_badge');
    if (badge) badge.textContent = `${filtered.length} sessions`;
    container.replaceChildren();
    if (!filtered.length) container.appendChild(sessionReviewText('p', 'No matching session logs found.'));
    for (const session of filtered) {
        const row = document.createElement('article'); row.className = 'rev-card session-review-row';
        const open = document.createElement('button'); open.type = 'button'; open.className = 'session-review-open';
        open.addEventListener('click', () => openSessionReviewModal(String(session.id)));
        const start = new Date(session.start_time);
        const end = session.end_time ? new Date(session.end_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Open';
        open.appendChild(sessionReviewText('span', `${start.toLocaleString()} – ${end}`, 'session-review-time'));
        open.appendChild(sessionReviewText('strong', session.attachedTask?.title || session.notes || 'Direct session log'));
        if (session.attachedTask?.description) open.appendChild(sessionReviewText('span', session.attachedTask.description));
        if (session.attachedTask && session.notes) open.appendChild(sessionReviewText('span', session.notes));
        open.appendChild(sessionReviewText('span', `${Math.round((session.duration_seconds || 0) / 6) / 10} mins · ${session.tags || '#general'}`));
        row.appendChild(open);
        const states = document.createElement('div'); states.className = 'session-review-states';
        if (session.is_reviewed) states.appendChild(sessionReviewText('span', 'Reviewed', 'session-review-badge reviewed'));
        if (session.is_exempt) states.appendChild(sessionReviewText('span', 'Exempt', 'session-review-badge exempt'));
        if (session.is_missed) states.appendChild(sessionReviewText('span', 'Missed review', 'session-review-badge missed'));
        if (session.is_reviewed == null || session.is_exempt == null) states.appendChild(sessionReviewText('span', 'Review state unavailable', 'session-review-badge'));
        if (session.classification_stale) states.appendChild(sessionReviewText('span', 'Metadata unavailable; refresh to verify', 'session-review-badge'));
        if (session.is_missed) {
            const dismiss = sessionReviewText('button', 'Exempt session'); dismiss.type = 'button';
            dismiss.disabled = sessionReviewQuickBusy.has(String(session.id));
            dismiss.addEventListener('click', event => quickDismissSessionReview(String(session.id), event));
            states.appendChild(dismiss);
        }
        row.appendChild(states); container.appendChild(row);
    }
}

const sessionReviewTextSelector = '#session_rev_modal_tags, #session_rev_modal_notes, #session_rev_modal_skip_check';
let sessionReviewEditor = null;
let sessionReviewSelection = 0;
function sessionReviewElement(id) { return document.getElementById(id); }
function sessionReviewCurrent(editor) { return sessionReviewEditor === editor && !editor.closed; }
function sessionReviewStatus(message) {
    const el = sessionReviewElement('session_rev_modal_status');
    if (el) el.textContent = message;
}
function sessionReviewDirty() {
    return typeof hasSettingsDrafts === 'function' && hasSettingsDrafts(['session_review_modal', 'session_custom_ratings_container']);
}
function sessionReviewControls(editor) {
    const ready = editor.textReady && editor.ratingsReady;
    for (const id of ['session_rev_save', 'session_rev_delete', 'session_rev_reset']) {
        const button = sessionReviewElement(id);
        if (button) button.disabled = !ready || editor.busy || editor.loading || sessionReviewQuickBusy.has(editor.id)
            || id === 'session_rev_save' && editor.resetRatingsDone;
    }
    const retry = sessionReviewElement('session_rev_retry');
    if (retry) retry.disabled = editor.busy || editor.loading;
    for (const id of ['session_rev_modal_tags', 'session_rev_modal_notes', 'session_rev_modal_skip_check']) {
        const field = sessionReviewElement(id);
        if (field) field.disabled = !editor.textReady;
    }
}
// The shared confirmation owns Enter/Escape; this session-local seam owns its focus.
let sessionReviewConfirmation = null;
async function sessionReviewConfirm(editor, title, message) {
    const origin = document.activeElement;
    const owner = {editor};
    sessionReviewConfirmation = owner;
    try {
        const result = showCustomConfirm(title, message);
        sessionReviewElement('confirm_modal_cancel_btn')?.focus();
        return await result;
    } finally {
        if (sessionReviewConfirmation === owner) {
            sessionReviewConfirmation = null;
            if (sessionReviewCurrent(editor)) {
                if (origin?.getClientRects().length && !origin.disabled) origin.focus();
                else sessionReviewElement('session_review_modal')?.focus();
            }
        }
    }
}
async function openSessionReviewModal(sessionId) {
    sessionId = String(sessionId);
    const selection = ++sessionReviewSelection;
    const previous = sessionReviewEditor;
    if (previous && previous.id === sessionId && sessionReviewCurrent(previous)) return retrySessionReviewLoad();
    if (previous && sessionReviewDirty()) {
        const discard = await sessionReviewConfirm(previous, 'Discard session draft', 'Discard unsaved changes to open another session?');
        if (!discard || selection !== sessionReviewSelection || sessionReviewEditor !== previous) return;
    }
    closeSessionReviewModal(false);
    const editor = {id:sessionId, textReady:false, ratingsReady:false, loading:false, busy:false,
        generation:0, closed:false, skipRevision:0, origin:document.activeElement, textAcknowledged:null, resetRatingsDone:false};
    sessionReviewEditor = editor;
    editor.quickExemption = sessionReviewQuickActions.get(sessionId);
    editor.quickExemptionRevision = editor.skipRevision;
    sessionReviewElement('session_rev_modal_id').value = sessionId;
    sessionReviewElement('session_review_modal').classList.remove('hidden');
    sessionReviewElement('session_review_modal').focus();
    const root = sessionReviewElement('session_custom_ratings_container');
    root.classList.remove('hidden'); root.innerHTML = ''; root.ratingTarget = `session:${sessionId}`;
    root.ratingAcknowledged = new Map(); root.ratingBaselines = new Map(); root.ratingHTML = null;
    sessionReviewElement('session_rev_refresh')?.classList.add('hidden');
    for (const id of ['session_rev_modal_tags', 'session_rev_modal_notes']) sessionReviewElement(id).value = '';
    sessionReviewElement('session_rev_modal_skip_check').checked = false;
    return retrySessionReviewLoad();
}
async function retrySessionReviewLoad() {
    const editor = sessionReviewEditor;
    if (!editor || editor.busy) return;
    const generation = ++editor.generation;
    const current = () => sessionReviewCurrent(editor) && editor.generation === generation;
    const root = sessionReviewElement('session_custom_ratings_container');
    editor.loading = true; editor.ratingsReady = false;
    sessionReviewStatus('Loading session and ratings…'); sessionReviewControls(editor);
    try {
        const session = await api.get(`/sessions/${encodeURIComponent(editor.id)}`);
        if (!current()) return;
        if (!editor.textReady) {
            editor.id = String(session.id);
            sessionReviewElement('session_rev_modal_id').value = editor.id;
            sessionReviewElement('session_rev_modal_tags').value = session.tags || '';
            sessionReviewElement('session_rev_modal_notes').value = session.notes || '';
            sessionReviewElement('session_rev_modal_skip_check').checked = session.review_skipped === true || editor.quickExemption?.acknowledged === true;
            editor.textReady = true;
            if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('session_review_modal', sessionReviewTextSelector);
        }
        const st = session.start_time ? new Date(session.start_time).toLocaleString() : 'Time unavailable';
        const et = session.end_time ? new Date(session.end_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Open';
        sessionReviewElement('session_rev_modal_time').textContent = `${st} – ${et}`;
        sessionReviewControls(editor);
        const entries = await api.get(`/rating-entries?target_type=session&target_id=${encodeURIComponent(editor.id)}`);
        if (!current()) return;
        const initialized = editor.ratingsInitialized === true;
        const rendered = await renderCustomRatingsInputs('session', editor.id, root.id, entries || [], current, root, initialized);
        if (!current()) return;
        if (rendered !== true) throw new Error('Ratings changed while loading');
        if (!initialized) {
            if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft(root.id, '.custom-rating-input');
            for (const input of root.querySelectorAll('.custom-rating-input')) root.ratingBaselines.set(input.id, JSON.stringify([input.value, input.disabled]));
        }
        editor.ratingsInitialized = true; editor.ratingsReady = true;
        sessionReviewStatus('Ready. Reviewed ratings and session exemption are independent.');
        setTimeout(() => { if (current()) sessionReviewElement('session_rev_modal_tags')?.focus(); }, 0);
    } catch (error) {
        if (current()) sessionReviewStatus(`Could not load session or ratings: ${error.message}. Retry load; existing drafts are retained.`);
    } finally {
        if (current()) { editor.loading = false; sessionReviewControls(editor); }
    }
}
function closeSessionReviewModal(restoreFocus = true) {
    const editor = sessionReviewEditor;
    if (editor) { editor.closed = true; editor.generation++; }
    sessionReviewEditor = null;
    sessionReviewSelection++;
    sessionReviewElement('session_review_modal')?.classList.add('hidden');
    sessionReviewElement('session_custom_ratings_container')?.classList.add('hidden');
    if (typeof settingsDrafts !== 'undefined') {
        settingsDrafts.delete('session_review_modal'); settingsDrafts.delete('session_custom_ratings_container');
    }
    if (restoreFocus) {
        const origin = editor?.origin;
        if (origin?.isConnected) origin.focus();
        else if (typeof currentActiveRevTab !== 'undefined' && currentActiveRevTab === 'day') {
            sessionReviewElement('day_review_date_input')?.focus();
        } else sessionReviewElement('session_rev_search')?.focus();
    }
}

async function retrySessionReviewRefresh(editor = sessionReviewEditor) {
    const loaded = await loadAllSessionsReview();
    // The active Day caller refreshes recorded-session evidence without changing this draft.
    if (loaded && typeof currentActiveRevTab !== 'undefined' && currentActiveRevTab === 'day'
        && typeof loadDayReviewData === 'function') await loadDayReviewData();
    if (editor && sessionReviewCurrent(editor) && editor.refreshFailed) {
        editor.refreshFailed = !loaded;
        sessionReviewStatus(loaded ? editor.saveFailure || 'Saved. Session evidence refreshed; newer drafts are retained.'
            : `${editor.saveFailure || 'Saved'} Evidence refresh failed. Retry refresh retries reads only.`);
        sessionReviewElement('session_rev_refresh')?.classList.toggle('hidden', loaded);
    }
    return loaded;
}
async function sessionReviewAfterWrite(editor = null) {
    try {
        const refreshed = await retrySessionReviewRefresh(editor);
        if (refreshed === false) throw new Error('Session list unavailable');
        return true;
    } catch (error) {
        sessionReviewListStatus('Saved; refresh failed. Refresh sessions retries reads only.');
        if (editor && sessionReviewCurrent(editor)) {
            editor.refreshFailed = true;
            sessionReviewStatus('Saved; refresh failed. Retry refresh retries reads only; successful saves are acknowledged.');
            sessionReviewElement('session_rev_refresh')?.classList.remove('hidden');
        }
        return false;
    }
}
async function saveSessionReviewModal() {
    const editor = sessionReviewEditor;
    if (!editor || editor.busy || editor.loading || !editor.textReady || !editor.ratingsReady
        || editor.resetRatingsDone || sessionReviewQuickBusy.has(editor.id)) return;
    const root = sessionReviewElement('session_custom_ratings_container');
    const current = () => sessionReviewCurrent(editor);
    if (!validateRequiredCustomRatings('session', editor.id, root)) return;
    const body = {tags:sessionReviewElement('session_rev_modal_tags').value.trim(),
        notes:sessionReviewElement('session_rev_modal_notes').value.trim(),
        review_skipped:sessionReviewElement('session_rev_modal_skip_check').checked};
    const signature = JSON.stringify(body);
    const checkpoint = typeof settingsDraftCheckpoint === 'function'
        ? settingsDraftCheckpoint('session_review_modal', sessionReviewTextSelector) : () => {};
    const submitted = snapshotCustomRatings('session', editor.id, root);
    editor.busy = true; editor.saveFailure = null; sessionReviewControls(editor); sessionReviewStatus('Saving session…');
    let phase = 'Session fields';
    let textAcknowledged = editor.textAcknowledged === signature;
    try {
        if (editor.textAcknowledged !== signature) {
            const saved = await api.put(`/sessions/${encodeURIComponent(editor.id)}`, body);
            textAcknowledged = true;
            if (!current()) { await sessionReviewAfterWrite(); return; }
            editor.textAcknowledged = signature; checkpoint();
            if (saved?.id && String(saved.id) !== editor.id) {
                // Occurrence PUT materializes virt: IDs; ratings belong to the resulting real row.
                editor.id = String(saved.id);
                sessionReviewElement('session_rev_modal_id').value = editor.id;
                root.ratingTarget = `session:${editor.id}`;
                for (const entry of submitted) {
                    entry.body.target_id = editor.id; entry.signature = JSON.stringify(entry.body);
                }
            }
        }
        checkpoint();
        phase = 'Ratings'; sessionReviewStatus('Session fields saved; saving ratings…');
        await submitCustomRatings('session', editor.id, current, root, submitted);
        if (!current()) { await sessionReviewAfterWrite(); return; }
        sessionReviewStatus('Saved. Newer edits remain in this dialog.');
        const refreshed = await sessionReviewAfterWrite(editor);
        if (current() && !sessionReviewDirty() && refreshed) closeSessionReviewModal();
    } catch (error) {
        if (textAcknowledged) await sessionReviewAfterWrite(current() ? editor : null);
        if (current()) {
            editor.saveFailure = `${phase} save failed or its acknowledgement was lost: ${error.message}. Successful acknowledgements are retained; retry saves only unfinished or changed values.`;
            sessionReviewStatus(editor.saveFailure + (editor.refreshFailed ? ' Evidence refresh also failed; Retry refresh retries reads only.' : ''));
        }
    } finally {
        if (current()) { editor.busy = false; sessionReviewControls(editor); }
    }
}
async function resetSessionReview() {
    const editor = sessionReviewEditor;
    if (!editor || editor.busy || editor.loading || !editor.ratingsReady || !editor.textReady
        || sessionReviewQuickBusy.has(editor.id)) return;
    editor.busy = true; sessionReviewControls(editor);
    const id = editor.id;
    try {
        const confirmed = await sessionReviewConfirm(editor, 'Reset session review',
            'Remove ratings for this session and clear its session exemption? A task exemption still applies.');
        if (!confirmed || !sessionReviewCurrent(editor) || editor.id !== id) return;
        if (!editor.resetRatingsDone) {
            await api.delete(`/rating-entries?target_type=session&target_id=${encodeURIComponent(id)}`);
            if (!sessionReviewCurrent(editor)) { await sessionReviewAfterWrite(); return; }
            editor.resetRatingsDone = true;
        }
        await api.put(`/sessions/${encodeURIComponent(id)}`, {review_skipped:false});
        if (!sessionReviewCurrent(editor)) { await sessionReviewAfterWrite(); return; }
        closeSessionReviewModal(); await sessionReviewAfterWrite();
    } catch (error) {
        if (!sessionReviewCurrent(editor) && editor.resetRatingsDone) await sessionReviewAfterWrite();
        if (sessionReviewCurrent(editor)) sessionReviewStatus(`Reset incomplete: ${editor.resetRatingsDone ? 'Ratings removed; session exemption still needs clearing.' : 'Rating removal was not acknowledged.'} ${error.message}. Retry Reset review.`);
    } finally {
        if (sessionReviewCurrent(editor)) { editor.busy = false; sessionReviewControls(editor); }
    }
}
const sessionReviewQuickBusy = new Set();
const sessionReviewQuickActions = new Map();
// Track intent, including a checkbox toggled back to its original value during a quick write.
sessionReviewElement('session_rev_modal_skip_check')?.addEventListener('change', () => {
    if (sessionReviewEditor) sessionReviewEditor.skipRevision++;
});
async function quickDismissSessionReview(sessionId, event) {
    if (event) event.stopPropagation();
    sessionId = String(sessionId);
    if (sessionReviewQuickBusy.has(sessionId) || sessionReviewEditor?.id === sessionId && sessionReviewEditor.busy) return;
    const action = {acknowledged:false};
    sessionReviewQuickActions.set(sessionId, action);
    const editor = sessionReviewEditor?.id === sessionId ? sessionReviewEditor : null;
    if (editor) { editor.quickExemption = action; editor.quickExemptionRevision = editor.skipRevision; }
    sessionReviewQuickBusy.add(sessionId);
    if (sessionReviewEditor?.id === sessionId) sessionReviewControls(sessionReviewEditor);
    if (event?.currentTarget) event.currentTarget.disabled = true;
    try {
        await api.put(`/sessions/${encodeURIComponent(sessionId)}`, {review_skipped:true});
        action.acknowledged = true;
        const current = sessionReviewEditor;
        if (current?.id === sessionId && current.quickExemption === action && current.textReady) {
            const field = sessionReviewElement('session_rev_modal_skip_check');
            const draft = field.checked;
            field.checked = true;
            // Acknowledge only exemption; notes/tags and newer checkbox intent stay drafts.
            const checkpoint = typeof settingsDraftCheckpoint === 'function'
                ? settingsDraftCheckpoint('session_review_modal', '#session_rev_modal_skip_check') : () => {};
            if (current.skipRevision !== current.quickExemptionRevision) field.checked = draft;
            checkpoint();
            current.textAcknowledged = null;
        }
        await sessionReviewAfterWrite();
    } catch (error) {
        sessionReviewListStatus(`Exemption save failed or was not acknowledged: ${error.message}. Retry the exemption action.`);
    } finally {
        sessionReviewQuickBusy.delete(sessionId);
        sessionReviewQuickActions.delete(sessionId);
        if (sessionReviewEditor?.id === sessionId) sessionReviewControls(sessionReviewEditor);
        if (event?.currentTarget) event.currentTarget.disabled = false;
    }
}
async function deleteSessionFromReviewModal() {
    const editor = sessionReviewEditor;
    if (!editor || editor.busy || editor.loading || !editor.textReady || sessionReviewQuickBusy.has(editor.id)) return;
    editor.busy = true; sessionReviewControls(editor);
    const id = editor.id;
    try {
        const confirmed = await sessionReviewConfirm(editor, 'Delete session log', 'Delete only this session log? This cannot be undone.');
        if (!confirmed || !sessionReviewCurrent(editor) || editor.id !== id) return;
        await api.delete(`/sessions/${encodeURIComponent(id)}`);
        if (!sessionReviewCurrent(editor)) { await sessionReviewAfterWrite(); return; }
        closeSessionReviewModal(); await sessionReviewAfterWrite();
    } catch (error) {
        if (sessionReviewCurrent(editor)) sessionReviewStatus(`Deletion failed or was not acknowledged: ${error.message}. Refresh before retrying if the result is uncertain.`);
    } finally {
        if (sessionReviewCurrent(editor)) { editor.busy = false; sessionReviewControls(editor); }
    }
}

// Keep keyboard focus inside the one visible session dialog. Escape/Ctrl+Enter use revision_nav.js.
document.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !sessionReviewEditor) return;
    const modal = sessionReviewElement(sessionReviewConfirmation ? 'custom_confirm_modal' : 'session_review_modal');
    if (!modal) return;
    const controls = Array.from(modal.querySelectorAll('button, input, textarea, select, [tabindex]'))
        .filter(field => !field.disabled && field.type !== 'hidden' && field.getClientRects().length);
    if (!controls.length) { event.preventDefault(); modal.focus(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
        event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === modal)) {
        event.preventDefault(); first.focus();
    }
});
