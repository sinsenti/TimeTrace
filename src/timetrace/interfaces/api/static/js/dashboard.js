/**
 * Dashboard Entry Orchestrator & FullCalendar Drag-and-Drop Handler
 */

let calendar;
let activeTasks = [];
let allSessions = [];
let currentFilter = 'all';

document.addEventListener('DOMContentLoaded', async function() {
    const userSettings = getUserSettings();

    if (typeof fetchAllTasksRegistry === 'function') {
        await fetchAllTasksRegistry();
    }

    const seedParams = new URLSearchParams(window.location.search);
    const seedTag = seedParams.get('tag');
    const seedTask = seedParams.get('task');
    if (typeof breakdownFilter !== 'undefined') {
        if (seedTag) {
            breakdownFilter = { type: 'tag', value: seedTag };
        } else if (seedTask) {
            breakdownFilter = { type: 'task', value: seedTask };
        }
    }

    const durationSelect = document.getElementById('config_slot_duration');
    if (durationSelect) durationSelect.value = userSettings.slotDuration;

    const calendarEl = document.getElementById('calendar');
    if (calendarEl) {
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: userSettings.defaultView === 'auto' ? (userSettings.lastSelectedView || 'timeGridWeek') : userSettings.defaultView,
            firstDay: userSettings.firstDayOfWeek,
            height: '100%',
            headerToolbar: false,
            slotMinTime: "00:00:00",
            slotMaxTime: "24:00:00",
            slotDuration: `00:${String(userSettings.slotDuration === 'auto' ? (userSettings.lastSelectedSlot || 15) : userSettings.slotDuration).padStart(2,'0')}:00`,
            scrollTime: getInitialScrollTime(),
            scrollTimeReset: false,
            nowIndicator: true,
            editable: true,
            selectable: true,
            unselectAuto: false,
            unselectCancel: '#session_modal, #task_modal, #subtask_modal, #custom_filter_modal, #settings_modal, .task-suggestion-item, .tag-suggestion-item',
            selectMirror: true,
            droppable: true,
            defaultTimedEventDuration: `00:15:00`,
            views: {
                timeGridThreeDay: {
                    type: 'timeGrid',
                    duration: { days: 3 },
                    buttonText: '3 Day',
                    visibleRange: function(currentDate) {
                        const start = new Date(currentDate);
                        start.setDate(start.getDate() - 1);
                        const end = new Date(currentDate);
                        end.setDate(end.getDate() + 2);
                        return { start: start, end: end };
                    }
                }
            },
            events: fetchCalendarEvents,

            eventContent: function(arg) {
                const props = arg.event.extendedProps || {};
                const taskTitle = props.taskTitle || '';
                const notes = props.notes || '';
                const tags = props.tags || '';
                const isMonthView = arg.view.type === 'dayGridMonth';

                let displayTitle = '';
                let displayDesc = '';
                let showTags = false;

                if (taskTitle) {
                    displayTitle = taskTitle;
                    displayDesc = notes;
                    showTags = !isMonthView && Boolean(tags);
                } else {
                    if (tags && notes) {
                        displayTitle = tags;
                        displayDesc = notes;
                        showTags = false;
                    } else if (tags) {
                        displayTitle = tags;
                        displayDesc = '';
                        showTags = false;
                    } else if (notes) {
                        displayTitle = notes;
                        displayDesc = '';
                        showTags = false;
                    } else {
                        displayTitle = 'Session';
                        displayDesc = '';
                        showTags = false;
                    }
                }

                return {
                    html: `
                        <div class="fc-event-custom flex flex-col h-full w-full overflow-hidden leading-tight p-0.5 text-white">
                            <div class="font-black text-[11px] truncate shrink-0">${displayTitle}</div>
                            ${displayDesc ? `<div class="text-[10px] opacity-85 overflow-hidden line-clamp-2 shrink-0">${displayDesc}</div>` : ''}
                            ${showTags ? `<div class="text-[9px] font-mono text-purple-200 opacity-80 truncate shrink-0 mt-auto">${tags}</div>` : ''}
                        </div>
                    `
                };
            },

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
                if (typeof suppressModalOnSelect !== 'undefined' && suppressModalOnSelect) return;
                cursorStart = selectionInfo.start;
                cursorEnd = selectionInfo.end;
                openCreateSessionModal(selectionInfo.start, selectionInfo.end);
            },

            eventDrop: async function(info) { await handleCalendarEventUpdate(info.event); },
            
            eventResize: async function(info) {
                await handleCalendarEventUpdate(info.event);
            },
            
            eventClick: function(info) {
                openEditSessionModal(info.event.id);
            },

            eventReceive: async function(info) {
                try {
                    const taskTitle = info.event.title;
                    const taskId = info.event.extendedProps ? info.event.extendedProps.taskId : null;
                    const estMins = info.event.extendedProps && info.event.extendedProps.estimatedMinutes ? parseInt(info.event.extendedProps.estimatedMinutes) : 15;
                    const sessionMins = estMins > 120 ? 30 : estMins;
                    
                    const startTime = info.event.start;
                    const endTime = new Date(startTime.getTime() + sessionMins * 60 * 1000);

                    info.event.remove();

                    const targetTask = (taskId && typeof allTasksMap !== 'undefined') ? allTasksMap[taskId] : null;
                    const defaultTags = (targetTask && targetTask.tags) ? targetTask.tags : "";

                    const payload = {
                        task_id: taskId ? taskId : null,
                        start_time: startTime.toISOString(),
                        end_time: endTime.toISOString(),
                        tags: defaultTags,
                        notes: ""
                    };

                    const createdSession = await api.post('/sessions', payload);

                    if (createdSession) {
                        if (typeof allSessions !== 'undefined' && Array.isArray(allSessions)) {
                            allSessions.push(createdSession);
                        }
                        if (calendar && typeof formatCalEventFromSession === 'function') {
                            calendar.addEvent(formatCalEventFromSession(createdSession));
                        }
                    }

                    if (taskId) {
                        const isOngoing = targetTask && (targetTask.status || '').toLowerCase() === 'ongoing';
                        if (!isOngoing) {
                            try { await api.put(`/api/tasks/${taskId}`, { status: "Scheduled" }); } catch(e) {}
                        }
                    }

                    if (typeof fetchTasks === 'function') fetchTasks();
                    if (typeof loadKanbanBoard === 'function') loadKanbanBoard();
                    if (typeof fetchRangeTotals === 'function') fetchRangeTotals();
                } catch (err) {
                    console.error("Failed to create session from dropped task:", err);
                    alert("Failed to create session from task: " + (err.message || err));
                    if (calendar) calendar.refetchEvents();
                }
            },

            datesSet: function(info) {
                const titleEl = document.getElementById('calendar_range_title');
                if (titleEl) titleEl.innerText = info.view.title;
                updateViewButtons(info.view.type);
                fetchRangeTotals();
                injectTimezoneLabel();

                const settings = typeof getUserSettings === 'function' ? getUserSettings() : null;
                if (settings && settings.lastSelectedView !== info.view.type) {
                    settings.lastSelectedView = info.view.type;
                    if (typeof saveUserSettings === 'function') saveUserSettings(settings);
                }
            }
        });
        calendar.render();

        const urlParams = new URLSearchParams(window.location.search);
        const targetDate = urlParams.get('date');
        if (targetDate) {
            calendar.gotoDate(targetDate);
        }
    }

    const taskCardList = document.getElementById('task_card_list');
    if (taskCardList && typeof FullCalendar !== 'undefined' && FullCalendar.Draggable) {
        new FullCalendar.Draggable(taskCardList, {
            itemSelector: '.task-card',
            eventData: function(eventEl) {
                const card = eventEl.closest('.task-card') || eventEl;
                const rawId = card.getAttribute('data-task-id');
                const rawEst = card.getAttribute('data-task-est');
                const estMins = rawEst ? parseInt(rawEst) : 15;
                const sessionMins = estMins > 120 ? 30 : estMins;

                return {
                    title: card.getAttribute('data-task-title') || '',
                    backgroundColor: card.getAttribute('data-task-color') || '#7c3aed',
                    duration: { minutes: sessionMins },
                    extendedProps: {
                        taskId: rawId ? rawId : null,
                        estimatedMinutes: estMins
                    }
                };
            }
        });
    }

    setupModalKeyboardListeners();
    setupVimKeyboardListeners();
    setupExportModalKeyboardShortcuts();

    await applyUserSettings(userSettings, true);

    if (userSettings.autoScrollNow && !window.location.search.includes('date=')) {
        scrollToCurrentTime();
    }

    fetchTasks();
});

