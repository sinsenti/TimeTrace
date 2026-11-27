/**
 * TimeTrace Session Modal & Stepper Logic
 */

function setupModalKeyboardListeners() {
    const sessionModal = document.getElementById('session_modal');
    if (sessionModal) {
        sessionModal.addEventListener('keydown', function(e) {
            const activeEl = document.activeElement;
            const isTypingText = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

            if (e.key === 'Tab' && !e.defaultPrevented) {
                const controls = [...sessionModal.querySelectorAll('button:not(:disabled), input:not([type="hidden"]):not(:disabled), textarea, select, [tabindex="0"]')]
                    .filter(el => el.offsetParent !== null);
                const target = e.shiftKey ? controls.at(-1) : controls[0];
                if ((e.shiftKey && activeEl === controls[0]) || (!e.shiftKey && activeEl === controls.at(-1))) {
                    e.preventDefault();
                    target?.focus();
                }
            } else if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                const dropdown = document.getElementById('tag_suggestions_dropdown');
                if (dropdown) dropdown.classList.add('hidden');
                if (typeof activeTagSuggestionIndex !== 'undefined') activeTagSuggestionIndex = -1;
                saveSessionFromModal();
            } else if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                closeSessionModal();
            } else if ((e.key === '+' || e.key === '=') && !isTypingText && !sessionModalOwner?.pending && !sessionModalOwner?.blocked && sessionModalOwner?.session?.kind !== 'scheduled_session') {
                e.preventDefault();
                openTaskModalFromSessionModal();
            }
        });
    }

    const taskSearchInput = document.getElementById('session_modal_task_search');
    if (taskSearchInput) {
        taskSearchInput.addEventListener('focus', () => renderTaskSuggestions(taskSearchInput.value));
        taskSearchInput.addEventListener('input', () => renderTaskSuggestions(taskSearchInput.value));

        taskSearchInput.addEventListener('keydown', function(e) {
            const dropdown = document.getElementById('task_suggestions_dropdown');
            const items = dropdown ? dropdown.querySelectorAll('.task-suggestion-item') : [];

            if (e.ctrlKey && e.key === 'Enter') {
                if (dropdown) dropdown.classList.add('hidden');
                if (typeof activeTaskSuggestionIndex !== 'undefined') activeTaskSuggestionIndex = -1;
                return;
            }

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (items.length > 0) {
                    activeTaskSuggestionIndex = (activeTaskSuggestionIndex + 1) % items.length;
                    highlightTaskSuggestionItem(items);
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (items.length > 0) {
                    activeTaskSuggestionIndex = (activeTaskSuggestionIndex - 1 + items.length) % items.length;
                    highlightTaskSuggestionItem(items);
                }
            } else if ((e.key === 'Enter') && !e.ctrlKey) {
                e.preventDefault();
                if (activeTaskSuggestionIndex >= 0 && items[activeTaskSuggestionIndex]) {
                    items[activeTaskSuggestionIndex].click();
                } else if (items.length > 0) {
                    items[0].click();
                }
            } else if (e.key === 'Tab') {
                if (dropdown) dropdown.classList.add('hidden');
                activeTaskSuggestionIndex = -1;
                const tagInput = document.getElementById('session_modal_tags_input');
                if (tagInput) {
                    e.preventDefault();
                    tagInput.focus();
                }
            } else if (e.key === 'Backspace' && !taskSearchInput.value && attachedTask) {
                detachTask();
                renderTaskSuggestions('');
            } else if (e.key === '+' && !sessionModalOwner?.pending && !sessionModalOwner?.blocked && sessionModalOwner?.session?.kind !== 'scheduled_session') {
                e.preventDefault();
                openTaskModalFromSessionModal();
            }
        });
    }

    const tagInput = document.getElementById('session_modal_tags_input');
    if (tagInput) {
        tagInput.addEventListener('focus', () => renderTagSuggestions(tagInput.value));
        tagInput.addEventListener('input', () => renderTagSuggestions(tagInput.value));

        tagInput.addEventListener('keydown', function(e) {
            const dropdown = document.getElementById('tag_suggestions_dropdown');
            const items = dropdown ? dropdown.querySelectorAll('.tag-suggestion-item') : [];

            if (e.ctrlKey && e.key === 'Enter') {
                if (dropdown) dropdown.classList.add('hidden');
                if (typeof activeTagSuggestionIndex !== 'undefined') activeTagSuggestionIndex = -1;
                return;
            }

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (items.length > 0) {
                    activeTagSuggestionIndex = (activeTagSuggestionIndex + 1) % items.length;
                    highlightTagSuggestionItem(items);
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (items.length > 0) {
                    activeTagSuggestionIndex = (activeTagSuggestionIndex - 1 + items.length) % items.length;
                    highlightTagSuggestionItem(items);
                }
            } else if ((e.key === 'Enter' || e.key === ' ') && !e.ctrlKey) {
                e.preventDefault();
                if (activeTagSuggestionIndex >= 0 && items[activeTagSuggestionIndex]) {
                    items[activeTagSuggestionIndex].click();
                } else if (tagInput.value.trim()) {
                    addTagChip(tagInput.value.trim());
                    tagInput.value = '';
                    renderTagSuggestions('');
                } else if (!tagInput.value.trim() && items.length > 0) {
                    items[0].click();
                }
            } else if (e.key === 'Tab') {
                if (dropdown) dropdown.classList.add('hidden');
                activeTagSuggestionIndex = -1;
                const notesInput = document.getElementById('session_modal_notes');
                if (notesInput) {
                    e.preventDefault();
                    notesInput.focus();
                }
            } else if (e.key === 'Backspace' && !tagInput.value && currentTagChips.length > 0) {
                removeTagChip(currentTagChips.length - 1);
                renderTagSuggestions('');
            }
        });
    }

    document.addEventListener('click', function(e) {
        const tagContainer = document.getElementById('tag_chips_container');
        const tagDropdown = document.getElementById('tag_suggestions_dropdown');
        if (tagContainer && tagDropdown && !tagContainer.contains(e.target) && !tagDropdown.contains(e.target)) {
            tagDropdown.classList.add('hidden');
        }

        const taskContainer = document.getElementById('task_chip_container');
        const taskDropdown = document.getElementById('task_suggestions_dropdown');
        if (taskContainer && taskDropdown && !taskContainer.contains(e.target) && !taskDropdown.contains(e.target)) {
            taskDropdown.classList.add('hidden');
        }
    });

    const colorPickerInput = document.getElementById('modal_input_color');
    if (colorPickerInput) {
        colorPickerInput.addEventListener('input', (e) => {
            const hexLabel = document.getElementById('custom_color_hex');
            if (hexLabel) hexLabel.innerText = e.target.value.toUpperCase();
        });
    }
}

