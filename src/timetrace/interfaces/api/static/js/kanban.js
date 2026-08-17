/**
 * TimeTrace Kanban Board Engine with Dynamic Real-Time Card & Column Updates and Markdown Descriptions
 */

let allStatuses = [];
let kanbanTasks = [];
let sortableCardInstances = [];
let sortableColumnInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    loadKanbanBoard();
});

async function loadKanbanBoard() {
    try {
        allStatuses = await api.get('/tasks/statuses') || [];
        kanbanTasks = await api.get('/tasks?status=all&sort=smart_gap_filler') || [];
        renderKanbanColumns();
    } catch (e) {
        console.error("Failed to load Kanban board:", e);
    }
}

function renderKanbanColumns() {
    const container = document.getElementById('kanban_columns_container');
    if (!container) return;

    sortableCardInstances.forEach(inst => inst.destroy());
    sortableCardInstances = [];
    if (sortableColumnInstance) sortableColumnInstance.destroy();

    if (allStatuses.length === 0) {
        container.innerHTML = '<div class="text-xs text-slate-500 py-8">No columns configured.</div>';
        return;
    }

    container.innerHTML = allStatuses.map(st => {
        let colTasks = kanbanTasks.filter(t => t.status === st.name || t.status_id === st.id);

        if (typeof matchesCustomFilter === 'function') {
            colTasks = colTasks.filter(t => matchesCustomFilter(t));
        }

        return `
            <div class="kanban-col flex flex-col p-3 space-y-3 h-full overflow-hidden shrink-0" data-status-id="${st.id}" data-status-name="${st.name}">
                <div class="kanban-col-header flex justify-between items-center border-b border-[var(--border-muted)] pb-2 shrink-0 cursor-move" title="Drag column to reorder">
                    <div class="flex items-center space-x-2">
                        <span class="w-3 h-3 rounded-full" style="background-color: ${st.color};"></span>
                        <span class="font-bold text-sm text-white">${st.name}</span>
                        <span class="kanban-col-count text-xs text-slate-500 font-bold">(${colTasks.length})</span>
                    </div>
                    ${st.is_completed ? '<span class="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded font-bold">DONE</span>' : ''}
                </div>

                <div class="kanban-card-list flex-1 overflow-y-auto space-y-2.5 pr-1" data-status-name="${st.name}">
                    ${colTasks.length === 0 ? '' : colTasks.map(t => renderKanbanCard(t)).join('')}
                </div>
            </div>
        `;
    }).join('');

    initKanbanDragAndDrop();
}

