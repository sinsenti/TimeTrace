let calendar;
let isRunning = false;
let activeTasks = [];
let allSessions = [];
let currentFilter = 'all';
let defaultDurationMinutes = parseInt(localStorage.getItem('timetrace_slot_duration') || '15');
let defaultPalette = ['#7c3aed', '#2563eb', '#d97706', '#dc2626', '#059669', '#ec4899'];
let idleDetectionEnabled = true;

// ==========================================
// 🧘 Neovim Mode Engine State
// ==========================================
let vimMode = 'NORMAL'; // 'NORMAL' | 'VISUAL'
let suppressModalOnSelect = false;

let cursorStart = null;
let cursorEnd = null;
let visualAnchorStart = null;

// ==========================================
// 🚀 Initialization & Calendar Setup
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    const durationSelect = document.getElementById('config_slot_duration');
    if (durationSelect) durationSelect.value = defaultDurationMinutes;

    const calendarEl = document.getElementById('calendar');
    if (calendarEl) {
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'timeGridWeek',
            headerToolbar: false,
            slotMinTime: "00:00:00",
            slotMaxTime: "24:00:00",
            slotDuration: `00:${String(defaultDurationMinutes).padStart(2,'0')}:00`,
            scrollTime: getInitialScrollTime(),
            scrollTimeReset: false,
            nowIndicator: true,
            editable: true,
            selectable: true,
            selectMirror: true,
            droppable: true,
            defaultTimedEventDuration: `00:${String(defaultDurationMinutes).padStart(2,'0')}:00`,
            events: fetchCalendarEvents,

            dayHeaderContent: function(arg) {
                const dayName = arg.date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
                const dayNum = arg.date.getDate();
                return {
                    html: `
                        <div class="flex flex-col items-center py-1">
                            <span class="text-[10px] font-bold tracking-widest text-slate-500 uppercase">${dayName}</span>
                            <span class="mt-1 text-base font-bold text-slate-200">${dayNum}</span>
                        </div>
                    `
                };
            },

            select: function(selectionInfo) {
                cursorStart = selectionInfo.start;
                cursorEnd = selectionInfo.end;

                if (!suppressModalOnSelect) {
                    openCreateSessionModal(selectionInfo.start, selectionInfo.end);
                }
            },

            eventDrop: async function(info) { await handleCalendarEventUpdate(info.event); },
            eventResize: async function(info) { await handleCalendarEventUpdate(info.event); },
            
            eventClick: function(info) {
                openEditSessionModal(info.event.id);
            },

            eventReceive: function(info) {
                const taskTitle = info.event.title;
                const taskId = info.event.extendedProps.taskId;
                const startTime = info.event.start;
                const endTime = new Date(startTime.getTime() + defaultDurationMinutes * 60000);

                info.event.remove();
                openCreateSessionModal(startTime, endTime, taskId, taskTitle);
            },

            datesSet: function(info) {
                const titleEl = document.getElementById('calendar_range_title');
                if (titleEl) titleEl.innerText = info.view.title;
                updateViewButtons(info.view.type);
                fetchRangeTotals();
                injectTimezoneLabel();
            }
        });
        calendar.render();
    }

    const taskCardList = document.getElementById('task_card_list');
    if (taskCardList) {
        new FullCalendar.Draggable(taskCardList, {
            itemSelector: '.task-card',
            eventData: function(eventEl) {
                return {
                    title: eventEl.getAttribute('data-task-title'),
                    backgroundColor: eventEl.getAttribute('data-task-color'),
                    extendedProps: {
                        taskId: parseInt(eventEl.getAttribute('data-task-id'))
                    }
                };
            }
        });
    }

    const sessionModal = document.getElementById('session_modal');
    if (sessionModal) {
        sessionModal.addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                saveSessionFromModal();
            } else if (e.key === 'Escape') {
                closeSessionModal();
            }
        });
    }

    fetchTasks();
    fetchTimerStatus();
    setInterval(fetchTimerStatus, 1000);
});

