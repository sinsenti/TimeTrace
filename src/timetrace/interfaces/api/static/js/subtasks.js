/**
 * Task Inspector Engine: Real Title Population, Parent Task Banner & Suppressed Estimates for Ongoing Tasks
 */

let currentTreeData = null;

document.addEventListener('DOMContentLoaded', () => {
    loadTaskDetailTree();
    setupSubtaskModalKeyboard();
});

async function loadTaskDetailTree() {
    const taskIdEl = document.getElementById('inspector_task_id');
    if (!taskIdEl || !taskIdEl.value) return;

    const taskId = taskIdEl.value;
    try {
        currentTreeData = await api.get(`/tasks/${taskId}/tree`);
        const tree = currentTreeData;
        
        // 1. Populate Header Title
        const titleHeader = document.getElementById('detail_task_title_header');
        if (titleHeader) titleHeader.innerText = tree.title || `Task #${tree.id}`;

        const statusBadge = document.getElementById('detail_task_status_badge');
        if (statusBadge) statusBadge.innerText = tree.status;

        const priorityBadge = document.getElementById('detail_task_priority_badge');
        if (priorityBadge) priorityBadge.innerText = (tree.priority || '-').toUpperCase();

        // 2. Display Parent Task Banner permanently if this is a Subtask
        const breadcrumbsEl = document.getElementById('task_breadcrumbs');
        const parentBannerEl = document.getElementById('parent_task_banner');

        if (tree.parent_id) {
            try {
                const parentTask = await api.get(`/tasks/${tree.parent_id}`);
                if (parentBannerEl) {
                    parentBannerEl.classList.remove('hidden');
                    parentBannerEl.innerHTML = `
                        <div class="bg-purple-950/40 border border-purple-800/80 rounded-xl p-3 flex justify-between items-center text-xs shadow-md">
                            <div class="flex items-center space-x-2">
                                <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-purple-900/80 text-purple-300 border border-purple-700">Subtask Of</span>
                                <a href="/task-inspector/${parentTask.id}" class="font-black text-sm text-white hover:underline hover:text-purple-300">#${parentTask.id} ${parentTask.title}</a>
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
                        <a href="/kanban" class="hover:underline">Tasks</a>
                        <span>&gt;</span>
                        <a href="/task-inspector/${parentTask.id}" class="hover:underline">#${parentTask.id} ${parentTask.title}</a>
                        <span>&gt;</span>
                        <span class="text-white font-bold">#${tree.id} ${tree.title}</span>
                    `;
                }
            } catch(e) {
                if (parentBannerEl) parentBannerEl.classList.add('hidden');
            }
        } else {
            if (parentBannerEl) parentBannerEl.classList.add('hidden');
            if (breadcrumbsEl) {
                breadcrumbsEl.innerHTML = `
                    <a href="/kanban" class="hover:underline">Tasks</a>
                    <span>&gt;</span>
                    <span class="text-white font-bold">#${tree.id} ${tree.title}</span>
                `;
            }
        }

        // 3. Suppress Time Estimation Display for 'Ongoing' Tasks
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

        // Populate Edit Form Inputs
        const titleInput = document.getElementById('inspector_edit_title');
        if (titleInput) titleInput.value = tree.title || '';

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

        const assignedInput = document.getElementById('inspector_edit_assigned_date');
        if (assignedInput) assignedInput.value = tree.assigned_date || '';

        const dueInput = document.getElementById('inspector_edit_due_date');
        if (dueInput) dueInput.value = tree.due_date ? formatIsoLocal(parseApiDateTime(tree.due_date)) : '';

        const attachInput = document.getElementById('inspector_edit_attachments');
        if (attachInput) attachInput.value = tree.attachments || '';

        const stats = await api.get(`/tasks/${taskId}/stats`);
        const trackedEl = document.getElementById('detail_task_tracked');
        if (trackedEl) trackedEl.innerText = `${stats.total_hours}h`;

        const progressEl = document.getElementById('detail_task_progress');
        if (progressEl && !isOngoing) progressEl.innerText = stats.progress_pct !== null ? `${stats.progress_pct}%` : 'N/A';

        const counts = calculateTreeCompletionStats(tree.subtasks || []);
        const pct = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;
        
        const completionPctEl = document.getElementById('detail_tree_completion_pct');
        if (completionPctEl) completionPctEl.innerText = `${pct}% (${counts.completed}/${counts.total})`;

        const pBar = document.getElementById('subtasks_completion_bar');
        if (pBar) pBar.style.width = `${pct}%`;

        renderSubtasksTreeNodes(tree.subtasks, document.getElementById('subtasks_tree_container'));
    } catch (e) {
        console.error("Failed to load task tree:", e);
        const container = document.getElementById('subtasks_tree_container');
        if (container) {
            container.innerHTML = `
                <div class="bg-red-950/40 border border-red-800/80 rounded-lg p-4 text-xs space-y-2 text-red-200">
                    <div class="font-bold">Task #${taskId} Not Found</div>
                    <div>The requested task does not exist or was deleted.</div>
                    <div class="pt-2 flex space-x-2">
                        <a href="/kanban" class="bg-purple-600 hover:bg-purple-500 text-white font-bold px-3 py-1 rounded">Return to Board</a>
                        <a href="/dashboard" class="bg-[#222536] hover:bg-[#2d3046] text-slate-300 font-bold px-3 py-1 rounded">Return to Dashboard</a>
                    </div>
                </div>
            `;
        }
    }
}

