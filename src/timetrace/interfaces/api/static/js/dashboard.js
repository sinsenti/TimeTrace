/**
 * Dashboard Entry Orchestrator & FullCalendar Drag-and-Drop Handler
 */

let calendar;
let activeTasks = [];
let allSessions = [];
let currentFilter = 'all';

document.addEventListener('DOMContentLoaded', async function() {
    const userSettings = getUserSettings();

    // Ensure allTasksMap is fully loaded before drawing calendar to prevent "#session" titles
    if (typeof fetchAllTasksRegistry === 'function') {
        await fetchAllTasksRegistry();
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

                const displayTitle = taskTitle || notes || '#session';
                const displayDesc = taskTitle ? notes : '';
                const showTags = !isMonthView && Boolean(tags);

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
                    
                    const startTime = info.event.start;
                    const endTime = new Date(startTime.getTime() + estMins * 60 * 1000);

                    info.event.remove();

                    const targetTask = (taskId && typeof allTasksMap !== 'undefined') ? allTasksMap[taskId] : null;
                    const defaultTags = (targetTask && targetTask.tags) ? targetTask.tags : "#general";

                    const payload = {
                        task_id: taskId ? parseInt(taskId) : null,
                        start_time: startTime.toISOString(),
                        end_time: endTime.toISOString(),
                        tags: defaultTags,
                        notes: taskTitle ? `Working on ${taskTitle}` : ""
                    };

                    await api.post('/sessions', payload);

                    if (taskId) {
                        try { await api.put(`/tasks/${taskId}`, { status: "Scheduled" }); } catch(e) {}
                    }

                    if (calendar) calendar.refetchEvents();
                    if (typeof fetchTasks === 'function') fetchTasks();
                    if (typeof loadKanbanBoard === 'function') loadKanbanBoard();
                } catch (err) {
                    console.error("Failed to create session from dropped task:", err);
                    alert("Failed to create session from task: " + (err.message || err));
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

                return {
                    title: card.getAttribute('data-task-title') || '',
                    backgroundColor: card.getAttribute('data-task-color') || '#7c3aed',
                    duration: { minutes: estMins },
                    extendedProps: {
                        taskId: rawId ? parseInt(rawId) : null,
                        estimatedMinutes: estMins
                    }
                };
            }
        });
    }

    setupModalKeyboardListeners();
    setupVimKeyboardListeners();

    await applyUserSettings(userSettings, true);

    if (userSettings.autoScrollNow) {
        scrollToCurrentTime();
    }

    fetchTasks();
});

async function fetchCalendarEvents(info, successCallback, failureCallback) {
    try {
        if (typeof fetchAllTasksRegistry === 'function' && (typeof allTasksMap === 'undefined' || Object.keys(allTasksMap).length === 0)) {
            await fetchAllTasksRegistry();
        }

        const startIso = info.start.toISOString();
        const endIso = info.end.toISOString();
        const sessions = await api.get(`/sessions?start=${startIso}&end=${endIso}`) || [];
        allSessions = sessions;

        const events = sessions.map(s => {
            const matchedTask = (typeof allTasksMap !== 'undefined' && allTasksMap) ? allTasksMap[s.task_id] : null;
            const taskTitle = matchedTask ? matchedTask.title : '';
            const taskColor = matchedTask ? getTaskColor(matchedTask) : getTagColor(s.tags || '#general');

            return {
                id: String(s.id),
                title: taskTitle || s.notes || s.tags || 'Session',
                start: s.start_time,
                end: s.end_time,
                backgroundColor: taskColor,
                borderColor: taskColor,
                extendedProps: {
                    taskId: s.task_id,
                    taskTitle: taskTitle,
                    notes: s.notes || '',
                    tags: s.tags || '',
                    reviewSkipped: s.review_skipped
                }
            };
        });

        successCallback(events);
        fetchRangeTotals();
    } catch (err) {
        console.error("Error fetching calendar events:", err);
        failureCallback(err);
    }
}

async function handleCalendarEventUpdate(event) {
    try {
        const payload = {
            start_time: event.start.toISOString(),
            end_time: event.end ? event.end.toISOString() : new Date(event.start.getTime() + 15 * 60000).toISOString()
        };
        await api.put(`/sessions/${event.id}`, payload);
        if (calendar) calendar.refetchEvents();
    } catch (err) {
        console.error("Failed to update event times:", err);
        if (calendar) calendar.refetchEvents();
    }
}

function switchView(viewName) {
    if (!calendar) return;
    calendar.changeView(viewName);
    updateViewButtons(viewName);
}

function updateViewButtons(activeView) {
    const viewButtons = {
        'timeGridDay': 'btn_view_day',
        'timeGridThreeDay': 'btn_view_three_day',
        'timeGridWeek': 'btn_view_week',
        'dayGridMonth': 'btn_view_month'
    };

    Object.entries(viewButtons).forEach(([view, btnId]) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        if (view === activeView) {
            btn.className = "h-6 px-2 rounded font-bold bg-purple-600 text-white text-[11px]";
        } else {
            btn.className = "h-6 px-2 rounded text-slate-300 hover:text-white text-[11px]";
        }
    });
}

function scrollToCurrentTime() {
    if (!calendar) return;
    calendar.today();
    const now = new Date();
    let targetHour = Math.max(0, now.getHours() - 1);
    const timeStr = `${String(targetHour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
    calendar.scrollToTime(timeStr);
}
