/**
 * TimeTrace Global Task Modal Engine & Swatch Controls
 */

let sessionModalStateBackup = null;

function renderColorSwatches(activeHex = '') {
    const list = document.getElementById('swatch_list');
    if (!list) return;

    list.innerHTML = defaultPalette.map(hex => `
        <button type="button" onclick="selectSwatch('${hex}')" class="w-5 h-5 rounded-full border-2 transition transform hover:scale-125 ${activeHex.toLowerCase() === hex.toLowerCase() ? 'border-white scale-110' : 'border-transparent'}" style="background-color: ${hex};"></button>
    `).join('');
}

function selectSwatch(hex) {
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
    const idEl = document.getElementById('edit_task_id');
    if (idEl) idEl.value = '';

    const modalTitle = document.getElementById('modal_task_title');
    if (modalTitle) modalTitle.innerText = 'Create Task Slot';

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

    const estSelect = document.getElementById('modal_input_est');
    if (estSelect) estSelect.value = '15';

    const assignedInput = document.getElementById('modal_input_assigned_date');
    if (assignedInput) assignedInput.value = '';

    const dueInput = document.getElementById('modal_input_due_date');
    if (dueInput) dueInput.value = '';

    const attachInput = document.getElementById('modal_input_attachments');
    if (attachInput) attachInput.value = '';

    const recurCheck = document.getElementById('modal_input_is_recurring');
    if (recurCheck) recurCheck.checked = false;

    const reqReviewCheck = document.getElementById('modal_input_requires_review');
    if (reqReviewCheck) reqReviewCheck.checked = true;

    const colorModeSelect = document.getElementById('modal_input_color_mode');
    if (colorModeSelect) colorModeSelect.value = 'auto';
    toggleCustomColorPicker('auto');

    const deleteBtn = document.getElementById('modal_delete_btn');
    if (deleteBtn) deleteBtn.classList.add('hidden');

    const modal = document.getElementById('task_modal');
    if (modal) modal.classList.remove('hidden');

    setTimeout(() => {
        if (titleInput) {
            titleInput.focus();
            titleInput.select();
        }
    }, 50);
}

async function openEditTaskModal(id) {
    let t = (typeof activeTasks !== 'undefined' && Array.isArray(activeTasks) ? activeTasks.find(item => item && String(item.id) === String(id)) : null)
         || (typeof kanbanTasks !== 'undefined' && Array.isArray(kanbanTasks) ? kanbanTasks.find(item => item && String(item.id) === String(id)) : null)
         || (typeof allTasksMap !== 'undefined' && allTasksMap ? (allTasksMap[id] || allTasksMap[String(id)]) : null);

    if (!t) {
        try {
            t = await api.get(`/tasks/${id}`);
        } catch(e) {
            console.error("Task not found:", id);
            return;
        }
    }
    if (!t) return;

    const idEl = document.getElementById('edit_task_id');
    if (idEl) idEl.value = t.id;

    const modalTitle = document.getElementById('modal_task_title');
    if (modalTitle) modalTitle.innerText = 'Edit Task Slot';

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

    const estSelect = document.getElementById('modal_input_est');
    if (estSelect) estSelect.value = String(t.estimated_minutes || 15);

    const assignedInput = document.getElementById('modal_input_assigned_date');
    if (assignedInput) assignedInput.value = t.assigned_date || '';

    const dueInput = document.getElementById('modal_input_due_date');
    if (dueInput) dueInput.value = t.due_date ? formatIsoLocal(parseApiDateTime(t.due_date)) : '';

    const attachInput = document.getElementById('modal_input_attachments');
    if (attachInput) attachInput.value = t.attachments || '';

    const recurCheck = document.getElementById('modal_input_is_recurring');
    if (recurCheck) recurCheck.checked = t.is_recurring === true;

    const ruleSelect = document.getElementById('modal_input_recurrence_rule');
    if (ruleSelect) ruleSelect.value = t.recurrence_rule || 'daily';

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

    setTimeout(() => {
        if (titleInput) {
            titleInput.focus();
            titleInput.select();
        }
    }, 50);
}

function closeTaskModal() {
    const modal = document.getElementById('task_modal');
    if (modal) modal.classList.add('hidden');
    if (typeof calendar !== 'undefined' && calendar) {
        calendar.unselect();
    }
}