let sessionModalFocusVersion = 0;
let sessionModalOwner = null;
// The returned row ID is writer identity, not an editable draft field.
const sessionModalDraftFields = 'input:not(#edit_session_id), select, textarea';

// Shared by explicit Schedule dialogs and Calendar's external task drops, not owned by a popup.
let scheduleCreatePending = false;
let scheduleCreateGeneration = 0;
let unconfirmedScheduleCreate = null;

function renderScheduleCreateRecovery() {
    const panel = document.getElementById('schedule_create_recovery');
    const attempt = unconfirmedScheduleCreate;
    if (!panel) return;
    panel.hidden = !attempt;
    if (!attempt) return;
    const fmt = value => new Date(value).toLocaleString();
    const status = document.getElementById('schedule_create_recovery_status');
    const inspect = document.getElementById('schedule_create_inspect');
    const allow = document.getElementById('schedule_create_new_intent');
    status.textContent = `Schedule creation not confirmed (${fmt(attempt.payload.start_time)} — ${fmt(attempt.payload.end_time)}). ` +
        (attempt.result || 'Check saved schedules before starting another plan.');
    allow.disabled = !attempt.inspected;
    inspect.onclick = async () => {
        if (attempt.reading) return;
        attempt.reading = true;
        attempt.inspected = false;
        allow.disabled = true;
        try {
            const { start_time, end_time, task_id } = attempt.payload;
            // A plan can outlast the maximum viewport; its start still fits this read.
            const inspectEnd = new Date(Math.min(+new Date(end_time), +new Date(start_time) + 60000));
            const query = `start=${encodeURIComponent(start_time)}&end=${encodeURIComponent(inspectEnd.toISOString())}`;
            const result = await api.get(`/agenda?${query}`);
            const matches = result.items.filter(row => row.kind === 'scheduled_session' && !row.is_virtual &&
                row.task_id === task_id && +new Date(row.start_time) === +new Date(start_time) && +new Date(row.end_time) === +new Date(end_time));
            attempt.result = matches.length ? `Possible saved plan IDs: ${matches.map(row => row.id).join(', ')}. Do not recreate a plan that already exists.`
                : 'No matching saved plan is visible in this interval. That does not prove the first request failed.';
            attempt.inspected = true;
        } catch {
            attempt.result = 'Could not check saved schedules. Retry the read; creating another plan is blocked.';
        } finally {
            attempt.reading = false;
        }
        if (attempt === unconfirmedScheduleCreate) renderScheduleCreateRecovery();
    };
    allow.onclick = () => {
        if (attempt !== unconfirmedScheduleCreate || !attempt.inspected || attempt.reading) return;
        unconfirmedScheduleCreate = null;
        scheduleCreateGeneration++;
        renderScheduleCreateRecovery();
        const active = document.activeElement;
        if (panel.contains?.(active) || active === document.body) document.getElementById('session_modal_save_btn')?.focus();
    };
}