// ==========================================
// ⌨️ Neovim Motion & Visual Mode Engine
// ==========================================
document.addEventListener('keydown', function(e) {
    const activeEl = document.activeElement;
    const isEditingText = activeEl.tagName === 'INPUT' || 
                          activeEl.tagName === 'TEXTAREA' || 
                          activeEl.tagName === 'SELECT';

    if (isEditingText) {
        if (e.key === 'Escape') activeEl.blur();
        return;
    }

    if (!cursorStart) {
        const now = new Date();
        now.setMinutes(Math.floor(now.getMinutes() / defaultDurationMinutes) * defaultDurationMinutes, 0, 0);
        cursorStart = new Date(now);
        cursorEnd = new Date(now.getTime() + defaultDurationMinutes * 60000);
    }

    const slotMs = defaultDurationMinutes * 60000;
    const dayMs = 24 * 60 * 60 * 1000;
    const isMonthView = calendar && calendar.view.type === 'dayGridMonth';

    switch (e.key.toLowerCase()) {
        case 'v':
            e.preventDefault();
            if (vimMode === 'NORMAL') {
                vimMode = 'VISUAL';
                visualAnchorStart = new Date(cursorStart);
            } else {
                vimMode = 'NORMAL';
                visualAnchorStart = null;
                cursorEnd = new Date(cursorStart.getTime() + slotMs);
            }
            updateVimModeIndicator();
            renderHighlightSelection();
            break;

        case 'j':
            e.preventDefault();
            const stepDownMs = isMonthView ? (7 * dayMs) : slotMs;
            cursorStart = new Date(cursorStart.getTime() + stepDownMs);
            cursorEnd = new Date(cursorEnd.getTime() + stepDownMs);
            checkAndShiftCalendarView();
            renderHighlightSelection();
            break;

        case 'k':
            e.preventDefault();
            const stepUpMs = isMonthView ? (7 * dayMs) : slotMs;
            cursorStart = new Date(cursorStart.getTime() - stepUpMs);
            cursorEnd = new Date(cursorEnd.getTime() - stepUpMs);
            checkAndShiftCalendarView();
            renderHighlightSelection();
            break;

        case 'h':
            e.preventDefault();
            cursorStart = new Date(cursorStart.getTime() - dayMs);
            cursorEnd = new Date(cursorEnd.getTime() - dayMs);
            checkAndShiftCalendarView();
            renderHighlightSelection();
            break;

        case 'l':
            e.preventDefault();
            cursorStart = new Date(cursorStart.getTime() + dayMs);
            cursorEnd = new Date(cursorEnd.getTime() + dayMs);
            checkAndShiftCalendarView();
            renderHighlightSelection();
            break;

        case 'enter':
        case 's':
            e.preventDefault();
            const selectedRange = getActiveSelectionRange();
            if (selectedRange) {
                openCreateSessionModal(selectedRange.start, selectedRange.end);
            }
            break;

        case 't':
            scrollToCurrentTime();
            break;
        case 'd':
            switchView('timeGridDay');
            break;
        case 'w':
            switchView('timeGridWeek');
            break;
        case 'm':
            switchView('dayGridMonth');
            break;
        case 'a':
            e.preventDefault();
            openNewTaskModal();
            break;

        case 'escape':
            if (vimMode === 'VISUAL') {
                vimMode = 'NORMAL';
                visualAnchorStart = null;
                cursorEnd = new Date(cursorStart.getTime() + slotMs);
                updateVimModeIndicator();
                renderHighlightSelection();
            } else {
                closeTaskModal();
                closeSessionModal();
                if (calendar) calendar.unselect();
            }
            break;
    }
});

function checkAndShiftCalendarView() {
    if (!calendar || !calendar.view) return;
    const viewStart = calendar.view.activeStart;
    const viewEnd = calendar.view.activeEnd;

    if (cursorStart < viewStart) {
        calendar.prev();
    } else if (cursorStart >= viewEnd) {
        calendar.next();
    }
}

function getActiveSelectionRange() {
    if (!cursorStart || !cursorEnd) return null;

    if (vimMode === 'VISUAL' && visualAnchorStart) {
        const slotMs = defaultDurationMinutes * 60000;
        const minStartMs = Math.min(visualAnchorStart.getTime(), cursorStart.getTime());
        const maxEndMs = Math.max(visualAnchorStart.getTime() + slotMs, cursorEnd.getTime());
        return {
            start: new Date(minStartMs),
            end: new Date(maxEndMs)
        };
    } else {
        return {
            start: cursorStart,
            end: cursorEnd
        };
    }
}

