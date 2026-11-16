/**
 * Task Inspector, Typeahead Combobox & Task Post-Mortem
 */

let selectedInspectedTaskId = null;
let initializedTaskReviewId = null;
let taskInspectorRequest = 0;
let activeTaskInspectorSearchIdx = -1;
let taskInspectorSearchIntent = false;

function taskInspectorReviewEditor() {
    return typeof createTaskPostmortemEditor === 'function'
        ? createTaskPostmortemEditor(document.getElementById('revision_task_postmortem'), true) : null;
}

async function loadTaskInspectorRegistry() {
    await taskKnowledge.load();
    await refreshTaskInspectorKnowledge();
}

async function refreshTaskInspectorKnowledge() {
    refreshTaskInspectorLabels();
    if (selectedInspectedTaskId) return loadTaskInspectorStats(selectedInspectedTaskId, true);
}

function refreshTaskInspectorLabels() {
    renderTaskQuickChipsBar();
    const search = document.getElementById('task_inspector_search');
    const tab = document.getElementById('rev_tab_task_inspector');
    const dropdown = document.getElementById('task_inspector_dropdown');
    const visible = dropdown && !dropdown.classList.contains('hidden');
    if (search && (!tab || !tab.classList.contains('hidden')) &&
        (visible || (taskInspectorSearchIntent && document.activeElement === search))) {
        renderTaskInspectorSuggestions(search.value, false);
    } else {
        taskInspectorSearchIntent = false;
    }
}

function renderTaskQuickChipsBar() {
    const bar = document.getElementById('task_quick_chips_bar');
    if (!bar) return;

    const tasks = taskKnowledge.values();
    if (tasks.length === 0) {
        bar.innerHTML = `<span class="text-xs text-slate-500">${taskKnowledge.state().status === 'fresh' ? 'No tasks created yet.' : 'Task metadata unavailable. Retry refresh to load tasks.'}</span>`;
        return;
    }

    bar.innerHTML = tasks.map((t, idx) => {
        const color = typeof getTaskColor === 'function' ? getTaskColor(t, idx) : '#7c3aed';
        return `
            <button onclick="selectTaskInspectorById('${t.id}')" class="px-2.5 py-1 rounded-lg text-xs font-bold text-white shadow-sm hover:scale-105 transition flex items-center space-x-1.5" style="background-color: ${escapeHtml(color)}; color: ${typeof getContrastingTextColor === 'function' ? getContrastingTextColor(color) : '#fff'};">
                <span>${escapeHtml(t.title)}</span>
                <span class="text-[9px] opacity-80 uppercase bg-black/20 px-1 rounded">${escapeHtml(t.status)}</span>
            </button>
        `;
    }).join('');
}

function setupTaskInspectorSearchListeners() {
    const searchInput = document.getElementById('task_inspector_search');
    if (!searchInput) return;

    // Blur cancels pending refreshes without hiding a suggestion before its click runs.
    searchInput.addEventListener('blur', () => { taskInspectorSearchIntent = false; });
    const tab = document.getElementById('rev_tab_task_inspector');
    if (tab && typeof MutationObserver !== 'undefined') {
        new MutationObserver(() => {
            if (tab.classList.contains('hidden')) dismissTaskInspectorSuggestions();
        }).observe(tab, {attributes: true, attributeFilter: ['class']});
    }

    searchInput.addEventListener('keydown', (e) => {
        const dropdown = document.getElementById('task_inspector_dropdown');
        const items = dropdown ? dropdown.querySelectorAll('.task-inspect-item') : [];

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (items.length > 0) {
                activeTaskInspectorSearchIdx = (activeTaskInspectorSearchIdx + 1) % items.length;
                highlightTaskInspectItem(items);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (items.length > 0) {
                activeTaskInspectorSearchIdx = (activeTaskInspectorSearchIdx - 1 + items.length) % items.length;
                highlightTaskInspectItem(items);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeTaskInspectorSearchIdx >= 0 && items[activeTaskInspectorSearchIdx]) {
                items[activeTaskInspectorSearchIdx].click();
            } else if (items.length > 0) {
                items[0].click();
            }
        } else if (e.key === 'Escape') {
            dismissTaskInspectorSuggestions();
        }
    });

    document.addEventListener('click', (e) => {
        const combobox = document.getElementById('task_inspector_combobox');
        const dropdown = document.getElementById('task_inspector_dropdown');
        if (combobox && dropdown && !combobox.contains(e.target) && !dropdown.contains(e.target)) {
            dismissTaskInspectorSuggestions();
        }
    });
}