/* ----------------------------------------------------
 * Export Modal Functions & Keyboard Listeners
 * ---------------------------------------------------- */

function openExportModal() {
    const modal = document.getElementById('export_modal');
    if (modal) {
        modal.classList.remove('hidden');
        const sel = document.getElementById('export_mode_select');
        if (sel) toggleExportDateInputs(sel.value);
    }
}

function closeExportModal() {
    const modal = document.getElementById('export_modal');
    if (modal) modal.classList.add('hidden');
}

function toggleExportDateInputs(modeVal) {
    const group = document.getElementById('export_date_range_group');
    if (!group) return;
    if (modeVal === 'all_date_range') {
        group.classList.remove('hidden');
    } else {
        group.classList.add('hidden');
    }
}

function triggerExportDownload() {
    const sel = document.getElementById('export_mode_select');
    const mode = sel ? sel.value : 'sessions';
    let url = `/api/agenda/export?mode=${encodeURIComponent(mode)}`;

    if (mode === 'all_date_range') {
        const startVal = document.getElementById('export_start_date') ? document.getElementById('export_start_date').value.trim() : '';
        const endVal = document.getElementById('export_end_date') ? document.getElementById('export_end_date').value.trim() : '';

        if (startVal) url += `&start_date=${encodeURIComponent(startVal)}`;
        if (endVal) url += `&end_date=${encodeURIComponent(endVal)}`;
    }

    window.location.href = url;
    closeExportModal();
}

function setupExportModalKeyboardShortcuts() {
    const modal = document.getElementById('export_modal');
    if (!modal) return;

    modal.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            triggerExportDownload();
        } else if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            e.stopPropagation();
            closeExportModal();
        }
    });
}
