/**
 * TimeTrace Kanban Board Engine
 */

let allStatuses = [];
let kanbanTasks = [];
let sortableCardInstances = [];
let sortableColumnInstance = null;
let sortableStatusListInstance = null;
let taskBoardReadVersion = 0;
let selectedTaskView = 'kanban';

document.addEventListener('DOMContentLoaded', () => {
    setupTaskViewSelector();
    loadKanbanBoard();
    setupAddStatusModalKeyboard();
});

function setupTaskViewSelector() {
    const selector = document.getElementById('task_view_selector');
    if (!selector) return;
    selector.value = getUserSettings().taskView;
    selectedTaskView = selector.value;
    showTaskViewAvailability(selector.value);
}

function showTaskViewAvailability(view) {
    const notice = document.getElementById('task_view_notice');
    if (notice) notice.textContent = view === 'outline'
        ? 'Outline + inspector is not available yet. Showing Kanban; your view preference is kept.' : '';
}

function selectTaskView(view) {
    if (!['kanban', 'grouped', 'outline'].includes(view)) return;
    const settings = getUserSettings();
    settings.taskView = view;
    selectedTaskView = view;
    const selector = document.getElementById('task_view_selector');
    if (selector) selector.value = view;
    saveUserSettings(settings);
    showTaskViewAvailability(view);
    renderCurrentTaskView();
}

function matchesKanbanSearch(task) {
    const text = document.getElementById('tasks_search')?.value.trim().toLocaleLowerCase() || '';
    return !text || `${task.title || ''} ${task.tags || ''} ${task.category || ''}`.toLocaleLowerCase().includes(text);
}

async function loadKanbanBoard() {
    const generation = taskKnowledge.state().generation;
    const request = ++taskBoardReadVersion;
    const statusGeneration = statusReadGeneration;
    const workspace = document.getElementById('tasks_workspace');
    const container = document.getElementById('kanban_columns_container');
    workspace?.setAttribute('aria-busy', 'true');
    if (container && !container.innerHTML) container.textContent = 'Loading tasks…';
    try {
        const statuses = await api.get('/api/tasks/statuses');
        const tasks = await api.get('/api/tasks?status=all&sort=smart_gap_filler');
        if (generation !== taskKnowledge.state().generation || request !== taskBoardReadVersion || statusGeneration !== statusReadGeneration) return null;
        if (!Array.isArray(statuses) || !Array.isArray(tasks)) throw new Error('Task list unavailable');
        allStatuses = statuses;
        refreshStatusChoices(statuses);
        kanbanTasks = tasks;
        renderCurrentTaskView();
        taskKnowledge.viewResult('kanban', true);
        return true;
    } catch (e) {
        if (generation !== taskKnowledge.state().generation || request !== taskBoardReadVersion || statusGeneration !== statusReadGeneration) return null;
        taskKnowledge.viewResult('kanban', false);
        console.error("Failed to load Kanban board:", e);
        if (container && !kanbanTasks.length && !allStatuses.length) container.textContent = 'Tasks could not be loaded. Use Retry refresh to try again.';
        return false;
    } finally {
        if (request === taskBoardReadVersion) workspace?.setAttribute('aria-busy', 'false');
    }
}

function destroyKanbanSorting() {
    sortableCardInstances.forEach(inst => inst.destroy());
    sortableCardInstances = [];
    if (sortableColumnInstance) sortableColumnInstance.destroy();
    sortableColumnInstance = null;
}

function renderCurrentTaskView() {
    const container = document.getElementById('kanban_columns_container');
    if (!container) return;
    const restoreFocus = container.contains?.(document.activeElement);
    const grouped = selectedTaskView === 'grouped';
    destroyKanbanSorting();
    document.getElementById('tasks_workspace')?.setAttribute('aria-label', grouped ? 'Grouped task list' : 'Kanban board');
    container.className = grouped ? 'grouped-task-list' : 'flex gap-4 h-full w-full';
    if (grouped) renderGroupedTasks(container, allStatuses, kanbanTasks);
    else renderKanbanColumns();
    if (restoreFocus) document.getElementById('tasks_heading')?.focus({preventScroll: true});
}

