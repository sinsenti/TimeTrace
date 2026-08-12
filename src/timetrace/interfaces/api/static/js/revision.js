/**
 * TimeTrace Revision Engine JavaScript Module
 * Handles Day Reviews, Day History Overview, Sessions Inspection, Task Post-Mortems,
 * Custom Ratings, Sub-Routing (Hashes), and Typeahead Task Inspector Search.
 */

let currentActiveRevTab = 'day';
let allRevisionSessions = [];
let allTasksList = [];
let allRatingDefinitions = [];
let allDayHistoryList = [];

let dayReviewHasExisting = false;
let currentDayHistoryFilter = 'all';

let selectedInspectedTaskId = null;
let activeTaskInspectorSearchIdx = -1;

const TAB_HASH_MAP = {
    'day': '#day',
    'overview': '#overview',
    'sessions': '#sessions',
    'task_inspector': '#tasks',
    'ratings_config': '#ratings'
};

const HASH_TAB_MAP = {
    '#day': 'day',
    '#overview': 'overview',
    '#sessions': 'sessions',
    '#tasks': 'task_inspector',
    '#ratings': 'ratings_config'
};

document.addEventListener('DOMContentLoaded', () => {
    setupRevisionKeyboardShortcuts();
    setupTaskInspectorSearchListeners();

    window.addEventListener('hashchange', handleHashChange);
    
    const initialHash = window.location.hash || '#day';
    const initialTab = HASH_TAB_MAP[initialHash] || 'day';
    switchRevisionTab(initialTab, false);
});

function handleHashChange() {
    const currentHash = window.location.hash || '#day';
    const targetTab = HASH_TAB_MAP[currentHash] || 'day';
    if (targetTab !== currentActiveRevTab) {
        switchRevisionTab(targetTab, false);
    }
}

function setupRevisionKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const sessionRevModal = document.getElementById('session_review_modal');
        if (sessionRevModal && !sessionRevModal.classList.contains('hidden')) {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                saveSessionReviewModal();
                return;
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeSessionReviewModal();
                return;
            }
        }

        const ratingDefModal = document.getElementById('rating_def_modal');
        if (ratingDefModal && !ratingDefModal.classList.contains('hidden')) {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                saveRatingDefinition();
                return;
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeRatingDefModal();
                return;
            }
        }
    });
}

function switchRevisionTab(tabName, updateHash = true) {
    currentActiveRevTab = tabName;

    if (updateHash && TAB_HASH_MAP[tabName]) {
        window.history.pushState(null, '', TAB_HASH_MAP[tabName]);
    }

    ['day', 'overview', 'sessions', 'task_inspector', 'ratings_config'].forEach(t => {
        const el = document.getElementById(`rev_tab_${t}`);
        const btn = document.getElementById(`rev_tab_btn_${t}`);
        if (el) el.classList.add('hidden');
        if (btn) btn.className = "h-6 px-3 rounded font-bold text-slate-400 hover:text-white text-[11px]";
    });

    const activeEl = document.getElementById(`rev_tab_${tabName}`);
    const activeBtn = document.getElementById(`rev_tab_btn_${tabName}`);
    if (activeEl) activeEl.classList.remove('hidden');
    if (activeBtn) activeBtn.className = "h-6 px-3 rounded font-bold bg-purple-600 text-white text-[11px]";

    loadCurrentRevisionView();
}

function loadCurrentRevisionView() {
    if (currentActiveRevTab === 'day') {
        loadDayReviewData();
    } else if (currentActiveRevTab === 'overview') {
        loadDayHistoryOverview();
    } else if (currentActiveRevTab === 'sessions') {
        loadAllSessionsReview();
    } else if (currentActiveRevTab === 'task_inspector') {
        loadTaskInspectorRegistry();
    } else {
        loadRatingDefinitionsList();
    }
}

// 1. Day Review
function setDayReviewToday() {
    const dateInput = document.getElementById('day_review_date_input');
    if (dateInput) {
        const todayStr = new Date().toISOString().slice(0, 10);
        dateInput.value = todayStr;
        loadDayReviewData();
    }
}