function renderHighlightSelection() {
    if (!calendar) return;
    const range = getActiveSelectionRange();
    if (range) {
        suppressModalOnSelect = true;
        calendar.select(range.start, range.end);
        suppressModalOnSelect = false;

        const scroller = document.querySelector('.fc-scroller-harness .fc-scroller');
        if (scroller && calendar.view.type !== 'dayGridMonth') {
            const hour = range.start.getHours();
            const scrollPx = (hour * 3.2 * 16) - 100;
            scroller.scrollTop = Math.max(0, scrollPx);
        }
    }
}

function updateVimModeIndicator() {
    const el = document.getElementById('vim_mode_indicator');
    if (!el) return;

    if (vimMode === 'VISUAL') {
        el.innerText = '-- VISUAL --';
        el.className = 'px-2.5 py-1 rounded text-[11px] font-black uppercase tracking-wider bg-amber-900/80 text-amber-300 border border-amber-600 shadow-md shadow-amber-500/20';
    } else {
        el.innerText = '-- NORMAL --';
        el.className = 'px-2.5 py-1 rounded text-[11px] font-black uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700';
    }
}

// ==========================================
// 🛠️ Calendar Utility & Helper Functions
// ==========================================
function parseApiDateTime(dtStr) {
    if (!dtStr) return null;
    if (typeof dtStr !== 'string') dtStr = String(dtStr);
    if (!dtStr.endsWith('Z') && !dtStr.includes('+') && !dtStr.includes('-')) {
        dtStr += 'Z';
    }
    return new Date(dtStr);
}

function setSlotDuration(val) {
    defaultDurationMinutes = parseInt(val) || 15;
    localStorage.setItem('timetrace_slot_duration', defaultDurationMinutes);
    if (calendar) {
        const durStr = `00:${String(defaultDurationMinutes).padStart(2,'0')}:00`;
        calendar.setOption('slotDuration', durStr);
        calendar.setOption('defaultTimedEventDuration', durStr);
    }
}

function getInitialScrollTime() {
    const now = new Date();
    let targetHour = now.getHours() - 1;
    if (targetHour < 0) targetHour = 0;
    return `${String(targetHour).padStart(2, '0')}:00:00`;
}

function getLocalTimezoneLabel() {
    const offsetMins = -new Date().getTimezoneOffset();
    const hours = Math.floor(Math.abs(offsetMins) / 60);
    const sign = offsetMins >= 0 ? '+' : '-';
    return `GMT${sign}${String(hours).padStart(2, '0')}`;
}

function injectTimezoneLabel() {
    setTimeout(() => {
        const cornerCell = document.querySelector('.fc-timegrid-axis-frame');
        if (cornerCell && !cornerCell.querySelector('.tz-header-label')) {
            cornerCell.innerHTML = `<div class="tz-header-label">${getLocalTimezoneLabel()}</div>`;
        }
    }, 50);
}

function scrollToCurrentTime() {
    if (!calendar) return;
    calendar.today();
    if (calendar.view.type !== 'dayGridMonth') {
        calendar.scrollToTime(getInitialScrollTime());
    }
}