function renderKanbanColumns() {
    const container = document.getElementById('kanban_columns_container');
    if (!container) return;

    destroyKanbanSorting();

    const visibleStatuses = allStatuses.filter(st => !st.is_hide_by_default);

    if (visibleStatuses.length === 0) {
        container.innerHTML = '<div class="text-xs text-slate-500 py-8">No active columns configured. Open "Statuses Config" to unhide or create columns.</div>';
        return;
    }

    container.innerHTML = visibleStatuses.map(st => {
        let colTasks = kanbanTasks.filter(t => t.status === st.name || t.status_id === st.id);

        if (typeof matchesCustomFilter === 'function') {
            colTasks = colTasks.filter(t => matchesCustomFilter(t));
        }

        colTasks = colTasks.filter(matchesKanbanSearch);

        return `
            <div class="kanban-col flex flex-col p-3 space-y-3 h-full overflow-hidden shrink-0" data-status-id="${st.id}" data-status-name="${escapeHtml(st.name)}">
                <div class="kanban-col-header flex justify-between items-center border-b border-[var(--border-muted)] pb-2 shrink-0 cursor-move" title="Drag column to reorder">
                    <div class="flex items-center space-x-2">
                        <span class="w-3 h-3 rounded-full status-swatch" style="background-color: ${/^#[0-9a-f]{3,8}$/i.test(st.color) ? st.color : 'transparent'}"></span>
                        <span class="font-bold text-sm text-white">${escapeHtml(st.name)}</span>
                        <span class="kanban-col-count text-xs text-slate-500 font-bold">(${colTasks.length})</span>
                    </div>
                    ${st.is_completed ? '<span class="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded font-bold">DONE</span>' : ''}
                </div>

                <div class="kanban-card-list flex-1 overflow-y-auto space-y-2.5 pr-1" data-status-name="${escapeHtml(st.name)}">
                    ${colTasks.length === 0 ? '<p class="text-xs text-slate-400 py-4">No matching tasks</p>' : colTasks.map(t => renderKanbanCard(t)).join('')}
                </div>
            </div>
        `;
    }).join('');

    initKanbanDragAndDrop();
}

function renderKanbanCard(task) {
    const isOngoing = (task.status || '').toLowerCase() === 'ongoing';
    const estBadge = formatMinutesToDuration(task.estimated_minutes);
    const prioLabel = (task.priority || '-').toUpperCase();
    const isRecurring = task.is_recurring === true;

    // next_occurrence_date is the derived next RRULE occurrence for recurring tasks.
    const dateBadge = getTaskDateBadge(task.due_date, task.next_occurrence_date || task.assigned_date);
    let dueBadgeHTML = '';
    if (dateBadge) {
        dueBadgeHTML = dateBadge.isUrgent
            ? `<span class="text-[9px] font-black bg-red-900/90 text-red-200 border border-red-600 px-1.5 py-0.5 rounded uppercase shrink-0">${escapeHtml(dateBadge.label)}</span>`
            : `<span class="text-[9px] font-bold bg-black/40 text-slate-300 px-1.5 py-0.5 rounded shrink-0">${escapeHtml(dateBadge.label)}</span>`;
    }

    let descContentHTML = '';
    if (task.description && task.description.trim()) {
        // Task descriptions can come from accepted model output. Keep previews literal.
        descContentHTML = `<div class="text-[11px] text-slate-300 line-clamp-3 font-normal leading-snug overflow-hidden">${escapeHtml(task.description.trim())}</div>`;
    }

    const parent = task.parent_id ? kanbanTasks.find(t => t.id === task.parent_id) || taskKnowledge.get(task.parent_id) : null;
    const parentLabel = task.parent_id ? `<div class="text-[11px] text-slate-400">Subtask of ${escapeHtml(parent?.title || 'another task')}</div>` : '';
    return `
        <div data-task-id="${task.id}" tabindex="0" onkeydown="if(event.target === this && event.key === 'Enter') window.location.href='/task-inspector/${task.id}'" onclick="window.location.href='/task-inspector/${task.id}'" class="kanban-card p-3 space-y-2 cursor-pointer">
            <div class="flex justify-between items-start">
                <span class="font-semibold text-xs text-white leading-snug hover:underline hover:text-purple-300">${escapeHtml(task.title)}</span>
                ${!isOngoing ? `<span class="text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800 px-1.5 py-0.5 rounded shrink-0 ml-1">${estBadge}</span>` : ''}
            </div>
            ${dueBadgeHTML ? `<div class="pt-0.5">${dueBadgeHTML}</div>` : ''}
            ${parentLabel}
            ${descContentHTML}
            ${task.tags ? `<div class="text-[11px] text-slate-400 break-words">${escapeHtml(task.tags)}</div>` : ''}
            <div class="flex justify-between items-center pt-1 border-t border-[#1a1c26] text-[10px]">
                <div class="flex items-center space-x-1.5">
                    <span class="text-purple-400 font-semibold uppercase">${escapeHtml(task.category || 'work')}</span>
                    ${isRecurring ? '<span class="text-[9px] text-emerald-400 font-bold" title="Recurrent Task">↻</span>' : ''}
                </div>
                <div class="flex items-center space-x-1.5">
                    <span class="font-bold text-slate-400 bg-black/30 px-1.5 py-0.5 rounded">${escapeHtml(prioLabel)}</span>
                    <button type="button" onclick="event.stopPropagation(); openEditTaskModal('${task.id}');" class="bg-purple-950/80 hover:bg-purple-900 text-purple-300 border border-purple-800/80 px-1.5 py-0.5 rounded font-bold text-[9px]">Edit</button>
                </div>
            </div>
        </div>
    `;
}

