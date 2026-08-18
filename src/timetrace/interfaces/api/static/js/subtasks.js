/**
 * Task Inspector Engine
 */

let currentTreeData = null;

document.addEventListener('DOMContentLoaded', () => {
    loadTaskDetailTree();
    setupSubtaskModalKeyboard();
});

function toggleInspectorRecurrenceRule(isRecurring) {
    const container = document.getElementById('inspector_recurrence_rule_container');
    if (!container) return;
    if (isRecurring) {
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
}

function navigateBack() {
    if (document.referrer) {
        try {
            const refUrl = new URL(document.referrer);
            if (refUrl.host === window.location.host && refUrl.pathname !== window.location.pathname) {
                window.location.href = document.referrer;
                return;
            }
        } catch (e) {}
    }
    window.location.href = '/tasks';
}

async function loadTaskDetailTree() {
    const taskIdEl = document.getElementById('inspector_task_id');
    if (!taskIdEl || !taskIdEl.value) return;

    const taskId = taskIdEl.value;
    try {
        currentTreeData = await api.get(`/api/tasks/${taskId}/tree`);
        const tree = currentTreeData;
        
        const titleHeader = document.getElementById('detail_task_title_header');
        if (titleHeader) titleHeader.innerText = tree.title || 'Untitled Task';

        const statusBadge = document.getElementById('detail_task_status_badge');
        if (statusBadge) statusBadge.innerText = tree.status;

        const priorityBadge = document.getElementById('detail_task_priority_badge');
        if (priorityBadge) priorityBadge.innerText = (tree.priority || '-').toUpperCase();

        const breadcrumbsEl = document.getElementById('task_breadcrumbs');
        const parentBannerEl = document.getElementById('parent_task_banner');

        if (tree.parent_id) {
            try {
                const parentTask = await api.get(`/api/tasks/${tree.parent_id}`);
                if (parentBannerEl) {
                    parentBannerEl.classList.remove('hidden');
                    parentBannerEl.innerHTML = `
                        <div class="bg-purple-950/40 border border-purple-800/80 rounded-xl p-3 flex justify-between items-center text-xs shadow-md">
                            <div class="flex items-center space-x-2">
                                <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-purple-900/80 text-purple-300 border border-purple-700">Subtask Of</span>
                                <a href="/task-inspector/${parentTask.id}" class="font-black text-sm text-white hover:underline hover:text-purple-300">${parentTask.title}</a>
                                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-black/40 text-slate-300 uppercase">${parentTask.status}</span>
                            </div>
                            <a href="/task-inspector/${parentTask.id}" class="text-purple-300 hover:text-white font-bold underline text-[11px] flex items-center space-x-1">
                                <span>Go to Parent Task</span>
                                <span>&rarr;</span>
                            </a>
                        </div>
                    `;
                }
                if (breadcrumbsEl) {
                    breadcrumbsEl.innerHTML = `
                        <button type="button" onclick="navigateBack()" class="h-8 px-3.5 bg-[#181a28] hover:bg-[#222536] text-purple-300 border border-[var(--border-muted)] rounded-lg font-bold text-xs flex items-center space-x-1">&larr; Back</button>
                        <span class="text-slate-600">|</span>
                        <span class="text-slate-400">Subtask of:</span>
                        <a href="/task-inspector/${parentTask.id}" class="hover:underline font-bold text-purple-400">${parentTask.title}</a>
                    `;
                }
            } catch(e) {
                if (parentBannerEl) parentBannerEl.classList.add('hidden');
            }
        } else {
            if (parentBannerEl) parentBannerEl.classList.add('hidden');
            if (breadcrumbsEl) {
                breadcrumbsEl.innerHTML = `
                    <button type="button" onclick="navigateBack()" class="h-8 px-3.5 bg-[#181a28] hover:bg-[#222536] text-purple-300 border border-[var(--border-muted)] rounded-lg font-bold text-xs flex items-center space-x-1">&larr; Back</button>
                `;
            }
        }

        const isOngoing = (tree.status || '').toLowerCase() === 'ongoing';
        const estContainer = document.getElementById('detail_task_est_container');
        const progressContainer = document.getElementById('detail_task_progress_container');
        const estBadge = document.getElementById('detail_task_est');

        if (isOngoing) {
            if (estContainer) estContainer.classList.add('hidden');
            if (progressContainer) progressContainer.classList.add('hidden');
        } else {
            if (estContainer) estContainer.classList.remove('hidden');
            if (progressContainer) progressContainer.classList.remove('hidden');
            if (estBadge) estBadge.innerText = `${tree.estimated_minutes || 15}m`;
        }

        const titleInput = document.getElementById('inspector_edit_title');
        if (titleInput) titleInput.value = tree.title || '';

        const tagsInput = document.getElementById('inspector_edit_tags');
        if (tagsInput) tagsInput.value = tree.tags || '';

        const descInput = document.getElementById('inspector_edit_desc');
        if (descInput) descInput.value = tree.description || '';

        const statusSelect = document.getElementById('inspector_edit_status');
        if (statusSelect) statusSelect.value = tree.status || 'To Do';

        const catSelect = document.getElementById('inspector_edit_category');
        if (catSelect) catSelect.value = tree.category || 'work';

        const prioSelect = document.getElementById('inspector_edit_priority');
        if (prioSelect) prioSelect.value = tree.priority || '-';

        const estSelect = document.getElementById('inspector_edit_est');
        if (estSelect) estSelect.value = String(tree.estimated_minutes || 15);

        const isRecur = tree.is_recurring === true;
        const recurCheck = document.getElementById('inspector_edit_is_recurring');
        if (recurCheck) recurCheck.checked = isRecur;

        const ruleSelect = document.getElementById('inspector_edit_recurrence_rule');
        if (ruleSelect) ruleSelect.value = tree.recurrence_rule || 'daily';

        toggleInspectorRecurrenceRule(isRecur);

        const assignedInput = document.getElementById('inspector_edit_assigned_date');
        if (assignedInput) assignedInput.value = tree.assigned_date ? formatFlexibleDateForInput(tree.assigned_date) : '';

        const dueInput = document.getElementById('inspector_edit_due_date');
        if (dueInput) dueInput.value = tree.due_date ? formatFlexibleDateForInput(tree.due_date) : '';

        const attachInput = document.getElementById('inspector_edit_attachments');
        if (attachInput) attachInput.value = tree.attachments || '';

        const stats = await api.get(`/api/tasks/${taskId}/stats`);
        const trackedEl = document.getElementById('detail_task_tracked');
        if (trackedEl) trackedEl.innerText = `${stats.total_hours}h`;

        const progressEl = document.getElementById('detail_task_progress');
        if (progressEl && !isOngoing) progressEl.innerText = stats.progress_pct !== null ? `${stats.progress_pct}%` : 'N/A';

        const counts = calculateTreeCompletionStats(tree.subtasks || []);
        const completionContainer = document.getElementById('detail_subtask_completion_container');
        const pBarWrapper = document.getElementById('subtasks_completion_bar_wrapper');

        if (counts.total === 0) {
            if (completionContainer) completionContainer.classList.add('hidden');
            if (pBarWrapper) pBarWrapper.classList.add('hidden');
        } else {
            if (completionContainer) completionContainer.classList.remove('hidden');
            if (pBarWrapper) pBarWrapper.classList.remove('hidden');

            const pct = Math.round((counts.completed / counts.total) * 100);
            const completionPctEl = document.getElementById('detail_tree_completion_pct');
            if (completionPctEl) completionPctEl.innerText = `${pct}% (${counts.completed}/${counts.total})`;

            const pBar = document.getElementById('subtasks_completion_bar');
            if (pBar) pBar.style.width = `${pct}%`;
        }

        renderSubtasksTreeNodes(tree.subtasks, document.getElementById('subtasks_tree_container'));
    } catch (e) {
        console.error("Failed to load task tree:", e);
    }
}

async function saveInspectorTaskProperties(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const taskId = document.getElementById('inspector_task_id').value;
    if (!taskId) return;

    const oldStatus = currentTreeData ? currentTreeData.status : null;
    const assignedInputVal = document.getElementById('inspector_edit_assigned_date') ? document.getElementById('inspector_edit_assigned_date').value.trim() : '';
    const dueInputVal = document.getElementById('inspector_edit_due_date') ? document.getElementById('inspector_edit_due_date').value.trim() : '';
    const titleVal = document.getElementById('inspector_edit_title').value.trim();

    if (!titleVal) {
        alert("Task title is required.");
        return;
    }

    const assignedParsed = parseFlexibleDateInput(assignedInputVal);
    const dueParsed = parseFlexibleDateInput(dueInputVal);

    const payload = {
        title: titleVal,
        tags: document.getElementById('inspector_edit_tags') ? document.getElementById('inspector_edit_tags').value : '',
        description: document.getElementById('inspector_edit_desc').value,
        status: document.getElementById('inspector_edit_status').value,
        category: document.getElementById('inspector_edit_category').value,
        priority: document.getElementById('inspector_edit_priority').value,
        estimated_minutes: parseInt(document.getElementById('inspector_edit_est').value) || 15,
        is_recurring: document.getElementById('inspector_edit_is_recurring') ? document.getElementById('inspector_edit_is_recurring').checked : false,
        recurrence_rule: document.getElementById('inspector_edit_recurrence_rule') ? document.getElementById('inspector_edit_recurrence_rule').value : 'daily',
        assigned_date: assignedParsed ? assignedParsed.dateStr : null,
        due_date: dueParsed ? dueParsed.isoString : null,
        attachments: document.getElementById('inspector_edit_attachments').value || ''
    };

    try {
        await api.put(`/api/tasks/${taskId}`, payload);
        if ((oldStatus || '').toLowerCase() === 'scheduled' && payload.status.toLowerCase() !== 'scheduled') {
            await discardFutureSessionsForTask(taskId);
        }
        navigateBack();
    } catch (err) {
        console.error("Failed to save inspector task properties:", err);
        alert("Failed to save changes: " + (err.message || err));
    }
}

async function deleteMainInspectorTask() {
    const taskId = document.getElementById('inspector_task_id').value;
    if (!taskId) return;

    const confirmed = await showCustomConfirm("Delete Task", "Are you sure you want to delete this task slot and all its subtasks?");
    if (confirmed) {
        await api.delete(`/api/tasks/${taskId}`);
        navigateBack();
    }
}

function calculateTreeCompletionStats(subtasks) {
    let total = 0;
    let completed = 0;

    function traverse(nodes) {
        if (!nodes) return;
        nodes.forEach(node => {
            total++;
            const stLower = (node.status || '').toLowerCase();
            if (stLower === 'done' || stLower === 'completed') {
                completed++;
            }
            if (node.subtasks && node.subtasks.length > 0) {
                traverse(node.subtasks);
            }
        });
    }

    traverse(subtasks);
    return { total, completed };
}

function renderSubtasksTreeNodes(subtasks, container) {
    if (!container) return;

    if (!subtasks || subtasks.length === 0) {
        container.innerHTML = '<div class="text-xs text-slate-500 py-2">No subtasks created under this level.</div>';
        return;
    }

    container.innerHTML = subtasks.map(node => renderSubtaskCardHTML(node)).join('');
}

function renderSubtaskCardHTML(node) {
    const isDone = (node.status || '').toLowerCase() === 'done' || (node.status || '').toLowerCase() === 'completed';
    const isOngoing = (node.status || '').toLowerCase() === 'ongoing';

    return `
        <div class="subtask-node bg-[#0f1016] p-3 rounded-lg border border-[var(--border-muted)] space-y-2">
            <div class="flex justify-between items-center">
                <div class="flex items-center space-x-2">
                    <input type="checkbox" ${isDone ? 'checked' : ''} onchange="toggleSubtaskCompletion(${node.id}, '${node.status}')" class="w-4 h-4 accent-emerald-600 cursor-pointer rounded">
                    <span class="font-bold text-xs ${isDone ? 'line-through text-slate-500' : 'text-white'}">${node.title}</span>
                    ${!isOngoing ? `<span class="text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800 px-1.5 py-0.5 rounded">${node.estimated_minutes || 15}m</span>` : ''}
                    <span class="text-[10px] font-bold bg-black/30 px-1.5 py-0.5 rounded text-slate-400">${node.status}</span>
                </div>
                <div class="flex items-center space-x-2 text-xs">
                    <button type="button" onclick="openSubtaskCreationModal(${node.id})" class="text-purple-400 hover:text-purple-300 font-bold">+ Subtask</button>
                    <button type="button" onclick="deleteSubtaskNode(${node.id})" class="text-red-400 hover:text-red-300 font-bold">&times;</button>
                </div>
            </div>

            ${node.subtasks && node.subtasks.length > 0 ? `<div class="subtask-children pl-3 border-l border-purple-900/50 space-y-2 mt-2">${node.subtasks.map(child => renderSubtaskCardHTML(child)).join('')}</div>` : ''}
        </div>
    `;
}

function openSubtaskCreationModal(parentId = null) {
    const mainTaskId = document.getElementById('inspector_task_id').value;
    const targetParentId = parentId ? parentId : parseInt(mainTaskId);

    document.getElementById('subtask_parent_id').value = targetParentId;
    document.getElementById('modal_subtask_title').value = '';
    document.getElementById('modal_subtask_est').value = '15';
    document.getElementById('modal_subtask_status').value = 'To Do';

    const heading = document.getElementById('subtask_modal_heading');
    if (heading) {
        heading.innerText = parentId ? `Create Subtask under parent task` : "Create Root Subtask";
    }

    document.getElementById('subtask_modal').classList.remove('hidden');

    setTimeout(() => {
        const input = document.getElementById('modal_subtask_title');
        if (input) {
            input.focus();
            input.select();
        }
    }, 50);
}

function closeSubtaskModal() {
    const modal = document.getElementById('subtask_modal');
    if (modal) modal.classList.add('hidden');
}

async function saveSubtaskFromModal() {
    const parentId = document.getElementById('subtask_parent_id').value;
    const titleVal = document.getElementById('modal_subtask_title').value.trim();
    if (!titleVal) {
        alert("Subtask title is required.");
        return;
    }

    const payload = {
        title: titleVal,
        parent_id: parseInt(parentId),
        status: document.getElementById('modal_subtask_status').value,
        estimated_minutes: parseInt(document.getElementById('modal_subtask_est').value) || 15,
        category: currentTreeData ? currentTreeData.category : "work"
    };

    await api.post('/api/tasks', payload);
    closeSubtaskModal();
    loadTaskDetailTree();
}

async function toggleSubtaskCompletion(subtaskId, currentStatus) {
    const stLower = (currentStatus || '').toLowerCase();
    const newStatus = (stLower === 'done' || stLower === 'completed') ? 'To Do' : 'Done';
    await api.put(`/api/tasks/${subtaskId}`, { status: newStatus });
    loadTaskDetailTree();
}

async function deleteSubtaskNode(id) {
    const confirmed = await showCustomConfirm("Delete Subtask", "Are you sure you want to delete this subtask and all its nested children?");
    if (confirmed) {
        await api.delete(`/api/tasks/${id}`);
        loadTaskDetailTree();
    }
}

function setupSubtaskModalKeyboard() {
    const modal = document.getElementById('subtask_modal');
    if (modal) {
        modal.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveSubtaskFromModal();
            } else if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                closeSubtaskModal();
            }
        });
    }
}