function scheduleCreateIntent() {
    return unconfirmedScheduleCreate || scheduleCreatePending ? null : scheduleCreateGeneration;
}

async function createScheduledSessionFromEditor(payload, intent = scheduleCreateGeneration) {
    if (unconfirmedScheduleCreate || scheduleCreatePending) {
        throw Object.assign(new Error(unconfirmedScheduleCreate ? 'Close this editor and check Schedule creation recovery before starting another plan.'
            : 'Another Schedule creation is still pending.'), { scheduleRecovery: true });
    }
    if (intent !== scheduleCreateGeneration) {
        throw Object.assign(new Error('This drop predates schedule recovery. Start a new gesture.'), { scheduleRecovery: true });
    }
    scheduleCreatePending = true;
    try {
        return await api.saveScheduledSession(null, payload);
    } catch (err) {
        if (err.status && err.status < 500) throw err;
        scheduleCreateGeneration++;
        unconfirmedScheduleCreate = { payload };
        renderScheduleCreateRecovery();
        throw Object.assign(new Error('Save not confirmed. Close this editor and check Schedule creation recovery before starting another plan.'), { scheduleRecovery: true });
    } finally {
        scheduleCreatePending = false;
    }
}

function setSessionSavePending(owner, pending) {
    owner.pending = pending;
    if (sessionModalOwner !== owner) return;
    for (const id of ['session_modal_save_btn', 'session_modal_delete_btn', 'session_modal_start_now_btn', 'session_modal_new_task_btn']) {
        const button = document.getElementById(id);
        if (button) button.disabled = pending || (id === 'session_modal_save_btn' && Boolean(owner.blocked));
    }
    const modal = document.getElementById('session_modal');
    if (modal) modal.setAttribute('aria-busy', String(pending));
}

function beginSessionModal(calendarLauncher = null) {
    const modal = document.getElementById('session_modal');
    const active = calendarLauncher || document.activeElement;
    const launcher = modal?.contains?.(active) ? sessionModalOwner?.launcher : active;
    if (calendarLauncher && calendarLauncher.tabIndex < 0) calendarLauncher.setAttribute('tabindex', '-1');
    closeSessionModal(false);
    const metadata = document.getElementById('session_modal_metadata');
    if (metadata) metadata.inert = false;
    const choice = document.getElementById('session_modal_intent');
    if (choice) choice.disabled = false;
    sessionModalOwner = { launcher, calendarLauncher: Boolean(calendarLauncher) };
    setSessionSavePending(sessionModalOwner, false);
    const feedback = document.getElementById('session_modal_feedback');
    if (feedback) feedback.textContent = '';
    document.getElementById('session_modal_use_latest')?.classList.add('hidden');
}

function sessionModalSnapshot() {
    return JSON.stringify([
        ...['session_modal_task_id', 'session_modal_start', 'session_modal_end', 'session_modal_notes', 'session_modal_tags_input']
            .map(id => document.getElementById(id).value),
        currentTagChips, sessionModalOwner?.intent
    ]);
}

function scheduleSessionModalFocus(inputId) {
    const modal = document.getElementById('session_modal');
    if (!modal) return;
    const version = ++sessionModalFocusVersion;
    const previousFocus = document.activeElement;
    let interacted = false;
    const markInteraction = () => { interacted = true; };
    const events = ['focusin', 'input', 'pointerdown', 'keydown'];
    events.forEach(name => modal.addEventListener(name, markInteraction));
    setTimeout(() => {
        events.forEach(name => modal.removeEventListener(name, markInteraction));
        // Initial focus yields to immediate editing, dismissal and newer popup instances.
        if (version !== sessionModalFocusVersion || interacted || modal.classList.contains('hidden') ||
            document.activeElement !== previousFocus) return;
        const input = document.getElementById(inputId);
        if (input) {
            input.focus();
            input.select();
        }
    }, 50);
}

function sessionModalFeedback(message) {
    const feedback = document.getElementById('session_modal_feedback');
    if (feedback) feedback.textContent = message;
}