function updateColumnHeaderCounts() {
    const columns = document.querySelectorAll('.kanban-col');
    columns.forEach(col => {
        const cardList = col.querySelector('.kanban-card-list');
        const countBadge = col.querySelector('.kanban-col-count');
        if (cardList && countBadge) {
            const cardCount = cardList.querySelectorAll('.kanban-card').length;
            countBadge.innerText = `(${cardCount})`;
        }
    });
}

function initKanbanDragAndDrop() {
    if (typeof Sortable === 'undefined') return;

    const container = document.getElementById('kanban_columns_container');
    if (container) {
        sortableColumnInstance = Sortable.create(container, {
            animation: 150,
            handle: '.kanban-col-header',
            ghostClass: 'sortable-ghost',
            disabled: statusOrderLocked(),
            onEnd: async function() {
                await saveBoardStatusOrder(Array.from(container.querySelectorAll('.kanban-col')).map(col => col.getAttribute('data-status-id')));
            }
        });
    }

    const lists = document.querySelectorAll('.kanban-card-list');
    lists.forEach(listEl => {
        const inst = Sortable.create(listEl, {
            group: 'kanban_board',
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: async function(evt) {
                const itemEl = evt.item;
                const taskId = itemEl.getAttribute('data-task-id');
                const targetList = evt.to;
                const sourceList = evt.from;
                const newStatusName = targetList.getAttribute('data-status-name');

                updateColumnHeaderCounts();

                if (taskId && newStatusName && sourceList !== targetList) {
                    try {
                        const oldTask = kanbanTasks.find(t => String(t.id) === String(taskId));

                        const updatedTask = await api.put(`/api/tasks/${taskId}`, { status: newStatusName });
                        if (oldTask) oldTask.status = newStatusName;

                        if (typeof handleCompletionPolicy === 'function') await handleCompletionPolicy(updatedTask);
                        await taskKnowledge.changed();
                    } catch (err) {
                        console.error("Failed to update task status on drag:", err);
                        loadKanbanBoard();
                    }
                }
            }
        });
        sortableCardInstances.push(inst);
    });
}

// Status rows own independent explicit drafts; display reads never reopen task/session editors.
let statusManagerOwner = null;
let addStatusOwner = null;
let statusReadGeneration = 0;
let statusBoardOrder = null;
let statusFocusGeneration = 0;
for (const event of ['focusin', 'pointerdown', 'keydown']) document.addEventListener(event, () => { statusFocusGeneration++; }, true);
const statusFields = ['name', 'color', 'is_hide_by_default', 'is_completed', 'is_scheduled_trigger'];

function statusElement(tag, text, attributes = {}) {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
    return el;
}

function refreshStatusChoices(statuses) {
    for (const id of ['modal_input_status', 'inspector_edit_status', 'modal_subtask_status']) {
        const select = document.getElementById(id);
        if (!select) continue;
        const selected = select.value;
        const names = [...new Set(statuses.map(st => st.name))];
        if (!names.includes(selected)) names.push(selected);
        select.replaceChildren(...names.map(name => statusElement('option', name, {value: name})));
        select.value = selected;
    }
}

function statusMessage(owner, text) {
    if (owner?.message) owner.message.textContent = text;
}

function statusSnapshot(owner) {
    return Object.fromEntries(statusFields.filter(field => owner.inputs[field]).map(field => {
        const input = owner.inputs[field];
        return [field, input.type === 'checkbox' ? input.checked : input.value];
    }));
}

function statusCheckpoint(owner) {
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft(owner.root);
}

function statusRestoreFocus(launcher, fallback) {
    // Only synchronous dismissal restores focus. Late writers never steal a newer owner's focus.
    if (launcher?.isConnected && !launcher.closest('.hidden')) launcher.focus();
    else document.getElementById(fallback)?.focus();
}

function openStatusManagerModal() {
    if (statusManagerOwner) return;
    const modal = document.getElementById('status_manager_modal');
    statusManagerOwner = {root: modal, launcher: document.activeElement, rows: new Map(), pendingOrder: false};
    document.getElementById('status_manager_list').replaceChildren();
    document.getElementById('status_manager_feedback').textContent = '';
    document.getElementById('status_order_retry').hidden = true;
    modal.classList.remove('hidden');
    renderStatusManagerRows();
    updateStatusOrderControls();
    modal.querySelector('button')?.focus();
    refreshStatusManagement(statusManagerOwner);
}

