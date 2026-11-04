/**
 * TimeTrace Global Task Modal Engine
 */

let suspendedSessionModal = null;
let taskEditorGeneration = 0;
let taskSaveInFlight = false;
let savedTaskParent = null;
let queuedTaskChildren = [];
let taskReturnFocus = null;

function taskSaveFeedback(message) {
    const el = document.getElementById('task_save_feedback');
    if (el) el.textContent = message;
}

function renderTaskChildQueue() {
    const list = document.getElementById('task_child_queue');
    if (list) {
        list.replaceChildren();
        queuedTaskChildren.forEach((child, index) => {
            const row = document.createElement('li');
            const title = document.createElement('span');
            title.textContent = `${child.title}${child.id ? ' — Saved' : ' — Not saved'}`;
            row.appendChild(title);
            if (!child.id) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.textContent = 'Remove';
                remove.className = 'ml-2 underline';
                remove.disabled = taskSaveInFlight;
                remove.addEventListener('click', () => {
                    if (taskSaveInFlight) return;
                    queuedTaskChildren.splice(index, 1);
                    renderTaskChildQueue();
                });
                row.appendChild(remove);
            }
            list.appendChild(row);
        });
    }
    // The Settings departure guard observes form fields, including this queue draft.
    const draft = document.getElementById('task_children_draft');
    if (draft) draft.value = JSON.stringify(queuedTaskChildren.filter(child => !child.id).map(child => child.title));
}

function queueTaskChild() {
    if (taskSaveInFlight) return;
    const input = document.getElementById('task_child_title');
    if (!input?.value.trim()) return;
    queuedTaskChildren.push({ title: input.value.trim(), id: null });
    input.value = '';
    renderTaskChildQueue();
    input.focus();
}

function setTaskParentLocked(locked) {
    const modal = document.getElementById('task_modal');
    modal?.querySelectorAll?.('input, select, textarea').forEach(el => {
        if (!['task_child_title', 'task_children_draft'].includes(el.id)) el.disabled = locked;
    });
    document.getElementById('swatch_list')?.querySelectorAll('button').forEach(button => {
        button.disabled = locked;
    });
    const deleteButton = document.getElementById('modal_delete_btn');
    if (deleteButton) deleteButton.disabled = locked;
    const parse = document.getElementById('ai_quickadd_parse_btn');
    if (parse) parse.disabled = locked;
}

function resetTaskEditor() {
    taskEditorGeneration++;
    taskReturnFocus = document.activeElement;
    savedTaskParent = null;
    queuedTaskChildren = [];
    setTaskParentLocked(false);
    const input = document.getElementById('task_child_title');
    if (input) input.value = '';
    renderTaskChildQueue();
    taskSaveFeedback('');
    const save = document.getElementById('task_save_btn');
    if (save) save.textContent = 'Save';
    if (typeof aiQuickAddReset === 'function') aiQuickAddReset();
}

function resumeSessionModalFromTask(task = null) {
    if (!suspendedSessionModal) return;
    const { returnFocus } = suspendedSessionModal;
    suspendedSessionModal = null;
    const modal = document.getElementById('session_modal');
    if (!modal) return;
    if (task) attachTaskById(task.id, true, task.title, true);
    modal.classList.remove('hidden');
    delete modal.dataset.settingsDraftRetained;
    // Resume the initialized DOM and its original baseline, not a new Session editor.
    returnFocus?.focus();
}