function showSessionModalPlan(row) {
    document.getElementById('session_modal_metadata')?.classList.toggle('hidden', Boolean(row));
    document.getElementById('session_modal_times')?.classList.toggle('hidden', row?.kind === 'recorded_work');
    const detail = document.getElementById('session_modal_plan_detail');
    if (!detail) return;
    detail.classList.toggle('hidden', !row);
    detail.textContent = '';
    if (!row) return;
    const interval = (a, b) => `${new Date(a).toLocaleString()} — ${b ? new Date(b).toLocaleString() : 'No end'}`;
    const fields = row.kind === 'scheduled_session' ? [
        [row.is_virtual ? 'Original plan (provisional)' : 'Original plan', interval(row.original_start, row.original_end)],
        ['Current schedule', interval(row.start_time, row.end_time)],
    ] : [['Recorded work', interval(row.start_time, row.end_time)]];
    fields.push(['Task', row.task_id ? taskKnowledge.get(row.task_id)?.title || 'Task unavailable' : 'No task'],
        ['Tags', row.tags || 'None'], ['Notes', row.notes || 'None']);
    for (const [label, value] of fields) {
        const term = document.createElement('dt'), description = document.createElement('dd');
        term.textContent = label; description.textContent = value;
        detail.appendChild(term); detail.appendChild(description);
    }
    const link = document.createElement('a');
    const at = new Date(row.start_time);
    const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    link.href = `/agenda-view?${new URLSearchParams({date:day, entry:row.id})}`;
    link.textContent = 'Open this entry in Agenda';
    detail.appendChild(link);
    sessionModalFeedback(row.kind === 'recorded_work' ? 'Recorded work is read-only here.'
        : 'Only the current schedule is editable. Record time explicitly adds work; Remove schedule preserves saved work.');
    if (row.kind === 'scheduled_session') mountCalendarPlanActions(detail, row);
}

function mountCalendarPlanActions(detail, row) {
    const owner = sessionModalOwner;
    const sourceId = row.id;
    const available = () => {
        if (sessionModalOwner !== owner || owner.pending || owner.blocked || owner.removalPending) return false;
        if (typeof calendarScheduleNeedsReview === 'function' && calendarScheduleNeedsReview(row)) return false;
        if (owner.timeBaseline?.some((value,index) => value !== document.getElementById(index ? 'session_modal_end' : 'session_modal_start').value)) {
            sessionModalFeedback('Save or discard edited schedule times before recording or removing this plan.'); return false;
        }
        return true;
    };
    const record = document.createElement('button'); record.type = 'button'; record.textContent = 'Record time';
    owner.recordButton = record;
    record.disabled = !row.task_id;
    record.addEventListener('click', () => {
        if (!available()) return;
        if (typeof mountReviewedRecording !== 'function') { sessionModalFeedback('Recording review unavailable; reload before recording.'); return; }
        owner.recordingSourceId = sourceId;
        const view = mountReviewedRecording({document,api,payload:{task_id:row.task_id,start_time:row.start_time,end_time:row.end_time,tags:row.tags || '',notes:'',scheduled_session_id:row.id,
            ...(row.is_virtual ? {expected_projection_revision:row.projection_revision} : {expected_plan_revision:row.revision})},
            acknowledge:result => acknowledgeCalendarRecording(result,sourceId,owner),
            returnFocus:() => sessionModalOwner === owner && !document.getElementById('session_modal').classList.contains('hidden') ? owner.recordButton : null});
        void view.completion.then(result => { if (result) void refreshSessionDisplay(); });
    });
    detail.appendChild(record);
    if (!row.task_id) { const reason = document.createElement('p'); reason.textContent = 'Linked recording requires an assigned task. Taskless plans cannot implicitly assign work.'; detail.appendChild(reason); }
    window.planRemoval?.mount(detail,row,{api,available,lock:pending => {
        if (sessionModalOwner === owner) { owner.removalPending = pending; setSessionSavePending(owner,pending); }
    },ack:async result => {
        if (result.action === 'squeeze' && result.plan) rememberSavedSession(result.plan,result.plan.id);
        else if (result.plan_id && typeof forgetCalendarPlanningRow === 'function') forgetCalendarPlanningRow(result.plan_id);
        if (sessionModalOwner === owner) {
            if (result.action === 'squeeze' && result.plan) openEditSessionModal(result.plan.id,owner.launcher,result.plan);
            else closeSessionModal();
        }
        await refreshSessionDisplay();
    }});
}

function acknowledgeCalendarRecording(result, sourceId = result.requested_scheduled_session_id, owner = null) {
    const plan = result.linked_plan;
    if (plan) {
        const previousId = sourceId || plan.id;
        rememberSavedSession(plan,previousId);
        // Recovery carries the journal's original projection ID, not the materialized UUID.
        const editor = owner || (sessionModalOwner?.recordingSourceId === previousId ? sessionModalOwner : null);
        if (editor && sessionModalOwner === editor && editor.session?.id === previousId) {
            const materialized = previousId !== plan.id;
            // Association ACK changes identity/revision, not input times or their draft baseline.
            Object.assign(editor.session,plan);
            document.getElementById('edit_session_id').value = plan.id;
            if (materialized) showSessionModalPlan(editor.session);
        }
    }
    rememberSavedSession(result,result.id);
}

