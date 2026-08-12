/**
 * TimeTrace Revision Engine JavaScript Module
 * Fully integrated with centralized ApiClient (api.get, api.post, api.put, api.delete).
 */

let currentActiveRevTab = 'overview';
let allRevisionSessions = [];
let allTasksList = [];
let allRatingDefinitions = [];
let allDayHistoryList = [];

let dayReviewHasExisting = false;
let currentDayHistoryFilter = 'all';
let currentSessionReviewFilter = 'all';

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
    
    const dateInput = document.getElementById('day_review_date_input');
    if (dateInput && !dateInput.value) {
        dateInput.value = typeof getLocalTodayStr === 'function' ? getLocalTodayStr() : new Date().toISOString().slice(0, 10);
    }

    const initialHash = window.location.hash || '#overview';
    const initialTab = HASH_TAB_MAP[initialHash] || 'overview';
    switchRevisionTab(initialTab, false);
});

function updateSessionReviewTabVisibility() {
    switchRevisionTab(currentActiveRevTab, false);
}

function handleHashChange() {
    const currentHash = window.location.hash || '#overview';
    let targetTab = HASH_TAB_MAP[currentHash] || 'overview';
    
    const s = typeof getUserSettings === 'function' ? getUserSettings() : { enableSessionReview: true };
    if (targetTab === 'sessions' && s.enableSessionReview === false) {
        targetTab = 'overview';
    }

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
    const s = typeof getUserSettings === 'function' ? getUserSettings() : { enableSessionReview: true };
    const isSessionReviewEnabled = s.enableSessionReview !== false;

    if (tabName === 'sessions' && !isSessionReviewEnabled) {
        tabName = 'overview';
    }

    currentActiveRevTab = tabName;

    if (updateHash && TAB_HASH_MAP[tabName]) {
        window.history.pushState(null, '', TAB_HASH_MAP[tabName]);
    }

    ['day', 'overview', 'sessions', 'task_inspector', 'ratings_config'].forEach(t => {
        const el = document.getElementById(`rev_tab_${t}`);
        const btn = document.getElementById(`rev_tab_btn_${t}`);
        if (el) el.classList.add('hidden');

        if (btn) {
            const isCurrent = (t === tabName);
            const shouldHideBtn = (t === 'sessions' && !isSessionReviewEnabled);

            btn.className = `h-6 px-3 rounded font-bold text-[11px] ${
                isCurrent 
                    ? "bg-purple-600 text-white" 
                    : "text-slate-400 hover:text-white"
            } ${shouldHideBtn ? "hidden" : ""}`.trim();
        }
    });

    const activeEl = document.getElementById(`rev_tab_${tabName}`);
    if (activeEl) activeEl.classList.remove('hidden');

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

// ==========================================
// 1. Day Review & Dynamic Button State Engine
// ==========================================
function setDayReviewToday() {
    const dateInput = document.getElementById('day_review_date_input');
    if (dateInput) {
        dateInput.value = typeof getLocalTodayStr === 'function' ? getLocalTodayStr() : new Date().toISOString().slice(0, 10);
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
    if (!dateInput) return;

    if (!dateInput.value) {
        dateInput.value = typeof getLocalTodayStr === 'function' ? getLocalTodayStr() : new Date().toISOString().slice(0, 10);
    }

    const dateStr = dateInput.value;
    try {
        const data = await api.get(`/api/v1/revision/day-summary?date_str=${dateStr}`);

        const badge = document.getElementById('day_review_status_badge');
        const saveBtn = document.getElementById('day_form_save_btn');

        if (data.day_review && !data.day_review.review_skipped) {
            dayReviewHasExisting = true;
            if (badge) {
                badge.innerText = `Reviewed (${data.day_review.rating}/5)`;
                badge.className = "px-2.5 py-1 rounded text-xs font-bold bg-emerald-900/60 text-emerald-300 border border-emerald-700";
            }
            if (saveBtn) {
                saveBtn.innerText = "Save Updates";
                saveBtn.className = "w-full bg-[#222536] hover:bg-[#2d3046] text-slate-300 font-bold py-2 rounded-lg text-xs transition border border-[var(--border-muted)]";
            }
        } else if (data.day_review && data.day_review.review_skipped) {
            dayReviewHasExisting = true;
            if (badge) {
                badge.innerText = "Dismissed";
                badge.className = "px-2.5 py-1 rounded text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700";
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
        document.getElementById('day_form_highlights').value = review ? (review.highlights || "") : "";
        document.getElementById('day_form_friction').value = review ? (review.friction || "") : "";
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
                            ${s.task ? `
                                <div class="space-y-0.5">
                                    <div class="font-black text-sm text-white">${s.task.title}</div>
                                    ${s.task.description ? `<div class="text-xs text-slate-400 line-clamp-1">${s.task.description}</div>` : ''}
                                </div>
                            ` : ''}
                            ${s.notes ? `<div class="text-slate-200 font-medium">${s.notes}</div>` : ''}
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
        highlights: document.getElementById('day_form_highlights').value,
        friction: document.getElementById('day_form_friction').value,
        notes: document.getElementById('day_form_notes').value,
        review_skipped: false
    };

    await api.post('/api/v1/revision/day-review', payload);
    await submitCustomRatings('day', dateStr);
    loadDayReviewData();
}

async function dismissDayReview() {
    const dateInput = document.getElementById('day_review_date_input');
    if (!dateInput || !dateInput.value) return;

    const dateStr = dateInput.value;

    const confirmed = await showCustomConfirm(
        "Dismiss Day Review",
        `Mark day review for ${dateStr} as dismissed?`
    );

    if (confirmed) {
        const payload = {
            date_str: dateStr,
            rating: parseInt(document.getElementById('day_form_rating').value) || 3,
            highlights: document.getElementById('day_form_highlights').value,
            friction: document.getElementById('day_form_friction').value,
            notes: document.getElementById('day_form_notes').value,
            review_skipped: true
        };

        await api.post('/api/v1/revision/day-review', payload);
        loadDayReviewData();
    }
}

// ==========================================
// 2. Day Revisions History Overview
// ==========================================
async function loadDayHistoryOverview() {
    try {
        allDayHistoryList = await api.get('/api/v1/revision/day-history');
        renderDayHistoryGrid();
    } catch (e) {
        console.error("Failed to load day history overview:", e);
    }
}

function setHistoryFilter(filter) {
    currentDayHistoryFilter = filter;
    ['all', 'reviewed', 'missed', 'dismissed'].forEach(f => {
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
        filtered = filtered.filter(d => d.has_review && !d.review_skipped);
    } else if (currentDayHistoryFilter === 'missed') {
        filtered = filtered.filter(d => !d.has_review && !d.review_skipped);
    } else if (currentDayHistoryFilter === 'dismissed') {
        filtered = filtered.filter(d => d.review_skipped);
    }

    if (filtered.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-xs text-slate-500 text-center py-8">No matching days found in history.</div>';
        return;
    }

    grid.innerHTML = filtered.map(d => {
        const dateObj = new Date(d.date_str + "T00:00:00");
        const formattedDate = dateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        
        let statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-950/80 text-amber-400 border border-amber-800">Missing Review</span>';
        if (d.review_skipped) {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700">Dismissed</span>';
        } else if (d.has_review) {
            statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-900/60 text-emerald-300 border border-emerald-700">Reviewed (${d.rating}/5)</span>`;
        }

        return `
            <div onclick="jumpToDayReview('${d.date_str}')" class="rev-card hover:border-purple-500 cursor-pointer transition space-y-2">
                <div class="flex justify-between items-center border-b border-[var(--border-muted)] pb-2">
                    <span class="font-bold text-sm text-white">${formattedDate}</span>
                    ${statusBadge}
                </div>
                <div class="flex justify-between items-center text-xs text-slate-400">
                    <span>${d.total_hours} focus hours</span>
                    <span>${d.session_count} sessions</span>
                </div>
                ${d.highlights ? `<p class="text-xs text-slate-300 line-clamp-2"><span class="font-bold text-emerald-400">Highlights:</span> ${d.highlights}</p>` : ''}
                ${d.friction ? `<p class="text-xs text-slate-300 line-clamp-2"><span class="font-bold text-amber-400">Friction:</span> ${d.friction}</p>` : ''}
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

// ==========================================
// 3. Session Review & Inspector Modal
// ==========================================
async function openSessionReviewModal(sessionId) {
    try {
        const session = await api.get(`/api/v1/sessions/${sessionId}`);

        document.getElementById('session_rev_modal_id').value = session.id;

        const st = session.start_time ? new Date(session.start_time) : new Date();
        const et = session.end_time ? new Date(session.end_time) : new Date();
        const timeStr = `${st.toLocaleString()} - ${et.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        document.getElementById('session_rev_modal_time').innerText = timeStr;

        document.getElementById('session_rev_modal_tags').value = session.tags || '';
        document.getElementById('session_rev_modal_notes').value = session.notes || '';

        const skipCheck = document.getElementById('session_rev_modal_skip_check');
        if (skipCheck) skipCheck.checked = session.review_skipped === true;

        const entries = await api.get(`/api/v1/rating-entries?target_type=session&target_id=${sessionId}`);
        await renderCustomRatingsInputs('session', sessionId, 'session_custom_ratings_container', entries || []);

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
    const skipVal = document.getElementById('session_rev_modal_skip_check') ? document.getElementById('session_rev_modal_skip_check').checked : false;

    await api.put(`/api/v1/sessions/${sessionId}`, { tags: tagsVal, notes: notesVal, review_skipped: skipVal });
    await submitCustomRatings('session', sessionId);

    closeSessionReviewModal();
    loadCurrentRevisionView();
}

async function resetSessionReview() {
    const sessionId = document.getElementById('session_rev_modal_id').value;
    if (!sessionId) return;

    const confirmed = await showCustomConfirm(
        "Reset Session Review",
        "Are you sure you want to remove all review ratings for this session and mark it as unreviewed?"
    );

    if (confirmed) {
        await api.delete(`/api/v1/rating-entries?target_type=session&target_id=${sessionId}`);
        await api.put(`/api/v1/sessions/${sessionId}`, { review_skipped: false });

        closeSessionReviewModal();
        loadCurrentRevisionView();
    }
}

async function quickDismissSessionReview(sessionId, event) {
    if (event) event.stopPropagation();
    await api.put(`/api/v1/sessions/${sessionId}`, { review_skipped: true });
    loadCurrentRevisionView();
}

async function deleteSessionFromReviewModal() {
    const sessionId = document.getElementById('session_rev_modal_id').value;
    if (!sessionId) return;

    const confirmed = await showCustomConfirm("Delete Session Log", "Are you sure you want to delete this session log? This action cannot be undone.");
    if (confirmed) {
        await api.delete(`/api/v1/sessions/${sessionId}`);
        closeSessionReviewModal();
        loadCurrentRevisionView();
    }
}

// ==========================================
// 4. Fast Typeahead Task Inspector Search & Quick Bar
// ==========================================
async function loadTaskInspectorRegistry() {
    try {
        allTasksList = await api.get('/api/v1/tasks?status=all');
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
        const data = await api.get(`/api/v1/tasks/${taskId}/stats`);
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

    const payload = {
        task_id: taskId,
        difficulty: parseInt(document.getElementById('task_rev_difficulty').value),
        what_went_well: document.getElementById('task_rev_went_well').value,
        blockers: document.getElementById('task_rev_blockers').value,
        key_takeaways: document.getElementById('task_rev_takeaways').value
    };

    await api.post('/api/v1/task-reviews', payload);
    await submitCustomRatings('task', taskId);
    loadTaskInspectorStats(taskId);
}

// 6. Custom Ratings Form Engine
async function renderCustomRatingsInputs(targetType, targetId, containerId, existingEntries = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const defs = await api.get(`/api/v1/rating-definitions?target_type=${targetType}`);

    if (!defs || defs.length === 0) {
        container.innerHTML = '';
        return;
    }

    const existingMap = {};
    const dismissedMap = {};
    if (existingEntries) {
        existingEntries.forEach(e => {
            existingMap[e.rating_definition_id] = e.score;
            dismissedMap[e.rating_definition_id] = e.dismissed === true;
        });
    }

    container.innerHTML = `
        <div class="text-xs font-bold text-slate-300 mb-2 border-b border-[var(--border-muted)] pb-1">Custom Ratings (${targetType.toUpperCase()})</div>
        ${defs.map(d => {
            const isDismissed = dismissedMap[d.id] === true;
            const currentScore = existingMap[d.id] !== undefined && existingMap[d.id] !== null ? existingMap[d.id] : Math.ceil((d.min_score + d.max_score) / 2);
            return `
                <div class="bg-[#0f1016] p-2.5 rounded-lg border border-[var(--border-muted)] space-y-1.5" data-rating-def-id="${d.id}" data-required="${d.is_required}">
                    <div class="flex justify-between items-center text-xs">
                        <span class="font-bold text-slate-200">${d.name} ${d.is_required ? '<span class="text-red-400">*</span>' : ''}</span>
                        <div class="flex items-center space-x-2">
                            <span id="score_label_${d.id}" class="font-mono ${isDismissed ? 'text-slate-500' : 'text-purple-400'} font-bold">${isDismissed ? 'Dismissed' : `${currentScore} / ${d.max_score}`}</span>
                            <button type="button" onclick="toggleDismissRatingInput(${d.id}, ${d.max_score})" id="dismiss_btn_${d.id}" class="px-1.5 py-0.5 rounded text-[9px] font-bold ${isDismissed ? 'bg-purple-900/60 text-purple-300 border border-purple-700' : 'bg-slate-800 text-slate-400 hover:text-white'}">${isDismissed ? 'Undismiss' : 'Dismiss'}</button>
                        </div>
                    </div>
                    ${d.description ? `<p class="text-[10px] text-slate-400">${d.description}</p>` : ''}
                    <input type="range" min="${d.min_score}" max="${d.max_score}" value="${currentScore}" ${isDismissed ? 'disabled' : ''} id="rating_range_input_${d.id}" oninput="document.getElementById('score_label_${d.id}').innerText = this.value + ' / ${d.max_score}'; if(typeof markDayFormDirty === 'function') markDayFormDirty();" class="custom-rating-input w-full accent-purple-600 ${isDismissed ? 'opacity-30 cursor-not-allowed' : ''}">
                </div>
            `;
        }).join('')}
    `;
}

function toggleDismissRatingInput(defId, maxScore) {
    const input = document.getElementById(`rating_range_input_${defId}`);
    const label = document.getElementById(`score_label_${defId}`);
    const btn = document.getElementById(`dismiss_btn_${defId}`);
    if (!input || !label || !btn) return;

    const isCurrentlyDismissed = input.disabled;
    if (isCurrentlyDismissed) {
        input.disabled = false;
        input.classList.remove('opacity-30', 'cursor-not-allowed');
        label.innerText = `${input.value} / ${maxScore}`;
        label.className = "font-mono text-purple-400 font-bold";
        btn.innerText = "Dismiss";
        btn.className = "px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-400 hover:text-white";
    } else {
        input.disabled = true;
        input.classList.add('opacity-30', 'cursor-not-allowed');
        label.innerText = "Dismissed";
        label.className = "font-mono text-slate-500 font-bold";
        btn.innerText = "Undismiss";
        btn.className = "px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-900/60 text-purple-300 border border-purple-700";
    }

    if (typeof markDayFormDirty === 'function') markDayFormDirty();
}

function validateRequiredCustomRatings(targetType, targetId) {
    const inputs = document.querySelectorAll(`[data-rating-def-id]`);
    for (let el of inputs) {
        const isReq = el.getAttribute('data-required') === 'true';
        const input = el.querySelector('.custom-rating-input');
        const isDismissed = input ? input.disabled : false;
        if (isReq && !isDismissed && input && (!input.value || input.value === '')) {
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
        if (input) {
            const isDismissed = input.disabled;
            await api.post('/api/v1/rating-entries', {
                rating_definition_id: defId,
                target_type: targetType,
                target_id: String(targetId),
                score: isDismissed ? 0 : parseInt(input.value),
                dismissed: isDismissed
            });
        }
    }
}

// 7. All Sessions Review & Filter Engine
async function loadAllSessionsReview() {
    try {
        allRevisionSessions = await api.get('/api/v1/sessions') || [];
        
        let tasksMap = {};
        try {
            const tasks = await api.get('/api/v1/tasks?status=all');
            if (tasks) tasks.forEach(t => { tasksMap[t.id] = t; });
        } catch (e) {}

        let reviewedSessionIds = new Set();
        try {
            const entries = await api.get('/api/v1/rating-entries?target_type=session&target_id=all');
            if (entries) {
                entries.forEach(e => {
                    if (!e.dismissed) reviewedSessionIds.add(String(e.target_id));
                });
            }
        } catch (e) {}

        allRevisionSessions.forEach(s => {
            s.is_reviewed = reviewedSessionIds.has(String(s.id));
            const attachedTask = s.task_id ? tasksMap[s.task_id] : null;
            s.attachedTask = attachedTask;
            const isExempt = s.review_skipped === true || (attachedTask && attachedTask.requires_session_review === false);
            s.is_exempt = isExempt;
            s.is_missed = !s.is_reviewed && !isExempt;
        });

        allRevisionSessions.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
        filterSessionsReviewList();
    } catch (e) {
        console.error("Failed to load sessions for review:", e);
    }
}

function setSessionReviewFilter(filter) {
    currentSessionReviewFilter = filter;
    ['all', 'reviewed', 'missed', 'dismissed'].forEach(f => {
        const btn = document.getElementById(`sess_filter_${f}`);
        if (btn) btn.className = f === filter 
            ? "px-2.5 py-0.5 rounded font-bold bg-purple-600 text-white" 
            : "px-2.5 py-0.5 rounded font-bold text-slate-400 hover:text-white";
    });
    filterSessionsReviewList();
}

function filterSessionsReviewList() {
    const queryEl = document.getElementById('session_rev_search');
    const query = queryEl ? queryEl.value.trim().toLowerCase() : '';
    const container = document.getElementById('sessions_review_list');
    const badge = document.getElementById('session_rev_count_badge');

    if (!container) return;

    let filtered = allRevisionSessions;

    if (currentSessionReviewFilter === 'reviewed') {
        filtered = filtered.filter(s => s.is_reviewed);
    } else if (currentSessionReviewFilter === 'missed') {
        filtered = filtered.filter(s => s.is_missed);
    } else if (currentSessionReviewFilter === 'dismissed') {
        filtered = filtered.filter(s => s.is_exempt);
    }

    if (query) {
        filtered = filtered.filter(s => 
            (s.notes && s.notes.toLowerCase().includes(query)) ||
            (s.tags && s.tags.toLowerCase().includes(query)) ||
            (s.attachedTask && s.attachedTask.title.toLowerCase().includes(query))
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

        let statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-950/80 text-amber-400 border border-amber-800">Missed Review</span>';
        if (s.is_reviewed) {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-900/60 text-emerald-300 border border-emerald-700">Reviewed</span>';
        } else if (s.is_exempt) {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700">Dismissed</span>';
        }

        const attachedTask = s.attachedTask;

        return `
            <div onclick="openSessionReviewModal(${s.id})" class="rev-card hover:border-purple-500 cursor-pointer space-y-2 text-xs transition">
                <div class="flex justify-between items-center border-b border-[var(--border-muted)] pb-2">
                    <div class="flex items-center space-x-2">
                        <span class="font-bold text-purple-400">${dateLabel} (${timeLabel})</span>
                        ${statusBadge}
                    </div>
                    <div class="flex items-center space-x-2">
                        ${!s.is_reviewed && !s.is_exempt ? `<button onclick="quickDismissSessionReview(${s.id}, event)" class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-800/80 transition">Dismiss</button>` : ''}
                        <span class="font-mono font-bold text-slate-300">${durMins} mins</span>
                        <span class="px-2 py-0.5 rounded bg-purple-900/50 text-purple-300 font-bold border border-purple-800">${s.tags || '#general'}</span>
                    </div>
                </div>
                ${attachedTask ? `
                    <div class="space-y-0.5">
                        <div class="font-black text-sm text-white">${attachedTask.title}</div>
                        ${attachedTask.description ? `<div class="text-xs text-slate-400 line-clamp-1">${attachedTask.description}</div>` : ''}
                    </div>
                ` : ''}
                ${s.notes ? `<div class="text-slate-200 font-medium">${s.notes}</div>` : ''}
            </div>
        `;
    }).join('');
}

// 8. Custom Rating Definitions Manager
async function loadRatingDefinitionsList() {
    const container = document.getElementById('rating_defs_card_list');
    if (!container) return;

    try {
        allRatingDefinitions = await api.get('/api/v1/rating-definitions') || [];

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
        await api.put(`/api/v1/rating-definitions/${id}`, payload);
    } else {
        await api.post('/api/v1/rating-definitions', payload);
    }

    closeRatingDefModal();
    loadRatingDefinitionsList();
}

async function deleteRatingDefinition() {
    const id = document.getElementById('edit_rating_def_id').value;
    if (!id) return;

    const confirmed = await showCustomConfirm("Delete Rating Definition", "Are you sure you want to delete this custom rating scale? Attached rating entries will also be removed.");
    if (confirmed) {
        await api.delete(`/api/v1/rating-definitions/${id}`);
        closeRatingDefModal();
        loadRatingDefinitionsList();
    }
}

function roundVal(val, decimals) {
    return Number(Math.round(val + 'e' + decimals) + 'e-' + decimals);
}
