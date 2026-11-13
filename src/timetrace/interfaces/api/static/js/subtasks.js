/**
 * Task Inspector Engine
 */

let currentTreeData = null;
let initializedTaskDetailId = null;
let taskDetailRequest = 0;
let taskDetailOwner = 0;
let taskPropertiesPending = false;
let taskDetailReadAvailable = false;
let subtaskEditorOwner = 0;
let subtaskSavePending = false;
let subtaskPersistedReceipt = null;
let subtaskReturnFocus = null;
let detailRecordedSessions = [];

const taskFormFieldRevisions = new WeakMap();
function recordTaskFormEdit(event) {
    const field = event.target;
    if (field?.id?.startsWith('inspector_edit_') || field?.id?.startsWith('modal_subtask_')) {
        taskFormFieldRevisions.set(field, (taskFormFieldRevisions.get(field) || 0) + 1);
    }
}
// Input records edit intent, including ABA edits. A delayed change-on-blur is not a new edit.
document.addEventListener('input', recordTaskFormEdit, true);
document.addEventListener('click', event => {
    const link = event.target?.closest?.('a[href]');
    if (!link || event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
        link.target === '_blank' || link.hasAttribute?.('download') || link.getAttribute('href')?.startsWith('#')) return;
    // The Settings navbar already owns this confirmation through its inline shared handler.
    if (link.getAttribute('onclick')?.includes('followSettingsLink')) return;
    if (!confirmTaskDetailDeparture()) {
        event.preventDefault();
        event.stopPropagation();
    }
}, true);

function confirmTaskDetailDeparture() {
    return typeof hasSettingsDrafts !== 'function' || !hasSettingsDrafts() ||
        window.confirm('Leave this page and discard unsaved changes?');
}

function navigateToTaskDetail(taskId) {
    if (confirmTaskDetailDeparture()) window.location.href = `/task-inspector/${taskId}`;
}

function taskFormFieldValue(field) {
    return field.type === 'checkbox' ? field.checked : field.value;
}
function setTaskFormFieldValue(field, value) {
    if (field.type === 'checkbox') { field.checked = value === true; return; }
    field.value = value;
    if (field.tagName === 'SELECT' && field.value !== value) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value || '(Empty)';
        field.appendChild(option);
        field.value = value;
    }
}
function taskReceiptFieldValue(key, task) {
    if (key === 'estimated_minutes') return formatMinutesToDuration(task[key]);
    if (key === 'assigned_date' || key === 'due_date') return task[key] ? formatFlexibleDateForInput(task[key]) : '';
    if (key === 'is_recurring') return task[key] === true;
    return task[key] ?? '';
}
function captureTaskFormReceipt(rootId, payload, fieldIds) {
    const fields = Object.entries(fieldIds).filter(([key]) => key === 'id' || Object.hasOwn(payload, key))
        .map(([key, id]) => ({key, id, field: document.getElementById(id)})).filter(entry => entry.field)
        .map(entry => ({...entry, value: taskFormFieldValue(entry.field), revision: taskFormFieldRevisions.get(entry.field) || 0}));
    return {
        hasEdits: () => fields.some(entry => entry.key !== 'id' &&
            (taskFormFieldValue(entry.field) !== entry.value || (taskFormFieldRevisions.get(entry.field) || 0) !== entry.revision)),
        checkpoint(task) {
            // A detached same-id snapshot supplies canonical baselines without replacing live drafts.
            const root = document.getElementById(rootId);
            const receipt = typeof settingsDraftCheckpoint === 'function' ? root?.cloneNode(true) : null;
            const persisted = fields.filter(entry => Object.hasOwn(task, entry.key));
            for (const entry of persisted) {
                const canonical = taskReceiptFieldValue(entry.key, task);
                if (taskFormFieldValue(entry.field) === entry.value &&
                    (taskFormFieldRevisions.get(entry.field) || 0) === entry.revision) setTaskFormFieldValue(entry.field, canonical);
                if (receipt) setTaskFormFieldValue(receipt.querySelectorAll(`#${entry.id}`)[0], canonical);
            }
            if (receipt && persisted.length) settingsDraftCheckpoint(receipt, persisted.map(entry => `#${entry.id}`).join(','))();
        }
    };
}

function taskPropertiesFeedback(message) {
    const status = document.getElementById('task_properties_status');
    if (status) status.textContent = message;
}

function subtaskFeedback(message) {
    const status = document.getElementById('subtask_save_status');
    if (status) status.textContent = message;
}