function toggleRecurrenceRuleSelect(isRecurring) {
    const container = document.getElementById('recurrence_rule_container');
    if (!container) return;
    if (isRecurring) {
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
}

function renderColorSwatches(activeHex = '') {
    const list = document.getElementById('swatch_list');
    if (!list) return;

    list.innerHTML = defaultPalette.map(hex => `
        <button type="button" ${taskSaveInFlight || savedTaskParent ? 'disabled' : ''} onclick="selectSwatch('${hex}')" class="w-5 h-5 rounded-full border-2 transition transform hover:scale-125 ${activeHex.toLowerCase() === hex.toLowerCase() ? 'border-white scale-110' : 'border-transparent'}" style="background-color: ${hex};"></button>
    `).join('');
}

function selectSwatch(hex) {
    if (taskSaveInFlight || savedTaskParent) return;
    const picker = document.getElementById('modal_input_color');
    const hexLabel = document.getElementById('custom_color_hex');
    if (picker) picker.value = hex;
    if (hexLabel) hexLabel.innerText = hex.toUpperCase();
    renderColorSwatches(hex);
}

function toggleCustomColorPicker(val) {
    const container = document.getElementById('custom_color_container');
    const swatches = document.getElementById('color_swatches_container');
    if (!container || !swatches) return;

    if (val === 'custom') {
        container.classList.remove('hidden');
        swatches.classList.remove('hidden');
        const picker = document.getElementById('modal_input_color');
        renderColorSwatches(picker ? picker.value : defaultPalette[0]);
    } else {
        container.classList.add('hidden');
        swatches.classList.add('hidden');
    }
}

function openNewTaskModal() {
    if (taskSaveInFlight) return;
    resetTaskEditor();
    const idEl = document.getElementById('edit_task_id');
    if (idEl) idEl.value = '';

    const modalTitle = document.getElementById('modal_task_title');
    if (modalTitle) modalTitle.innerText = 'Create Task';

    const titleInput = document.getElementById('modal_input_title');
    if (titleInput) titleInput.value = '';

    const descInput = document.getElementById('modal_input_desc');
    if (descInput) descInput.value = '';

    const tagsInput = document.getElementById('modal_input_tags');
    if (tagsInput) tagsInput.value = '';

    const prioSelect = document.getElementById('modal_input_priority');
    if (prioSelect) prioSelect.value = '-';

    const statusSelect = document.getElementById('modal_input_status');
    if (statusSelect) statusSelect.value = 'To Do';

    const catSelect = document.getElementById('modal_input_category');
    if (catSelect) catSelect.value = 'work';

    const estInput = document.getElementById('modal_input_est');
    if (estInput) estInput.value = '15m';

    const assignedInput = document.getElementById('modal_input_assigned_date');
    if (assignedInput) assignedInput.value = '';

    const dueInput = document.getElementById('modal_input_due_date');
    if (dueInput) dueInput.value = '';

    const attachInput = document.getElementById('modal_input_attachments');
    if (attachInput) attachInput.value = '';

    const recurCheck = document.getElementById('modal_input_is_recurring');
    if (recurCheck) recurCheck.checked = false;

    const ruleSelect = document.getElementById('modal_input_recurrence_rule');
    if (ruleSelect) ruleSelect.value = 'daily';

    toggleRecurrenceRuleSelect(false);

    const reqReviewCheck = document.getElementById('modal_input_requires_review');
    if (reqReviewCheck) reqReviewCheck.checked = true;

    const colorModeSelect = document.getElementById('modal_input_color_mode');
    if (colorModeSelect) colorModeSelect.value = 'auto';
    toggleCustomColorPicker('auto');

    const deleteBtn = document.getElementById('modal_delete_btn');
    if (deleteBtn) deleteBtn.classList.add('hidden');

    const modal = document.getElementById('task_modal');
    if (modal) modal.classList.remove('hidden');
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('task_modal');

    if (titleInput) {
        titleInput.focus();
        titleInput.select();
    }
}

async function openEditTaskModal(id) {
    if (taskSaveInFlight) return;
    resetTaskEditor();
    const generation = taskEditorGeneration;
    const cached = taskKnowledge.get(id);
    // Last-known display rows and title-only fallbacks must not populate an editable snapshot.
    let t = taskKnowledge.state().status === 'fresh' && cached && cached.status !== undefined ? cached : null;

    if (!t) {
        try {
            t = await api.get(`/api/tasks/${id}`);
        } catch(e) {
            console.error("Task not found:", id);
            return;
        }
    }
    if (!t || generation !== taskEditorGeneration) return;

    const idEl = document.getElementById('edit_task_id');
    if (idEl) idEl.value = t.id;

    const modalTitle = document.getElementById('modal_task_title');
    if (modalTitle) modalTitle.innerText = 'Edit Task';

    const titleInput = document.getElementById('modal_input_title');
    if (titleInput) titleInput.value = t.title || '';

    const descInput = document.getElementById('modal_input_desc');
    if (descInput) descInput.value = t.description || '';

    const tagsInput = document.getElementById('modal_input_tags');
    if (tagsInput) tagsInput.value = t.tags || '';

    const prioSelect = document.getElementById('modal_input_priority');
    if (prioSelect) prioSelect.value = t.priority || '-';

    const statusSelect = document.getElementById('modal_input_status');
    if (statusSelect) statusSelect.value = t.status || 'To Do';

    const catSelect = document.getElementById('modal_input_category');
    if (catSelect) catSelect.value = t.category || 'work';

    const estInput = document.getElementById('modal_input_est');
    if (estInput) estInput.value = formatMinutesToDuration(t.estimated_minutes);

    const assignedInput = document.getElementById('modal_input_assigned_date');
    if (assignedInput) assignedInput.value = t.assigned_date ? formatFlexibleDateForInput(t.assigned_date) : '';

    const dueInput = document.getElementById('modal_input_due_date');
    if (dueInput) dueInput.value = t.due_date ? formatFlexibleDateForInput(t.due_date) : '';

    const attachInput = document.getElementById('modal_input_attachments');
    if (attachInput) attachInput.value = t.attachments || '';

    const isRecur = t.is_recurring === true;
    const recurCheck = document.getElementById('modal_input_is_recurring');
    if (recurCheck) recurCheck.checked = isRecur;

    const ruleSelect = document.getElementById('modal_input_recurrence_rule');
    if (ruleSelect) {
        ruleSelect.value = t.recurrence_rule || 'daily';
        if (!ruleSelect.value) ruleSelect.value = 'daily';
    }

    toggleRecurrenceRuleSelect(isRecur);

    const reqReviewCheck = document.getElementById('modal_input_requires_review');
    if (reqReviewCheck) reqReviewCheck.checked = t.requires_session_review !== false;

    const isCustom = t.color && t.color !== 'auto';
    const colorModeSelect = document.getElementById('modal_input_color_mode');
    if (colorModeSelect) colorModeSelect.value = isCustom ? 'custom' : 'auto';

    if (isCustom) {
        const colorInput = document.getElementById('modal_input_color');
        if (colorInput) colorInput.value = t.color;
        const hexLabel = document.getElementById('custom_color_hex');
        if (hexLabel) hexLabel.innerText = t.color.toUpperCase();
    }

    toggleCustomColorPicker(isCustom ? 'custom' : 'auto');

    const deleteBtn = document.getElementById('modal_delete_btn');
    if (deleteBtn) deleteBtn.classList.remove('hidden');

    const modal = document.getElementById('task_modal');
    if (modal) modal.classList.remove('hidden');
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('task_modal');

    if (titleInput) {
        titleInput.focus();
        titleInput.select();
    }
}

function closeTaskModal(resumeSession = true) {
    if (taskSaveInFlight) return;
    if (savedTaskParent && (queuedTaskChildren.some(child => !child.id) || document.getElementById('task_child_title')?.value.trim())) {
        if (!confirm('Discard unsaved subtasks? The parent and any saved subtasks will remain saved.')) return;
    }
    taskEditorGeneration++;
    if (typeof aiQuickAddReset === 'function') aiQuickAddReset();
    const modal = document.getElementById('task_modal');
    if (modal) modal.classList.add('hidden');
    if (resumeSession) {
        const nested = !!suspendedSessionModal;
        resumeSessionModalFromTask(savedTaskParent);
        if (!nested) taskReturnFocus?.focus();
    }
    if (typeof calendar !== 'undefined' && calendar) {
        calendar.unselect();
    }
}

async function saveTask() {
    if (taskSaveInFlight) return;
    queueTaskChild();
    const suspendedOwner = suspendedSessionModal;
    try {
        const idEl = document.getElementById('edit_task_id');
        const id = idEl ? idEl.value : '';

        const titleVal = document.getElementById('modal_input_title') ? document.getElementById('modal_input_title').value.trim() : '';
        if (!titleVal) {
            alert("Task title is required.");
            return;
        }

        const assignedInput = document.getElementById('modal_input_assigned_date') ? document.getElementById('modal_input_assigned_date').value.trim() : '';
        const dueInput = document.getElementById('modal_input_due_date') ? document.getElementById('modal_input_due_date').value.trim() : '';
        const estInputVal = document.getElementById('modal_input_est') ? document.getElementById('modal_input_est').value : '15m';
        
        const assignedParsed = parseFlexibleDateInput(assignedInput);
        const dueParsed = parseFlexibleDateInput(dueInput);
        const parsedEstMins = parseDurationToMinutes(estInputVal);

        const colorMode = document.getElementById('modal_input_color_mode') ? document.getElementById('modal_input_color_mode').value : 'auto';
        const chosenColor = colorMode === 'custom' ? (document.getElementById('modal_input_color') ? document.getElementById('modal_input_color').value : '#7c3aed') : 'auto';

        const payload = {
            title: titleVal,
            description: document.getElementById('modal_input_desc') ? document.getElementById('modal_input_desc').value : '',
            tags: document.getElementById('modal_input_tags') ? document.getElementById('modal_input_tags').value : '',
            priority: document.getElementById('modal_input_priority') ? document.getElementById('modal_input_priority').value : '-',
            status: document.getElementById('modal_input_status') ? document.getElementById('modal_input_status').value : 'To Do',
            category: document.getElementById('modal_input_category') ? document.getElementById('modal_input_category').value : 'work',
            estimated_minutes: parsedEstMins,
            assigned_date: assignedParsed ? assignedParsed.dateStr : null,
            due_date: dueParsed ? dueParsed.isoString : null,
            attachments: document.getElementById('modal_input_attachments') ? document.getElementById('modal_input_attachments').value : '',
            is_recurring: document.getElementById('modal_input_is_recurring') ? document.getElementById('modal_input_is_recurring').checked : false,
            recurrence_rule: document.getElementById('modal_input_recurrence_rule') ? document.getElementById('modal_input_recurrence_rule').value : 'daily',
            color: chosenColor,
            requires_session_review: document.getElementById('modal_input_requires_review') ? document.getElementById('modal_input_requires_review').checked : true
        };

        // "custom" means the task holds an RRULE the preset picker cannot express; omit the
        // preset so the backend leaves recurrence_rrule exactly as saved. Also never send a
        // preset for a non-recurring task -- that is how "daily" leaked onto every task.
        if (payload.recurrence_rule === 'custom' || !payload.is_recurring) delete payload.recurrence_rule;

        taskSaveInFlight = true;
        const save = document.getElementById('task_save_btn');
        if (save) save.disabled = true;
        taskSaveFeedback('Saving…');
        if (typeof aiQuickAddInvalidate === 'function') aiQuickAddInvalidate();
        setTaskParentLocked(true);
        const childInput = document.getElementById('task_child_title');
        if (childInput) childInput.disabled = true;
        if (!savedTaskParent) {
            savedTaskParent = id ? await api.put(`/api/tasks/${id}`, payload) : await api.post('/api/tasks', payload);
            // Capture the mutation receipt before prompts, children or metadata reads can fail.
            if (typeof aiQuickAddReset === 'function') aiQuickAddReset();
            setTaskParentLocked(true);
            if (typeof settingsDraftCheckpoint === 'function') {
                settingsDraftCheckpoint('task_modal', 'input:not(#task_child_title), select, textarea:not(#task_children_draft)')();
            }
            if (id && typeof handleCompletionPolicy === 'function') {
                await handleCompletionPolicy(savedTaskParent);
                if (savedTaskParent.completion_policy) document.getElementById('completion_policy_modal')?.querySelector?.('button')?.focus();
            }
        }
        for (const child of queuedTaskChildren) {
            if (child.id) continue;
            const created = await api.post('/api/tasks', {
                title: child.title, parent_id: savedTaskParent.id,
                tags: savedTaskParent.tags || '', category: savedTaskParent.category
            });
            child.id = created.id;
            renderTaskChildQueue();
        }
        const completedParent = savedTaskParent;
        const returnFocus = taskReturnFocus;
        taskSaveInFlight = false;
        closeTaskModal(false);
        const completedGeneration = taskEditorGeneration;
        savedTaskParent = null;
        queuedTaskChildren = [];
        taskSaveInFlight = true;
        // Deliver this owner's acknowledged result before fallible display reads. Focus
        // changes during refresh must not strand the Session or leak it into a later Task.
        if (suspendedOwner && suspendedSessionModal === suspendedOwner && completedParent?.id) {
            resumeSessionModalFromTask(completedParent);
        }
        // Metadata can finish after another editor or ordinary input has claimed focus.
        const focusAtClose = document.activeElement;
        let focusMoved = false;
        const retainNewFocus = () => { focusMoved = true; };
        document.addEventListener('focusin', retainNewFocus);
        // A failed metadata read is not a failed mutation and must never replay writes.
        try { await taskKnowledge.changed(); }
        catch (error) { console.error('Task saved; metadata refresh failed:', error); }
        finally { document.removeEventListener?.('focusin', retainNewFocus); }
        const activeDialog = Array.from(document.querySelectorAll('[role="dialog"]'))
            .some(dialog => dialog.getClientRects().length);
        if (completedGeneration !== taskEditorGeneration || focusMoved ||
            document.activeElement !== focusAtClose || activeDialog) return;
        if (!suspendedOwner && returnFocus?.isConnected) returnFocus.focus();
    } catch (err) {
        console.error("Failed to save task:", err);
        if (savedTaskParent) {
            const saved = queuedTaskChildren.filter(child => child.id).length;
            taskSaveFeedback(`Parent saved. ${saved} of ${queuedTaskChildren.length} subtasks saved. Retry saves only unsaved subtasks. After a connection loss, check the task list before retrying. ${err.message || err}`);
            const save = document.getElementById('task_save_btn');
            if (save) save.textContent = 'Retry unsaved subtasks';
            try { await taskKnowledge.changed(); }
            catch (error) { console.error('Saved task metadata refresh failed:', error); }
        } else {
            taskSaveFeedback(`Task save not confirmed. After a connection loss, check the task list before retrying. ${err.message || err}`);
        }
    } finally {
        taskSaveInFlight = false;
        const save = document.getElementById('task_save_btn');
        if (save) save.disabled = false;
        setTaskParentLocked(!!savedTaskParent);
        const childInput = document.getElementById('task_child_title');
        if (childInput) childInput.disabled = false;
        renderTaskChildQueue();
    }
}

async function deleteTask() {
    if (taskSaveInFlight || savedTaskParent) return;
    const idEl = document.getElementById('edit_task_id');
    const id = idEl ? idEl.value : '';
    if (!id) return;

    const confirmed = await showCustomConfirm("Delete Task Slot", "Are you sure you want to delete this task slot? Attached sessions will remain.");
    if (confirmed) {
        await api.delete(`/api/tasks/${id}`);
        closeTaskModal();
        await taskKnowledge.changed();
    }
}

function openTaskModalFromSessionModal() {
    if (taskSaveInFlight) return;
    const modal = document.getElementById('session_modal');
    if (!modal || modal.classList.contains('hidden')) return;
    const returnFocus = document.activeElement;
    closeSessionModal();
    suspendedSessionModal = { returnFocus };
    modal.dataset.settingsDraftRetained = 'true';
    openNewTaskModal();
}

document.addEventListener('DOMContentLoaded', () => {
    const taskModal = document.getElementById('task_modal');
    if (taskModal) {
        taskModal.addEventListener('keydown', function(e) {
            if (e.defaultPrevented) return;
            if (e.key === 'Tab') {
                const fields = Array.from(taskModal.querySelectorAll('button, input, select, textarea, a[href]'))
                    .filter(el => !el.disabled && el.tabIndex !== -1 && el.getClientRects().length);
                const first = fields[0], last = fields[fields.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                saveTask();
                return;
            }
            if (e.key === 'Enter' && document.activeElement?.id === 'task_child_title') {
                e.preventDefault();
                e.stopPropagation();
                queueTaskChild();
                return;
            }
            if (e.key === 'Enter' && !e.defaultPrevented) {
                const active = document.activeElement;
                if (active && active.tagName === 'INPUT' && active.id !== 'modal_input_tags') {
                    e.preventDefault();
                    saveTask();
                }
            }
        });
    }
});