function closeStatusManagerModal() {
    const owner = statusManagerOwner;
    if (!owner) return;
    // Done/Cancel discards only unsaved status drafts; already acknowledged rows stay saved.
    owner.rows.forEach(row => row.root.classList.add('hidden'));
    statusManagerOwner = null;
    statusReadGeneration++;
    document.getElementById('status_manager_modal').classList.add('hidden');
    if (sortableStatusListInstance) sortableStatusListInstance.destroy();
    sortableStatusListInstance = null;
    statusRestoreFocus(owner.launcher, 'status_manager_entry');
}

function renderStatusManagerRows() {
    const manager = statusManagerOwner;
    const list = document.getElementById('status_manager_list');
    if (!manager || !list) return;
    const ids = new Set(allStatuses.map(st => st.id));
    for (const [id, owner] of manager.rows) {
        if (!ids.has(id) && !owner.pending) { owner.root.remove(); manager.rows.delete(id); }
    }
    for (const st of allStatuses) {
        let owner = manager.rows.get(st.id);
        if (!owner) {
            const root = statusElement('section', '', {'data-status-id': st.id, id: `status_draft_${st.id}`, class: 'status-manager-row'});
            owner = {id: st.id, root, inputs: {}, baseline: {...st}, pending: false, readOnly: false, manager};
            const fields = statusElement('div', '', {class: 'status-fields'});
            for (const [field, label] of [['name', 'Name'], ['color', 'Color'], ['is_hide_by_default', 'Hide'], ['is_completed', 'Done'], ['is_scheduled_trigger', 'Calendar']]) {
                const wrapper = statusElement('label', label);
                // Raw color text retains every API-accepted color; a swatch is decoration, never label text.
                const input = statusElement('input', '', {id: `status_${st.id}_${field}`, type: field.startsWith('is_') ? 'checkbox' : 'text', 'aria-label': label});
                input.addEventListener('input', () => { owner.dirty = true; });
                owner.inputs[field] = input;
                wrapper.appendChild(input);
                fields.appendChild(wrapper);
            }
            root.appendChild(fields);
            const actions = statusElement('div', '', {class: 'status-actions'});
            for (const [label, action] of [['Save', () => saveStatusRow(st.id)], ['Cancel', () => cancelStatusRow(st.id)], ['Move up', () => moveStatusRow(st.id, -1)], ['Move down', () => moveStatusRow(st.id, 1)], ['Delete', () => deleteStatusRow(st.id)]]) {
                const button = statusElement('button', label, {type: 'button'});
                if (label.startsWith('Move ')) button.dataset.statusOrder = 'true';
                button.addEventListener('click', action);
                actions.appendChild(button);
            }
            owner.message = statusElement('p', '', {role: 'status'});
            owner.retry = statusElement('button', 'Retry refresh', {type: 'button', hidden: ''});
            owner.retry.addEventListener('click', () => refreshStatusManagement(manager, owner));
            root.appendChild(actions); root.appendChild(owner.message); root.appendChild(owner.retry);
            manager.rows.set(st.id, owner);
            list.appendChild(root);
        }
        // Do not replace another row's pending or unsaved fields when a writer refreshes metadata.
        for (const field of statusFields) {
            const input = owner.inputs[field];
            const value = input.type === 'checkbox' ? input.checked : input.value;
            if (!owner.initialized || (!owner.pending && value === owner.baseline[field])) {
                if (input.type === 'checkbox') input.checked = st[field]; else input.value = st[field];
            }
        }
        if (!owner.pending) {
            owner.baseline = {...st};
            // Canonical baselines advance even for retained dirty fields, without replacing live input.
            if (typeof settingsDraftCheckpoint === 'function') {
                const receipt = document.createElement('div');
                receipt.id = owner.root.id;
                for (const field of statusFields) {
                    const input = document.createElement('input');
                    input.id = owner.inputs[field].id;
                    input.type = owner.inputs[field].type;
                    input.value = st[field]; input.checked = st[field] === true;
                    receipt.appendChild(input);
                }
                settingsDraftCheckpoint(receipt)();
            }
        }
        if (!owner.initialized) statusCheckpoint(owner);
        owner.initialized = true;
        owner.dirty = JSON.stringify(statusSnapshot(owner)) !== JSON.stringify(Object.fromEntries(statusFields.map(f => [f, owner.baseline[f]])));
    }
    // Adopt server order with the same nodes, retaining independent drafts and focus.
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    for (const st of allStatuses) {
        const row = manager.rows.get(st.id)?.root;
        if (row) list.appendChild(row);
    }
    if (focused?.isConnected && document.activeElement !== focused) focused.focus();
    initStatusManagerDragAndDrop();
    updateStatusOrderControls();
}