function updateSessionSaveLabel() {
    const button = document.getElementById('session_modal_save_btn');
    if (button) button.textContent = sessionModalOwner?.intent === 'work' ? 'Review actual work' : sessionModalOwner?.intent === 'schedule' ? 'Save schedule' : 'Save legacy session';
}

function updateSessionModalIntent() {
    const owner = sessionModalOwner;
    if (!owner || owner.session || !owner.chooseIntent || owner.pending || owner.blocked) return;
    owner.intent = document.getElementById('session_modal_intent').value;
    updateSessionSaveLabel();
    document.getElementById('session_modal_start_now_btn')?.classList.toggle('hidden', owner.intent !== 'legacy' || !owner.canStartNow);
    sessionModalFeedback(owner.intent === 'schedule' ? 'Scheduling time does not record work.' : owner.intent === 'work'
        ? 'Explicitly record actual past work. This does not create or attach a plan.' : 'Saved in uncertain legacy history.');
}

async function useLatestSessionSchedule() {
    const owner = sessionModalOwner;
    const latest = owner?.latest;
    if (!latest || !await window.appDialogs.confirm({title:'Use saved schedule?', message:'Replace your unsaved times with the saved schedule?'})) return;
    if (sessionModalOwner !== owner || owner.pending || owner.latest !== latest) return;
    openEditSessionModal(latest.id, owner.launcher, latest);
}

async function reviewSessionModalSchedule(owner, id) {
    try {
        const latest = await api.get(`/scheduled-sessions/${encodeURIComponent(id)}`);
        if (sessionModalOwner !== owner || document.getElementById('session_modal').classList.contains('hidden')) return;
        owner.latest = latest;
        sessionModalFeedback(`Latest saved times: ${new Date(latest.start_time).toLocaleString()} — ${new Date(latest.end_time).toLocaleString()}. Your input is unchanged.`);
        document.getElementById('session_modal_use_latest')?.classList.remove('hidden');
    } catch (err) {
        if (sessionModalOwner === owner) sessionModalFeedback(`Could not read the saved schedule: ${err.message}. Refresh Calendar and reopen the entry to review.`);
    }
}

function openEditSessionModal(sessionId, launcher = null, recordedSession = null) {
    const session = recordedSession?.id === sessionId ? recordedSession
        : (typeof calendarSessionRows === 'function' ? calendarSessionRows().find(s => s.id === sessionId) : null)
            || (typeof allSessions !== 'undefined' ? allSessions.find(s => s.id === sessionId) : null);
    if (!session) return;
    beginSessionModal(launcher);
    const owner = sessionModalOwner;
    owner.session = session;
    owner.intent = session.kind === 'scheduled_session' ? 'schedule' : 'legacy';
    updateSessionSaveLabel();
    owner.blocked = session.kind === 'recorded_work';
    const typed = owner.intent === 'schedule' || owner.blocked;
    document.getElementById('session_modal_intent_choice')?.classList.add('hidden');

    document.getElementById('edit_session_id').value = session.id;
    const titleEl = document.getElementById('session_modal_title');
    if (titleEl) titleEl.innerText = typed ? (owner.blocked ? 'Recorded work' : 'Edit current schedule') : 'Edit Legacy Session';

    document.getElementById('session_modal_start_now_btn').classList.toggle('hidden',
        session.kind !== 'scheduled_session' || !session.task_id);
    const deleteBtn = document.getElementById('session_modal_delete_btn');
    if (deleteBtn) deleteBtn.classList.toggle('hidden', typed);

    const taskDropdown = document.getElementById('task_suggestions_dropdown');
    if (taskDropdown) taskDropdown.classList.add('hidden');
    const tagDropdown = document.getElementById('tag_suggestions_dropdown');
    if (tagDropdown) tagDropdown.classList.add('hidden');

    const startDate = parseApiDateTime(session.start_time);
    const endDate = session.end_time ? parseApiDateTime(session.end_time) : new Date(startDate.getTime() + (session.duration_seconds || 900) * 1000);

    document.getElementById('session_modal_start').value = formatIsoLocal(startDate);
    document.getElementById('session_modal_end').value = formatIsoLocal(endDate);

    if (session.task_id) {
        attachTaskById(session.task_id, true, "", true);
    } else {
        detachTask();
    }

    setTagChips(session.tags || "");
    document.getElementById('session_modal_notes').value = session.notes || "";

    updateSessionModalDurationBadge();
    document.getElementById('session_modal').classList.remove('hidden');
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('session_modal', sessionModalDraftFields);

    owner.timeBaseline = [document.getElementById('session_modal_start').value, document.getElementById('session_modal_end').value];
    showSessionModalPlan(typed ? session : null);
    setSessionSavePending(owner, false);
    if (!owner.blocked) scheduleSessionModalFocus(typed ? 'session_modal_start' : 'session_modal_notes');
}

