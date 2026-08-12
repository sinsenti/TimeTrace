let currentActiveRevTab = 'day';
let allRevisionSessions = [];
let allTasksList = [];
let allRatingDefinitions = [];

document.addEventListener('DOMContentLoaded', () => {
    setDayReviewToday();
    populateTaskInspectorSelect();
    loadRatingDefinitionsList();
    setupRatingModalKeyboardShortcuts();
});

function setupRatingModalKeyboardShortcuts() {
    const modal = document.getElementById('rating_def_modal');
    if (!modal) return;
    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeRatingDefModal();
        }
    });
}

function switchRevisionTab(tabName) {
    currentActiveRevTab = tabName;
    ['day', 'sessions', 'task_inspector', 'ratings_config'].forEach(t => {
        document.getElementById(`rev_tab_${t}`).classList.add('hidden');
        document.getElementById(`rev_tab_btn_${t}`).className = "h-6 px-3 rounded font-bold text-slate-400 hover:text-white text-[11px]";
    });

    document.getElementById(`rev_tab_${tabName}`).classList.remove('hidden');
    document.getElementById(`rev_tab_btn_${tabName}`).className = "h-6 px-3 rounded font-bold bg-purple-600 text-white text-[11px]";

    loadCurrentRevisionView();
}

function loadCurrentRevisionView() {
    if (currentActiveRevTab === 'day') {
        loadDayReviewData();
    } else if (currentActiveRevTab === 'sessions') {
        loadAllSessionsReview();
    } else if (currentActiveRevTab === 'task_inspector') {
        populateTaskInspectorSelect();
    } else {
        loadRatingDefinitionsList();
    }
}

// 1. Day Review Functions
function setDayReviewToday() {
    const dateInput = document.getElementById('day_review_date_input');
    if (dateInput) {
        const todayStr = new Date().toISOString().slice(0, 10);
        dateInput.value = todayStr;
        loadDayReviewData();
    }
}

