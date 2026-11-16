/**
 * Dashboard Entry Orchestrator & FullCalendar Drag-and-Drop Handler
 */

let calendar;
let activeTasks = [];
let allSessions = [];
let currentFilter = 'all';

async function resolveCalendarDropTask(taskId, taskTitle) {
    if (!taskId) return null;

    if (typeof fetchAllTasksRegistry === 'function') await fetchAllTasksRegistry(true);

    const task = taskKnowledge.get(taskId);
    if (task) return task;

    if (taskTitle) {
        return taskKnowledge.rememberFallback({ id: taskId, title: taskTitle });
    }

    return null;
}

document.addEventListener('DOMContentLoaded', async function() {
    if (typeof fetchAllTasksRegistry === 'function') {
        await fetchAllTasksRegistry();
    }

    const userSettings = getUserSettings();
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

    let initialCalendarContext = true;
    const calendarEl = document.getElementById('calendar');
    if (calendarEl) {
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: SUPPORTED_CALENDAR_VIEWS.includes(seedParams.get('view'))
                ? seedParams.get('view') : userSettings.defaultView === 'auto' ? userSettings.lastSelectedView : userSettings.defaultView,
            initialDate: seedParams.get('date') || undefined,
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
                const eventTextColor = getContrastingTextColor(arg.event.backgroundColor || '#7c3aed');

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
                        <div style="color: ${eventTextColor};" class="fc-event-custom flex flex-col h-full w-full overflow-hidden leading-tight p-0.5">
                            <div class="font-semibold text-[11px] truncate shrink-0">${escapeHtml(displayTitle)}</div>
                            ${displayDesc ? `<div class="text-[10px] overflow-hidden line-clamp-2 shrink-0">${escapeHtml(displayDesc)}</div>` : ''}
                            ${showTags ? `<div class="text-[9px] font-mono truncate shrink-0 mt-auto">${escapeHtml(tags)}</div>` : ''}
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

            eventDrop: async function(info) { await handleCalendarEventUpdate(info.event, 'move', info); },

            eventResize: async function(info) {
                await handleCalendarEventUpdate(info.event, 'resize', info);
            },
            
            eventClick: function(info) {
                openEditSessionModal(info.event.id, info.el);
            },

            eventReceive: async function(info) {
                try {
                    const taskTitle = info.event.title;
                    const taskId = info.event.extendedProps ? info.event.extendedProps.taskId : null;
                    const targetTask = await resolveCalendarDropTask(taskId, taskTitle);
                    const estMins = info.event.extendedProps && info.event.extendedProps.estimatedMinutes ? parseInt(info.event.extendedProps.estimatedMinutes) : 15;
                    const sessionMins = estMins > 120 ? 30 : estMins;
                    
                    const startTime = info.event.start;
                    const endTime = new Date(startTime.getTime() + sessionMins * 60 * 1000);

                    info.event.remove();

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
                        if (calendar) calendar.refetchEvents();
                    }

                    if (taskId) {
                        const isOngoing = targetTask && (targetTask.status || '').toLowerCase() === 'ongoing';
                        if (!isOngoing) {
                            try {
                                await api.put(`/api/tasks/${taskId}`, { status: "Scheduled" });
                                await taskKnowledge.changed();
                            } catch(e) {}
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
                syncCalendarContext(initialCalendarContext);
                initialCalendarContext = false;

                const settings = typeof getUserSettings === 'function' ? getUserSettings() : null;
                if (settings && settings.lastSelectedView !== info.view.type) {
                    settings.lastSelectedView = info.view.type;
                    if (typeof saveUserSettings === 'function') saveUserSettings(settings);
                }
            }
        });
        calendar.render();

        window.addEventListener('popstate', restoreCalendarContext);
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

    await applyUserSettings(getUserSettings(), true);

    if (getUserSettings().autoScrollNow && !seedParams.has('date')) {
        scrollToCurrentTime();
    }

    fetchTasks();
});

/* ----------------------------------------------------
 * Export Modal Functions & Keyboard Listeners
 * ---------------------------------------------------- */

const exportWorkflow = { generation: 0, pending: false, preview: null, launcher: null };

function exportSelection() {
    const mode = document.getElementById('export_mode_select').value;
    const start = mode === 'all_date_range' ? document.getElementById('export_start_date').value.trim() : '';
    const end = mode === 'all_date_range' ? document.getElementById('export_end_date').value.trim() : '';
    return { mode, start, end, key: JSON.stringify([mode, start, end]) };
}

function exportIsCurrent(generation, selection) {
    return generation === exportWorkflow.generation &&
        !document.getElementById('export_modal').classList.contains('hidden') && selection.key === exportSelection().key;
}

function updateExportActions() {
    const preview = exportWorkflow.preview;
    const ready = preview && exportIsCurrent(preview.generation, preview.selection) && !exportWorkflow.pending;
    document.getElementById('export_generate').disabled = exportWorkflow.pending;
    document.getElementById('export_copy').disabled = !ready || !!preview.copyPending;
    document.getElementById('export_download').disabled = !ready;
    document.getElementById('export_preview').setAttribute('aria-busy', String(exportWorkflow.pending));
}

function exportInputsChanged() {
    exportWorkflow.generation++;
    exportWorkflow.pending = false;
    exportWorkflow.preview = null;
    document.getElementById('export_preview').value = '';
    document.getElementById('export_provenance').textContent = '';
    document.getElementById('export_status').textContent = 'Selection changed. Generate a current preview before Copy or Download.';
    updateExportActions();
}

function openExportModal() {
    const modal = document.getElementById('export_modal');
    if (!modal || !modal.classList.contains('hidden')) return;
    exportWorkflow.launcher = document.activeElement;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('export_mode_select').focus();
    toggleExportDateInputs(document.getElementById('export_mode_select').value);
}

function closeExportModal() {
    const modal = document.getElementById('export_modal');
    if (!modal || modal.classList.contains('hidden')) return;
    const restore = modal.contains(document.activeElement);
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    exportWorkflow.generation++;
    exportWorkflow.pending = false;
    exportWorkflow.preview = null;
    updateExportActions();
    const launcher = exportWorkflow.launcher;
    const otherDialog = Array.from(document.querySelectorAll('[role="dialog"]')).some(el =>
        el !== modal && !el.classList.contains('hidden') && el.getAttribute('aria-hidden') !== 'true' && !el.contains(launcher));
    if (!restore || otherDialog) return;
    if (launcher?.isConnected && !launcher.disabled) launcher.focus();
    else {
        const fallback = document.getElementById('calendar');
        if (fallback) { fallback.setAttribute('tabindex', '-1'); fallback.focus(); }
    }
}

function toggleExportDateInputs(modeVal) {
    const group = document.getElementById('export_date_range_group');
    if (!group) return;
    if (modeVal === 'all_date_range') group.classList.remove('hidden');
    else group.classList.add('hidden');
    exportInputsChanged();
    if (!document.getElementById('export_modal').classList.contains('hidden')) generateExportPreview();
}

async function generateExportPreview() {
    if (exportWorkflow.pending || document.getElementById('export_modal').classList.contains('hidden')) return;
    exportInputsChanged();
    const selection = exportSelection();
    const status = document.getElementById('export_status');
    if (selection.mode === 'all_date_range') {
        const inputs = ['export_start_date', 'export_end_date'].map(id => document.getElementById(id));
        if (inputs.some(input => !input.checkValidity()) || (selection.start && selection.end && selection.start > selection.end)) {
            status.textContent = 'Use valid YYYY-MM-DD dates; Start must not be after End. Either boundary may be blank.';
            return;
        }
    }
    const generation = exportWorkflow.generation;
    const params = new URLSearchParams({ mode: selection.mode });
    if (selection.start) params.set('start_date', selection.start);
    if (selection.end) params.set('end_date', selection.end);
    exportWorkflow.pending = true;
    status.textContent = 'Loading Markdown preview…';
    updateExportActions();
    try {
        const content = await api.get(`/api/agenda/export?${params}`);
        if (!exportIsCurrent(generation, selection)) return;
        if (typeof content !== 'string') throw new Error('Expected Markdown text from the export endpoint.');
        document.getElementById('export_preview').value = content;
        if (content.length) {
            exportWorkflow.preview = { generation, selection, content, filename: `timetrace_export_${selection.mode}.md` };
            const label = document.getElementById('export_mode_select').selectedOptions[0].textContent;
            document.getElementById('export_provenance').textContent = `Current preview: ${label}${selection.mode === 'all_date_range' ? ` · UTC session starts ${selection.start || 'any start'} through ${selection.end || 'any end'} (inclusive)` : ''} · timetrace_export_${selection.mode}.md`;
            status.textContent = 'Preview ready. Copy or Download explicitly; generating does not export a file.';
        } else status.textContent = 'The endpoint returned empty Markdown. Generate preview to retry this read.';
    } catch (error) {
        if (exportIsCurrent(generation, selection)) status.textContent = `Could not generate preview: ${error.message}. Generate preview retries this read only.`;
    } finally {
        if (exportIsCurrent(generation, selection)) {
            exportWorkflow.pending = false;
            updateExportActions();
        }
    }
}

function setupExportModalKeyboardShortcuts() {
    const modal = document.getElementById('export_modal');
    if (!modal) return;
    modal.addEventListener('keydown', function(e) {
        if (modal.classList.contains('hidden')) return;
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault(); e.stopPropagation(); triggerExportDownload();
        } else if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault(); e.stopPropagation(); closeExportModal();
        } else if (e.key === 'Tab') {
            const controls = Array.from(modal.querySelectorAll('button, select, input, textarea, [tabindex]'))
                .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
            const first = controls[0], last = controls[controls.length - 1];
            if (e.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) {
                e.preventDefault(); last?.focus();
            } else if (!e.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) {
                e.preventDefault(); first?.focus();
            }
        }
    });
}