function openCreateSessionModal(startDate, endDate, taskId = null, taskTitle = "", intent = "legacy") {
    try {
        beginSessionModal();
        const owner = sessionModalOwner;
        owner.intent = intent === 'calendar' ? 'schedule' : intent;
        updateSessionSaveLabel();
        owner.chooseIntent = intent === 'calendar';
        document.getElementById('session_modal_intent_choice')?.classList.toggle('hidden', !owner.chooseIntent);
        const choice = document.getElementById('session_modal_intent');
        if (choice) choice.value = owner.intent;
        showSessionModalPlan(null);
        const editIdEl = document.getElementById('edit_session_id');
        if (editIdEl) editIdEl.value = "";

        const titleEl = document.getElementById('session_modal_title');
        if (titleEl) titleEl.innerText = owner.chooseIntent ? 'Calendar Session' : owner.intent === 'schedule' ? 'Schedule Session' : 'Legacy Session';

        const deleteBtn = document.getElementById('session_modal_delete_btn');
        if (deleteBtn) deleteBtn.classList.add('hidden');

        const taskDropdown = document.getElementById('task_suggestions_dropdown');
        if (taskDropdown) taskDropdown.classList.add('hidden');
        const tagDropdown = document.getElementById('tag_suggestions_dropdown');
        if (tagDropdown) tagDropdown.classList.add('hidden');

        const now = new Date();
        const startNowBtn = document.getElementById('session_modal_start_now_btn');

        const attachedTaskObj = taskId ? taskKnowledge.get(taskId) : null;
        const estMins = attachedTaskObj ? (attachedTaskObj.estimated_minutes || 15) : 15;
        const defaultSessionMins = estMins > 120 ? 30 : estMins;

        if (!endDate || endDate <= startDate) {
            endDate = new Date(startDate.getTime() + defaultSessionMins * 60 * 1000);
        }
        if (owner.chooseIntent) {
            owner.intent = endDate <= now ? 'work' : 'schedule';
            if (choice) choice.value = owner.intent;
            updateSessionSaveLabel();
        }

        const startInput = document.getElementById('session_modal_start');
        if (startInput) startInput.value = formatIsoLocal(startDate);

        const endInput = document.getElementById('session_modal_end');
        if (endInput) endInput.value = formatIsoLocal(endDate);

        owner.canStartNow = startDate <= now && endDate > now;
        if (owner.intent === 'legacy' && owner.canStartNow) {
            if (startNowBtn) startNowBtn.classList.remove('hidden');
        } else {
            if (startNowBtn) startNowBtn.classList.add('hidden');
        }

        if (taskId) {
            if (typeof attachTaskById === 'function') {
                attachTaskById(taskId, true, taskTitle);
            }
            if (!attachedTaskObj || !attachedTaskObj.tags || !attachedTaskObj.tags.trim()) {
                if (typeof setTagChips === 'function') setTagChips("");
            }
        } else {
            if (typeof detachTask === 'function') detachTask();
            if (typeof setTagChips === 'function') setTagChips("");
        }

        const notesInput = document.getElementById('session_modal_notes');
        if (notesInput) notesInput.value = "";

        if (typeof updateSessionModalDurationBadge === 'function') updateSessionModalDurationBadge();

        const modal = document.getElementById('session_modal');
        if (modal) modal.classList.remove('hidden');
        if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('session_modal', sessionModalDraftFields);

        if (owner.intent === 'schedule') sessionModalFeedback('Scheduling time does not record work.');
        else if (owner.intent === 'work') sessionModalFeedback('Explicitly record actual past work. This does not create or attach a plan.');
        scheduleSessionModalFocus('session_modal_task_search');
    } catch (err) {
        console.error("Error opening session modal:", err);
    }
}

function restoreSessionModalFocus(owner, refreshing = false) {
    const calendarRegion = document.getElementById('calendar');
    const refreshDisposesLauncher = refreshing && (owner?.calendarLauncher ||
        document.getElementById('task_card_list')?.contains?.(owner?.launcher));
    const target = owner?.launcher?.isConnected && !refreshDisposesLauncher
        ? owner.launcher : calendarRegion;
    if (target === calendarRegion && target) target.setAttribute('tabindex', '-1');
    target?.focus({ preventScroll: true });
}