document.addEventListener('DOMContentLoaded', () => {
    taskKnowledge.load();
    loadTaskDetailTree();
    setupModalKeyboardListeners();
    setupSubtaskModalKeyboard();
    setupInspectorKeyboardShortcuts();
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
    if (!confirmTaskDetailDeparture()) return;
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

function setupInspectorKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        const subtaskModal = document.getElementById('subtask_modal');
        const settingsModal = document.getElementById('settings_modal');
        const confirmModal = document.getElementById('custom_confirm_modal');

        const taskModal = document.getElementById('task_modal');
        const sessionModal = document.getElementById('session_modal');
        const isAnyModalOpen = (taskModal && !taskModal.classList.contains('hidden')) ||
                               (sessionModal && !sessionModal.classList.contains('hidden')) ||
                               (subtaskModal && !subtaskModal.classList.contains('hidden')) ||
                               (settingsModal && !settingsModal.classList.contains('hidden')) ||
                               (confirmModal && !confirmModal.classList.contains('hidden'));

        if (isAnyModalOpen || e.defaultPrevented) return;
        const reviewRoot = document.getElementById('details_task_postmortem');
        if (reviewRoot?.contains(e.target)) return;

        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            saveInspectorTaskProperties(e);
        } else if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            navigateBack();
        }
    });
}

