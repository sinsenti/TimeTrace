/**
 * Completion Policy Prompt Engine
 *
 * When a task transitions into "completed", or out of a "scheduled trigger"
 * status without becoming completed, the backend (TaskService.update_task)
 * returns a `completion_policy` block describing any future scheduled
 * sessions still sitting on the calendar for that task. This module renders
 * that prompt and lets the user clear those sessions (optionally including
 * subtasks) or just keep them.
 */

let completionPolicyState = null;

function formatCompletionPolicySessionTime(startIso, endIso) {
    const start = parseApiDateTime(startIso);
    const end = endIso ? parseApiDateTime(endIso) : null;
    if (!start || isNaN(start.getTime())) return startIso || '';

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pad = (n) => String(n).padStart(2, '0');
    const dateLabel = `${monthNames[start.getMonth()]} ${start.getDate()}`;
    const startLabel = `${pad(start.getHours())}:${pad(start.getMinutes())}`;

    if (end && !isNaN(end.getTime())) {
        const endLabel = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
        return `${dateLabel}, ${startLabel} - ${endLabel}`;
    }
    return `${dateLabel}, ${startLabel}`;
}

function handleCompletionPolicy(putResponse) {
    if (!putResponse || !putResponse.completion_policy) return;

    const policy = putResponse.completion_policy;
    completionPolicyState = policy;

    const titleEl = document.getElementById('completion_policy_modal_title');
    if (titleEl) {
        titleEl.innerText = policy.reason === 'left_scheduled' ? 'Removed from calendar' : 'Task completed';
    }

    const listEl = document.getElementById('completion_policy_session_list');
    if (listEl) {
        listEl.innerHTML = (policy.scheduled_sessions || []).map(s => `
            <label class="flex items-center space-x-2 text-xs bg-[#0f1016] border border-[var(--border-muted)] rounded-lg px-2.5 py-2 cursor-pointer">
                <input type="checkbox" class="completion_policy_session_checkbox w-4 h-4 accent-purple-600 cursor-pointer rounded" data-session-id="${s.id}" checked>
                <span class="flex-1 text-slate-200">${formatCompletionPolicySessionTime(s.start_time, s.end_time)}</span>
            </label>
        `).join('');
    }

    const subtaskRow = document.getElementById('completion_policy_subtask_row');
    const subtaskCheckbox = document.getElementById('completion_policy_include_subtasks');
    const subtaskLabel = document.getElementById('completion_policy_subtask_label');
    if (subtaskRow) {
        if (policy.subtask_scheduled_count > 0) {
            subtaskRow.classList.remove('hidden');
            if (subtaskLabel) {
                subtaskLabel.innerText = `Also clear ${policy.subtask_scheduled_count} scheduled sessions on subtasks`;
            }
            if (subtaskCheckbox) subtaskCheckbox.checked = false;
        } else {
            subtaskRow.classList.add('hidden');
        }
    }

    const modal = document.getElementById('completion_policy_modal');
    if (modal) modal.classList.remove('hidden');
}

function closeCompletionPolicyModal() {
    const modal = document.getElementById('completion_policy_modal');
    if (modal) modal.classList.add('hidden');
    completionPolicyState = null;
}

async function clearCompletionPolicySessions() {
    if (!completionPolicyState) {
        closeCompletionPolicyModal();
        return;
    }

    const taskId = completionPolicyState.task_id;
    const checkboxes = Array.from(document.querySelectorAll('.completion_policy_session_checkbox'));
    const checkedIds = checkboxes.filter(cb => cb.checked).map(cb => cb.getAttribute('data-session-id'));

    const includeSubtasksCheckbox = document.getElementById('completion_policy_include_subtasks');
    const includeSubtasks = includeSubtasksCheckbox ? includeSubtasksCheckbox.checked : false;

    const sessionIds = checkedIds.length === checkboxes.length ? null : checkedIds;

    try {
        await api.post(`/api/tasks/${taskId}/clear-scheduled-sessions`, {
            include_subtasks: includeSubtasks,
            session_ids: sessionIds
        });

        if (typeof calendar !== 'undefined' && calendar && typeof calendar.refetchEvents === 'function') calendar.refetchEvents();
        if (typeof fetchRangeTotals === 'function') fetchRangeTotals();
        if (typeof loadKanbanBoard === 'function') loadKanbanBoard();
        if (typeof loadTaskDetailTree === 'function') loadTaskDetailTree();
    } catch (err) {
        console.error("Failed to clear scheduled sessions:", err);
        alert("Failed to clear scheduled sessions: " + (err.message || err));
    } finally {
        closeCompletionPolicyModal();
    }
}