function setStatusBusy(owner, busy) {
    owner.pending = busy;
    // Inputs remain editable while saving; successful acknowledgement consumes submitted values only.
    owner.root.querySelectorAll('button').forEach(button => {
        if ((busy || owner.readOnly) && document.activeElement === button) owner.disabledFocus = {button, generation: statusFocusGeneration};
        button.disabled = busy || owner.readOnly;
    });
    if (owner.retry) owner.retry.disabled = busy;
    updateStatusOrderControls();
    if (!busy && !owner.readOnly && owner.disabledFocus) {
        const {button, generation} = owner.disabledFocus;
        const live = owner === addStatusOwner || owner.manager === statusManagerOwner;
        if (live && button.isConnected && document.activeElement === document.body && generation === statusFocusGeneration) button.focus();
        owner.disabledFocus = null;
    }
}

function cancelStatusRow(id) {
    const owner = statusManagerOwner?.rows.get(id);
    if (!owner || owner.pending || owner.readOnly) return;
    for (const field of statusFields) {
        const input = owner.inputs[field];
        if (input.type === 'checkbox') input.checked = owner.baseline[field]; else input.value = owner.baseline[field];
    }
    statusMessage(owner, 'Unsaved changes canceled.');
    statusCheckpoint(owner);
}

function isStatusWriterCurrent(writer) {
    return Boolean(writer && (writer.root.id === 'add_status_modal' ? writer === addStatusOwner
        : writer.manager && writer.manager === statusManagerOwner && writer.manager.rows.get(writer.id) === writer));
}

async function refreshStatusManagement(manager = statusManagerOwner, writer = null) {
    const generation = ++statusReadGeneration;
    if (writer?.retry === document.activeElement) writer.disabledFocus = {button: writer === addStatusOwner ? document.getElementById('status_add_save') : writer.root.querySelector('button'), generation: statusFocusGeneration};
    try {
        const rows = await api.get('/api/tasks/statuses');
        if (!Array.isArray(rows)) throw new Error('Status list unavailable');
        if (generation !== statusReadGeneration) {
            if (isStatusWriterCurrent(writer)) {
                writer.retry.hidden = false;
                statusMessage(writer, 'Saved. A newer refresh superseded this read. Retry refresh reads only.');
            }
            if (writer) await taskKnowledge.changed();
            return false;
        }
        allStatuses = rows;
        refreshStatusChoices(rows);
        if (manager && manager === statusManagerOwner) renderStatusManagerRows();
        if (isStatusWriterCurrent(writer)) {
            writer.readOnly = false;
            if (writer.retry) writer.retry.hidden = true;
            setStatusBusy(writer, false);
            statusMessage(writer, writer.uncertain
                ? 'Server list checked. Save was not confirmed; review current statuses before explicitly retrying. A lost create response may mean a duplicate.'
                : 'Saved. Status list refreshed.');
        }
        // A successful explicit read also recovers superseded/failed refresh receipts, not mutations.
        const waiting = [...(statusManagerOwner?.rows.values() || []), addStatusOwner].filter(Boolean);
        for (const owner of waiting) {
            if (owner.pending || !owner.readOnly) continue;
            owner.readOnly = false; owner.retry.hidden = true; setStatusBusy(owner, false);
            statusMessage(owner, owner.uncertain ? 'Server list checked. Save not confirmed; review before explicit retry (a lost create response may duplicate).' : 'Saved. Status list refreshed.');
        }
        // Only this current, post-write read can verify order. Adopt both visible orders first.
        renderCurrentTaskView();
        if (statusBoardOrder && !statusBoardOrder.pendingOrder) {
            // A current authoritative list confirms absent rows; never retry positions for deleted IDs.
            statusBoardOrder.orderRemaining = statusBoardOrder.orderRemaining.filter(entry => rows.some(row => row.id === entry.id));
            statusBoardOrder.orderReadOnly = false;
            statusOrderNotice(statusBoardOrder.orderRemaining.length
                ? 'Order partially saved. Server list checked. Retry writes only unacknowledged positions; a lost response may already have saved the last position.'
                : 'Order saved.');
        }
        updateStatusOrderControls();
        await taskKnowledge.changed();
        return true;
    } catch (error) {
        if (generation !== statusReadGeneration) return false;
        if (isStatusWriterCurrent(writer)) {
            writer.readOnly = true;
            setStatusBusy(writer, false);
            if (writer.retry) writer.retry.hidden = false;
            statusMessage(writer, writer.uncertain ? `Save not confirmed. Retry refresh to verify before retrying Save. ${error.message}`
                : `Saved. Display refresh unavailable; Retry refresh reads only. ${error.message}`);
        } else {
            const message = document.getElementById('status_manager_feedback');
            if (statusBoardOrder?.orderReadOnly) statusOrderNotice(statusBoardOrder.orderRemaining.length
                ? `Order partially saved. Earlier acknowledgements remain saved. Retry refresh reads only. ${error.message}`
                : `Order saved. Retry refresh reads only. ${error.message}`);
            else if (manager === statusManagerOwner && message) message.textContent = `Could not load statuses. Existing drafts retained. ${error.message}`;
        }
        return false;
    }
}

