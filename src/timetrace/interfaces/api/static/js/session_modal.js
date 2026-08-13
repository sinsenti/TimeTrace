/**
 * TimeTrace Session Modal & Stepper Logic
 */

function setupModalKeyboardListeners() {
    const taskModal = document.getElementById('task_modal');
    if (taskModal) {
        taskModal.addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                saveTask();
            } else if (e.key === 'Escape') {
                closeTaskModal();
            }
        });
    }

    const sessionModal = document.getElementById('session_modal');
    if (sessionModal) {
        sessionModal.addEventListener('keydown', function(e) {
            const activeEl = document.activeElement;
            const isTypingText = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                saveSessionFromModal();
            } else if (e.key === 'Escape') {
                closeSessionModal();
            } else if ((e.key === '+' || e.key === '=') && !isTypingText) {
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
            } else if (e.key === 'Enter') {
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
            } else if (e.key === '+') {
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
            } else if (e.key === 'Enter' || e.key === ' ') {
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

function openEditSessionModal(sessionId) {
    const session = allSessions.find(s => String(s.id) === String(sessionId));
    if (!session) return;

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

    if (session.task_id && allTasksMap[session.task_id]) {
        attachTaskById(session.task_id, true);
    } else {
        detachTask();
    }

    setTagChips(session.tags || "");
    document.getElementById('session_modal_notes').value = session.notes || "";

    updateSessionModalDurationBadge();
    document.getElementById('session_modal').classList.remove('hidden');

    setTimeout(() => {
        const notesInput = document.getElementById('session_modal_notes');
        if (notesInput) {
            notesInput.focus();
            notesInput.select();
        }
    }, 50);
}

function openCreateSessionModal(startDate, endDate, taskId = null, taskTitle = "") {
    document.getElementById('edit_session_id').value = "";
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

    if (!endDate || endDate <= startDate) {
        endDate = new Date(startDate.getTime() + 15 * 60 * 1000);
    }

    document.getElementById('session_modal_start').value = formatIsoLocal(startDate);
    document.getElementById('session_modal_end').value = formatIsoLocal(endDate);

    if (startDate <= now && endDate > now) {
        if (startNowBtn) startNowBtn.classList.remove('hidden');
    } else {
        if (startNowBtn) startNowBtn.classList.add('hidden');
    }

    const settings = getUserSettings();

    if (taskId && allTasksMap[taskId]) {
        attachTaskById(taskId, true);
        const attachedTaskObj = allTasksMap[taskId];
        if (!attachedTaskObj.tags || !attachedTaskObj.tags.trim()) {
            setTagChips(settings.defaultTag || "#general");
        }
    } else {
        detachTask();
        setTagChips(settings.defaultTag || "#general");
    }

    document.getElementById('session_modal_notes').value = taskTitle ? `Working on ${taskTitle}` : "";

    updateSessionModalDurationBadge();
    document.getElementById('session_modal').classList.remove('hidden');

    setTimeout(() => {
        const taskSearchInput = document.getElementById('session_modal_task_search');
        if (taskSearchInput) {
            taskSearchInput.focus();
            taskSearchInput.select();
        }
    }, 50);
}

function closeSessionModal() {
    const modal = document.getElementById('session_modal');
    if (modal) modal.classList.add('hidden');
}

async function saveSessionFromModal() {
    const sessionId = document.getElementById('edit_session_id').value;
    const taskIdVal = document.getElementById('session_modal_task_id').value;
    const startVal = document.getElementById('session_modal_start').value;
    const endVal = document.getElementById('session_modal_end').value;
    const notesVal = document.getElementById('session_modal_notes').value;

    const extraTypedTag = document.getElementById('session_modal_tags_input').value.trim();
    if (extraTypedTag) addTagChip(extraTypedTag);

    const settings = getUserSettings();
    const tagsVal = currentTagChips.length > 0 ? currentTagChips.join(' ') : (settings.defaultTag || '#general');

    if (!startVal || !endVal) return;

    const payload = {
        task_id: taskIdVal ? parseInt(taskIdVal) : null,
        start_time: new Date(startVal).toISOString(),
        end_time: new Date(endVal).toISOString(),
        tags: tagsVal,
        notes: notesVal || ""
    };

    if (sessionId) {
        await api.put(`/api/v1/sessions/${sessionId}`, payload);
    } else {
        await api.post('/api/v1/sessions', payload);
    }

    closeSessionModal();
    if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
}

async function deleteSessionFromModal() {
    const sessionId = document.getElementById('edit_session_id').value;
    if (!sessionId) return;

    const confirmed = await showCustomConfirm("Delete Session Log", "Are you sure you want to delete this session log? This action cannot be undone.");
    if (confirmed) {
        await api.delete(`/api/v1/sessions/${sessionId}`);
        closeSessionModal();
        if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
    }
}

async function startTimerFromModal() {
    const taskIdVal = document.getElementById('session_modal_task_id').value;
    const extraTypedTag = document.getElementById('session_modal_tags_input').value.trim();
    if (extraTypedTag) addTagChip(extraTypedTag);

    const settings = getUserSettings();
    const tagsVal = currentTagChips.length > 0 ? currentTagChips.join(' ') : (settings.defaultTag || '#general');
    const notesVal = document.getElementById('session_modal_notes').value;

    await api.post('/api/v1/timer/start', {
        task_id: taskIdVal ? parseInt(taskIdVal) : null,
        tags: tagsVal,
        notes: notesVal || ""
    });

    closeSessionModal();
    fetchTimerStatus();
}