function closeSessionModal(restoreFocus = true) {
    sessionModalFocusVersion++;
    closeRecurringDeleteModal();
    const modal = document.getElementById('session_modal');
    if (modal) {
        modal.classList.add('hidden');
        delete modal.dataset.settingsDraftRetained;
    }
    if (restoreFocus) restoreSessionModalFocus(sessionModalOwner);
    if (typeof suspendedSessionModal !== 'undefined') suspendedSessionModal = null;
    if (typeof calendar !== 'undefined' && calendar) {
        calendar.unselect();
    }
}

async function saveSessionFromModal() {
    const owner = sessionModalOwner;
    if (!owner || owner.pending || owner.blocked || document.getElementById('session_modal').classList.contains('hidden')) return;
    const typed = owner.intent === 'schedule';
    const work = owner.intent === 'work';
    if (typeof calendarScheduleNeedsReview === 'function' && calendarScheduleNeedsReview(owner.session)) {
        sessionModalFeedback('Review the previous attempt in Calendar before editing this entry again.');
        return;
    }
    const metadata = document.getElementById('session_modal_metadata');
    const intent = document.getElementById('session_modal_intent');
    setSessionSavePending(owner, true);
    let savedSession, submittedSnapshot, checkpoint, attemptedPayload;
    const sessionId = document.getElementById('edit_session_id').value;
    try {
        const extraTypedTag = document.getElementById('session_modal_tags_input').value.trim();
        if (extraTypedTag) {
            addTagChip(extraTypedTag);
            document.getElementById('session_modal_tags_input').value = '';
        }
        const startVal = document.getElementById('session_modal_start').value;
        const endVal = document.getElementById('session_modal_end').value;
        const previous = owner.session;
        const savedStart = typed && previous && startVal === owner.timeBaseline?.[0] ? previous.start_time : null;
        const savedEnd = typed && previous && endVal === owner.timeBaseline?.[1] ? previous.end_time : null;
        const startDt = new Date(savedStart || startVal);
        const endDt = new Date(savedEnd || endVal);
        if (!startVal || !endVal || isNaN(startDt.getTime()) || isNaN(endDt.getTime()) || endDt <= startDt) {
            window.appDialogs.alert({message:'End time must be after a valid Start time.'});
            return;
        }
        const payload = {
            task_id: document.getElementById('session_modal_task_id').value || null,
            start_time: savedStart || startDt.toISOString(),
            end_time: savedEnd || endDt.toISOString(),
            tags: currentTagChips.join(' '),
            notes: document.getElementById('session_modal_notes').value || ''
        };
        attemptedPayload = payload;
        submittedSnapshot = sessionModalSnapshot();
        checkpoint = typeof settingsDraftCheckpoint === 'function' ? settingsDraftCheckpoint('session_modal', sessionModalDraftFields) : () => {};
        if (intent) intent.disabled = true;
        if (typed) {
            if (metadata && !sessionId) metadata.inert = true;
            owner.submittedTimes = [startVal, endVal];
        }
        savedSession = work ? await mountReviewedRecording({document,api,payload,acknowledge:acknowledgeCalendarRecording}).completion : typed ? (previous ? await api.saveScheduledSession(previous, payload)
            : await createScheduledSessionFromEditor(payload)) : sessionId
            ? await api.put(`/sessions/${encodeURIComponent(sessionId)}`, payload)
            : await api.post('/sessions', payload);
    } catch (err) {
        if (work) {
            owner.blocked = !err.status || err.status >= 500 || err.status === 409;
            if (sessionModalOwner === owner) sessionModalFeedback(owner.blocked
                ? 'Recording not confirmed. Your input is retained. Check recorded work in Agenda; do not repeat this recording.' : err.message);
        } else if (typed && err.scheduleRecovery) {
            if (sessionModalOwner === owner) sessionModalFeedback(err.message);
        } else if (typed) {
            const uncertain = !err.status || err.status >= 500;
            owner.blocked = uncertain || err.status === 409;
            if (owner.blocked && owner.session && typeof calendarNeedsReview !== 'undefined') {
                const row = owner.session;
                const occurrence = calendarOccurrenceId(row.id, row.series_task_id, row.occurrence_start);
                calendarNeedsReview.set(occurrence || row.id, {id:row.id, occurrence,
                    title:'Scheduled session', payload:attemptedPayload, uncertain});
                renderCalendarScheduleReviews();
            }
            if (sessionModalOwner === owner) {
                sessionModalFeedback(uncertain ? 'Save not confirmed. Check Calendar or Agenda before trying again.'
                    : err.status === 409 ? 'Schedule changed on the server. Your input is retained for review.' : err.message);
                if (owner.blocked && sessionId) void reviewSessionModalSchedule(owner, sessionId);
            }
            if (owner.blocked) void refreshSessionDisplay();
        } else {
            console.error('Failed to save session:', err);
            window.appDialogs.alert({message:'Failed to save session: ' + (err.message || err)});
        }
        return;
    } finally {
        if (sessionModalOwner === owner) {
            if (metadata) metadata.inert = false;
            if (intent) intent.disabled = false;
        }
        setSessionSavePending(owner, false);
    }

    if (work && !savedSession) return; // Dismissal approves no recording; retain the editor draft.
    // A successful write is authoritative before any fallible display work, including POST IDs.
    if (savedSession && sessionModalOwner === owner) {
        document.getElementById('edit_session_id').value = savedSession.id;
        checkpoint();
        if (typed || work) {
            owner.session = savedSession;
            if (work) owner.blocked = true;
            owner.timeBaseline = owner.submittedTimes;
            document.getElementById('session_modal_intent_choice')?.classList.add('hidden');
            document.getElementById('session_modal_delete_btn')?.classList.add('hidden');
            showSessionModalPlan(savedSession);
        }
    }
    rememberSavedSession(savedSession, sessionId);
    if (sessionModalOwner === owner && !document.getElementById('session_modal').classList.contains('hidden')) {
        if (submittedSnapshot === sessionModalSnapshot()) {
            closeSessionModal(false);
            // Calendar events and sidebar task launchers are replaced on refresh; use the stable planning region.
            restoreSessionModalFocus(owner, true);
        } else {
            const feedback = document.getElementById('session_modal_feedback');
            if (feedback) feedback.textContent = 'Saved. New edits are still unsaved; Save again to keep them.';
        }
    }
    await refreshSessionDisplay();
}