async function loadDayReviewData() {
    const dateInput = document.getElementById('day_review_date_input');
    if (!dateInput || !dateInput.value) return;

    const dateStr = dateInput.value;
    try {
        const res = await fetch(`/api/v1/revision/day-summary?date_str=${dateStr}`);
        const data = await res.json();

        // Render KPI Badges
        const kpiContainer = document.getElementById('day_kpi_badges');
        if (kpiContainer) {
            kpiContainer.innerHTML = `
                <div>
                    <span class="text-[10px] text-slate-400 uppercase font-semibold block">Focus Time</span>
                    <span class="text-lg font-black text-purple-400">${data.total_hours}h</span>
                </div>
                <div>
                    <span class="text-[10px] text-slate-400 uppercase font-semibold block">Sessions</span>
                    <span class="text-lg font-black text-emerald-400">${data.total_sessions}</span>
                </div>
                <div>
                    <span class="text-[10px] text-slate-400 uppercase font-semibold block">Tasks Completed</span>
                    <span class="text-lg font-black text-blue-400">${data.completed_tasks_count}</span>
                </div>
                <div>
                    <span class="text-[10px] text-slate-400 uppercase font-semibold block">Avg Energy</span>
                    <span class="text-lg font-black text-amber-400">${data.avg_energy ? `${data.avg_energy}/5` : 'N/A'}</span>
                </div>
            `;
        }

        // Fill Day Form if Review exists
        const review = data.day_review;
        document.getElementById('day_form_rating').value = review ? review.rating : 3;
        document.getElementById('day_form_wins').value = review ? (review.wins || "") : "";
        document.getElementById('day_form_blockers').value = review ? (review.blockers || "") : "";
        document.getElementById('day_form_notes').value = review ? (review.notes || "") : "";

        // Render Custom Day Ratings Section
        await renderCustomRatingsInputs('day', dateStr, 'day_custom_ratings_container', data.custom_ratings);

        // Render Sessions Timeline
        const timeline = document.getElementById('day_sessions_timeline');
        if (timeline) {
            if (data.sessions.length === 0) {
                timeline.innerHTML = '<div class="text-xs text-slate-500 text-center py-6">No sessions logged for this day.</div>';
            } else {
                timeline.innerHTML = data.sessions.map(s => {
                    const stStr = s.start_time ? new Date(s.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '00:00';
                    const etStr = s.end_time ? new Date(s.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'NOW';
                    const durMins = roundVal((s.duration_seconds || 0) / 60, 1);
                    const ref = s.reflection;

                    return `
                        <div class="bg-[#0f1016] border border-[var(--border-muted)] p-3 rounded-lg flex flex-col space-y-1.5 text-xs">
                            <div class="flex justify-between items-center">
                                <span class="font-mono text-purple-300 font-bold">[${stStr} - ${etStr}] (${durMins}m)</span>
                                <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-800">${s.tags || '#general'}</span>
                            </div>
                            <div class="text-white font-semibold">${s.notes || 'No description notes'}</div>
                            ${s.task ? `<div class="text-[10px] text-blue-400 font-bold">Attached Task: ${s.task.title}</div>` : ''}
                            ${ref ? `
                                <div class="bg-[#181a28] p-2 rounded text-[11px] space-y-0.5 mt-1 border border-[var(--border-muted)]">
                                    <div class="text-amber-400 font-bold">Energy: ${ref.energy_level}/5</div>
                                    ${ref.obstacles ? `<div class="text-slate-300">Obstacles: ${ref.obstacles}</div>` : ''}
                                    ${ref.habits_completed ? `<div class="text-emerald-400">Habits: ${ref.habits_completed}</div>` : ''}
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('');
            }
        }

    } catch (e) {
        console.error("Failed to load day review:", e);
    }
}

async function saveDayReviewForm() {
    const dateInput = document.getElementById('day_review_date_input');
    if (!dateInput || !dateInput.value) return;

    const dateStr = dateInput.value;

    if (!validateRequiredCustomRatings('day', dateStr)) {
        return;
    }

    const payload = {
        date_str: dateStr,
        rating: parseInt(document.getElementById('day_form_rating').value),
        wins: document.getElementById('day_form_wins').value,
        blockers: document.getElementById('day_form_blockers').value,
        notes: document.getElementById('day_form_notes').value
    };

    await fetch('/api/v1/revision/day-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    await submitCustomRatings('day', dateStr);
    loadDayReviewData();
}

// 2. Custom Ratings Core Engine
async function renderCustomRatingsInputs(targetType, targetId, containerId, existingEntries = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const res = await fetch(`/api/v1/rating-definitions?target_type=${targetType}`);
    const defs = await res.json();

    if (defs.length === 0) {
        container.innerHTML = '';
        return;
    }

    const existingMap = {};
    if (existingEntries) {
        existingEntries.forEach(e => { existingMap[e.rating_definition_id] = e.score; });
    }

    container.innerHTML = `
        <div class="text-xs font-bold text-slate-300 mb-2 border-b border-[var(--border-muted)] pb-1">Custom Ratings (${targetType.toUpperCase()})</div>
        ${defs.map(d => {
            const currentScore = existingMap[d.id] !== undefined ? existingMap[d.id] : Math.ceil((d.min_score + d.max_score) / 2);
            return `
                <div class="bg-[#0f1016] p-2.5 rounded-lg border border-[var(--border-muted)] space-y-1" data-rating-def-id="${d.id}" data-required="${d.is_required}">
                    <div class="flex justify-between items-center text-xs">
                        <span class="font-bold text-slate-200">${d.name} ${d.is_required ? '<span class="text-red-400">*</span>' : ''}</span>
                        <span id="score_label_${d.id}" class="font-mono text-purple-400 font-bold">${currentScore} / ${d.max_score}</span>
                    </div>
                    ${d.description ? `<p class="text-[10px] text-slate-400">${d.description}</p>` : ''}
                    <input type="range" min="${d.min_score}" max="${d.max_score}" value="${currentScore}" oninput="document.getElementById('score_label_${d.id}').innerText = this.value + ' / ${d.max_score}'" class="custom-rating-input w-full accent-purple-600">
                </div>
            `;
        }).join('')}
    `;
}

function validateRequiredCustomRatings(targetType, targetId) {
    const inputs = document.querySelectorAll(`[data-rating-def-id]`);
    for (let el of inputs) {
        const isReq = el.getAttribute('data-required') === 'true';
        const input = el.querySelector('.custom-rating-input');
        if (isReq && input && (!input.value || input.value === '')) {
            alert(`Please complete essential rating: ${el.querySelector('.font-bold').innerText}`);
            return false;
        }
    }
    return true;
}

async function submitCustomRatings(targetType, targetId) {
    const cards = document.querySelectorAll(`[data-rating-def-id]`);
    for (let card of cards) {
        const defId = parseInt(card.getAttribute('data-rating-def-id'));
        const input = card.querySelector('.custom-rating-input');
        if (input && input.value !== '') {
            await fetch('/api/v1/rating-entries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rating_definition_id: defId,
                    target_type: targetType,
                    target_id: String(targetId),
                    score: parseInt(input.value)
                })
            });
        }
    }
}

// 3. All Sessions Review Functions
async function loadAllSessionsReview() {
    try {
        const res = await fetch('/api/v1/sessions');
        allRevisionSessions = await res.json();
        allRevisionSessions.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
        filterSessionsReviewList();
    } catch (e) {
        console.error("Failed to load sessions for review:", e);
    }
}

function filterSessionsReviewList() {
    const queryEl = document.getElementById('session_rev_search');
    const query = queryEl ? queryEl.value.trim().toLowerCase() : '';
    const container = document.getElementById('sessions_review_list');
    const badge = document.getElementById('session_rev_count_badge');

    if (!container) return;

    let filtered = allRevisionSessions;
    if (query) {
        filtered = filtered.filter(s => 
            (s.notes && s.notes.toLowerCase().includes(query)) ||
            (s.tags && s.tags.toLowerCase().includes(query))
        );
    }

    if (badge) badge.innerText = `${filtered.length} sessions`;

    if (filtered.length === 0) {
        container.innerHTML = '<div class="text-xs text-slate-500 text-center py-8">No matching session logs found.</div>';
        return;
    }

    container.innerHTML = filtered.map(s => {
        const st = new Date(s.start_time);
        const dateLabel = st.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        const timeLabel = `${st.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${s.end_time ? new Date(s.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'NOW'}`;
        const durMins = roundVal((s.duration_seconds || 0) / 60, 1);
        const ref = s.reflection;

        return `
            <div class="rev-card space-y-2 text-xs">
                <div class="flex justify-between items-center border-b border-[var(--border-muted)] pb-2">
                    <span class="font-bold text-purple-400">${dateLabel} (${timeLabel})</span>
                    <div class="flex items-center space-x-2">
                        <span class="font-mono font-bold text-slate-300">${durMins} mins</span>
                        <span class="px-2 py-0.5 rounded bg-purple-900/50 text-purple-300 font-bold border border-purple-800">${s.tags || '#general'}</span>
                    </div>
                </div>
                <div class="text-white text-sm font-semibold">${s.notes || 'No description notes'}</div>
                ${ref ? `
                    <div class="bg-[#0f1016] p-2.5 rounded border border-[var(--border-muted)] flex space-x-4 text-[11px]">
                        <div><span class="text-slate-400">Energy:</span> <span class="font-bold text-amber-400">${ref.energy_level}/5</span></div>
                        ${ref.obstacles ? `<div><span class="text-slate-400">Obstacle:</span> <span class="text-slate-200">${ref.obstacles}</span></div>` : ''}
                        ${ref.habits_completed ? `<div><span class="text-slate-400">Habits:</span> <span class="text-emerald-400">${ref.habits_completed}</span></div>` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

// 4. Task Inspector & Reviews
async function populateTaskInspectorSelect() {
    try {
        const res = await fetch('/api/v1/tasks?status=all');
        allTasksList = await res.json();

        const select = document.getElementById('task_inspector_select');
        if (!select) return;

        select.innerHTML = '<option value="">-- Choose Task --</option>' +
            allTasksList.map(t => `<option value="${t.id}">${t.title} [${t.status}]</option>`).join('');
    } catch (e) {}
}

async function loadTaskInspectorStats(taskId) {
    const body = document.getElementById('task_inspector_body');
    if (!taskId) {
        if (body) body.classList.add('hidden');
        return;
    }

    try {
        const res = await fetch(`/api/v1/tasks/${taskId}/stats`);
        const data = await res.json();
        const task = data.task;

        if (body) body.classList.remove('hidden');

        document.getElementById('inspect_task_title').innerText = task.title;
        document.getElementById('inspect_task_desc').innerText = task.description || 'No description provided';
        document.getElementById('inspect_task_status_badge').innerText = task.status;

        // KPI Badges & Estimation Ratio
        const kpiContainer = document.getElementById('task_inspector_kpis');
        if (kpiContainer) {
            const ratioStr = data.progress_pct !== null ? `${data.progress_pct}%` : 'N/A';
            kpiContainer.innerHTML = `
                <div>
                    <span class="text-[10px] text-slate-400 uppercase font-semibold block">Tracked Hours</span>
                    <span class="text-lg font-black text-purple-400">${data.total_hours}h</span>
                </div>
                <div>
                    <span class="text-[10px] text-slate-400 uppercase font-semibold block">Estimated</span>
                    <span class="text-lg font-black text-slate-300">${data.estimated_hours}h</span>
                </div>
                <div>
                    <span class="text-[10px] text-slate-400 uppercase font-semibold block">Estimation Ratio</span>
                    <span class="text-lg font-black text-blue-400">${ratioStr}</span>
                </div>
                <div>
                    <span class="text-[10px] text-slate-400 uppercase font-semibold block">Avg Energy</span>
                    <span class="text-lg font-black text-amber-400">${data.avg_energy ? `${data.avg_energy}/5` : 'N/A'}</span>
                </div>
            `;
        }

        // Progress Bar
        const pBar = document.getElementById('inspect_task_progress_bar');
        if (pBar) {
            const pct = data.progress_pct !== null ? Math.min(data.progress_pct, 100) : 0;
            pBar.style.width = `${pct}%`;
        }

        // Session List
        const list = document.getElementById('inspect_task_sessions_list');
        if (list) {
            if (data.sessions.length === 0) {
                list.innerHTML = '<div class="text-xs text-slate-500 text-center py-6">No sessions logged for this task yet.</div>';
            } else {
                list.innerHTML = data.sessions.map(s => {
                    const st = s.start_time ? new Date(s.start_time).toLocaleString() : '';
                    const durMins = roundVal((s.duration_seconds || 0) / 60, 1);
                    return `
                        <div class="bg-[#0f1016] border border-[var(--border-muted)] p-3 rounded-lg text-xs space-y-1">
                            <div class="flex justify-between items-center font-mono">
                                <span class="text-purple-300 font-bold">${st}</span>
                                <span class="text-slate-400 font-bold">${durMins} mins</span>
                            </div>
                            <div class="text-white font-semibold">${s.notes || 'No session notes'}</div>
                        </div>
                    `;
                }).join('');
            }
        }

        // Fill Task Review Form
        const rev = data.task_review;
        document.getElementById('task_rev_difficulty').value = rev ? rev.difficulty : 3;
        document.getElementById('task_rev_went_well').value = rev ? (rev.what_went_well || "") : "";
        document.getElementById('task_rev_blockers').value = rev ? (rev.blockers || "") : "";
        document.getElementById('task_rev_takeaways').value = rev ? (rev.key_takeaways || "") : "";

        // Custom Task Ratings
        await renderCustomRatingsInputs('task', taskId, 'task_custom_ratings_container', data.custom_ratings);

    } catch (e) {
        console.error("Failed to load task inspector stats:", e);
    }
}

async function saveTaskReviewForm() {
    const select = document.getElementById('task_inspector_select');
    if (!select || !select.value) return;

    const taskId = parseInt(select.value);

    if (!validateRequiredCustomRatings('task', taskId)) {
        return;
    }

    const payload = {
        task_id: taskId,
        difficulty: parseInt(document.getElementById('task_rev_difficulty').value),
        what_went_well: document.getElementById('task_rev_went_well').value,
        blockers: document.getElementById('task_rev_blockers').value,
        key_takeaways: document.getElementById('task_rev_takeaways').value
    };

    await fetch('/api/v1/task-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    await submitCustomRatings('task', taskId);
    loadTaskInspectorStats(taskId);
}

// 5. Custom Rating Definitions Configuration Manager
async function loadRatingDefinitionsList() {
    const container = document.getElementById('rating_defs_card_list');
    if (!container) return;

    try {
        const res = await fetch('/api/v1/rating-definitions');
        allRatingDefinitions = await res.json();

        if (allRatingDefinitions.length === 0) {
            container.innerHTML = '<div class="text-xs text-slate-500 text-center py-8">No custom rating definitions created yet. Click "+ New Rating Scale" to create your first evaluation metric!</div>';
            return;
        }

        container.innerHTML = allRatingDefinitions.map(d => `
            <div class="rev-card flex items-center justify-between hover:border-purple-500 transition">
                <div class="space-y-1">
                    <div class="flex items-center space-x-2">
                        <span class="font-bold text-sm text-white">${d.name}</span>
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-purple-900/60 text-purple-300 border border-purple-800">${d.target_type}</span>
                        ${d.is_required ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-950/80 text-red-400 border border-red-800">Essential</span>' : '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-400">Optional</span>'}
                    </div>
                    <p class="text-xs text-slate-400">${d.description || 'No description provided'}</p>
                </div>
                <div class="flex items-center space-x-4">
                    <span class="font-mono text-xs font-bold text-purple-300 bg-[#0f1016] px-2.5 py-1 rounded border border-[var(--border-muted)]">Scale: ${d.min_score} - ${d.max_score}</span>
                    <button onclick="openEditRatingDefModal(${d.id})" class="text-xs text-slate-400 hover:text-white underline">Edit</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error("Failed to load rating definitions:", e);
    }
}

function openNewRatingDefModal() {
    document.getElementById('edit_rating_def_id').value = '';
    document.getElementById('rating_modal_title').innerText = 'Configure Rating Scale';
    document.getElementById('modal_rating_name').value = '';
    document.getElementById('modal_rating_target_type').value = 'session';
    document.getElementById('modal_rating_min').value = '1';
    document.getElementById('modal_rating_max').value = '10';
    document.getElementById('modal_rating_required').checked = false;
    document.getElementById('modal_rating_desc').value = '';
    document.getElementById('modal_rating_delete_btn').classList.add('hidden');
    document.getElementById('rating_def_modal').classList.remove('hidden');
}

function openEditRatingDefModal(id) {
    const d = allRatingDefinitions.find(item => item.id === id);
    if (!d) return;

    document.getElementById('edit_rating_def_id').value = d.id;
    document.getElementById('rating_modal_title').innerText = 'Edit Rating Scale';
    document.getElementById('modal_rating_name').value = d.name;
    document.getElementById('modal_rating_target_type').value = d.target_type;
    document.getElementById('modal_rating_min').value = d.min_score;
    document.getElementById('modal_rating_max').value = d.max_score;
    document.getElementById('modal_rating_required').checked = d.is_required;
    document.getElementById('modal_rating_desc').value = d.description || '';
    document.getElementById('modal_rating_delete_btn').classList.remove('hidden');
    document.getElementById('rating_def_modal').classList.remove('hidden');
}

function closeRatingDefModal() {
    document.getElementById('rating_def_modal').classList.add('hidden');
}

async function saveRatingDefinition() {
    const id = document.getElementById('edit_rating_def_id').value;
    const payload = {
        name: document.getElementById('modal_rating_name').value.trim(),
        target_type: document.getElementById('modal_rating_target_type').value,
        min_score: parseInt(document.getElementById('modal_rating_min').value) || 1,
        max_score: parseInt(document.getElementById('modal_rating_max').value) || 10,
        is_required: document.getElementById('modal_rating_required').checked,
        description: document.getElementById('modal_rating_desc').value.trim()
    };

    if (!payload.name) return;

    if (id) {
        await fetch(`/api/v1/rating-definitions/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } else {
        await fetch('/api/v1/rating-definitions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    closeRatingDefModal();
    loadRatingDefinitionsList();
}

async function deleteRatingDefinition() {
    const id = document.getElementById('edit_rating_def_id').value;
    if (!id) return;

    const confirmed = await showCustomConfirm("Delete Rating Definition", "Are you sure you want to delete this custom rating scale? Attached rating entries will also be removed.");
    if (confirmed) {
        await fetch(`/api/v1/rating-definitions/${id}`, { method: 'DELETE' });
        closeRatingDefModal();
        loadRatingDefinitionsList();
    }
}

function roundVal(val, decimals) {
    return Number(Math.round(val + 'e' + decimals) + 'e-' + decimals);
}
