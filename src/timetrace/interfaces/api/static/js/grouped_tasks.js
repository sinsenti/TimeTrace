/** Grouped list uses the board snapshot and the shared task/session editors. */
function renderGroupedTasks(container, statuses, tasks) {
    const groups = statuses.map((status, index) => ({status, index, tasks: []}))
        .sort((a, b) => (a.status.position ?? a.index) - (b.status.position ?? b.index));
    const unknown = {status: {name: 'Unknown status'}, tasks: []};
    let hiddenCount = 0;
    for (const task of tasks) {
        if (!matchesKanbanSearch(task) || (typeof matchesCustomFilter === 'function' && !matchesCustomFilter(task))) continue;
        const group = groups.find(group => task.status_id && group.status.id === task.status_id)
            || groups.find(group => group.status.name === task.status) || unknown;
        if (group.status.is_hide_by_default) hiddenCount++;
        else group.tasks.push(task);
    }
    const visible = groups.filter(group => !group.status.is_hide_by_default);
    if (unknown.tasks.length) visible.push(unknown);
    container.innerHTML = `<p class="grouped-summary">Grouped by status. ${hiddenCount} task${hiddenCount === 1 ? '' : 's'} in hidden statuses excluded. Use Statuses Config to show them.</p>`
        + (visible.length ? visible.map((group, index) => `<section class="grouped-status" aria-labelledby="grouped_status_${index}">
            <h2 id="grouped_status_${index}">${escapeHtml(group.status.name)} <span>(${group.tasks.length})</span>${group.status.is_completed ? ' — Completed' : ''}</h2>
            ${group.tasks.length ? `<ul>${group.tasks.map(task => renderGroupedTaskRow(task, tasks)).join('')}</ul>` : '<p class="grouped-empty">No matching tasks</p>'}
        </section>`).join('') : '<p class="grouped-empty">No visible statuses configured. Open Statuses Config to show or create a status.</p>');
}

function renderGroupedTaskRow(task, tasks) {
    const parent = task.parent_id ? tasks.find(row => row.id === task.parent_id) || taskKnowledge.get(task.parent_id) : null;
    const dateBadge = getTaskDateBadge(task.due_date, task.next_occurrence_date || task.assigned_date);
    return `<li class="grouped-task" data-task-id="${escapeHtml(task.id)}">
        <div class="grouped-task-copy">
            <a class="grouped-task-title" href="/task-inspector/${encodeURIComponent(task.id)}">${escapeHtml(task.title)}</a>
            ${task.parent_id ? `<p>Subtask of ${escapeHtml(parent?.title || 'another task')}</p>` : ''}
            ${task.description ? `<p class="grouped-description">${escapeHtml(task.description)}</p>` : ''}
            <p class="grouped-metadata"><span>Priority: ${escapeHtml(task.priority || 'None')}</span><span>Estimate: ${escapeHtml(formatMinutesToDuration(task.estimated_minutes))}</span>
                ${dateBadge ? `<span>${escapeHtml(dateBadge.label)}</span>` : ''}
                ${task.is_recurring ? '<span>Recurring</span>' : ''}
                ${task.category ? `<span>${escapeHtml(task.category)}</span>` : ''}
                ${task.tags ? `<span>${escapeHtml(task.tags)}</span>` : ''}</p>
            ${task.attachments ? `<p>Links: ${escapeHtml(task.attachments)}</p>` : ''}
        </div>
        <div class="grouped-task-actions">
            <button type="button" onclick="openGroupedTaskEdit('${task.id}')">Edit</button>
            <button type="button" onclick="openGroupedTaskSchedule('${task.id}')">Schedule / Timer</button>
        </div>
    </li>`;
}

function openGroupedTaskEdit(taskId) {
    // A stable launcher survives the read refresh after Save/Delete as well as Cancel.
    document.getElementById('tasks_heading')?.focus({preventScroll: true});
    return openEditTaskModal(taskId);
}

function openGroupedTaskSchedule(taskId) {
    const task = kanbanTasks.find(row => row.id === taskId) || taskKnowledge.get(taskId);
    if (!task) return;
    taskKnowledge.rememberFallback(task);
    openCreateSessionModal(new Date(), null, task.id, task.title);
}

// Calendar-independent adapters required by the shared Session modal.
function rememberSavedSession(savedSession) {
    if (savedSession) taskKnowledge.invalidate();
}

async function refreshSessionDisplay() {
    await taskKnowledge.refresh();
}

function restoreSessionModalFocus(owner, refreshing = false) {
    const modal = document.getElementById('session_modal');
    const active = document.activeElement;
    if (active && active !== document.body && !modal?.contains?.(active)) return;
    const history = document.getElementById('detail_session_focus');
    const retainedHistory = owner?.launcher === history && !document.getElementById('outline_inspector')?.hidden;
    const target = owner?.launcher?.isConnected && (!refreshing || retainedHistory)
        ? owner.launcher : document.getElementById('tasks_heading');
    target?.focus({preventScroll: true});
}

async function clearCompletedTasks() {
    if (await showCustomConfirm('Clear Completed Tasks', 'Are you sure you want to remove all completed task slots?')) {
        await api.delete('/api/tasks/completed');
        await taskKnowledge.changed();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupModalKeyboardListeners();
    fetchAllTasksRegistry();
});