function deleteSessionFromModal() {
    const sessionId = document.getElementById('edit_session_id').value;
    if (sessionModalOwner?.pending || sessionModalOwner?.blocked ||
        (typeof calendarScheduleNeedsReview === 'function' && calendarScheduleNeedsReview(sessionModalOwner?.session))) return;
    if (!sessionId || sessionModalOwner?.session?.kind === 'scheduled_session' || sessionModalOwner?.session?.kind === 'recorded_work') return;
    promptDeleteSession(sessionId);
}

async function startTimerFromModal() {
    const owner = sessionModalOwner;
    if (!owner || owner.intent === 'work' || owner.pending || owner.blocked || document.getElementById('session_modal').classList.contains('hidden')) return;
    if (typeof startTimerFromSession !== 'function') {
        document.getElementById('session_modal_feedback').textContent = 'Timer controller unavailable. Reload before starting a timer.';
        return;
    }
    if (typeof calendarScheduleNeedsReview === 'function' && calendarScheduleNeedsReview(owner.session)) {
        sessionModalFeedback('Review the previous schedule attempt before starting a timer.');
        return;
    }
    const taskIdVal = document.getElementById('session_modal_task_id').value;
    const extraTypedTag = document.getElementById('session_modal_tags_input').value.trim();
    if (extraTypedTag) addTagChip(extraTypedTag);

    const tagsVal = (typeof currentTagChips !== 'undefined' && currentTagChips.length > 0) ? currentTagChips.join(' ') : '';
    const notesVal = document.getElementById('session_modal_notes').value;

    const snapshot = sessionModalSnapshot();
    const launcher = document.getElementById('session_modal_start_now_btn');
    const recoveryFocus = () => {
        if (sessionModalOwner === owner && !document.getElementById('session_modal').classList.contains('hidden') &&
                launcher?.isConnected && !launcher.disabled) return launcher;
        const region = document.getElementById('calendar');
        region?.setAttribute('tabindex', '-1');
        return region;
    };
    setSessionSavePending(owner, true);
    let started = false;
    try {
        started = await startTimerFromSession({
            task_id: taskIdVal ? taskIdVal : null,
            tags: tagsVal,
            notes: notesVal || "",
            ...(owner.session?.kind === 'scheduled_session' && taskIdVal && taskIdVal === owner.session.task_id ? {
                scheduled_session_id:owner.session.id,
                ...(owner.session.is_virtual ? {expected_projection_revision:owner.session.projection_revision}
                    : {expected_plan_revision:owner.session.revision})
            } : {})
        }, () => sessionModalOwner === owner && sessionModalSnapshot() === snapshot &&
            !document.getElementById('session_modal').classList.contains('hidden'), recoveryFocus);
    } finally {
        setSessionSavePending(owner, false);
    }
    if (sessionModalOwner !== owner) return;
    if (started && sessionModalSnapshot() === snapshot) closeSessionModal();
    else document.getElementById('session_modal_feedback').textContent = started
        ? 'Timer start acknowledged. Your newer Session edits are retained, not saved.'
        : 'Timer not started or outcome uncertain. Review timer recovery/status; no automatic retry.';
}
