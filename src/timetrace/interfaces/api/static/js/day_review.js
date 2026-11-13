/** Date-owned Day workspace. Hidden editors stay mounted for departure ownership. */
const dayEditors = new Map();
let dayReviewEditor = null;
let expandedHistoryDate = null;
let dayHistoryVisible = false;

function dayField(editor, name) { return editor.root.querySelector(`[data-day="${name}"]`); }
function dayEditorCurrent(editor) { return dayEditors.get(editor.date) === editor; }
function localDayToday() {
    if (typeof getLocalTodayStr === 'function') return getLocalTodayStr();
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
function getDayEditor(date) {
    if (dayEditors.has(date)) return dayEditors.get(date);
    const root = document.getElementById('day_editor_template').content.firstElementChild.cloneNode(true);
    root.id = `day_editor_${date}`;
    root.dataset.settingsDraftRetained = 'true';
    root.querySelectorAll('[data-day]').forEach(el => { el.id = `${root.id}_${el.dataset.day}`; });
    const editor = {date, root, summary:null, textReady:false, ratingsReady:false, loading:false,
        generation:0, saving:false, filter:null, group:'tag', acknowledged:null, baseline:null};
    dayEditors.set(date, editor);
    document.getElementById('day_editor_store').appendChild(root);
    dayField(editor,'date').textContent = date;
    root.addEventListener('keydown', event => {
        if (event.ctrlKey && event.key === 'Enter') {
            event.preventDefault(); event.stopPropagation(); saveDayReviewForm(editor);
        }
    });
    root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'save') saveDayReviewForm(editor);
        if (action === 'dismiss') dismissDayReview(editor);
        if (action === 'discard') discardDayReview(editor);
        if (action === 'retry') {
            const unchanged = editor.retryDiscard === JSON.stringify(snapshotCustomRatings('day',editor.date,dayField(editor,'ratings')).map(entry=>[entry.signature,entry.rawValue]));
            if (unchanged) discardDayReview(editor, true);
            else { editor.retryDiscard = null; loadDayEditor(editor); }
        }
        if (action === 'calendar') jumpToCalendarForDay(editor);
        if (action === 'clear-filter') { editor.filter = null; renderDayEvidence(editor); }
        if (action === 'activity' || action === 'tasks') { editor.group = action === 'tasks' ? 'task' : 'tag'; renderDayEvidence(editor); }
        if (action === 'promote') jumpToDayReview(editor.date);
    }));
    dayField(editor,'rating').addEventListener('change', () => applyDayRatingColor(editor));
    return editor;
}
function positionDayEditors() {
    const main = document.getElementById('day_main_editor');
    const history = document.getElementById('day_history_editor');
    const store = document.getElementById('day_editor_store');
    for (const editor of dayEditors.values()) {
        const isMain = editor === dayReviewEditor;
        const historical = dayHistoryVisible && editor.date === expandedHistoryDate && !isMain;
        (isMain ? main : historical ? history : store).appendChild(editor.root);
        editor.root.classList.toggle('hidden', !isMain && !historical);
        editor.root.querySelector('[data-action="promote"]').hidden = isMain;
    }
}
async function loadDayReviewData() {
    const input = document.getElementById('day_review_date_input');
    if (!input) return;
    input.value ||= localDayToday();
    dayReviewEditor = getDayEditor(input.value);
    if (expandedHistoryDate === input.value) expandedHistoryDate = null;
    positionDayEditors();
    if (typeof renderDayHistoryGrid === 'function') renderDayHistoryGrid();
    return loadDayEditor(dayReviewEditor);
}
function setDayReviewToday() {
    document.getElementById('day_review_date_input').value = localDayToday();
    return loadDayReviewData();
}
function dayText(editor, skipped = false) {
    return {date_str:editor.date, rating:Number(dayField(editor,'rating').value) || 3,
        highlights:dayField(editor,'highlights').value || '', friction:dayField(editor,'friction').value || '',
        notes:dayField(editor,'notes').value || '', review_skipped:skipped};
}
function populateDayText(editor, payload) {
    for (const name of ['rating','highlights','friction','notes']) dayField(editor,name).value = payload[name];
    applyDayRatingColor(editor);
}
function dayCheckpoint(editor) {
    return typeof settingsDraftCheckpoint === 'function'
        ? settingsDraftCheckpoint(editor.root.id, '[data-day-text]') : () => {};
}
function setDayStatus(editor, text) { dayField(editor,'status').textContent = text; }
async function loadDayEditor(editor) {
    if (editor.saving) return;
    const generation = ++editor.generation;
    editor.loading = true;
    editor.ratingsFresh = false;
    if (!editor.textReady) editor.root.querySelectorAll('[data-day-text]').forEach(el => { el.disabled = true; });
    setDayStatus(editor,'Loading…');
    try {
        const data = await api.get(`/revision/day-summary?date_str=${encodeURIComponent(editor.date)}`);
        if (!dayEditorCurrent(editor) || generation !== editor.generation) return;
        editor.summary = data;
        // A refresh updates evidence, never replaces an initialized date's unsaved form.
        if (!editor.textReady) {
            const review = data.day_review;
            editor.baseline = {date_str:editor.date, rating:review?.rating ?? 3,
                highlights:review?.highlights || '', friction:review?.friction || '', notes:review?.notes || '', review_skipped:!!review?.review_skipped};
            populateDayText(editor,editor.baseline);
            dayCheckpoint(editor)();
            editor.textReady = true;
        }
        editor.root.querySelectorAll('[data-day-text]').forEach(el => { el.disabled = false; });
        renderDayEvidence(editor);
        {
            const ratings = dayField(editor,'ratings');
            const hydrated = await renderCustomRatingsInputs('day',editor.date,ratings.id,data.custom_ratings || [],
                () => dayEditorCurrent(editor) && generation === editor.generation, ratings, editor.ratingsReady);
            if (!dayEditorCurrent(editor) || generation !== editor.generation) return;
            if (!hydrated) { setDayStatus(editor,'Load failed. Retry load before saving. Existing drafts retained.'); return; }
            if (!editor.ratingsReady) {
                ratings.ratingBaselines = new Map(Array.from(ratings.querySelectorAll('.custom-rating-input')).map(input=>[input.id,JSON.stringify([input.value,input.disabled])]));
                if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft(ratings.id,'.custom-rating-input');
            }
            ratings.dataset.settingsDraftRetained = 'true';
            editor.ratingsReady = true; editor.ratingsFresh = true;
        }
        setDayStatus(editor,data.day_review?.review_skipped ? 'Dismissed' : data.day_review ? `Reviewed (${data.day_review.rating}/5)` : 'Missing review');
    } catch (error) {
        if (dayEditorCurrent(editor) && generation === editor.generation) setDayStatus(editor,'Load failed. Retry load before saving. Existing drafts retained.');
    } finally {
        if (generation === editor.generation) editor.loading = false;
    }
}
function applyDayRatingColor(editor = dayReviewEditor) {
    if (!editor || typeof getGradeColorClasses !== 'function') return;
    dayField(editor,'rating').style.color = getGradeColorClasses(dayField(editor,'rating').value,1,5).hex;
}
function markDayFormDirty() {} // Retained callers; ownership is derived from field snapshots.
function sessionMatchesDayFilter(session, editor = dayReviewEditor) {
    const filter = editor?.filter;
    if (!filter) return true;
    if (filter.type === 'task') return filter.value === '__none__' ? !session.task_id : String(session.task_id) === String(filter.value);
    const tags = (session.tags || '').split(/\s+/).filter(tag => tag.startsWith('#'));
    return (tags.length ? tags : ['#general']).includes(filter.value);
}
function toggleDayBreakdownFilter(type, value, editor = dayReviewEditor) {
    if (!editor) return;
    editor.filter = editor.filter?.type === type && String(editor.filter.value) === String(value) ? null : {type,value};
    renderDayEvidence(editor);
}
function jumpToCalendarForDay(editor = dayReviewEditor) {
    if (!editor) return;
    const query = new URLSearchParams({date:editor.date});
    if (editor.filter) query.set(editor.filter.type,editor.filter.value);
    window.location.href = `/dashboard?${query}`;
}
function renderDayEvidence(editor) {
    const data = editor.summary;
    if (!data) return;
    dayField(editor,'created-tasks').hidden = editor.group !== 'task';
    const group = editor.group;
    const rows = (editor.group === 'tag' ? data.tag_breakdown : data.task_breakdown) || [];
    const list = dayField(editor,'breakdown');
    list.replaceChildren();
    dayField(editor,'total').textContent = `${data.total_hours ?? 0}h recorded`;
    dayField(editor,'created-tasks').textContent = `${data.completed_tasks_count ?? 0} done tasks created on ${editor.date}`;
    editor.root.querySelector('[data-action="activity"]').setAttribute('aria-pressed',String(editor.group === 'tag'));
    editor.root.querySelector('[data-action="tasks"]').setAttribute('aria-pressed',String(editor.group === 'task'));
    for (const row of rows) {
        const value = editor.group === 'tag' ? row.tag : row.task_id ?? '__none__';
        const button = document.createElement('button'); button.type = 'button'; button.className = 'day-breakdown-row';
        button.setAttribute('aria-pressed',String(editor.filter?.type === editor.group && String(editor.filter.value) === String(value)));
        const label = document.createElement('span'); label.textContent = editor.group === 'tag' ? row.tag : row.title;
        const hours = document.createElement('span'); hours.textContent = `${row.total_hours}h`;
        const bar = document.createElement('span'); bar.className = 'day-breakdown-bar';
        bar.style.width = `${data.total_hours > 0 ? Math.max(0,Math.min(100,Number(row.total_hours)/data.total_hours*100)) : 0}%`;
        button.append(label,hours,bar);
        button.addEventListener('click',()=>toggleDayBreakdownFilter(group,value,editor)); list.appendChild(button);
    }
    if (!rows.length) list.textContent = 'No activity logged.';
    const filter = editor.filter;
    const chip = dayField(editor,'filter'); chip.hidden = !filter;
    if (filter) {
        const label = filter.type === 'tag' ? filter.value : filter.value === '__none__' ? 'Direct Session Log'
            : (data.task_breakdown || []).find(row=>String(row.task_id) === String(filter.value))?.title || 'Task';
        dayField(editor,'filter-label').textContent = `${filter.type}: ${label}`;
    }
    const sessions = (data.sessions || []).filter(session=>sessionMatchesDayFilter(session,editor));
    dayField(editor,'session-count').textContent = filter ? `${sessions.length}/${data.total_sessions ?? 0} matching recorded sessions` : `${data.total_sessions ?? 0} recorded sessions`;
    const timeline = dayField(editor,'sessions'); timeline.replaceChildren();
    for (const session of sessions) {
        const button = document.createElement('button');button.type = 'button';button.className = 'day-session-row';
        const start = session.start_time ? new Date(session.start_time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
        button.textContent = `${start} · ${session.task?.title || session.notes || 'Direct Session Log'} · ${Math.round((session.duration_seconds || 0)/60)}m · ${session.tags || '#general'}`;
        button.addEventListener('click',()=>openSessionReviewModal(session.id));timeline.appendChild(button);
    }
    if (!sessions.length) timeline.textContent = 'No matching sessions for this day.';
}
function renderDayBreakdown() { if (dayReviewEditor) renderDayEvidence(dayReviewEditor); }
function renderDaySessionsTimeline() { renderDayBreakdown(); }
async function saveDayReviewForm(editor = dayReviewEditor) {
    if (!editor || editor.saving || editor.loading) return;
    if (!editor.textReady || !editor.ratingsReady || !editor.ratingsFresh) { await loadDayEditor(editor); return; }
    const ratings = dayField(editor,'ratings');
    if (!validateRequiredCustomRatings('day',editor.date,ratings)) return;
    const payload = dayText(editor);
    const signature = JSON.stringify(payload);
    const checkpoint = dayCheckpoint(editor);
    const submitted = snapshotCustomRatings('day',editor.date,ratings);
    editor.saving = true;
    try {
        if (editor.acknowledged !== signature) {
            await api.post('/revision/day-review',payload);
            if (!dayEditorCurrent(editor)) return;
            editor.acknowledged = signature; editor.baseline = {...payload}; checkpoint();
        }
        await submitCustomRatings('day',editor.date,()=>dayEditorCurrent(editor),ratings,submitted);
        if (dayEditorCurrent(editor)) setDayStatus(editor,'Saved submitted values. Later edits remain unsaved.');
    } catch (error) {
        if (dayEditorCurrent(editor)) setDayStatus(editor,'Save incomplete. Acknowledged writes remain saved; retry sends unfinished values. A lost response may have saved.');
    } finally { editor.saving = false; }
}
async function dismissDayReview(editor = dayReviewEditor) {
    if (!editor || editor.loading || editor.saving) return;
    if (!editor.textReady) { await loadDayEditor(editor); return; }
    editor.saving = true;
    // Confirmation and payload belong to this date even if the main date changes.
    const payload = dayText(editor,true); const checkpoint = dayCheckpoint(editor);
    try {
        if (!await showCustomConfirm('Dismiss Day Review',`Mark day review for ${editor.date} as dismissed?`)) return;
        if (!dayEditorCurrent(editor)) return;
        await api.post('/revision/day-review',payload);
        if (!dayEditorCurrent(editor)) return;
        editor.baseline = {...payload}; editor.acknowledged = JSON.stringify(payload); checkpoint();
        setDayStatus(editor,'Dismissed. Custom rating drafts retained.');
    } catch (error) { setDayStatus(editor,'Dismiss incomplete. A lost response may have saved; drafts retained.'); }
    finally { editor.saving = false; }
}
async function discardDayReview(editor = dayReviewEditor, retry = false) {
    if (!editor || editor.saving || editor.loading || editor.discarding || !editor.textReady) return;
    editor.discarding = true;
    let confirmed;
    try { confirmed = retry || await showCustomConfirm('Discard day drafts',`Discard unsaved text and ratings for ${editor.date}? Saved rows remain.`); }
    finally { editor.discarding = false; }
    if (!confirmed) return;
    if (!dayEditorCurrent(editor) || editor.saving || editor.loading) return;
    if (!retry) { populateDayText(editor,editor.baseline); dayCheckpoint(editor)(); }
    // Read persisted rating entries afresh; failed reads retain their initialized drafts.
    editor.loading = true;
    const generation = ++editor.generation;
    const ratings = dayField(editor,'ratings');
    const before = JSON.stringify(snapshotCustomRatings('day',editor.date,ratings).map(entry=>[entry.signature,entry.rawValue]));
    const unchanged = () => dayEditorCurrent(editor) && generation === editor.generation && before === JSON.stringify(snapshotCustomRatings('day',editor.date,ratings).map(entry=>[entry.signature,entry.rawValue]));
    try {
        const data = await api.get(`/revision/day-summary?date_str=${encodeURIComponent(editor.date)}`);
        if (!dayEditorCurrent(editor) || generation !== editor.generation) return;
        const hydrated = await renderCustomRatingsInputs('day',editor.date,ratings.id,data.custom_ratings || [],unchanged,ratings);
        if (!dayEditorCurrent(editor) || generation !== editor.generation) return;
        if (!hydrated) { setDayStatus(editor,'Newer rating edits retained.'); return; }
        ratings.ratingBaselines = new Map(Array.from(ratings.querySelectorAll('.custom-rating-input')).map(input=>[input.id,JSON.stringify([input.value,input.disabled])]));
        editor.retryDiscard = false; editor.ratingsReady = true; editor.ratingsFresh = true;
        if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft(ratings.id,'.custom-rating-input');
        setDayStatus(editor,'Drafts discarded for this date.');
    } catch (error) {
        if (dayEditorCurrent(editor) && generation === editor.generation) {
            editor.retryDiscard = before;
            setDayStatus(editor,'Rating reload failed; rating drafts retained. Retry load.');
        }
    } finally { if (generation === editor.generation) editor.loading = false; }
}