function renderKanbanCard(task) {
    const isOngoing = (task.status || '').toLowerCase() === 'ongoing';
    const estBadge = task.estimated_minutes ? `${task.estimated_minutes}m` : '15m';
    const prioLabel = (task.priority || '-').toUpperCase();
    const isRecurring = task.is_recurring === true;

    // Markdown description parsing
    let descContentHTML = '';
    if (task.description && task.description.trim()) {
        const rawParsed = typeof marked !== 'undefined' ? marked.parse(task.description.trim()) : task.description;
        descContentHTML = `<div class="kanban-markdown text-[11px] text-slate-300 line-clamp-3 font-normal leading-snug overflow-hidden">${rawParsed}</div>`;
    }

    return `
        <div data-task-id="${task.id}" onclick="window.location.href='/task-inspector/${task.id}'" class="kanban-card p-3 space-y-2 cursor-pointer">
            <div class="flex justify-between items-start">
                <span class="font-bold text-xs text-white leading-snug hover:underline hover:text-purple-300">${task.title}</span>
                ${!isOngoing ? `<span class="text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800 px-1.5 py-0.5 rounded shrink-0 ml-1">${estBadge}</span>` : ''}
            </div>
            ${descContentHTML}
            <div class="flex justify-between items-center pt-1 border-t border-[#1a1c26] text-[10px]">
                <div class="flex items-center space-x-1.5">
                    <span class="text-purple-400 font-semibold uppercase">${task.category || 'work'}</span>
                    ${isRecurring ? '<span class="text-[9px] text-emerald-400 font-bold" title="Recurrent Task">↻</span>' : ''}
                </div>
                <div class="flex items-center space-x-1.5">
                    <span class="font-bold text-slate-400 bg-black/30 px-1.5 py-0.5 rounded">${prioLabel}</span>
                    <button type="button" onclick="event.stopPropagation(); openEditTaskModal(${task.id});" class="bg-purple-950/80 hover:bg-purple-900 text-purple-300 border border-purple-800/80 px-1.5 py-0.5 rounded font-bold text-[9px]">Edit</button>
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
            onEnd: async function() {
                const cols = container.querySelectorAll('.kanban-col');
                for (let idx = 0; idx < cols.length; idx++) {
                    const statusId = cols[idx].getAttribute('data-status-id');
                    if (statusId) {
                        await api.put(`/tasks/statuses/${statusId}`, { position: idx });
                    }
                }
                allStatuses = await api.get('/tasks/statuses') || [];
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
                        await api.put(`/tasks/${taskId}`, { status: newStatusName });
                        const updatedTask = kanbanTasks.find(t => String(t.id) === String(taskId));
                        if (updatedTask) updatedTask.status = newStatusName;
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

function openStatusManagerModal() {
    renderStatusManagerRows();
    document.getElementById('status_manager_modal').classList.remove('hidden');
}

function closeStatusManagerModal() {
    document.getElementById('status_manager_modal').classList.add('hidden');
    loadKanbanBoard();
}

function renderStatusManagerRows() {
    const list = document.getElementById('status_manager_list');
    if (!list) return;

    list.innerHTML = allStatuses.map((st, idx) => `
        <div class="bg-[#0f1016] border border-[var(--border-muted)] p-2.5 rounded-lg flex items-center justify-between text-xs space-x-2">
            <div class="flex items-center space-x-1">
                <button onclick="shiftStatusPosition(${st.id}, -1)" ${idx === 0 ? 'disabled class="opacity-30"' : ''} class="px-1 py-0.5 bg-[#181a28] text-slate-300 rounded hover:text-white">&larr;</button>
                <button onclick="shiftStatusPosition(${st.id}, 1)" ${idx === allStatuses.length - 1 ? 'disabled class="opacity-30"' : ''} class="px-1 py-0.5 bg-[#181a28] text-slate-300 rounded hover:text-white">&rarr;</button>
            </div>

            <input type="text" value="${st.name}" onchange="updateStatusField(${st.id}, 'name', this.value)" class="bg-[#181a28] border border-[var(--border-muted)] px-2 py-1 rounded text-xs text-white font-bold w-28">
            <input type="color" value="${st.color}" onchange="updateStatusField(${st.id}, 'color', this.value)" class="w-7 h-7 bg-transparent cursor-pointer border border-[var(--border-muted)] rounded p-0.5">
            
            <label class="flex items-center space-x-1 cursor-pointer">
                <input type="checkbox" ${st.is_completed ? 'checked' : ''} onchange="updateStatusField(${st.id}, 'is_completed', this.checked)" class="accent-emerald-600 rounded">
                <span class="text-[10px] text-slate-400">Done</span>
            </label>

            <label class="flex items-center space-x-1 cursor-pointer">
                <input type="checkbox" ${st.is_scheduled_trigger ? 'checked' : ''} onchange="updateStatusField(${st.id}, 'is_scheduled_trigger', this.checked)" class="accent-purple-600 rounded">
                <span class="text-[10px] text-slate-400">Calendar</span>
            </label>

            <button onclick="deleteStatusRow(${st.id})" class="text-red-400 hover:text-red-300 font-bold px-1.5 py-0.5">&times;</button>
        </div>
    `).join('');
}

async function shiftStatusPosition(id, direction) {
    const idx = allStatuses.findIndex(st => st.id === id);
    if (idx < 0) return;

    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= allStatuses.length) return;

    const currentSt = allStatuses[idx];
    const targetSt = allStatuses[targetIdx];

    await api.put(`/tasks/statuses/${currentSt.id}`, { position: targetSt.position });
    await api.put(`/tasks/statuses/${targetSt.id}`, { position: currentSt.position });

    allStatuses = await api.get('/tasks/statuses') || [];
    renderStatusManagerRows();
}

async function updateStatusField(id, field, value) {
    await api.put(`/tasks/statuses/${id}`, { [field]: value });
    allStatuses = await api.get('/tasks/statuses') || [];
}

async function createNewStatusRow() {
    const name = prompt("Enter new status name:");
    if (!name) return;
    await api.post('/tasks/statuses', { name: name, position: allStatuses.length });
    allStatuses = await api.get('/tasks/statuses') || [];
    renderStatusManagerRows();
}

async function deleteStatusRow(id) {
    if (confirm("Delete this status column?")) {
        await api.delete(`/tasks/statuses/${id}`);
        allStatuses = await api.get('/tasks/statuses') || [];
        renderStatusManagerRows();
    }
}