async function loadTaskDetailTree(preserveEdits = false) {
    const generation = taskKnowledge.state().generation;
    const request = ++taskDetailRequest;
    const taskIdEl = document.getElementById('inspector_task_id');
    if (!taskIdEl || !taskIdEl.value) return;

    const taskId = taskIdEl.value;
    const postmortemRoot = document.getElementById('details_task_postmortem');
    if (postmortemRoot && typeof createTaskPostmortemEditor === 'function') {
        createTaskPostmortemEditor(postmortemRoot).begin(taskId);
    }
    const isCurrent = () => request === taskDetailRequest && generation === taskKnowledge.state().generation &&
        taskIdEl.value === taskId;
    if (initializedTaskDetailId !== taskId) {
        const editor = document.getElementById('task_properties_editor');
        if (editor) editor.disabled = true;
        taskPropertiesFeedback('Loading task properties before editing...');
    }
    try {
        const tree = await api.get(`/api/tasks/${taskId}/tree`);
        if (!isCurrent()) return null;
        currentTreeData = tree;
        
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
                if (!isCurrent()) return null;
                if (parentBannerEl) {
                    parentBannerEl.classList.remove('hidden');
                    parentBannerEl.innerHTML = `
                        <div class="bg-purple-950/40 border border-purple-800/80 rounded-xl p-3 flex justify-between items-center text-xs shadow-md mb-4">
                            <div class="flex items-center space-x-2">
                                <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-purple-900/80 text-purple-300 border border-purple-700">Subtask Of</span>
                                <a href="/task-inspector/${parentTask.id}" class="font-black text-sm text-white hover:underline hover:text-purple-300">${escapeHtml(parentTask.title)}</a>
                                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-black/40 text-slate-300 uppercase">${escapeHtml(parentTask.status)}</span>
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
                        <button type="button" onclick="navigateBack()" class="h-8 px-3.5 bg-[#181a28] hover:bg-[#222536] text-purple-300 border border-[var(--border-muted)] rounded-lg font-bold text-xs flex items-center space-x-1">&larr; Back <kbd class="text-[9px] opacity-70 font-mono bg-black/20 px-1 rounded ml-1">Esc</kbd></button>
                        <span class="text-slate-600">|</span>
                        <span class="text-slate-400">Subtask of:</span>
                        <a href="/task-inspector/${parentTask.id}" class="hover:underline font-bold text-purple-400">${escapeHtml(parentTask.title)}</a>
                    `;
                }
            } catch(e) {
                if (!isCurrent()) return null;
                if (parentBannerEl) {
                    parentBannerEl.classList.remove('hidden');
                    parentBannerEl.textContent = 'Parent task unavailable. Your task and edits are retained.';
                }
            }
        } else {
            if (parentBannerEl) parentBannerEl.classList.add('hidden');
            if (breadcrumbsEl) {
                breadcrumbsEl.innerHTML = `
                    <button type="button" onclick="navigateBack()" class="h-8 px-3.5 bg-[#181a28] hover:bg-[#222536] text-purple-300 border border-[var(--border-muted)] rounded-lg font-bold text-xs flex items-center space-x-1">&larr; Back <kbd class="text-[9px] opacity-70 font-mono bg-black/20 px-1 rounded ml-1">Esc</kbd></button>
                `;
            }
        }

        if (!isCurrent()) return null;
        const estContainer = document.getElementById('detail_task_est_container');
        const progressContainer = document.getElementById('detail_task_progress_container');
        const scheduledContainer = document.getElementById('detail_task_scheduled_container');
        const remainingContainer = document.getElementById('detail_task_remaining_container');
        const estBadge = document.getElementById('detail_task_est');

        if (estContainer) estContainer.classList.remove('hidden');
        if (progressContainer) progressContainer.classList.remove('hidden');
        if (scheduledContainer) scheduledContainer.classList.remove('hidden');
        if (remainingContainer) remainingContainer.classList.remove('hidden');
        if (estBadge) estBadge.innerText = formatMinutesToDuration(tree.estimated_minutes);

        if (!preserveEdits || initializedTaskDetailId !== taskId) initializeTaskProperties(tree, taskId);

        renderSubtasksTreeNodes(tree.subtasks, document.getElementById('subtasks_tree_container'));
        const estimateLabel = document.getElementById('detail_task_est_label');
        if (estimateLabel) estimateLabel.textContent = tree.is_recurring ? 'Estimate per occurrence' : 'Estimated duration';
        const stats = await api.get(`/api/tasks/${taskId}/stats`);
        if (!isCurrent()) return null;
        const reviewRoot = document.getElementById('details_task_postmortem');
        if (reviewRoot && typeof createTaskPostmortemEditor === 'function') {
            // Review definitions are independent of this task’s recorded evidence.
            void createTaskPostmortemEditor(reviewRoot).hydrate(taskId, stats, isCurrent, true);
        }
        detailRecordedSessions = stats.sessions || [];
        if (typeof setSessionTagHistory === 'function') setSessionTagHistory(detailRecordedSessions);
        const trackedEl = document.getElementById('detail_task_tracked');
        if (trackedEl) trackedEl.innerText = `${stats.logged_hours}h`;

        const progressEl = document.getElementById('detail_task_progress');
        if (progressEl) progressEl.innerText = stats.progress_pct !== null ? `${stats.progress_pct}%` : 'N/A';

        const scheduledEl = document.getElementById('detail_task_scheduled');
        if (scheduledEl) scheduledEl.innerText = `${stats.scheduled_hours}h`;

        const remainingEl = document.getElementById('detail_task_remaining');
        if (remainingEl) {
            if (stats.is_unbounded || stats.remaining_hours === null || stats.remaining_hours === undefined) {
                remainingEl.innerText = 'Unbounded';
            } else if (stats.remaining_hours < 0) {
                remainingEl.innerText = `${stats.remaining_hours}h (over estimate)`;
            } else {
                remainingEl.innerText = `${stats.remaining_hours}h`;
            }
        }

        const unscheduledEl = document.getElementById('detail_task_unscheduled');
        if (unscheduledEl) {
            if (!stats.is_unbounded && stats.unscheduled_hours !== null && stats.unscheduled_hours !== undefined) {
                const label = stats.unscheduled_hours < 0
                    ? `${stats.unscheduled_hours}h unscheduled (overallocated)`
                    : `${stats.unscheduled_hours}h still unscheduled`;
                unscheduledEl.innerText = label;
                unscheduledEl.classList.remove('hidden');
            } else {
                unscheduledEl.classList.add('hidden');
            }
        }

        // Bottom Task Statistics & Session History Section
        const statsBadgeEl = document.getElementById('detail_stats_total_badge');
        if (statsBadgeEl) statsBadgeEl.innerText = `${stats.total_sessions} sessions`;

        const statLoggedEl = document.getElementById('detail_stat_logged');
        if (statLoggedEl) statLoggedEl.innerText = `${stats.logged_hours}h`;

        const statScheduledEl = document.getElementById('detail_stat_scheduled');
        if (statScheduledEl) statScheduledEl.innerText = `${stats.scheduled_hours}h`;

        const statRemainingEl = document.getElementById('detail_stat_remaining');
        if (statRemainingEl) {
            if (stats.is_unbounded || stats.remaining_hours === null || stats.remaining_hours === undefined) {
                statRemainingEl.innerText = 'Unbounded';
            } else if (stats.remaining_hours < 0) {
                statRemainingEl.innerText = `${stats.remaining_hours}h (over estimate)`;
            } else {
                statRemainingEl.innerText = `${stats.remaining_hours}h`;
            }
        }

        const statProgressEl = document.getElementById('detail_stat_progress');
        if (statProgressEl) statProgressEl.innerText = stats.progress_pct !== null ? `${stats.progress_pct}%` : 'N/A';

        const sessionListEl = document.getElementById('detail_task_sessions_list');
        if (sessionListEl) {
            if (!stats.sessions || stats.sessions.length === 0) {
                sessionListEl.innerHTML = '<div class="text-xs text-slate-500 py-3 text-center">No recorded sessions linked directly to this task yet.</div>';
            } else {
                sessionListEl.innerHTML = stats.sessions.map(s => {
                    const st = s.start_time ? new Date(s.start_time).toLocaleString() : '';
                    const durMins = roundVal((s.duration_seconds || 0) / 60, 1);
                    return `
                        <div class="bg-[#0f1016] border border-[var(--border-muted)] p-2.5 rounded-lg text-xs space-y-1">
                            <button type="button" onclick="editInspectorSession('${s.id}')" class="underline">Edit recorded session</button>
                            <div class="flex justify-between items-center font-mono">
                                <span class="text-purple-300 font-bold">${st}</span>
                                <span class="text-slate-400 font-bold">${durMins} mins</span>
                            </div>
                            ${s.notes ? `<div class="text-white font-semibold">${escapeHtml(s.notes)}</div>` : ''}
                            ${s.tags ? `<div class="text-[10px] text-purple-300 font-mono">${escapeHtml(s.tags)}</div>` : ''}
                        </div>
                    `;
                }).join('');
            }
        }

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
        taskDetailReadAvailable = true;
        taskKnowledge.viewResult("task-detail", true);
        taskPropertiesFeedback('Properties ready. Save is explicit; refresh retains your edits.');
        return true;
    } catch (e) {
        if (!isCurrent()) return null;
        taskDetailReadAvailable = false;
        taskKnowledge.viewResult("task-detail", false);
        taskPropertiesFeedback(initializedTaskDetailId === taskId
            ? 'Refresh unavailable. Last-known data and unsaved edits retained. Retry refresh reads only.'
            : 'Task unavailable or deleted. Use Retry refresh to enable editing.');
        console.error("Failed to load task tree:", e);
        return false;
    }
}

