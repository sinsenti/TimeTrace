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
            } else if ((e.key === '+' || e.key === '=') && !isTypingText && !sessionModalOwner?.pending) {
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
            } else if (e.key === '+' && !sessionModalOwner?.pending) {
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

function setSessionSavePending(owner, pending) {
    owner.pending = pending;
    if (sessionModalOwner !== owner) return;
    for (const id of ['session_modal_save_btn', 'session_modal_delete_btn', 'session_modal_start_now_btn', 'session_modal_new_task_btn']) {
        const button = document.getElementById(id);
        if (button) button.disabled = pending;
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
    sessionModalOwner = { launcher, calendarLauncher: Boolean(calendarLauncher) };
    setSessionSavePending(sessionModalOwner, false);
    const feedback = document.getElementById('session_modal_feedback');
    if (feedback) feedback.textContent = '';
}

function sessionModalSnapshot() {
    return JSON.stringify([
        ...['session_modal_task_id', 'session_modal_start', 'session_modal_end', 'session_modal_notes', 'session_modal_tags_input']
            .map(id => document.getElementById(id).value),
        currentTagChips
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

function openEditSessionModal(sessionId, launcher = null, recordedSession = null) {
    const session = recordedSession?.id === sessionId ? recordedSession
        : typeof allSessions !== 'undefined' ? allSessions.find(s => String(s.id) === String(sessionId)) : null;
    if (!session) return;
    beginSessionModal(launcher);

    document.getElementById('edit_session_id').value = session.id;
    const titleEl = document.getElementById('session_modal_title');
    if (titleEl) titleEl.innerText = "Edit Session";

    document.getElementById('session_modal_start_now_btn').classList.add('hidden');
    const deleteBtn = document.getElementById('session_modal_delete_btn');
    if (deleteBtn) deleteBtn.classList.remove('hidden');

    const taskDropdown = document.getElementById('task_suggestions_dropdown');
    if (taskDropdown) taskDropdown.classList.add('hidden');
    const tagDropdown = document.getElementById('tag_suggestions_dropdown');
    if (tagDropdown) tagDropdown.classList.add('hidden');

    const startDate = parseApiDateTime(session.start_time);
    const endDate = session.end_time ? parseApiDateTime(session.end_time) : new Date(startDate.getTime() + (session.duration_seconds || 900) * 1000);

    document.getElementById('session_modal_start').value = formatIsoLocal(startDate);
    document.getElementById('session_modal_end').value = formatIsoLocal(endDate);

    if (session.task_id) {
        attachTaskById(session.task_id, true);
    } else {
        detachTask();
    }

    setTagChips(session.tags || "");
    document.getElementById('session_modal_notes').value = session.notes || "";

    updateSessionModalDurationBadge();
    document.getElementById('session_modal').classList.remove('hidden');
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('session_modal', sessionModalDraftFields);

    scheduleSessionModalFocus('session_modal_notes');
}

function openCreateSessionModal(startDate, endDate, taskId = null, taskTitle = "") {
    try {
        beginSessionModal();
        const editIdEl = document.getElementById('edit_session_id');
        if (editIdEl) editIdEl.value = "";

        const titleEl = document.getElementById('session_modal_title');
        if (titleEl) titleEl.innerText = "Calendar Session";

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

        const startInput = document.getElementById('session_modal_start');
        if (startInput) startInput.value = formatIsoLocal(startDate);

        const endInput = document.getElementById('session_modal_end');
        if (endInput) endInput.value = formatIsoLocal(endDate);

        if (startDate <= now && endDate > now) {
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
    if (!owner || owner.pending || document.getElementById('session_modal').classList.contains('hidden')) return;
    setSessionSavePending(owner, true);
    let savedSession, submittedSnapshot, checkpoint;
    const sessionId = document.getElementById('edit_session_id').value;
    try {
        const extraTypedTag = document.getElementById('session_modal_tags_input').value.trim();
        if (extraTypedTag) {
            addTagChip(extraTypedTag);
            document.getElementById('session_modal_tags_input').value = '';
        }
        const startVal = document.getElementById('session_modal_start').value;
        const endVal = document.getElementById('session_modal_end').value;
        const startDt = new Date(startVal);
        const endDt = new Date(endVal);
        if (!startVal || !endVal || isNaN(startDt.getTime()) || isNaN(endDt.getTime()) || endDt <= startDt) {
            alert('End time must be after a valid Start time.');
            return;
        }
        const payload = {
            task_id: document.getElementById('session_modal_task_id').value || null,
            start_time: startDt.toISOString(),
            end_time: endDt.toISOString(),
            tags: currentTagChips.join(' '),
            notes: document.getElementById('session_modal_notes').value || ''
        };
        submittedSnapshot = sessionModalSnapshot();
        checkpoint = typeof settingsDraftCheckpoint === 'function' ? settingsDraftCheckpoint('session_modal', sessionModalDraftFields) : () => {};
        savedSession = sessionId
            ? await api.put(`/sessions/${encodeURIComponent(sessionId)}`, payload)
            : await api.post('/sessions', payload);
    } catch (err) {
        console.error('Failed to save session:', err);
        alert('Failed to save session: ' + (err.message || err));
        return;
    } finally {
        setSessionSavePending(owner, false);
    }

    // A successful write is authoritative before any fallible display work, including POST IDs.
    if (savedSession && sessionModalOwner === owner) {
        document.getElementById('edit_session_id').value = savedSession.id;
        checkpoint();
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
    if (!sessionId) return;
    promptDeleteSession(sessionId);
}

async function startTimerFromModal() {
    const owner = sessionModalOwner;
    if (!owner || owner.pending || document.getElementById('session_modal').classList.contains('hidden')) return;
    if (typeof startTimerFromSession !== 'function') {
        document.getElementById('session_modal_feedback').textContent = 'Timer controller unavailable. Reload before starting a timer.';
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
            notes: notesVal || ""
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