function markDayFormDirty() {
    const btn = document.getElementById('day_form_save_btn');
    if (btn) {
        btn.innerText = dayReviewHasExisting ? "Save Updates" : "Save Day Review";
        btn.className = "w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-lg text-xs transition shadow-lg shadow-purple-600/30";
    }
}

async function loadDayReviewData() {
    const dateInput = document.getElementById('day_review_date_input');
    if (!dateInput || !dateInput.value) return;

    const dateStr = dateInput.value;
    try {
        const res = await fetch(`/api/v1/revision/day-summary?date_str=${dateStr}`);
        const data = await res.json();

        const badge = document.getElementById('day_review_status_badge');
        const saveBtn = document.getElementById('day_form_save_btn');

        if (data.day_review) {
            dayReviewHasExisting = true;
            if (badge) {
                badge.innerText = `Reviewed (${data.day_review.rating}/5)`;
                badge.className = "px-2.5 py-1 rounded text-xs font-bold bg-emerald-900/60 text-emerald-300 border border-emerald-700";
            }
            if (saveBtn) {
                saveBtn.innerText = "Save Updates";
                saveBtn.className = "w-full bg-[#222536] hover:bg-[#2d3046] text-slate-300 font-bold py-2 rounded-lg text-xs transition border border-[var(--border-muted)]";
            }
        } else {
            dayReviewHasExisting = false;
            if (badge) {
                badge.innerText = "Missing Review";
                badge.className = "px-2.5 py-1 rounded text-xs font-bold bg-amber-900/60 text-amber-300 border border-amber-700";
            }
            if (saveBtn) {
                saveBtn.innerText = "Save Day Review";
                saveBtn.className = "w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 rounded-lg text-xs transition";
            }
        }

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
            `;
        }

        const review = data.day_review;
        document.getElementById('day_form_rating').value = review ? review.rating : 3;
        document.getElementById('day_form_wins').value = review ? (review.wins || "") : "";
        document.getElementById('day_form_blockers').value = review ? (review.blockers || "") : "";
        document.getElementById('day_form_notes').value = review ? (review.notes || "") : "";

        await renderCustomRatingsInputs('day', dateStr, 'day_custom_ratings_container', data.custom_ratings);

        const timeline = document.getElementById('day_sessions_timeline');
        if (timeline) {
            if (data.sessions.length === 0) {
                timeline.innerHTML = '<div class="text-xs text-slate-500 text-center py-6">No sessions logged for this day.</div>';
            } else {
                timeline.innerHTML = data.sessions.map(s => {
                    const stStr = s.start_time ? new Date(s.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '00:00';
                    const etStr = s.end_time ? new Date(s.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'NOW';
                    const durMins = roundVal((s.duration_seconds || 0) / 60, 1);

                    return `
                        <div onclick="openSessionReviewModal(${s.id})" class="bg-[#0f1016] hover:bg-[#161824] border border-[var(--border-muted)] hover:border-purple-500 p-3 rounded-lg flex flex-col space-y-1.5 text-xs cursor-pointer transition">
                            <div class="flex justify-between items-center">
                                <span class="font-mono text-purple-300 font-bold">[${stStr} - ${etStr}] (${durMins}m)</span>
                                <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-800">${s.tags || '#general'}</span>
                            </div>
                            <div class="text-white font-semibold">${s.notes || 'No description notes'}</div>
                            ${s.task ? `<div class="text-[10px] text-blue-400 font-bold">Attached Task: ${s.task.title}</div>` : ''}
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

// 2. Day Revisions History Overview
async function loadDayHistoryOverview() {
    try {
        const res = await fetch('/api/v1/revision/day-history');
        allDayHistoryList = await res.json();
        renderDayHistoryGrid();
    } catch (e) {
        console.error("Failed to load day history overview:", e);
    }
}

function setHistoryFilter(filter) {
    currentDayHistoryFilter = filter;
    ['all', 'reviewed', 'missed'].forEach(f => {
        const btn = document.getElementById(`hist_filter_${f}`);
        if (btn) btn.className = f === filter 
            ? "px-3 py-1 rounded font-bold bg-purple-600 text-white" 
            : "px-3 py-1 rounded font-bold text-slate-400 hover:text-white";
    });
    renderDayHistoryGrid();
}

function renderDayHistoryGrid() {
    const grid = document.getElementById('day_history_grid');
    if (!grid) return;

    let filtered = allDayHistoryList;
    if (currentDayHistoryFilter === 'reviewed') {
        filtered = filtered.filter(d => d.has_review);
    } else if (currentDayHistoryFilter === 'missed') {
        filtered = filtered.filter(d => !d.has_review);
    }

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-xs text-slate-500 text-center py-8">No matching days found in history.</div>';
        return;
    }

    grid.innerHTML = filtered.map(d => {
        const dateObj = new Date(d.date_str + "T00:00:00");
        const formattedDate = dateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        
        return `
            <div onclick="jumpToDayReview('${d.date_str}')" class="rev-card hover:border-purple-500 cursor-pointer transition space-y-2">
                <div class="flex justify-between items-center border-b border-[var(--border-muted)] pb-2">
                    <span class="font-bold text-sm text-white">${formattedDate}</span>
                    ${d.has_review 
                        ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-900/60 text-emerald-300 border border-emerald-700">Reviewed (${d.rating}/5)</span>`
                        : `<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-950/80 text-amber-400 border border-amber-800">Missing Review</span>`
                    }
                </div>
                <div class="flex justify-between items-center text-xs text-slate-400">
                    <span>${d.total_hours} focus hours</span>
                    <span>${d.session_count} sessions</span>
                </div>
                ${d.wins ? `<p class="text-xs text-slate-300 line-clamp-2 italic">${d.wins}</p>` : '<p class="text-[10px] text-slate-500 italic">No notes recorded.</p>'}
            </div>
        `;
    }).join('');
}

function jumpToDayReview(dateStr) {
    switchRevisionTab('day');
    const dateInput = document.getElementById('day_review_date_input');
    if (dateInput) {
        dateInput.value = dateStr;
        loadDayReviewData();
    }
}

// 3. Session Review & Inspector Modal
async function openSessionReviewModal(sessionId) {
    try {
        const res = await fetch(`/api/v1/sessions/${sessionId}`);
        if (!res.ok) return;
        const session = await res.json();

        document.getElementById('session_rev_modal_id').value = session.id;

        const st = session.start_time ? new Date(session.start_time) : new Date();
        const et = session.end_time ? new Date(session.end_time) : new Date();
        const timeStr = `${st.toLocaleString()} - ${et.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        document.getElementById('session_rev_modal_time').innerText = timeStr;

        document.getElementById('session_rev_modal_tags').value = session.tags || '';
        document.getElementById('session_rev_modal_notes').value = session.notes || '';

        const entriesRes = await fetch(`/api/v1/rating-entries?target_type=session&target_id=${sessionId}`);
        const entries = entriesRes.ok ? await entriesRes.json() : [];
        
        await renderCustomRatingsInputs('session', sessionId, 'session_custom_ratings_container', entries);

        document.getElementById('session_review_modal').classList.remove('hidden');

        setTimeout(() => {
            const tagsInput = document.getElementById('session_rev_modal_tags');
            if (tagsInput) tagsInput.focus();
        }, 50);

    } catch (e) {
        console.error("Failed to open session review modal:", e);
    }
}

function closeSessionReviewModal() {
    const modal = document.getElementById('session_review_modal');
    if (modal) modal.classList.add('hidden');
}

async function saveSessionReviewModal() {
    const sessionId = document.getElementById('session_rev_modal_id').value;
    if (!sessionId) return;

    if (!validateRequiredCustomRatings('session', sessionId)) {
        return;
    }

    const tagsVal = document.getElementById('session_rev_modal_tags').value.trim();
    const notesVal = document.getElementById('session_rev_modal_notes').value.trim();

    await fetch(`/api/v1/sessions/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: tagsVal, notes: notesVal })
    });

    await submitCustomRatings('session', sessionId);

    closeSessionReviewModal();
    loadCurrentRevisionView();
}

async function deleteSessionFromReviewModal() {
    const sessionId = document.getElementById('session_rev_modal_id').value;
    if (!sessionId) return;

    const confirmed = await showCustomConfirm("Delete Session Log", "Are you sure you want to delete this session log? This action cannot be undone.");
    if (confirmed) {
        await fetch(`/api/v1/sessions/${sessionId}`, { method: 'DELETE' });
        closeSessionReviewModal();
        loadCurrentRevisionView();
    }
}

// 4. Fast Typeahead Task Inspector Search & Quick Bar
async function loadTaskInspectorRegistry() {
    try {
        const res = await fetch('/api/v1/tasks?status=all');
        allTasksList = await res.json();
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
            <button onclick="selectTaskInspectorById(${t.id})" class="px-2.5 py-1 rounded-lg text-xs font-bold text-white shadow-sm hover:scale-105 transition flex items-center space-x-1.5" style="background-color: ${color};">
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
        <div onclick="selectTaskInspectorById(${t.id})" class="task-inspect-item px-3 py-2 hover:bg-[#1a1c28] cursor-pointer text-xs flex items-center justify-between border-b border-[#1a1c26] last:border-b-0 transition ${idx === 0 ? 'bg-[#1a1c28]' : ''}">
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

// 5. Task Inspector Stats Loader
async function loadTaskInspectorStats(taskId) {
    const body = document.getElementById('task_inspector_body');
    if (!taskId) {
        if (body) body.classList.add('hidden');
        return;
    }

    selectedInspectedTaskId = taskId;

    try {
        const res = await fetch(`/api/v1/tasks/${taskId}/stats`);
        const data = await res.json();
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
                        <div onclick="openSessionReviewModal(${s.id})" class="bg-[#0f1016] hover:bg-[#161824] border border-[var(--border-muted)] hover:border-purple-500 p-3 rounded-lg text-xs space-y-1 cursor-pointer transition">
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

// 6. Custom Ratings Form Engine
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
                    <input type="range" min="${d.min_score}" max="${d.max_score}" value="${currentScore}" oninput="document.getElementById('score_label_${d.id}').innerText = this.value + ' / ${d.max_score}'; if(typeof markDayFormDirty === 'function') markDayFormDirty();" class="custom-rating-input w-full accent-purple-600">
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

// 7. All Sessions Review
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

        return `
            <div onclick="openSessionReviewModal(${s.id})" class="rev-card hover:border-purple-500 cursor-pointer space-y-2 text-xs transition">
                <div class="flex justify-between items-center border-b border-[var(--border-muted)] pb-2">
                    <span class="font-bold text-purple-400">${dateLabel} (${timeLabel})</span>
                    <div class="flex items-center space-x-2">
                        <span class="font-mono font-bold text-slate-300">${durMins} mins</span>
                        <span class="px-2 py-0.5 rounded bg-purple-900/50 text-purple-300 font-bold border border-purple-800">${s.tags || '#general'}</span>
                    </div>
                </div>
                <div class="text-white text-sm font-semibold">${s.notes || 'No description notes'}</div>
            </div>
        `;
    }).join('');
}

// 8. Custom Rating Definitions Manager
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
            <div onclick="openEditRatingDefModal(${d.id})" class="rev-card flex items-center justify-between hover:border-purple-500 cursor-pointer transition">
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

    setTimeout(() => {
        const nameInput = document.getElementById('modal_rating_name');
        if (nameInput) nameInput.focus();
    }, 50);
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

    setTimeout(() => {
        const nameInput = document.getElementById('modal_rating_name');
        if (nameInput) nameInput.focus();
    }, 50);
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