function formatIsoLocal(dt) {
    if (!dt || isNaN(dt.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

// ==========================================
// ⚡ Idle Detector Killer Switch & Resolution
// ==========================================
async function toggleIdleSwitch() {
    const res = await fetch('/api/v1/idle/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const data = await res.json();
    idleDetectionEnabled = data.idle_detection_enabled;
    updateIdleSwitchUI();
}

function updateIdleSwitchUI() {
    const btn = document.getElementById('idle_killer_switch_btn');
    const label = document.getElementById('idle_switch_label');
    if (!btn || !label) return;

    if (idleDetectionEnabled) {
        label.innerText = '⚡ Idle Detector: ON';
        btn.className = 'bg-[#181a28] hover:bg-[#222536] text-amber-400 border border-amber-500/40 px-2.5 py-1 rounded font-bold transition flex items-center space-x-1';
    } else {
        label.innerText = '⏸️ Idle Detector: OFF';
        btn.className = 'bg-[#181a28] hover:bg-[#222536] text-slate-500 border border-slate-700 px-2.5 py-1 rounded font-bold transition flex items-center space-x-1';
    }
}

async function resolveIdleGap(option) {
    const retagInput = document.getElementById('idle_retag_input');
    const newTags = retagInput ? retagInput.value.strip() || '#general' : '#general';

    await fetch('/api/v1/idle/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option: option, new_tags: newTags })
    });

    const modal = document.getElementById('idle_resolution_modal');
    if (modal) modal.classList.add('hidden');

    fetchTimerStatus();
    if (calendar) calendar.refetchEvents();
}

// ==========================================
// 📅 Session & Task Modal Controllers
// ==========================================
function filterTaskDropdown(query) {
    const q = (query || "").toLowerCase().trim();
    const taskSelect = document.getElementById('session_modal_task_select');
    if (!taskSelect) return;

    const filtered = activeTasks.filter(t => 
        !q || 
        t.title.toLowerCase().includes(q) || 
        (t.description && t.description.toLowerCase().includes(q))
    );

    taskSelect.innerHTML = '<option value="">-- Independent Session --</option>' +
        filtered.map(t => `<option value="${t.id}">${t.title}</option>`).join('');

    if (q && filtered.length > 0) {
        taskSelect.selectedIndex = 1;
    }
}

function openEditSessionModal(sessionId) {
    const session = allSessions.find(s => String(s.id) === String(sessionId));
    if (!session) return;

    document.getElementById('edit_session_id').value = session.id;
    const titleEl = document.getElementById('session_modal_title');
    if (titleEl) titleEl.innerText = "Edit Session";

    const badge = document.getElementById('session_modal_type_badge');
    badge.innerText = "Logged Session";
    badge.className = "px-2 py-0.5 text-[10px] font-black uppercase rounded bg-purple-900/60 text-purple-300 border border-purple-700";

    document.getElementById('session_modal_start_now_btn').classList.add('hidden');
    const deleteBtn = document.getElementById('session_modal_delete_btn');
    if (deleteBtn) deleteBtn.classList.remove('hidden');

    const startDate = parseApiDateTime(session.start_time);
    const endDate = session.end_time ? parseApiDateTime(session.end_time) : new Date();

    document.getElementById('session_modal_start').value = formatIsoLocal(startDate);
    document.getElementById('session_modal_end').value = formatIsoLocal(endDate);

    document.getElementById('session_modal_task_search').value = "";
    filterTaskDropdown("");
    if (session.task_id) {
        document.getElementById('session_modal_task_select').value = session.task_id;
    } else {
        document.getElementById('session_modal_task_select').value = "";
    }

    document.getElementById('session_modal_tags').value = session.tags || "#";
    document.getElementById('session_modal_notes').value = session.notes || "";

    document.getElementById('session_modal').classList.remove('hidden');

    setTimeout(() => {
        const searchInput = document.getElementById('session_modal_task_search');
        if (searchInput) searchInput.focus();
    }, 50);
}

function openCreateSessionModal(startDate, endDate, taskId = null, taskTitle = "") {
    document.getElementById('edit_session_id').value = "";
    const titleEl = document.getElementById('session_modal_title');
    if (titleEl) titleEl.innerText = "Calendar Session Configuration";

    const deleteBtn = document.getElementById('session_modal_delete_btn');
    if (deleteBtn) deleteBtn.classList.add('hidden');

    const now = new Date();
    const badge = document.getElementById('session_modal_type_badge');
    const startNowBtn = document.getElementById('session_modal_start_now_btn');

    document.getElementById('session_modal_start').value = formatIsoLocal(startDate);
    document.getElementById('session_modal_end').value = formatIsoLocal(endDate);

    if (endDate <= now) {
        badge.innerText = "Logged Past Session";
        badge.className = "px-2 py-0.5 text-[10px] font-black uppercase rounded bg-blue-900/60 text-blue-300 border border-blue-700";
        startNowBtn.classList.add('hidden');
    } else if (startDate <= now && endDate > now) {
        badge.innerText = "Active / Present Slot";
        badge.className = "px-2 py-0.5 text-[10px] font-black uppercase rounded bg-emerald-900/60 text-emerald-300 border border-emerald-700";
        startNowBtn.classList.remove('hidden');
    } else {
        badge.innerText = "Planned Slot";
        badge.className = "px-2 py-0.5 text-[10px] font-black uppercase rounded bg-purple-900/60 text-purple-300 border border-purple-700";
        startNowBtn.classList.add('hidden');
    }

    document.getElementById('session_modal_task_search').value = "";
    filterTaskDropdown("");
    if (taskId) {
        document.getElementById('session_modal_task_select').value = taskId;
    }

    document.getElementById('session_modal_tags').value = "#";
    document.getElementById('session_modal_notes').value = taskTitle ? `Working on ${taskTitle}` : "";

    document.getElementById('session_modal').classList.remove('hidden');

    setTimeout(() => {
        const taskSearchInput = document.getElementById('session_modal_task_search');
        if (taskSearchInput) {
            taskSearchInput.focus();
            taskSearchInput.select();
        }
    }, 50);
}

function closeSessionModal() {
    const modal = document.getElementById('session_modal');
    if (modal) modal.classList.add('hidden');
}

async function saveSessionFromModal() {
    const sessionId = document.getElementById('edit_session_id').value;
    const taskIdVal = document.getElementById('session_modal_task_select').value;
    const startVal = document.getElementById('session_modal_start').value;
    const endVal = document.getElementById('session_modal_end').value;
    const tagsVal = document.getElementById('session_modal_tags').value;
    const notesVal = document.getElementById('session_modal_notes').value;

    if (!startVal || !endVal) return;

    const payload = {
        task_id: taskIdVal ? parseInt(taskIdVal) : null,
        start_time: new Date(startVal).toISOString(),
        end_time: new Date(endVal).toISOString(),
        tags: (tagsVal && tagsVal.trim() !== "#") ? tagsVal : "#general",
        notes: notesVal || ""
    };

    if (sessionId) {
        await fetch(`/api/v1/sessions/${sessionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } else {
        await fetch('/api/v1/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    closeSessionModal();
    if (calendar) calendar.refetchEvents();
}

async function deleteSessionFromModal() {
    const sessionId = document.getElementById('edit_session_id').value;
    if (!sessionId) return;

    if (confirm("Are you sure you want to delete this session log?")) {
        await fetch(`/api/v1/sessions/${sessionId}`, { method: 'DELETE' });
        closeSessionModal();
        if (calendar) calendar.refetchEvents();
    }
}

async function startTimerFromModal() {
    const taskIdVal = document.getElementById('session_modal_task_select').value;
    const tagsVal = document.getElementById('session_modal_tags').value;
    const notesVal = document.getElementById('session_modal_notes').value;

    await fetch('/api/v1/timer/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            task_id: taskIdVal ? parseInt(taskIdVal) : null,
            tags: (tagsVal && tagsVal.trim() !== "#") ? tagsVal : "#general",
            notes: notesVal || ""
        })
    });

    closeSessionModal();
    fetchTimerStatus();
}

async function handleCalendarEventUpdate(event) {
    const payload = {
        start_time: event.start.toISOString(),
        end_time: event.end ? event.end.toISOString() : event.start.toISOString()
    };
    await fetch(`/api/v1/sessions/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (calendar) calendar.refetchEvents();
}

function switchView(viewName) {
    if (!calendar) return;
    calendar.changeView(viewName);
    if (viewName !== 'dayGridMonth') {
        setTimeout(() => calendar.scrollToTime(getInitialScrollTime()), 50);
    }
}

function updateViewButtons(activeViewType) {
    const btnDay = document.getElementById('btn_view_day');
    const btnWeek = document.getElementById('btn_view_week');
    const btnMonth = document.getElementById('btn_view_month');

    const activeClass = "px-2.5 py-1 rounded border text-white font-bold bg-purple-600 border-purple-400 shadow-md";
    const inactiveClass = "px-2.5 py-1 rounded border text-slate-300 bg-[#181a28] hover:bg-[#222536] border-[#262938]";

    if (btnDay) btnDay.className = (activeViewType === 'timeGridDay') ? activeClass : inactiveClass;
    if (btnWeek) btnWeek.className = (activeViewType === 'timeGridWeek') ? activeClass : inactiveClass;
    if (btnMonth) btnMonth.className = (activeViewType === 'dayGridMonth') ? activeClass : inactiveClass;
}

// ==========================================
// 📡 Data Fetching & Sync Functions
// ==========================================
async function fetchCalendarEvents(fetchInfo, successCallback, failureCallback) {
    try {
        const res = await fetch(`/api/v1/sessions?start=${fetchInfo.start.toISOString()}&end=${fetchInfo.end.toISOString()}`);
        allSessions = await res.json();
        
        const events = allSessions.map(s => {
            const matchedTask = activeTasks.find(t => t.id === s.task_id);
            const color = matchedTask ? matchedTask.color : '#7c3aed';
            
            let titleParts = [];
            if (matchedTask && matchedTask.title) titleParts.push(matchedTask.title);
            if (s.notes) titleParts.push(s.notes);
            let mainTitle = titleParts.join(' - ');

            let finalTitle = mainTitle;
            if (s.tags) finalTitle = finalTitle ? `${finalTitle} ${s.tags}` : s.tags;
            if (!finalTitle) finalTitle = '#session';

            return {
                id: s.id,
                title: finalTitle,
                start: s.start_time,
                end: s.end_time || new Date().toISOString(),
                backgroundColor: color,
                borderColor: 'transparent'
            };
        });
        successCallback(events);
        fetchRangeTotals();
    } catch (err) { failureCallback(err); }
}

async function fetchTimerStatus() {
    try {
        const res = await fetch('/api/v1/timer/status');
        const data = await res.json();
        isRunning = data.is_running;
        idleDetectionEnabled = data.idle_detection_enabled;
        updateIdleSwitchUI();

        // Handle Frozen AFK Modal Popup
        if (data.is_frozen_idle && data.pending_idle_gap) {
            const idleModal = document.getElementById('idle_resolution_modal');
            const idleLabel = document.getElementById('idle_time_summary_label');
            if (idleModal && idleLabel) {
                const idleMins = Math.round((data.pending_idle_gap.idle_seconds || 600) / 60);
                idleLabel.innerText = `You were away for ${idleMins} mins.`;
                idleModal.classList.remove('hidden');
            }
        }

        const label = document.getElementById('timer_status_label');
        const btn = document.getElementById('toggle_btn');

        if (isRunning) {
            const mins = Math.floor(data.elapsed_seconds / 60);
            const secs = data.elapsed_seconds % 60;
            const timeStr = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
            const taskName = data.task_title || (data.tags || 'Task');
            
            if (label) label.innerText = `⏱️ ${timeStr} | ${taskName}`;
            if (btn) {
                btn.innerText = 'Stop';
                btn.className = 'bg-red-600 hover:bg-red-500 text-white font-medium px-3 py-1 rounded text-xs';
            }
            document.title = `⏱️ ${timeStr} - [${taskName}] ${data.tags}`;
        } else {
            if (label) label.innerText = data.is_frozen_idle ? '⏸️ Timer Frozen (AFK)' : 'Timer Idle';
            if (btn) {
                btn.innerText = 'Start Timer';
                btn.className = 'bg-purple-600 hover:bg-purple-500 text-white font-medium px-3 py-1 rounded text-xs';
            }
            document.title = data.is_frozen_idle ? '⚠️ AFK Detected - TimeTrace' : 'TimeTrace Dashboard';
        }
    } catch(e) {}
}

function setTaskFilter(filterName) {
    currentFilter = filterName;
    
    const tabAll = document.getElementById('filter_tab_all');
    const tabActive = document.getElementById('filter_tab_active');
    const tabDone = document.getElementById('filter_tab_done');
    
    const activeClass = "flex-1 py-1 text-[10px] rounded bg-purple-600 text-white font-bold";
    const inactiveClass = "flex-1 py-1 text-[10px] rounded bg-[#181a28] text-slate-400 hover:text-white";

    if (tabAll) tabAll.className = (filterName === 'all') ? activeClass : inactiveClass;
    if (tabActive) tabActive.className = (filterName === 'hide_completed') ? activeClass : inactiveClass;
    if (tabDone) tabDone.className = (filterName === 'completed') ? activeClass : inactiveClass;

    fetchTasks();
}

async function fetchTasks() {
    const res = await fetch(`/api/v1/tasks?status=${currentFilter}`);
    activeTasks = await res.json();

    const cardList = document.getElementById('task_card_list');
    const select = document.getElementById('timer_task_select');
    
    const countEl = document.getElementById('selected_tasks_count');
    if (countEl) countEl.innerText = `${activeTasks.length} tasks`;
    
    if (select) {
        select.innerHTML = '<option value="">-- Attach Task --</option>' + 
            activeTasks.map(t => `<option value="${t.id}">${t.title}</option>`).join('');
    }

    if (cardList) {
        if (activeTasks.length === 0) {
            cardList.innerHTML = '<div class="text-xs text-slate-500 text-center py-4">No tasks found.</div>';
        } else {
            cardList.innerHTML = activeTasks.map((t, idx) => {
                const color = t.color || defaultPalette[idx % defaultPalette.length];
                const prioLabel = (t.priority || '-').toUpperCase();
                return `
                    <div onclick="openEditTaskModal(${t.id})" data-task-id="${t.id}" data-task-title="${t.title}" data-task-color="${color}" style="background-color: ${color};" class="task-card p-3 rounded-lg shadow-md transition transform hover:-translate-y-0.5 hover:brightness-110 flex flex-col justify-between h-24 text-white">
                        <div>
                            <div class="font-black text-sm tracking-wide leading-snug">${t.title}</div>
                            <div class="text-[11px] opacity-80 truncate">${t.description || ''}</div>
                        </div>
                        <div class="flex justify-between items-center text-[10px] font-semibold opacity-90">
                            <span class="bg-black/20 px-1.5 py-0.5 rounded">${t.status}</span>
                            <span class="bg-black/30 px-1.5 py-0.5 rounded font-bold">${prioLabel}</span>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    fetchRangeTotals();
}

async function clearCompletedTasks() {
    if (confirm("Are you sure you want to delete all completed tasks?")) {
        await fetch('/api/v1/tasks/completed', { method: 'DELETE' });
        fetchTasks();
    }
}

function fetchRangeTotals() {
    if (!calendar) return;
    const viewType = calendar.view.type;
    let rangeLabel = "Week";
    if (viewType === 'timeGridDay') rangeLabel = "Day";
    if (viewType === 'dayGridMonth') rangeLabel = "Month";

    const labelEl = document.getElementById('range_breakdown_label');
    const headerEl = document.getElementById('range_total_header');
    if (labelEl) labelEl.innerText = `${rangeLabel} Breakdown`;
    if (headerEl) headerEl.innerText = `${rangeLabel} Total`;

    const viewStart = calendar.view.activeStart;
    const viewEnd = calendar.view.activeEnd;

    let taskHours = {};
    let tagHours = {};
    let grandTotalSecs = 0;

    const visibleSessions = allSessions.filter(s => {
        const start = new Date(s.start_time);
        return start >= viewStart && start < viewEnd;
    });

    visibleSessions.forEach(s => {
        const dur = s.duration_seconds || 0;
        grandTotalSecs += dur;

        const tid = s.task_id || 0;
        taskHours[tid] = (taskHours[tid] || 0) + dur;

        const tagStr = s.tags || '#general';
        const tags = tagStr.split(' ').filter(t => t.startsWith('#'));
        if (tags.length === 0) tags.push('#general');
        tags.forEach(tg => {
            tagHours[tg] = (tagHours[tg] || 0) + dur;
        });
    });

    const badgeEl = document.getElementById('weekly_total_badge');
    const sideEl = document.getElementById('side_total_hours');
    if (badgeEl) badgeEl.innerText = `${(grandTotalSecs / 3600).toFixed(1)}h`;
    if (sideEl) sideEl.innerText = `${(grandTotalSecs / 3600).toFixed(1)}h`;

    const activityList = document.getElementById('activity_totals_list');
    const sortedTags = Object.entries(tagHours).sort((a,b) => b[1] - a[1]);
    if (activityList) {
        if (sortedTags.length === 0) {
            activityList.innerHTML = '<div class="text-xs text-slate-500">No activities in this range.</div>';
        } else {
            activityList.innerHTML = sortedTags.map(([tag, secs]) => `
                <div class="bg-[#161824] border border-[#262938] p-2.5 rounded-lg flex justify-between items-center">
                    <span class="text-xs font-bold text-emerald-400">${tag}</span>
                    <span class="text-xs font-black text-white">${(secs / 3600).toFixed(1)}h</span>
                </div>
            `).join('');
        }
    }

    const totalsList = document.getElementById('weekly_totals_list');
    if (totalsList) {
        totalsList.innerHTML = activeTasks.map((t, idx) => {
            const color = t.color || defaultPalette[idx % defaultPalette.length];
            const hrs = ((taskHours[t.id] || 0) / 3600).toFixed(1);
            return `
                <div style="background-color: ${color};" class="p-2.5 rounded-lg shadow text-white flex justify-between items-center">
                    <span class="font-bold text-xs truncate">${t.title}</span>
                    <span class="text-sm font-black">${hrs}h</span>
                </div>
            `;
        }).join('');
    }
}

async function toggleTimer() {
    if (isRunning) {
        await fetch('/api/v1/timer/stop', { method: 'POST' });
        if (calendar) calendar.refetchEvents();
    } else {
        const taskId = document.getElementById('timer_task_select').value;
        await fetch('/api/v1/timer/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId ? parseInt(taskId) : null, tags: "#timetrace" })
        });
    }
    fetchTimerStatus();
}

function openNewTaskModal() {
    const nowIso = formatIsoLocal(new Date());
    document.getElementById('edit_task_id').value = '';
    document.getElementById('modal_task_title').innerText = 'Create Task Slot';
    document.getElementById('modal_input_title').value = '';
    document.getElementById('modal_input_desc').value = '';
    document.getElementById('modal_input_created').value = nowIso;
    document.getElementById('modal_input_priority').value = '-';
    document.getElementById('modal_input_status').value = 'in_progress';
    document.getElementById('modal_input_color').value = defaultPalette[activeTasks.length % defaultPalette.length];
    document.getElementById('modal_delete_btn').classList.add('hidden');
    document.getElementById('task_modal').classList.remove('hidden');
}

function openEditTaskModal(id) {
    const t = activeTasks.find(item => item.id === id);
    if (!t) return;
    document.getElementById('edit_task_id').value = t.id;
    document.getElementById('modal_task_title').innerText = 'Edit Task Slot';
    document.getElementById('modal_input_title').value = t.title;
    document.getElementById('modal_input_desc').value = t.description || '';
    document.getElementById('modal_input_created').value = t.created_at ? formatIsoLocal(parseApiDateTime(t.created_at)) : '';
    document.getElementById('modal_input_priority').value = t.priority || '-';
    document.getElementById('modal_input_status').value = t.status || 'in_progress';
    document.getElementById('modal_input_color').value = t.color || '#7c3aed';
    document.getElementById('modal_delete_btn').classList.remove('hidden');
    document.getElementById('task_modal').classList.remove('hidden');
}

function closeTaskModal() {
    const modal = document.getElementById('task_modal');
    if (modal) modal.classList.add('hidden');
}

async function saveTask() {
    const id = document.getElementById('edit_task_id').value;
    const createdInput = document.getElementById('modal_input_created').value;
    const payload = {
        title: document.getElementById('modal_input_title').value,
        description: document.getElementById('modal_input_desc').value,
        priority: document.getElementById('modal_input_priority').value,
        status: document.getElementById('modal_input_status').value,
        color: document.getElementById('modal_input_color').value
    };

    if (createdInput) {
        payload.created_at = new Date(createdInput).toISOString();
    }

    if (!payload.title) return;

    if (id) {
        await fetch(`/api/v1/tasks/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } else {
        await fetch('/api/v1/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }
    closeTaskModal();
    fetchTasks();
    if (calendar) calendar.refetchEvents();
}

async function deleteTask() {
    const id = document.getElementById('edit_task_id').value;
    if (!id) return;
    if (confirm("Are you sure you want to delete this task slot?")) {
        await fetch(`/api/v1/tasks/${id}`, { method: 'DELETE' });
        closeTaskModal();
        fetchTasks();
        if (calendar) calendar.refetchEvents();
    }
}

function toggleSidebar(id) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden');
}
