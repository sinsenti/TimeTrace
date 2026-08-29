/**
 * Task Inspector, Typeahead Combobox & Task Post-Mortem
 */

async function loadTaskInspectorRegistry() {
    try {
        allTasksList = await api.get('/api/tasks?status=all') || [];
        renderTaskQuickChipsBar();
    } catch (e) {}
}

function renderTaskQuickChipsBar() {
    const bar = document.getElementById('task_quick_chips_bar');
    if (!bar) return;

    if (allTasksList.length === 0) {
        bar.innerHTML = '<span class="text-xs text-slate-500">No tasks created yet.</span>';
        return;
    }

    bar.innerHTML = allTasksList.map((t, idx) => {
        const color = typeof getTaskColor === 'function' ? getTaskColor(t, idx) : '#7c3aed';
        return `
            <button onclick="selectTaskInspectorById('${t.id}')" class="px-2.5 py-1 rounded-lg text-xs font-bold text-white shadow-sm hover:scale-105 transition flex items-center space-x-1.5" style="background-color: ${color};">
                <span>${t.title}</span>
                <span class="text-[9px] opacity-80 uppercase bg-black/20 px-1 rounded">${t.status}</span>
            </button>
        `;
    }).join('');
}

function setupTaskInspectorSearchListeners() {
    const searchInput = document.getElementById('task_inspector_search');
    if (!searchInput) return;

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
            if (dropdown) dropdown.classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        const combobox = document.getElementById('task_inspector_combobox');
        const dropdown = document.getElementById('task_inspector_dropdown');
        if (combobox && dropdown && !combobox.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
}

function renderTaskInspectorSuggestions(query) {
    const dropdown = document.getElementById('task_inspector_dropdown');
    if (!dropdown) return;

    const q = (query || '').trim().toLowerCase();
    let filtered = allTasksList;
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
                <span class="font-bold text-white block">${t.title}</span>
                <span class="text-[10px] text-slate-400 block">${t.description || 'No description'}</span>
            </div>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded text-white uppercase" style="background-color: ${t.color && t.color !== 'auto' ? t.color : '#7c3aed'}">${t.status}</span>
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
    const task = allTasksList.find(t => t.id === taskId);
    const searchInput = document.getElementById('task_inspector_search');
    const dropdown = document.getElementById('task_inspector_dropdown');

    selectedInspectedTaskId = taskId;

    if (searchInput && task) {
        searchInput.value = task.title;
    }
    if (dropdown) dropdown.classList.add('hidden');

    loadTaskInspectorStats(taskId);
}

async function loadTaskInspectorStats(taskId) {
    const body = document.getElementById('task_inspector_body');
    if (!taskId) {
        if (body) body.classList.add('hidden');
        return;
    }

    selectedInspectedTaskId = taskId;

    try {
        const data = await api.get(`/api/tasks/${taskId}/stats`);
        const task = data.task;

        if (body) body.classList.remove('hidden');

        document.getElementById('inspect_task_title').innerText = task.title;
        document.getElementById('inspect_task_desc').innerText = task.description || 'No description provided';
        document.getElementById('inspect_task_status_badge').innerText = task.status;

        const kpiContainer = document.getElementById('task_inspector_kpis');
        if (kpiContainer) {
            const ratioStr = data.progress_pct !== null ? `${data.progress_pct}%` : 'N/A';
            kpiContainer.innerHTML = `
                <div>
                    <span class="text-[10px] text-slate-400 uppercase font-semibold block">Logged</span>
                    <span class="text-lg font-black text-purple-400">${data.logged_hours}h</span>
                </div>
                <div>
                    <span class="text-[10px] text-slate-400 uppercase font-semibold block">Estimated</span>
                    <span class="text-lg font-black text-slate-300">${data.estimated_hours}h</span>
                </div>
                <div>
                    <span class="text-[10px] text-slate-400 uppercase font-semibold block">Estimation Ratio</span>
                    <span class="text-lg font-black text-blue-400">${ratioStr}</span>
                </div>
            `;
        }

        const pBar = document.getElementById('inspect_task_progress_bar');
        if (pBar) {
            const pct = data.progress_pct !== null ? Math.min(data.progress_pct, 100) : 0;
            pBar.style.width = `${pct}%`;
        }

        const list = document.getElementById('inspect_task_sessions_list');
        if (list) {
            if (data.sessions.length === 0) {
                list.innerHTML = '<div class="text-xs text-slate-500 text-center py-6">No sessions logged for this task yet.</div>';
            } else {
                list.innerHTML = data.sessions.map(s => {
                    const st = s.start_time ? new Date(s.start_time).toLocaleString() : '';
                    const durMins = roundVal((s.duration_seconds || 0) / 60, 1);
                    return `
                        <div onclick="openSessionReviewModal('${s.id}')" class="bg-[#0f1016] hover:bg-[#161824] border border-[var(--border-muted)] hover:border-purple-500 p-3 rounded-lg text-xs space-y-1 cursor-pointer transition">
                            <div class="flex justify-between items-center font-mono">
                                <span class="text-purple-300 font-bold">${st}</span>
                                <span class="text-slate-400 font-bold">${durMins} mins</span>
                            </div>
                            ${s.notes ? `<div class="text-white font-semibold">${s.notes}</div>` : ''}
                        </div>
                    `;
                }).join('');
            }
        }

        const rev = data.task_review;
        document.getElementById('task_rev_difficulty').value = rev ? rev.difficulty : 3;
        document.getElementById('task_rev_went_well').value = rev ? (rev.what_went_well || "") : "";
        document.getElementById('task_rev_blockers').value = rev ? (rev.blockers || "") : "";
        document.getElementById('task_rev_takeaways').value = rev ? (rev.key_takeaways || "") : "";

        await renderCustomRatingsInputs('task', taskId, 'task_custom_ratings_container', data.custom_ratings);

    } catch (e) {
        console.error("Failed to load task inspector stats:", e);
    }
}

async function saveTaskReviewForm() {
    if (!selectedInspectedTaskId) return;

    const taskId = selectedInspectedTaskId;

    if (!validateRequiredCustomRatings('task', taskId)) {
        return;
    }

    const diffEl = document.getElementById('task_rev_difficulty');
    const parsedDiff = diffEl ? parseInt(diffEl.value) : 3;

    const payload = {
        task_id: taskId,
        difficulty: isNaN(parsedDiff) ? 3 : parsedDiff,
        what_went_well: document.getElementById('task_rev_went_well') ? document.getElementById('task_rev_went_well').value || "" : "",
        blockers: document.getElementById('task_rev_blockers') ? document.getElementById('task_rev_blockers').value || "" : "",
        key_takeaways: document.getElementById('task_rev_takeaways') ? document.getElementById('task_rev_takeaways').value || "" : ""
    };

    await api.post('/api/task-reviews', payload);
    await submitCustomRatings('task', taskId);
    loadTaskInspectorStats(taskId);
}