function setInspectorSelectValue(id, value) {
    const select = document.getElementById(id);
    if (!select) return;
    // Unknown/custom metadata is saved data, not permission to select a default.
    setTaskFormFieldValue(select, value);
}

function initializeTaskProperties(tree, taskId) {
    const titleInput = document.getElementById('inspector_edit_title');
    if (titleInput) titleInput.value = tree.title || '';

    const tagsInput = document.getElementById('inspector_edit_tags');
    if (tagsInput) tagsInput.value = tree.tags || '';

    const descInput = document.getElementById('inspector_edit_desc');
    if (descInput) descInput.value = tree.description || '';

    const statusSelect = document.getElementById('inspector_edit_status');
    if (statusSelect) setInspectorSelectValue('inspector_edit_status', tree.status ?? 'To Do');

    const catSelect = document.getElementById('inspector_edit_category');
    if (catSelect) setInspectorSelectValue('inspector_edit_category', tree.category ?? 'work');

    const prioSelect = document.getElementById('inspector_edit_priority');
    if (prioSelect) setInspectorSelectValue('inspector_edit_priority', tree.priority ?? '-');

    const estInput = document.getElementById('inspector_edit_est');
    if (estInput) estInput.value = formatMinutesToDuration(tree.estimated_minutes);

    const isRecur = tree.is_recurring === true;
    const recurCheck = document.getElementById('inspector_edit_is_recurring');
    if (recurCheck) recurCheck.checked = isRecur;

    const ruleSelect = document.getElementById('inspector_edit_recurrence_rule');
    if (ruleSelect) {
        ruleSelect.value = tree.recurrence_rule || 'daily';
        if (!ruleSelect.value) ruleSelect.value = 'daily';
    }

    toggleInspectorRecurrenceRule(isRecur);

    const assignedInput = document.getElementById('inspector_edit_assigned_date');
    if (assignedInput) assignedInput.value = tree.assigned_date ? formatFlexibleDateForInput(tree.assigned_date) : '';

    const dueInput = document.getElementById('inspector_edit_due_date');
    if (dueInput) dueInput.value = tree.due_date ? formatFlexibleDateForInput(tree.due_date) : '';

    const attachInput = document.getElementById('inspector_edit_attachments');
    if (attachInput) attachInput.value = tree.attachments || '';
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('task_properties_editor');
    initializedTaskDetailId = taskId;
    taskDetailOwner++;
    const editor = document.getElementById('task_properties_editor');
    if (editor) editor.disabled = false;
    const status = document.getElementById('task_properties_status');
    if (status) status.textContent = '';
}