async function saveStatusRow(id) {
    const manager = statusManagerOwner, owner = manager?.rows.get(id);
    if (!owner || owner.pending || owner.readOnly) return;
    const submitted = statusSnapshot(owner);
    if (!submitted.name.trim()) return statusMessage(owner, 'Status name is required.');
    const checkpoint = typeof settingsDraftCheckpoint === 'function' ? settingsDraftCheckpoint(owner.root) : () => {};
    setStatusBusy(owner, true);
    statusReadGeneration++; taskKnowledge.invalidate();
    let saved;
    try { saved = await api.put(`/api/tasks/statuses/${id}`, submitted); }
    catch (error) { return statusWriteUnconfirmed(owner, error); }
    statusReadGeneration++; taskKnowledge.invalidate();
    allStatuses = allStatuses.map(st => st.id === id ? saved : st);
    owner.baseline = {...saved}; owner.uncertain = false;
    if (manager !== statusManagerOwner) { await taskKnowledge.changed(); return; }
    checkpoint();
    owner.readOnly = true; setStatusBusy(owner, false);
    statusMessage(owner, 'Saved. Refreshing display…');
    await refreshStatusManagement(manager, owner);
}

function statusWriteUnconfirmed(owner, error) {
    // Reads started before the uncertain result cannot verify that result.
    statusReadGeneration++; taskKnowledge.invalidate();
    if (owner.root.id === 'add_status_modal' ? owner !== addStatusOwner : owner.manager !== statusManagerOwner) return;
    owner.uncertain = true; owner.readOnly = true;
    setStatusBusy(owner, false);
    owner.retry.hidden = false;
    statusMessage(owner, `Save not confirmed. Fields retained. Retry refresh to verify before retrying Save. ${error.message}`);
}

function initStatusManagerDragAndDrop() {
    if (sortableStatusListInstance) sortableStatusListInstance.destroy();
    const list = document.getElementById('status_manager_list');
    if (!list || typeof Sortable === 'undefined') return;
    sortableStatusListInstance = Sortable.create(list, {
        animation: 150, handle: '.status-reorder-handle', ghostClass: 'sortable-ghost',
        disabled: statusOrderLocked(),
        onEnd: () => saveStatusOrder(Array.from(list.children).map(row => row.dataset.statusId))
    });
    // Dedicated handles keep input selection/checkboxes from becoming drag gestures.
    list.querySelectorAll('.status-manager-row').forEach(row => {
        if (!row.querySelector('.status-reorder-handle')) row.prepend(statusElement('span', 'Drag to reorder', {class: 'status-reorder-handle'}));
    });
}

function statusOrderLocked() {
    return Boolean(statusBoardOrder?.pendingOrder || statusBoardOrder?.orderReadOnly || statusBoardOrder?.orderRemaining?.length);
}

function statusOrderNotice(text) {
    for (const id of ['status_board_feedback', 'status_manager_feedback']) {
        const feedback = document.getElementById(id);
        if (feedback) feedback.textContent = text;
    }
}

function updateStatusOrderControls() {
    const locked = statusOrderLocked();
    sortableColumnInstance?.option('disabled', locked);
    sortableStatusListInstance?.option('disabled', locked);
    for (const row of statusManagerOwner?.rows.values() || []) {
        row.root.querySelectorAll('button').forEach(button => {
            if (button.dataset.statusOrder) {
                if (locked && document.activeElement === button && !button.disabled) {
                    statusBoardOrder.orderFocus = {button, generation: statusFocusGeneration};
                }
                button.disabled = locked || row.pending || row.readOnly;
            }
        });
        const handle = row.root.querySelector('.status-reorder-handle');
        if (handle) handle.textContent = locked ? 'Order locked — verify / retry first' : 'Drag to reorder';
    }
    if (!locked && statusBoardOrder?.orderFocus) {
        const {button, generation} = statusBoardOrder.orderFocus;
        if (button.isConnected && !button.disabled && document.activeElement === document.body && generation === statusFocusGeneration) button.focus();
        statusBoardOrder.orderFocus = null;
    }
    const container = document.getElementById('kanban_columns_container');
    container?.querySelectorAll('.kanban-col-header').forEach(header => {
        header.setAttribute('aria-disabled', String(locked));
        header.title = locked ? 'Order locked — verify / retry first' : 'Drag column to reorder';
    });
    for (const id of ['status_order_retry', 'status_board_order_retry']) {
        const retry = document.getElementById(id);
        if (!retry) continue;
        retry.hidden = !statusBoardOrder || statusBoardOrder.pendingOrder || (!statusBoardOrder.orderReadOnly && !statusBoardOrder.orderRemaining?.length);
        retry.disabled = Boolean(statusBoardOrder?.pendingOrder);
        retry.textContent = statusBoardOrder?.orderReadOnly ? 'Retry refresh (reads only)' : 'Retry remaining order writes';
    }
}