async function copyExportPreview() {
    const preview = exportWorkflow.preview;
    const status = document.getElementById('export_status');
    if (!preview || !exportIsCurrent(preview.generation, preview.selection) || exportWorkflow.pending || preview.copyPending) return;
    preview.copyPending = true;
    status.textContent = 'Copying current preview…';
    updateExportActions();
    try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable in this browser context');
        await navigator.clipboard.writeText(preview.content);
        if (exportIsCurrent(preview.generation, preview.selection)) status.textContent = 'Copied current Markdown preview to clipboard.';
    } catch (error) {
        if (exportIsCurrent(preview.generation, preview.selection)) status.textContent = `Copy failed: ${error.message}. Preview retained; retry Copy or Download.`;
    } finally {
        preview.copyPending = false;
        if (exportIsCurrent(preview.generation, preview.selection)) updateExportActions();
    }
}

function triggerExportDownload() {
    const preview = exportWorkflow.preview;
    const status = document.getElementById('export_status');
    if (!preview || !exportIsCurrent(preview.generation, preview.selection) || exportWorkflow.pending) {
        status.textContent = exportWorkflow.pending ? 'Preview is still loading. Wait before Download.' : 'Generate a current preview before Download.';
        return;
    }
    let url;
    const link = document.createElement('a');
    try {
        url = URL.createObjectURL(new Blob([preview.content], {type: 'text/markdown;charset=utf-8'}));
        link.href = url;
        link.download = preview.filename;
        document.body.appendChild(link);
        link.click();
        status.textContent = `Download requested: ${preview.filename}. Check your browser downloads; saving is controlled by your browser.`;
    } catch (error) {
        status.textContent = `Download could not be requested: ${error.message}. Preview retained; retry Download.`;
    } finally {
        link.remove();
        if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}