function dismissTaskInspectorSuggestions() {
    taskInspectorSearchIntent = false;
    activeTaskInspectorSearchIdx = -1;
    const dropdown = document.getElementById('task_inspector_dropdown');
    if (dropdown) dropdown.classList.add('hidden');
}

function renderTaskInspectorSuggestions(query, requestIntent = true) {
    if (requestIntent) taskInspectorSearchIntent = true;
    const dropdown = document.getElementById('task_inspector_dropdown');
    if (!dropdown) return;

    const q = (query || '').trim().toLowerCase();
    let filtered = taskKnowledge.values();
    if (q) {
        filtered = filtered.filter(t => 
            t.title.toLowerCase().includes(q) || 
            (t.description && t.description.toLowerCase().includes(q))
        );
    }

    if (filtered.length === 0) {
        dropdown.classList.add('hidden');
        activeTaskInspectorSearchIdx = -1;
        return;
    }

    activeTaskInspectorSearchIdx = 0;
    dropdown.innerHTML = filtered.map((t, idx) => `
        <div onclick="selectTaskInspectorById('${t.id}')" class="task-inspect-item px-3 py-2 hover:bg-[#1a1c28] cursor-pointer text-xs flex items-center justify-between border-b border-[#1a1c26] last:border-b-0 transition ${idx === 0 ? 'bg-[#1a1c28]' : ''}">
            <div>
                <span class="font-bold text-white block">${escapeHtml(t.title)}</span>
                <span class="text-[10px] text-slate-400 block">${escapeHtml(t.description || 'No description')}</span>
            </div>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded text-white uppercase" style="background-color: ${escapeHtml(t.color && t.color !== 'auto' ? t.color : '#7c3aed')}">${escapeHtml(t.status)}</span>
        </div>
    `).join('');

    dropdown.classList.remove('hidden');
}

function highlightTaskInspectItem(items) {
    items.forEach((item, idx) => {
        if (idx === activeTaskInspectorSearchIdx) {
            item.classList.add('bg-[#1a1c28]');
        } else {
            item.classList.remove('bg-[#1a1c28]');
        }
    });
}

function selectTaskInspectorById(taskId) {
    if (taskId !== selectedInspectedTaskId && taskInspectorReviewEditor()?.canLeave() === false) return;
    taskInspectorReviewEditor()?.bind(taskId);
    const task = taskKnowledge.get(taskId);
    const searchInput = document.getElementById('task_inspector_search');

    selectedInspectedTaskId = taskId;

    if (searchInput && task) {
        searchInput.value = task.title;
    }
    dismissTaskInspectorSuggestions();

    loadTaskInspectorStats(taskId, initializedTaskReviewId === taskId);
}