async function saveInspectorTaskProperties() {
    const taskId = document.getElementById('inspector_task_id').value;
    if (!taskId) return;

    const dueInput = document.getElementById('inspector_edit_due_date').value;

    const payload = {
        title: document.getElementById('inspector_edit_title').value.trim(),
        description: document.getElementById('inspector_edit_desc').value,
        status: document.getElementById('inspector_edit_status').value,
        category: document.getElementById('inspector_edit_category').value,
        priority: document.getElementById('inspector_edit_priority').value,
        estimated_minutes: parseInt(document.getElementById('inspector_edit_est').value) || 15,
        assigned_date: document.getElementById('inspector_edit_assigned_date').value || null,
        attachments: document.getElementById('inspector_edit_attachments').value || ''
    };

    if (dueInput) payload.due_date = new Date(dueInput).toISOString();

    if (!payload.title) {
        alert("Task title is required.");
        return;
    }

    await api.put(`/tasks/${taskId}`, payload);
    loadTaskDetailTree();
}

async function deleteMainInspectorTask() {
    const taskId = document.getElementById('inspector_task_id').value;
    if (!taskId) return;

    const confirmed = await showCustomConfirm("Delete Task", "Are you sure you want to delete this task slot and all its subtasks?");
    if (confirmed) {
        await api.delete(`/tasks/${taskId}`);
        window.location.href = '/kanban';
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
                    <button onclick="openSubtaskCreationModal(${node.id})" class="text-purple-400 hover:text-purple-300 font-bold">+ Subtask</button>
                    <button onclick="deleteSubtaskNode(${node.id})" class="text-red-400 hover:text-red-300 font-bold">&times;</button>
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
        heading.innerText = parentId ? `Create Subtask under #${parentId}` : "Create Root Subtask";
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

    await api.post('/tasks', payload);
    closeSubtaskModal();
    loadTaskDetailTree();
}

async function toggleSubtaskCompletion(subtaskId, currentStatus) {
    const stLower = (currentStatus || '').toLowerCase();
    const newStatus = (stLower === 'done' || stLower === 'completed') ? 'To Do' : 'Done';
    await api.put(`/tasks/${subtaskId}`, { status: newStatus });
    loadTaskDetailTree();
}

async function deleteSubtaskNode(id) {
    const confirmed = await showCustomConfirm("Delete Subtask", "Are you sure you want to delete this subtask and all its nested children?");
    if (confirmed) {
        await api.delete(`/tasks/${id}`);
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
