/** Optional hierarchy view. The mounted details editor owns its own draft. */
let outlineSelectedTaskId = null;
const outlineCollapsedTasks = new Set();
let outlineVisibleTaskIds = new Set();

function renderOutlineTasks(container, statuses, tasks) {
    const rows = new Map(tasks.map(task => [task.id, task]));
    const matches = new Set();
    for (const task of tasks) {
        const status = statuses.find(status => task.status_id && status.id === task.status_id)
            || statuses.find(status => status.name === task.status);
        if (!status?.is_hide_by_default && matchesKanbanSearch(task) &&
            (typeof matchesCustomFilter !== 'function' || matchesCustomFilter(task))) matches.add(task.id);
    }
    const included = new Set(matches);
    for (const id of matches) {
        const seen = new Set([id]);
        let parentId = rows.get(id)?.parent_id;
        while (parentId && !seen.has(parentId)) {
            seen.add(parentId);
            const parent = rows.get(parentId) || taskKnowledge.get(parentId);
            if (!parent) break;
            if (!rows.has(parentId)) rows.set(parentId, parent);
            included.add(parentId);
            parentId = parent.parent_id;
        }
    }
    const orderedIds = [...rows.keys()].filter(id => included.has(id));
    const children = new Map();
    for (const id of orderedIds) {
        const parent = rows.get(id).parent_id;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(id);
    }
    const roots = orderedIds.filter(id => !included.has(rows.get(id).parent_id));
    const visited = new Set();
    outlineVisibleTaskIds = new Set();
    const html = [];
    // An iterative walk handles arbitrarily deep/corrupt hierarchies without recursion overflow.
    function walk(root) {
        const stack = [{id: root, depth: 0, visible: true}];
        while (stack.length) {
            const frame = stack.pop();
            if (frame.close) { html.push('</ul></li>'); continue; }
            if (visited.has(frame.id)) continue;
            visited.add(frame.id);
            const task = rows.get(frame.id), descendants = children.get(frame.id) || [];
            const context = !matches.has(frame.id);
            // Required context expands during filtering so matching children remain reachable.
            const expanded = context || !outlineCollapsedTasks.has(frame.id);
            if (frame.visible) outlineVisibleTaskIds.add(frame.id);
            html.push(`<li data-task-id="${escapeHtml(frame.id)}"><div class="outline-row" style="--outline-depth:${Math.min(frame.depth, 8)}">
                ${descendants.length ? `<button type="button" data-outline-expand="${escapeHtml(frame.id)}" aria-expanded="${expanded}" aria-label="${expanded ? 'Collapse' : 'Expand'} ${escapeHtml(task.title)}">${expanded ? '−' : '+'}</button>` : '<span class="outline-leaf" aria-hidden="true"></span>'}
                <button type="button" class="outline-select" data-outline-select="${escapeHtml(frame.id)}" aria-current="${outlineSelectedTaskId === frame.id ? 'true' : 'false'}">${escapeHtml(task.title || 'Untitled task')}</button>
                ${context ? '<span class="outline-context">Ancestor context (outside current filter or hidden status)</span>' : `<span>${escapeHtml(task.status || 'Unknown status')}</span>`}
                ${task.parent_id && !rows.has(task.parent_id) ? '<span>Parent unavailable</span>' : ''}
                </div><ul${expanded ? '' : ' hidden'}>`);
            stack.push({close: true});
            for (let index = descendants.length - 1; index >= 0; index--) stack.push({id: descendants[index], depth: frame.depth + 1, visible: frame.visible && expanded});
        }
    }
    roots.forEach(walk);
    // Components consisting only of a cycle still receive a deterministic snapshot-order root.
    orderedIds.forEach(id => { if (!visited.has(id)) walk(id); });
    container.innerHTML = html.length ? `<ul class="outline-roots">${html.join('')}</ul>` : '<p>No matching tasks</p>';
    for (const button of container.querySelectorAll('[data-outline-select]')) {
        button.addEventListener('click', () => selectOutlineTask(button.dataset.outlineSelect));
    }
    for (const button of container.querySelectorAll('[data-outline-expand]')) {
        button.addEventListener('click', () => {
            const id = button.dataset.outlineExpand;
            if (outlineCollapsedTasks.has(id)) outlineCollapsedTasks.delete(id); else outlineCollapsedTasks.add(id);
            renderCurrentTaskView();
        });
    }
    updateOutlineSelectionNotice();
}

function updateOutlineSelectionNotice() {
    const notice = document.getElementById('outline_selection_notice');
    if (notice) notice.textContent = outlineSelectedTaskId && !outlineVisibleTaskIds.has(outlineSelectedTaskId)
        ? 'Selected task is outside the current filter or collapsed hierarchy. Its editor is retained.' : '';
}

async function selectOutlineTask(taskId) {
    if (!taskId) return false;
    if (outlineSelectedTaskId === taskId) return loadTaskDetailTree(true);
    if (!canChangeInlineTaskDetail()) return false;
    outlineSelectedTaskId = taskId;
    resetInlineTaskDetail(taskId);
    updateOutlineInspectorVisibility(selectedTaskView === 'outline');
    renderCurrentTaskView();
    return loadTaskDetailTree(true);
}

function updateOutlineInspectorVisibility(visible) {
    const host = document.getElementById('outline_inspector');
    if (!host) return;
    host.hidden = !visible;
    host.inert = !visible;
    const panel = document.getElementById('outline_inspector_panel');
    if (panel) { panel.hidden = !outlineSelectedTaskId; panel.inert = !outlineSelectedTaskId; }
    const empty = document.getElementById('outline_empty');
    if (empty) empty.hidden = Boolean(outlineSelectedTaskId);
    const link = document.getElementById('outline_details_link');
    if (link) {
        link.hidden = !outlineSelectedTaskId;
        link.href = outlineSelectedTaskId ? `/task-inspector/${encodeURIComponent(outlineSelectedTaskId)}` : '/tasks';
    }
}

function closeOutlineInspector(acknowledged = false) {
    if (!acknowledged && !canChangeInlineTaskDetail()) return false;
    outlineSelectedTaskId = null;
    resetInlineTaskDetail();
    updateOutlineInspectorVisibility(selectedTaskView === 'outline');
    renderCurrentTaskView();
    document.getElementById('tasks_heading')?.focus({preventScroll: true});
    return true;
}