async function moveStatusRow(id, direction) {
    if (statusOrderLocked()) return;
    const list = document.getElementById('status_manager_list');
    const ids = Array.from(list.children).map(row => row.dataset.statusId);
    const index = ids.indexOf(id), target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await saveStatusOrder(ids);
}

async function saveStatusOrder(ids) {
    const manager = statusManagerOwner;
    if (!manager || statusOrderLocked()) return;
    manager.orderRemaining = ids.map((id, position) => ({id, position}));
    // Keep the journal alive across manager dismissal, just like board-initiated order writes.
    statusBoardOrder = manager;
    await continueStatusOrder(manager);
}

function isStatusOrderCurrent(owner) {
    return owner && owner === statusBoardOrder;
}

async function saveBoardStatusOrder(ids) {
    if (statusOrderLocked()) return;
    // Visible columns fill only visible slots; hidden statuses keep their relative placement.
    const visible = allStatuses.filter(st => !st.is_hide_by_default).map(st => st.id);
    if (ids.length !== visible.length || new Set(ids).size !== ids.length || ids.some(id => !visible.includes(id))) return;
    let index = 0;
    const complete = allStatuses.map(st => st.is_hide_by_default ? st.id : ids[index++]);
    statusBoardOrder = {isBoard: true, orderRemaining: complete.map((id, position) => ({id, position}))};
    await continueStatusOrder(statusBoardOrder);
}

async function continueStatusOrder(manager = statusBoardOrder) {
    if (!isStatusOrderCurrent(manager) || manager.pendingOrder) return;
    if (manager.orderReadOnly) {
        // Verification is a separate read-only action, never a continuation of the write loop.
        await refreshStatusManagement();
        return;
    }
    manager.pendingOrder = true;
    manager.orderReadOnly = true;
    updateStatusOrderControls();
    while (manager.orderRemaining.length) {
        const next = manager.orderRemaining[0];
        statusReadGeneration++; taskKnowledge.invalidate();
        try { await api.put(`/api/tasks/statuses/${next.id}`, {position: next.position}); }
        catch (error) {
            statusReadGeneration++; taskKnowledge.invalidate();
            manager.pendingOrder = false;
            statusOrderNotice(`Order partially saved. Earlier acknowledgements remain saved. Retry refresh reads only; verify before retrying remaining positions. ${error.message}`);
            updateStatusOrderControls();
            // PUT position is separate; an uncertain response is never automatically replayed.
            await refreshStatusManagement();
            return;
        }
        statusReadGeneration++; taskKnowledge.invalidate();
        manager.orderRemaining.shift();
    }
    manager.pendingOrder = false;
    statusOrderNotice('Order saved. Refreshing display…');
    updateStatusOrderControls();
    const ok = await refreshStatusManagement();
    if (isStatusOrderCurrent(manager) && !ok) statusOrderNotice('Order saved. Retry refresh reads only.');
}

async function deleteStatusRow(id) {
    const manager = statusManagerOwner, owner = manager?.rows.get(id);
    if (!owner || owner.pending || owner.readOnly) return;
    const launcher = document.activeElement;
    setStatusBusy(owner, true);
    const modal = document.getElementById('custom_confirm_modal');
    const cancel = document.getElementById('confirm_modal_cancel_btn');
    const proceed = document.getElementById('confirm_modal_proceed_btn');
    // This status action owns only confirmation focus/Tab; shared confirmation owns its result.
    const trapTab = event => {
        if (event.key !== 'Tab' || !isStatusWriterCurrent(owner) || modal?.classList.contains('hidden') ||
            !modal?.contains(document.activeElement)) return;
        event.preventDefault(); event.stopPropagation();
        (document.activeElement === cancel ? proceed : cancel)?.focus();
    };
    let confirmed;
    try {
        const result = showCustomConfirm('Delete Status Column', 'Delete this status? Existing tasks are not reassigned. Saved task status text is retained; server deletion rules apply.');
        document.addEventListener('keydown', trapTab, true);
        if (modal && !modal.classList.contains('hidden')) cancel?.focus();
        confirmed = await result;
    } finally {
        document.removeEventListener('keydown', trapTab, true);
    }
    if (!isStatusWriterCurrent(owner)) return;
    const restoreFocus = modal?.contains(document.activeElement) || document.activeElement === document.body;
    if (!confirmed) {
        setStatusBusy(owner, false);
        if (restoreFocus) statusRestoreFocus(launcher, 'status_manager_entry');
        return;
    }
    if (restoreFocus) document.getElementById('status_add_entry')?.focus();
    statusReadGeneration++; taskKnowledge.invalidate();
    try { await api.delete(`/api/tasks/statuses/${id}`); }
    catch (error) { return statusWriteUnconfirmed(owner, error); }
    statusReadGeneration++; taskKnowledge.invalidate();
    allStatuses = allStatuses.filter(st => st.id !== id);
    owner.pending = false;
    if (manager === statusManagerOwner) {
        const focusWasInside = owner.root.contains(document.activeElement);
        owner.readOnly = true; setStatusBusy(owner, false);
        statusMessage(owner, 'Deleted. Refreshing display…');
        if (focusWasInside) document.getElementById('status_add_entry')?.focus();
        await refreshStatusManagement(manager, owner);
    } else await taskKnowledge.changed();
}