async function saveTask() {
    try {
        const idEl = document.getElementById('edit_task_id');
        const id = idEl ? idEl.value : '';

        const titleVal = document.getElementById('modal_input_title') ? document.getElementById('modal_input_title').value.trim() : '';
        if (!titleVal) {
            alert("Task title is required.");
            return;
        }

        const dueInput = document.getElementById('modal_input_due_date') ? document.getElementById('modal_input_due_date').value : '';
        const colorMode = document.getElementById('modal_input_color_mode') ? document.getElementById('modal_input_color_mode').value : 'auto';
        const chosenColor = colorMode === 'custom' ? (document.getElementById('modal_input_color') ? document.getElementById('modal_input_color').value : '#7c3aed') : 'auto';

        const payload = {
            title: titleVal,
            description: document.getElementById('modal_input_desc') ? document.getElementById('modal_input_desc').value : '',
            tags: document.getElementById('modal_input_tags') ? document.getElementById('modal_input_tags').value : '',
            priority: document.getElementById('modal_input_priority') ? document.getElementById('modal_input_priority').value : '-',
            status: document.getElementById('modal_input_status') ? document.getElementById('modal_input_status').value : 'To Do',
            category: document.getElementById('modal_input_category') ? document.getElementById('modal_input_category').value : 'work',
            estimated_minutes: document.getElementById('modal_input_est') ? parseInt(document.getElementById('modal_input_est').value) || 15 : 15,
            assigned_date: document.getElementById('modal_input_assigned_date') ? document.getElementById('modal_input_assigned_date').value || null : null,
            attachments: document.getElementById('modal_input_attachments') ? document.getElementById('modal_input_attachments').value : '',
            is_recurring: document.getElementById('modal_input_is_recurring') ? document.getElementById('modal_input_is_recurring').checked : false,
            recurrence_rule: document.getElementById('modal_input_recurrence_rule') ? document.getElementById('modal_input_recurrence_rule').value : 'daily',
            color: chosenColor,
            requires_session_review: document.getElementById('modal_input_requires_review') ? document.getElementById('modal_input_requires_review').checked : true
        };

        if (dueInput && dueInput.trim()) {
            const dt = new Date(dueInput);
            if (!isNaN(dt.getTime())) payload.due_date = dt.toISOString();
        }

        let createdTask = null;
        if (id) {
            createdTask = await api.put(`/tasks/${id}`, payload);
        } else {
            createdTask = await api.post('/tasks', payload);
        }

        closeTaskModal();

        // Dynamically update UI without reloading the page
        if (typeof fetchAllTasksRegistry === 'function') await fetchAllTasksRegistry();
        if (typeof fetchTasks === 'function') fetchTasks();
        if (typeof loadKanbanBoard === 'function') await loadKanbanBoard();
        if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();

        if (sessionModalStateBackup && createdTask && createdTask.id) {
            const backup = sessionModalStateBackup;
            sessionModalStateBackup = null;

            const startDt = backup.startVal ? new Date(backup.startVal) : new Date();
            const endDt = backup.endVal ? new Date(backup.endVal) : new Date(startDt.getTime() + (createdTask.estimated_minutes || 15) * 60000);

            openCreateSessionModal(startDt, endDt, createdTask.id, createdTask.title);
            if (backup.notesVal) {
                const notesInput = document.getElementById('session_modal_notes');
                if (notesInput) notesInput.value = backup.notesVal;
            }
        }
    } catch (err) {
        console.error("Failed to save task:", err);
        alert("Failed to save task: " + (err.message || err));
    }
}

async function deleteTask() {
    const idEl = document.getElementById('edit_task_id');
    const id = idEl ? idEl.value : '';
    if (!id) return;

    const confirmed = await showCustomConfirm("Delete Task Slot", "Are you sure you want to delete this task slot? Attached sessions will remain.");
    if (confirmed) {
        await api.delete(`/tasks/${id}`);
        closeTaskModal();
        if (typeof fetchAllTasksRegistry === 'function') await fetchAllTasksRegistry();
        if (typeof fetchTasks === 'function') fetchTasks();
        if (typeof loadKanbanBoard === 'function') await loadKanbanBoard();
        if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
    }
}

function openTaskModalFromSessionModal() {
    sessionModalStateBackup = {
        startVal: document.getElementById('session_modal_start') ? document.getElementById('session_modal_start').value : '',
        endVal: document.getElementById('session_modal_end') ? document.getElementById('session_modal_end').value : '',
        notesVal: document.getElementById('session_modal_notes') ? document.getElementById('session_modal_notes').value : '',
        tags: typeof currentTagChips !== 'undefined' ? [...currentTagChips] : []
    };
    closeSessionModal();
    openNewTaskModal();
}

document.addEventListener('DOMContentLoaded', () => {
    const taskModal = document.getElementById('task_modal');
    if (taskModal) {
        taskModal.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                const active = document.activeElement;
                if (active && active.tagName === 'INPUT' && active.id !== 'modal_input_tags') {
                    e.preventDefault();
                    saveTask();
                }
            }
        });
    }
});