function cancelInspectorTaskProperties() {
    if (taskPropertiesPending || !currentTreeData || currentTreeData.id !== initializedTaskDetailId) return;
    initializeTaskProperties(currentTreeData, initializedTaskDetailId);
    taskPropertiesFeedback('Unsaved property edits discarded.');
}

// Detail-page adapters for the existing shared Session controller. No Calendar instance is needed.
function rememberDetailSavedSession(savedSession, previousId) {
    const index = detailRecordedSessions.findIndex(session => session.id === previousId);
    if (index >= 0) detailRecordedSessions[index] = savedSession;
    else detailRecordedSessions.push(savedSession);
    taskKnowledge.invalidate();
}
async function refreshDetailSessionDisplay() {
    await taskKnowledge.refresh();
}
// The shared controller resolves these page hooks; do not replace another page's hooks.
if (typeof rememberSavedSession === 'undefined') globalThis.rememberSavedSession = rememberDetailSavedSession;
if (typeof refreshSessionDisplay === 'undefined') globalThis.refreshSessionDisplay = refreshDetailSessionDisplay;
if (typeof loadCurrentRevisionView === 'undefined') globalThis.loadCurrentRevisionView = refreshDetailSessionDisplay;
function editInspectorSession(sessionId) {
    // History rows are replaced by refresh; the heading is a persistent return-focus target.
    document.getElementById('detail_session_focus')?.focus();
    openEditSessionModal(sessionId, null, detailRecordedSessions.find(session => session.id === sessionId));
}
function scheduleInspectorSession() {
    if (!currentTreeData) return;
    const start = new Date();
    const minutes = currentTreeData.estimated_minutes > 0 ? currentTreeData.estimated_minutes : 30;
    openCreateSessionModal(start, new Date(start.getTime() + minutes * 60000), currentTreeData.id, currentTreeData.title);
}
async function quickEditInspectorTask(taskId) {
    // Force an authoritative snapshot before the shared editor, not a last-known fallback.
    taskKnowledge.invalidate();
    await openEditTaskModal(taskId);
}