function openAddStatusModal() {
    if (addStatusOwner) return;
    const modal = document.getElementById('add_status_modal');
    const inputs = {name: document.getElementById('modal_new_status_name'), color: document.getElementById('modal_new_status_color')};
    inputs.name.value = ''; inputs.color.value = '#7c3aed';
    document.getElementById('new_status_color_hex').textContent = '#7C3AED';
    addStatusOwner = {root: modal, inputs, launcher: document.activeElement,
        message: document.getElementById('status_add_feedback'), retry: document.getElementById('status_add_retry'), pending: false, readOnly: false};
    addStatusOwner.retry.hidden = true;
    statusMessage(addStatusOwner, ''); setStatusBusy(addStatusOwner, false);
    modal.classList.remove('hidden');
    statusCheckpoint(addStatusOwner);
    inputs.name.focus();
}

function closeAddStatusModal() {
    const owner = addStatusOwner;
    if (!owner) return;
    addStatusOwner = null;
    statusReadGeneration++;
    document.getElementById('add_status_modal').classList.add('hidden');
    statusRestoreFocus(owner.launcher, 'status_add_entry');
}

async function saveNewStatusFromModal() {
    const owner = addStatusOwner;
    if (!owner || owner.pending || owner.readOnly) return;
    const submitted = statusSnapshot(owner);
    if (!submitted.name.trim()) return statusMessage(owner, 'Status name is required.');
    const checkpoint = typeof settingsDraftCheckpoint === 'function' ? settingsDraftCheckpoint(owner.root) : () => {};
    setStatusBusy(owner, true); statusReadGeneration++; taskKnowledge.invalidate();
    let saved;
    try {
        saved = owner.id ? await api.put(`/api/tasks/statuses/${owner.id}`, submitted)
            : await api.post('/api/tasks/statuses', {...submitted, position: allStatuses.length});
    } catch (error) { return statusWriteUnconfirmed(owner, error); }
    // Adopt the canonical create ID before any fallible GET. Further Save edits this row, never POSTs again.
    owner.id = saved.id; owner.uncertain = false;
    statusReadGeneration++; taskKnowledge.invalidate();
    allStatuses = [...allStatuses.filter(st => st.id !== saved.id), saved];
    if (owner !== addStatusOwner) { await taskKnowledge.changed(); return; }
    checkpoint();
    owner.readOnly = true; setStatusBusy(owner, false);
    statusMessage(owner, 'Saved. Refreshing display…');
    await refreshStatusManagement(statusManagerOwner, owner);
    // Explicit close keeps concurrent input intact and avoids late focus restoration.
}

function setupAddStatusModalKeyboard() {
    for (const id of ['status_manager_modal', 'add_status_modal']) {
        const modal = document.getElementById(id);
        if (!modal) continue;
        modal.addEventListener('keydown', e => {
            if (!document.getElementById('custom_confirm_modal')?.classList.contains('hidden')) return;
            if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault(); e.stopPropagation();
                if (id === 'add_status_modal') closeAddStatusModal(); else closeStatusManagerModal();
            } else if (id === 'add_status_modal' && e.key === 'Enter' && (e.ctrlKey || e.target.id === 'modal_new_status_name')) {
                e.preventDefault(); e.stopPropagation(); saveNewStatusFromModal();
            } else if (e.key === 'Tab') {
                const controls = Array.from(modal.querySelectorAll('button, input')).filter(el => !el.disabled && !el.hidden && el.getClientRects().length);
                const first = controls[0], last = controls[controls.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
            }
        });
    }
}
