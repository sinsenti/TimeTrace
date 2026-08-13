/**
 * TimeTrace Task Modal & Swatch Controls
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
    const nowIso = formatIsoLocal(new Date());
    document.getElementById('edit_task_id').value = '';
    document.getElementById('modal_task_title').innerText = 'Create Task Slot';
    document.getElementById('modal_input_title').value = '';
    document.getElementById('modal_input_desc').value = '';
    document.getElementById('modal_input_tags').value = '';
    document.getElementById('modal_input_created').value = nowIso;
    document.getElementById('modal_input_priority').value = '-';
    document.getElementById('modal_input_status').value = 'in_progress';
    
    const reqReviewCheck = document.getElementById('modal_input_requires_review');
    if (reqReviewCheck) reqReviewCheck.checked = true;

    const colorModeSelect = document.getElementById('modal_input_color_mode');
    if (colorModeSelect) colorModeSelect.value = 'auto';
    toggleCustomColorPicker('auto');

    document.getElementById('modal_delete_btn').classList.add('hidden');
    document.getElementById('task_modal').classList.remove('hidden');

    setTimeout(() => {
        const titleInput = document.getElementById('modal_input_title');
        if (titleInput) titleInput.focus();
    }, 50);
}

function openEditTaskModal(id) {
    const t = activeTasks.find(item => item.id === id);
    if (!t) return;
    document.getElementById('edit_task_id').value = t.id;
    document.getElementById('modal_task_title').innerText = 'Edit Task Slot';
    document.getElementById('modal_input_title').value = t.title;
    document.getElementById('modal_input_desc').value = t.description || '';
    document.getElementById('modal_input_tags').value = t.tags || '';
    document.getElementById('modal_input_created').value = t.created_at ? formatIsoLocal(parseApiDateTime(t.created_at)) : '';
    document.getElementById('modal_input_priority').value = t.priority || '-';
    document.getElementById('modal_input_status').value = t.status || 'in_progress';
    
    const reqReviewCheck = document.getElementById('modal_input_requires_review');
    if (reqReviewCheck) reqReviewCheck.checked = t.requires_session_review !== false;

    const isCustom = t.color && t.color !== 'auto';
    const colorModeSelect = document.getElementById('modal_input_color_mode');
    if (colorModeSelect) colorModeSelect.value = isCustom ? 'custom' : 'auto';
    
    if (isCustom) {
        document.getElementById('modal_input_color').value = t.color;
        const hexLabel = document.getElementById('custom_color_hex');
        if (hexLabel) hexLabel.innerText = t.color.toUpperCase();
    }

    toggleCustomColorPicker(isCustom ? 'custom' : 'auto');

    document.getElementById('modal_delete_btn').classList.remove('hidden');
    document.getElementById('task_modal').classList.remove('hidden');

    setTimeout(() => {
        const titleInput = document.getElementById('modal_input_title');
        if (titleInput) titleInput.focus();
    }, 50);
}

function closeTaskModal() {
    const modal = document.getElementById('task_modal');
    if (modal) modal.classList.add('hidden');
}

async function saveTask() {
    const id = document.getElementById('edit_task_id').value;
    const createdInput = document.getElementById('modal_input_created').value;
    const colorMode = document.getElementById('modal_input_color_mode') ? document.getElementById('modal_input_color_mode').value : 'auto';
    const chosenColor = colorMode === 'custom' ? document.getElementById('modal_input_color').value : 'auto';

    const payload = {
        title: document.getElementById('modal_input_title').value,
        description: document.getElementById('modal_input_desc').value,
        tags: document.getElementById('modal_input_tags').value,
        priority: document.getElementById('modal_input_priority').value,
        status: document.getElementById('modal_input_status').value,
        color: chosenColor,
        requires_session_review: document.getElementById('modal_input_requires_review') ? document.getElementById('modal_input_requires_review').checked : true
    };

    if (createdInput) {
        payload.created_at = new Date(createdInput).toISOString();
    }

    if (!payload.title) return;

    let createdTask = null;
    if (id) {
        createdTask = await api.put(`/api/v1/tasks/${id}`, payload);
    } else {
        createdTask = await api.post('/api/v1/tasks', payload);
    }

    closeTaskModal();
    await fetchAllTasksRegistry();
    fetchTasks();
    if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();

    if (sessionModalStateBackup && createdTask && createdTask.id) {
        const backup = sessionModalStateBackup;
        sessionModalStateBackup = null;

        const startDt = backup.startVal ? new Date(backup.startVal) : new Date();
        const endDt = backup.endVal ? new Date(backup.endVal) : new Date(startDt.getTime() + 15 * 60000);

        openCreateSessionModal(startDt, endDt, createdTask.id, createdTask.title);
        if (backup.notesVal) {
            document.getElementById('session_modal_notes').value = backup.notesVal;
        }
    }
}

async function deleteTask() {
    const id = document.getElementById('edit_task_id').value;
    if (!id) return;
    
    const confirmed = await showCustomConfirm("Delete Task Slot", "Are you sure you want to delete this task slot? Attached sessions will remain.");
    if (confirmed) {
        await api.delete(`/api/v1/tasks/${id}`);
        closeTaskModal();
        await fetchAllTasksRegistry();
        fetchTasks();
        if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
    }
}

function openTaskModalFromSessionModal() {
    sessionModalStateBackup = {
        startVal: document.getElementById('session_modal_start').value,
        endVal: document.getElementById('session_modal_end').value,
        notesVal: document.getElementById('session_modal_notes').value,
        tags: [...currentTagChips]
    };
    closeSessionModal();
    openNewTaskModal();
}