async function saveInspectorTaskProperties(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (taskPropertiesPending) return;
    const taskId = document.getElementById('inspector_task_id').value;
    if (!taskId) return;
    if (initializedTaskDetailId !== taskId) {
        alert('Task properties are not ready. Wait for loading or use Retry refresh before saving.');
        return;
    }

    const assignedInputVal = document.getElementById('inspector_edit_assigned_date') ? document.getElementById('inspector_edit_assigned_date').value.trim() : '';
    const dueInputVal = document.getElementById('inspector_edit_due_date') ? document.getElementById('inspector_edit_due_date').value.trim() : '';
    const estInputVal = document.getElementById('inspector_edit_est') ? document.getElementById('inspector_edit_est').value : '15m';
    const titleVal = document.getElementById('inspector_edit_title').value.trim();

    if (!titleVal) {
        alert("Task title is required.");
        return;
    }

    const assignedParsed = parseFlexibleDateInput(assignedInputVal);
    const dueParsed = parseFlexibleDateInput(dueInputVal);
    const parsedEstMins = currentTreeData && estInputVal === formatMinutesToDuration(currentTreeData.estimated_minutes)
        ? currentTreeData.estimated_minutes : parseDurationToMinutes(estInputVal);

    const payload = {
        title: titleVal,
        tags: document.getElementById('inspector_edit_tags') ? document.getElementById('inspector_edit_tags').value : '',
        description: document.getElementById('inspector_edit_desc').value,
        status: document.getElementById('inspector_edit_status').value,
        category: document.getElementById('inspector_edit_category').value,
        priority: document.getElementById('inspector_edit_priority').value,
        estimated_minutes: parsedEstMins,
        is_recurring: document.getElementById('inspector_edit_is_recurring') ? document.getElementById('inspector_edit_is_recurring').checked : false,
        recurrence_rule: document.getElementById('inspector_edit_recurrence_rule') ? document.getElementById('inspector_edit_recurrence_rule').value : 'daily',
        assigned_date: assignedParsed ? assignedParsed.dateStr : null,
        due_date: dueParsed ? dueParsed.isoString : null,
        attachments: document.getElementById('inspector_edit_attachments').value || ''
    };

    // "custom" means the task holds an RRULE the preset picker cannot express; omit the preset
    // so the backend leaves recurrence_rrule exactly as saved (there is no RRULE builder UI).
    // A non-recurring task never sends a preset -- that is how "daily" leaked onto every task.
    if (payload.recurrence_rule === 'custom' || !payload.is_recurring) delete payload.recurrence_rule;

    const owner = taskDetailOwner;
    const isCurrent = () => owner === taskDetailOwner && document.getElementById('inspector_task_id').value === taskId;
    const receipt = captureTaskFormReceipt('task_properties_editor', payload, {
        title: 'inspector_edit_title', tags: 'inspector_edit_tags', description: 'inspector_edit_desc',
        status: 'inspector_edit_status', category: 'inspector_edit_category', priority: 'inspector_edit_priority',
        estimated_minutes: 'inspector_edit_est', is_recurring: 'inspector_edit_is_recurring',
        recurrence_rule: 'inspector_edit_recurrence_rule', assigned_date: 'inspector_edit_assigned_date',
        due_date: 'inspector_edit_due_date', attachments: 'inspector_edit_attachments'
    });
    taskPropertiesPending = true;
    const save = document.getElementById('inspector_save_btn');
    if (save) save.disabled = true;
    taskPropertiesFeedback('Saving task…');
    let acknowledged = false;
    try {
        const updatedTask = await api.put(`/api/tasks/${taskId}`, payload);
        acknowledged = true;
        if (isCurrent()) {
            currentTreeData = { ...currentTreeData, ...updatedTask };
            receipt.checkpoint(updatedTask);
            taskPropertiesFeedback('Task saved. Any later edits remain unsaved.');
        }
        if (typeof handleCompletionPolicy === 'function') await handleCompletionPolicy(updatedTask);
        await taskKnowledge.changed();
        if (isCurrent()) taskPropertiesFeedback(taskDetailReadAvailable
            ? 'Task saved. Any later edits remain unsaved.'
            : 'Task saved. Refresh unavailable; Retry refresh reads only, it does not save again.');
    } catch (err) {
        console.error('Task properties request failed:', err);
        if (isCurrent()) taskPropertiesFeedback(acknowledged
            ? 'Task saved. Follow-up unavailable; Retry refresh reads only.'
            : 'Save not confirmed. Edits retained. After connection loss, check the task before retrying Save.');
    } finally {
        taskPropertiesPending = false;
        if (save) save.disabled = false;
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

    return `
        <div onclick="navigateToTaskDetail('${node.id}')" class="subtask-node bg-[#0f1016] hover:bg-[#151724] p-3 rounded-lg border border-[var(--border-muted)] hover:border-purple-500/80 space-y-2 cursor-pointer transition">
            <div class="flex justify-between items-center">
                <div class="flex items-center space-x-2">
                    <input type="checkbox" ${isDone ? 'checked' : ''} onclick="event.stopPropagation();" data-task-status="${escapeHtml(node.status)}" onchange="toggleSubtaskCompletion('${node.id}', this.dataset.taskStatus)" class="w-4 h-4 accent-emerald-600 cursor-pointer rounded">
                    <a href="/task-inspector/${node.id}" onclick="event.stopPropagation()" class="font-bold text-xs text-left ${isDone ? 'line-through text-slate-500' : 'text-white'} hover:text-purple-300 hover:underline">${escapeHtml(node.title)}</a>
                    <span class="text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800 px-1.5 py-0.5 rounded">${formatMinutesToDuration(node.estimated_minutes)}</span>
                    <span class="text-[10px] font-bold bg-black/30 px-1.5 py-0.5 rounded text-slate-400">${escapeHtml(node.status)}</span>
                </div>
                <div class="flex items-center space-x-2 text-xs">
                    <button type="button" onclick="event.stopPropagation(); quickEditInspectorTask('${node.id}')" class="text-slate-400 hover:text-white font-bold" title="Quick edit modal">Quick Edit</button>
                    <button type="button" onclick="event.stopPropagation(); openSubtaskCreationModal('${node.id}')" class="text-purple-400 hover:text-purple-300 font-bold" title="Add child subtask">+ Subtask</button>
                    <button type="button" onclick="event.stopPropagation(); deleteSubtaskNode('${node.id}')" class="text-red-400 hover:text-red-300 font-bold">&times;</button>
                </div>
            </div>

            ${node.subtasks && node.subtasks.length > 0 ? `<div onclick="event.stopPropagation();" class="subtask-children pl-3 border-l border-purple-900/50 space-y-2 mt-2">${node.subtasks.map(child => renderSubtaskCardHTML(child)).join('')}</div>` : ''}
        </div>
    `;
}

function findNodeInTree(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    if (node.subtasks) {
        for (const child of node.subtasks) {
            const found = findNodeInTree(child, id);
            if (found) return found;
        }
    }
    return null;
}

function openSubtaskCreationModal(parentId = null) {
    if (subtaskSavePending) return;
    subtaskReturnFocus = document.activeElement;
    subtaskEditorOwner++;
    subtaskPersistedReceipt = null;
    const save = document.getElementById('subtask_save_btn');
    if (save) save.disabled = false;
    subtaskFeedback('');
    const mainTaskId = document.getElementById('inspector_task_id').value;
    const targetParentId = parentId ? parentId : mainTaskId;

    let inheritedTags = '';
    if (currentTreeData) {
        const parentNode = parentId ? findNodeInTree(currentTreeData, parentId) : currentTreeData;
        inheritedTags = (parentNode && parentNode.tags) ? parentNode.tags : '';
    }

    const editSubtaskIdEl = document.getElementById('edit_subtask_id');
    if (editSubtaskIdEl) editSubtaskIdEl.value = '';

    document.getElementById('subtask_parent_id').value = targetParentId;
    document.getElementById('modal_subtask_title').value = '';
    document.getElementById('modal_subtask_tags').value = inheritedTags;
    document.getElementById('modal_subtask_est').value = '15m';
    document.getElementById('modal_subtask_status').value = 'To Do';
    document.getElementById('modal_subtask_priority').value = '-';

    const heading = document.getElementById('subtask_modal_heading');
    if (heading) {
        heading.innerText = parentId ? `Create Subtask under parent task` : "Create Root Subtask";
    }

    document.getElementById('subtask_modal').classList.remove('hidden');
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('subtask_modal');

    const input = document.getElementById('modal_subtask_title');
    if (input) input.focus();
}

function openSubtaskEditModal(subtaskId) {
    if (subtaskSavePending) return;
    subtaskReturnFocus = document.activeElement;
    subtaskEditorOwner++;
    subtaskPersistedReceipt = null;
    const save = document.getElementById('subtask_save_btn');
    if (save) save.disabled = false;
    subtaskFeedback('');
    const subtask = findNodeInTree(currentTreeData, subtaskId);
    if (!subtask) return;
    subtaskPersistedReceipt = { ...subtask };

    const editSubtaskIdEl = document.getElementById('edit_subtask_id');
    if (editSubtaskIdEl) editSubtaskIdEl.value = subtask.id;

    document.getElementById('subtask_parent_id').value = subtask.parent_id || '';
    document.getElementById('modal_subtask_title').value = subtask.title || '';
    document.getElementById('modal_subtask_tags').value = subtask.tags || '';
    document.getElementById('modal_subtask_est').value = formatMinutesToDuration(subtask.estimated_minutes);
    document.getElementById('modal_subtask_status').value = subtask.status || 'To Do';
    document.getElementById('modal_subtask_priority').value = subtask.priority || '-';

    const heading = document.getElementById('subtask_modal_heading');
    if (heading) {
        heading.innerText = "Edit Subtask";
    }

    document.getElementById('subtask_modal').classList.remove('hidden');
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('subtask_modal');

    const input = document.getElementById('modal_subtask_title');
    if (input) input.focus();
}

function closeSubtaskModal(acknowledged = false, refreshing = false) {
    if (subtaskSavePending && !acknowledged) return;
    subtaskEditorOwner++;
    subtaskPersistedReceipt = null;
    const modal = document.getElementById('subtask_modal');
    const ownedFocus = modal?.contains?.(document.activeElement) || document.activeElement === document.body;
    if (modal) modal.classList.add('hidden');
    const editSubtaskIdEl = document.getElementById('edit_subtask_id');
    if (editSubtaskIdEl) editSubtaskIdEl.value = '';
    const target = !refreshing && subtaskReturnFocus?.isConnected
        ? subtaskReturnFocus : document.getElementById('detail_add_subtask_btn');
    if (ownedFocus) target?.focus();
}

async function saveSubtaskFromModal() {
    if (subtaskSavePending) return;
    const owner = subtaskEditorOwner;
    const editSubtaskId = document.getElementById('edit_subtask_id') ? document.getElementById('edit_subtask_id').value : '';
    const parentId = document.getElementById('subtask_parent_id').value;
    const titleVal = document.getElementById('modal_subtask_title').value.trim();
    if (!titleVal) {
        alert("Subtask title is required.");
        return;
    }

    const estVal = document.getElementById('modal_subtask_est') ? document.getElementById('modal_subtask_est').value : '15m';
    const persisted = subtaskPersistedReceipt?.id === editSubtaskId ? subtaskPersistedReceipt : null;

    const payload = {
        title: titleVal,
        parent_id: parentId || null,
        tags: document.getElementById('modal_subtask_tags') ? document.getElementById('modal_subtask_tags').value : '',
        status: document.getElementById('modal_subtask_status').value,
        priority: document.getElementById('modal_subtask_priority') ? document.getElementById('modal_subtask_priority').value : '-',
        estimated_minutes: persisted && estVal === formatMinutesToDuration(persisted.estimated_minutes)
            ? persisted.estimated_minutes : parseDurationToMinutes(estVal),
        category: persisted ? persisted.category
            : findNodeInTree(currentTreeData, parentId)?.category ?? currentTreeData?.category ?? 'work'
    };
    const receipt = captureTaskFormReceipt('subtask_modal', payload, {
        title: 'modal_subtask_title', tags: 'modal_subtask_tags', estimated_minutes: 'modal_subtask_est',
        status: 'modal_subtask_status', priority: 'modal_subtask_priority', id: 'edit_subtask_id'
    });
    let acknowledged = false;
    subtaskSavePending = true;
    const save = document.getElementById('subtask_save_btn');
    if (save) save.disabled = true;
    subtaskFeedback('Saving subtask…');
    try {
        const updatedTask = editSubtaskId
            ? await api.put(`/api/tasks/${editSubtaskId}`, payload)
            : await api.post('/api/tasks', payload);
        acknowledged = true;
        if (owner === subtaskEditorOwner) {
            // Last ACK belongs to this editor, not to the fallible display tree or a newer owner.
            subtaskPersistedReceipt = { ...updatedTask };
            // Adopt the canonical receipt before completion prompts or fallible display reads.
            const concurrentEdits = receipt.hasEdits();
            document.getElementById('edit_subtask_id').value = updatedTask.id;
            receipt.checkpoint(updatedTask);
            if (!concurrentEdits) closeSubtaskModal(true, true);
            else subtaskFeedback('Subtask saved. Later edits remain unsaved.');
        }
        if (editSubtaskId && typeof handleCompletionPolicy === 'function') await handleCompletionPolicy(updatedTask);
        await taskKnowledge.changed();
    } catch (error) {
        if (owner === subtaskEditorOwner) subtaskFeedback(acknowledged
            ? 'Subtask saved. Refresh unavailable; Retry refresh reads only.'
            : 'Save not confirmed. Draft retained. After connection loss, check the task before retrying Save.');
    } finally {
        subtaskSavePending = false;
        if (owner === subtaskEditorOwner && save === document.getElementById('subtask_save_btn')) {
            if (save) save.disabled = false;
        }
    }
}

async function toggleSubtaskCompletion(subtaskId, currentStatus) {
    const stLower = (currentStatus || '').toLowerCase();
    const newStatus = (stLower === 'done' || stLower === 'completed') ? 'To Do' : 'Done';
    const updatedTask = await api.put(`/api/tasks/${subtaskId}`, { status: newStatus });
    if (typeof handleCompletionPolicy === 'function') await handleCompletionPolicy(updatedTask);
    await taskKnowledge.changed();
}

async function deleteSubtaskNode(id) {
    const confirmed = await showCustomConfirm("Delete Subtask", "Are you sure you want to delete this subtask and all its nested children?");
    if (confirmed) {
        await api.delete(`/api/tasks/${id}`);
        await taskKnowledge.changed();
    }
}

function setupSubtaskModalKeyboard() {
    const modal = document.getElementById('subtask_modal');
    if (modal) {
        modal.addEventListener('keydown', function(e) {
            if (e.key === 'Tab' && !e.defaultPrevented) {
                const controls = [...modal.querySelectorAll('button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')]
                    .filter(control => control.offsetParent !== null);
                if (e.shiftKey && document.activeElement === controls[0]) {
                    e.preventDefault(); controls.at(-1)?.focus();
                } else if (!e.shiftKey && document.activeElement === controls.at(-1)) {
                    e.preventDefault(); controls[0]?.focus();
                }
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.target?.tagName === 'INPUT')) {
                e.preventDefault();
                e.stopPropagation();
                saveSubtaskFromModal();
            } else if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                closeSubtaskModal();
            }
        });
    }
}