async function loadTaskInspectorStats(taskId, preserveEdits = false) {
    const generation = taskKnowledge.state().generation;
    const request = ++taskInspectorRequest;
    const reviewEditor = taskInspectorReviewEditor();
    const keepEdits = preserveEdits && reviewEditor?.taskId === taskId && reviewEditor.initialized;
    const body = document.getElementById('task_inspector_body');
    taskInspectorReviewEditor()?.begin(taskId);
    if (!keepEdits) {
        initializedTaskReviewId = null;
        if (body) body.classList.add('hidden');
    }
    const isCurrent = () => request === taskInspectorRequest &&
        generation === taskKnowledge.state().generation && selectedInspectedTaskId === taskId;
    if (!taskId) {
        if (body) body.classList.add('hidden');
        return;
    }

    selectedInspectedTaskId = taskId;

    try {
        const data = await api.get(`/api/tasks/${taskId}/stats`);
        if (!isCurrent()) return null;
        const task = data.task;

        document.getElementById('inspect_task_title').innerText = task.title;
        document.getElementById('inspect_task_desc').innerText = task.description || 'No description provided';
        document.getElementById('inspect_task_status_badge').innerText = task.status;

        const kpiContainer = document.getElementById('task_inspector_kpis');
        if (kpiContainer) {
            const ratioStr = data.progress_pct != null ? `${data.progress_pct}%` : 'N/A';
            const balance = value => value == null ? 'Unbounded' : `${value}h`;
            const metrics = [
                ['Logged', `${data.logged_hours}h`], ['Scheduled', `${data.scheduled_hours}h`],
                [task.is_recurring ? 'Estimate per occurrence' : 'Estimated', `${data.estimated_hours}h`],
                ['Logged / estimate', ratioStr], ['Remaining', balance(data.remaining_hours)],
                ['Unscheduled', balance(data.unscheduled_hours)]
            ];
            kpiContainer.innerHTML = metrics.map(([label, value]) => `
                <div><span class="text-xs block">${label}</span><strong>${value}</strong></div>
            `).join('');
        }
        const details = document.getElementById('inspect_task_details_link');
        if (details) {
            details.href = `/task-inspector/${taskId}`;
            details.onclick = event => followSettingsLink(event);
        }
        const status = document.getElementById('task_inspector_status');
        if (status) status.textContent = 'Showing this task only. Descendant sessions are not included.';

        const list = document.getElementById('inspect_task_sessions_list');
        if (list) {
            if (data.sessions.length === 0) {
                list.innerHTML = '<div class="text-xs text-slate-500 text-center py-6">No recorded sessions linked directly to this task yet.</div>';
            } else {
                list.innerHTML = data.sessions.map(s => {
                    const st = s.start_time ? new Date(s.start_time).toLocaleString() : '';
                    const durMins = roundVal((s.duration_seconds || 0) / 60, 1);
                    return `
                        <button type="button" onclick="openSessionReviewModal('${s.id}')" class="bg-[#0f1016] hover:bg-[#161824] border border-[var(--border-muted)] hover:border-purple-500 p-3 rounded-lg text-xs space-y-1 cursor-pointer transition">
                            <div class="flex justify-between items-center font-mono">
                                <span class="text-purple-300 font-bold">${st}</span>
                                <span class="text-slate-400 font-bold">${durMins} mins</span>
                            </div>
                            ${s.notes ? `<div class="text-white font-semibold">${escapeHtml(s.notes)}</div>` : ''}
                        </button>
                    `;
                }).join('');
            }
        }

        const editor = taskInspectorReviewEditor();
        if (editor) {
            await editor.hydrate(taskId, data, isCurrent, true);
            if (!isCurrent()) return null;
            if (editor.ready) initializedTaskReviewId = taskId;
        }
        if (body) body.classList.remove('hidden');
        taskKnowledge.viewResult('inspector-registry', true);
        return true;
    } catch (e) {
        if (!isCurrent()) return null;
        const status = document.getElementById('task_inspector_status');
        if (status) status.textContent = 'Task unavailable or refresh failed. Last-known data and initialized drafts retained. Retry refresh reads only.';
        taskKnowledge.viewResult('inspector-registry', false);
        console.error("Failed to load task inspector stats:", e);
        return false;
    }
}

async function saveTaskReviewForm() {
    return taskInspectorReviewEditor()?.save();
}
