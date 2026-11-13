/**
 * TimeTrace Dashboard Sidebar Manager
 */

const STORAGE_STATUS_FILTER_KEY = 'timetrace_dashboard_status_filter';
const STORAGE_VISIBLE_TABS_KEY = 'timetrace_dashboard_visible_sidebar_tabs';

function getCurrentStatusFilter() {
    if (typeof activeCustomFilter !== 'undefined') return activeCustomFilter.status || 'all';
    try { return localStorage.getItem(STORAGE_STATUS_FILTER_KEY) || 'all'; } catch { return 'all'; }
}
const defaultSidebarTabs = ['all', 'hide_completed', 'To Do', 'Ongoing', 'Scheduled', 'Done', 'Backlog'];
let visibleSidebarTabs;
try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_VISIBLE_TABS_KEY) || 'null');
    visibleSidebarTabs = Array.isArray(saved) ? [...new Set(saved.filter(value => typeof value === 'string'))] : [...defaultSidebarTabs];
} catch { visibleSidebarTabs = [...defaultSidebarTabs]; }
let sidebarTabsReadVersion = 0;
let sidebarConfigReadVersion = 0;
let sidebarConfigOpen = false;
let sidebarConfigSortable = null;
let sidebarConfigLauncher = null;
let sidebarTaskReadVersion = 0;

function sidebarFeedback(id, message, retry) {
    const element = document.getElementById(id);
    if (!element) return;
    element.replaceChildren();
    element.textContent = message;
    if (retry) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Retry'; button.className = 'ml-2 underline';
        button.addEventListener('click', retry); element.append(button);
    }
}
function sidebarAvailableTabs(statuses) {
    const names = Array.isArray(statuses) ? statuses.filter(s => s && typeof s.name === 'string').map(s => s.name) : [];
    return [...new Set(['all', 'hide_completed', ...names])].map(id => ({ id, label: id === 'all' ? 'All' : id === 'hide_completed' ? 'Active' : id }));
}
document.addEventListener('DOMContentLoaded', () => { initSidebarResizers(); renderDynamicStatusTabs(); });
function setTaskFilter(filterName) {
    if (typeof activeCustomFilter !== 'undefined') {
        activeCustomFilter.status = filterName;
        activeCustomFilter.isActive = Boolean(activeCustomFilter.query || activeCustomFilter.status !== 'all' || activeCustomFilter.category !== 'all' || activeCustomFilter.estOp || activeCustomFilter.priority !== 'all');
        if (typeof saveCustomFilterState === 'function') saveCustomFilterState();
        if (typeof updateFilterButtonIndicators === 'function') updateFilterButtonIndicators();
    } else {
        try { localStorage.setItem(STORAGE_STATUS_FILTER_KEY, filterName); }
        catch { sidebarFeedback('sidebar_status_feedback', 'Status selection could not be saved on this device.'); }
    }
    renderDynamicStatusTabs(); fetchTasks();
}
async function renderDynamicStatusTabs() {
    const container = document.getElementById('sidebar_status_tabs');
    if (!container) return;
    const version = ++sidebarTabsReadVersion;
    try {
        const statuses = await api.get('/api/tasks/statuses');
        if (!Array.isArray(statuses)) throw new Error('Invalid status response');
        if (version !== sidebarTabsReadVersion) return;
        const available = sidebarAvailableTabs(statuses);
        container.replaceChildren();
        visibleSidebarTabs.forEach(id => {
            const tab = available.find(t => t.id === id);
            if (!tab) return;
            const button = document.createElement('button');
            button.type = 'button'; button.textContent = tab.label;
            const selected = getCurrentStatusFilter().toLowerCase() === id.toLowerCase();
            button.className = selected ? 'px-2 py-0.5 text-[10px] rounded bg-purple-600 text-white font-bold whitespace-nowrap' : 'px-2 py-0.5 text-[10px] rounded bg-[var(--bg-card)] text-slate-400 whitespace-nowrap';
            button.setAttribute('aria-pressed', String(selected));
            button.addEventListener('click', () => setTaskFilter(id)); container.append(button);
        });
        sidebarFeedback('sidebar_status_feedback', !visibleSidebarTabs.length ? 'No status tabs selected. Use Tabs to choose tabs.' :
            !container.children.length ? 'Selected tabs are unavailable and retained. Use Tabs to configure.' : '');
    } catch {
        if (version === sidebarTabsReadVersion) sidebarFeedback('sidebar_status_feedback', 'Status tabs could not be refreshed.', renderDynamicStatusTabs);
    }
}
function renderSidebarTabConfig(statuses) {
    const list = document.getElementById('sidebar_tab_config_list');
    if (!list) return;
    sidebarConfigSortable?.destroy(); sidebarConfigSortable = null;
    const available = sidebarAvailableTabs(statuses);
    const ordered = [...visibleSidebarTabs.map(id => ({ id, label: available.find(t => t.id === id)?.label || `${id} (unavailable; retained)`, checked: true })), ...available.filter(t => !visibleSidebarTabs.includes(t.id)).map(t => ({ ...t, checked: false }))];
    list.replaceChildren();
    ordered.forEach(tab => {
        const row = document.createElement('div');
        row.className = 'sidebar-tab-row flex items-center gap-2 p-2 rounded-lg border border-[var(--border-muted)]'; row.setAttribute('data-tab-id', tab.id);
        const label = document.createElement('label'); label.className = 'flex items-center gap-2 flex-1 min-w-0';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = tab.checked;
        checkbox.addEventListener('change', updateVisibleTabsFromDOM);
        const text = document.createElement('span'); text.textContent = tab.label; text.className = 'text-xs break-words';
        label.append(checkbox, text); row.append(label);
        for (const [direction, title] of [['up', 'Move up'], ['down', 'Move down']]) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = title;
            button.className = 'text-xs border rounded p-1'; button.setAttribute('aria-label', `${title}: ${tab.label}`);
            button.addEventListener('click', () => {
                if (direction === 'up' && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
                if (direction === 'down' && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
                updateVisibleTabsFromDOM(); button.focus();
            }); row.append(button);
        }
        list.append(row);
    });
    if (typeof Sortable !== 'undefined') sidebarConfigSortable = Sortable.create(list, { animation: 150, ghostClass: 'sortable-ghost', filter: 'input, button', preventOnFilter: false, onEnd: updateVisibleTabsFromDOM });
}
async function openSidebarTabsConfigModal() {
    const modal = document.getElementById('sidebar_tab_config_modal');
    if (!modal) return;
    if (!sidebarConfigOpen) sidebarConfigLauncher = document.activeElement;
    if (!sidebarConfigOpen) modal.addEventListener('keydown', sidebarConfigKeydown);
    sidebarConfigOpen = true; modal.classList.remove('hidden');
    const version = ++sidebarConfigReadVersion;
    renderSidebarTabConfig([]);
    sidebarFeedback('sidebar_tab_config_feedback', 'Loading statuses…');
    modal.querySelector('button')?.focus();
    try {
        const statuses = await api.get('/api/tasks/statuses');
        if (!Array.isArray(statuses)) throw new Error('Invalid status response');
        if (!sidebarConfigOpen || version !== sidebarConfigReadVersion) return;
        renderSidebarTabConfig(statuses);
        sidebarFeedback('sidebar_tab_config_feedback', 'Changes save immediately. Unavailable selected tabs are retained.');
    } catch {
        if (sidebarConfigOpen && version === sidebarConfigReadVersion) sidebarFeedback('sidebar_tab_config_feedback', 'Statuses could not be loaded. Saved selections are retained.', openSidebarTabsConfigModal);
    }
}
function sidebarConfigKeydown(event) {
    if (!sidebarConfigOpen) return;
    const modal = document.getElementById('sidebar_tab_config_modal');
    if (!modal?.contains(document.activeElement)) return;
    if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault(); event.stopPropagation(); closeSidebarTabsConfigModal();
    } else if (event.key === 'Tab') {
        const controls = [...modal.querySelectorAll('button, input')].filter(el => !el.disabled);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
}
function updateVisibleTabsFromDOM() {
    const list = document.getElementById('sidebar_tab_config_list');
    if (!list) return;
    visibleSidebarTabs = [...list.querySelectorAll('.sidebar-tab-row')].filter(row => row.querySelector('input[type="checkbox"]')?.checked).map(row => row.getAttribute('data-tab-id'));
    try {
        localStorage.setItem(STORAGE_VISIBLE_TABS_KEY, JSON.stringify(visibleSidebarTabs));
        sidebarFeedback('sidebar_tab_config_feedback', 'Changes saved. Unavailable selected tabs are retained.');
    }
    catch { sidebarFeedback('sidebar_tab_config_feedback', 'Changes apply here but could not be saved on this device.'); }
    renderDynamicStatusTabs();
}
function closeSidebarTabsConfigModal() {
    sidebarConfigOpen = false; ++sidebarConfigReadVersion;
    sidebarConfigSortable?.destroy(); sidebarConfigSortable = null;
    const modal = document.getElementById('sidebar_tab_config_modal');
    const restoreFocus = modal?.contains(document.activeElement);
    modal?.classList.add('hidden');
    if (restoreFocus && sidebarConfigLauncher?.isConnected) sidebarConfigLauncher.focus();
    renderDynamicStatusTabs(); fetchTasks();
}

function initSidebarResizers() {
    const leftSidebar = document.getElementById('left_sidebar');
    const leftResizer = document.getElementById('left_resizer');
    const rightSidebar = document.getElementById('right_sidebar');
    const rightResizer = document.getElementById('right_resizer');

    let isResizingLeft = false;
    let isResizingRight = false;

    const savedLeftWidth = localStorage.getItem('timetrace_left_sidebar_width');
    const savedRightWidth = localStorage.getItem('timetrace_right_sidebar_width');
    
    if (savedLeftWidth && leftSidebar) {
        leftSidebar.style.width = `${savedLeftWidth}px`;
        document.documentElement.style.setProperty('--planning-tasks-width', `${savedLeftWidth}px`);
    }
    if (savedRightWidth && rightSidebar) {
        rightSidebar.style.width = `${savedRightWidth}px`;
    }

    if (leftResizer && leftSidebar) {
        leftResizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isResizingLeft = true;
            leftResizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
    }

    if (rightResizer && rightSidebar) {
        rightResizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isResizingRight = true;
            rightResizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
    }

    document.addEventListener('mousemove', (e) => {
        if (!isResizingLeft && !isResizingRight) return;

        if (isResizingLeft && leftSidebar) {
            const containerLeft = leftSidebar.getBoundingClientRect().left;
            let newWidth = e.clientX - containerLeft;
            const maxLeftWidth = Math.max(160, window.innerWidth - 80);
            newWidth = Math.max(160, Math.min(newWidth, maxLeftWidth));
            
            leftSidebar.style.width = `${newWidth}px`;
            document.documentElement.style.setProperty('--planning-tasks-width', `${newWidth}px`);
            localStorage.setItem('timetrace_left_sidebar_width', newWidth);
        }

        if (isResizingRight && rightSidebar) {
            const containerRight = rightSidebar.getBoundingClientRect().right;
            let newWidth = containerRight - e.clientX;
            newWidth = Math.max(200, Math.min(newWidth, 600));
            rightSidebar.style.width = `${newWidth}px`;
            localStorage.setItem('timetrace_right_sidebar_width', newWidth);
        }

        if (typeof calendar !== 'undefined' && calendar) {
            calendar.updateSize();
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizingLeft || isResizingRight) {
            isResizingLeft = false;
            isResizingRight = false;
            if (leftResizer) leftResizer.classList.remove('resizing');
            if (rightResizer) rightResizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            if (typeof calendar !== 'undefined' && calendar) {
                calendar.updateSize();
            }
        }
    });
}

async function fetchTasks() {
    const version = ++sidebarTaskReadVersion;
    const filterIdentity = typeof activeCustomFilter !== 'undefined' ? JSON.stringify(activeCustomFilter) : getCurrentStatusFilter();
    const isCurrent = () => version === sidebarTaskReadVersion && generation === taskKnowledge.state().generation &&
        filterIdentity === (typeof activeCustomFilter !== 'undefined' ? JSON.stringify(activeCustomFilter) : getCurrentStatusFilter());
    sidebarFeedback('sidebar_task_feedback', 'Loading tasks…');
    const generation = taskKnowledge.state().generation;
    try {
        const currentFilterVal = getCurrentStatusFilter();
        let fetched = await api.get(`/api/tasks?status=${encodeURIComponent(currentFilterVal)}&sort=smart_gap_filler`) || [];
        if (!isCurrent()) return;

        if (typeof matchesCustomFilter === 'function') {
            activeTasks = fetched.filter(t => matchesCustomFilter(t));
        } else {
            activeTasks = fetched;
        }

        const cardList = document.getElementById('task_card_list');
        const select = document.getElementById('timer_task_select');
        
        const countEl = document.getElementById('selected_tasks_count');
        if (countEl) countEl.innerText = `${activeTasks.length} tasks`;
        
        if (select) {
            const selectedTask = select.value;
            const openTasks = activeTasks.filter(t => {
                const st = (t.status || '').toLowerCase();
                return st !== 'done' && st !== 'completed';
            });
            if (selectedTask && !openTasks.some(t => t.id === selectedTask)) {
                // Filtering/completion is not an instruction to detach an unsaved timer task.
                openTasks.push(activeTasks.find(t => t.id === selectedTask) || taskKnowledge.get(selectedTask) || {
                    id: selectedTask,
                    title: select.options[select.selectedIndex]?.textContent || 'Task information unavailable'
                });
            }
            select.innerHTML = '<option value="">-- Attach Task --</option>' +
                openTasks.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}</option>`).join('');
            select.value = selectedTask;
        }

        if (cardList) {
            if (activeTasks.length === 0) {
                cardList.innerHTML = '<div class="text-xs text-slate-500 text-center py-4">No tasks match filter.</div>';
            } else {
                cardList.innerHTML = activeTasks.map((t, idx) => {
                    const color = getTaskColor(t, idx);
                    const isOngoing = (t.status || '').toLowerCase() === 'ongoing';
                    const prioLabel = (t.priority || '-').toUpperCase();
                    const estBadge = formatMinutesToDuration(t.estimated_minutes);
                    const hasAttachments = Boolean(t.attachments && t.attachments.trim());
                    const isRecurring = t.is_recurring === true;
                    const parentTask = t.parent_id
                        ? taskKnowledge.get(t.parent_id)
                        : null;
                    const parentTaskLinkHTML = t.parent_id
                        ? `<div class="text-[10px] truncate mt-1">Subtask of: <a href="/task-inspector/${encodeURIComponent(t.parent_id)}" onclick="event.stopPropagation()" class="font-bold hover:underline" title="Open parent task">${escapeHtml(parentTask ? parentTask.title : 'Parent task')}</a></div>`
                        : '';

                    // Recurring tasks carry the next projected occurrence in next_occurrence_date (derived,
                    // read-only); everything else falls back to the stored assigned_date.
                    const dateBadge = getTaskDateBadge(t.due_date, t.next_occurrence_date || t.assigned_date);
                    let dueBadgeHTML = '';
                    if (dateBadge) {
                        dueBadgeHTML = dateBadge.isUrgent
                            ? `<span class="text-[9px] font-black bg-red-900/90 text-red-200 border border-red-600 px-1.5 py-0.5 rounded uppercase shrink-0">${escapeHtml(dateBadge.label)}</span>`
                            : `<span class="text-[9px] font-bold bg-black/60 text-white px-1.5 py-0.5 rounded shrink-0">${escapeHtml(dateBadge.label)}</span>`;
                    }

                    return `
                        <div onclick="window.location.href='/task-inspector/${t.id}'" data-task-id="${t.id}" data-task-title="${escapeHtml(t.title)}" data-task-est="${t.estimated_minutes || 15}" data-task-color="${escapeHtml(color)}" style="background-color: ${escapeHtml(color)}; color: ${getContrastingTextColor(color)};" class="task-card p-3 rounded-lg shadow-md transition transform hover:-translate-y-0.5 hover:brightness-110 flex flex-col justify-between ${t.parent_id ? 'min-h-[7rem]' : 'h-24'} cursor-pointer">
                            <div>
                                <div class="flex justify-between items-start">
                                    <span class="font-semibold text-sm tracking-wide leading-snug truncate hover:underline">${escapeHtml(t.title)}</span>
                                    ${!isOngoing ? `<span class="text-[9px] font-bold bg-black/60 px-1.5 py-0.5 rounded ml-1 shrink-0 text-white">${estBadge}</span>` : ''}
                                </div>
                                <div class="text-[11px] truncate flex items-center space-x-1 mt-0.5">
                                    ${dueBadgeHTML}
                                    <span class="truncate">${escapeHtml(t.description || '')}</span>
                                </div>
                                ${parentTaskLinkHTML}
                            </div>
                            <div class="flex justify-between items-center text-[10px] font-semibold">
                                <div class="flex items-center space-x-1">
                                    <span class="bg-black/60 px-1.5 py-0.5 rounded uppercase text-[9px] text-white">${escapeHtml(t.category || 'work')}</span>
                                    ${isRecurring ? '<span class="text-[9px] font-bold text-white">↻</span>' : ''}
                                    ${hasAttachments ? '<span class="text-[9px] font-bold text-white">📎</span>' : ''}
                                </div>
                                <div class="flex items-center space-x-1">
                                    <span class="bg-black/60 px-1.5 py-0.5 rounded font-bold text-white">${escapeHtml(prioLabel)}</span>
                                    <button type="button" aria-label="Schedule ${escapeHtml(t.title)}" onclick="event.stopPropagation(); createPlanningSession('${t.id}');" class="planning-schedule bg-black/60 hover:bg-black/80 px-1.5 py-0.5 rounded font-bold text-[11px] text-white">Schedule</button>
                                    <button type="button" onclick="event.stopPropagation(); openEditTaskModal('${t.id}');" class="bg-black/60 hover:bg-black/80 px-1.5 py-0.5 rounded font-bold text-[9px] text-white">Edit</button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        if (typeof filterPlanningTasks === 'function') {
            filterPlanningTasks(document.getElementById('planning_task_search')?.value || '');
        }
        fetchRangeTotals();
        sidebarFeedback('sidebar_task_feedback', '');
        taskKnowledge.viewResult("sidebar", true);
        return true;
    } catch (err) {
        if (!isCurrent()) return;
        taskKnowledge.viewResult("sidebar", false);
        sidebarFeedback('sidebar_task_feedback', 'Tasks could not be refreshed. Previous results are retained.', fetchTasks);
        return false;
    }
}

async function clearCompletedTasks() {
    const confirmed = await showCustomConfirm("Clear Completed Tasks", "Are you sure you want to remove all completed task slots?");
    if (confirmed) {
        await api.delete('/api/tasks/completed');
        await taskKnowledge.changed();
    }
}

let breakdownFilter = null; // { type: 'tag'|'task', value } or null
let lastTagSecs = {};
let lastTaskSecs = {};
let lastGrandTotalSecs = 0;

function sessionMatchesBreakdownFilter(s) {
    if (!breakdownFilter) return true;
    if (breakdownFilter.type === 'tag') {
        const tagStr = s.tags || '#general';
        const tokens = tagStr.split(/\s+/).filter(t => t.startsWith('#'));
        const effectiveTokens = tokens.length ? tokens : ['#general'];
        return effectiveTokens.includes(breakdownFilter.value);
    }
    if (breakdownFilter.type === 'task') {
        if (breakdownFilter.value === '__none__') return !s.task_id;
        return String(s.task_id) === String(breakdownFilter.value);
    }
    return true;
}

function toggleBreakdownFilter(type, value) {
    if (breakdownFilter && breakdownFilter.type === type && String(breakdownFilter.value) === String(value)) {
        breakdownFilter = null;
    } else {
        breakdownFilter = { type, value };
    }
    renderBreakdownLists();
    renderBreakdownFilterChip();
    if (typeof syncCalendarContext === 'function') syncCalendarContext();
    if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
}

function clearBreakdownFilter() {
    breakdownFilter = null;
    renderBreakdownLists();
    renderBreakdownFilterChip();
    if (typeof syncCalendarContext === 'function') syncCalendarContext();
    if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
}

function renderBreakdownFilterChip() {
    const chip = document.getElementById('breakdown_filter_chip');
    if (!chip) return;

    if (!breakdownFilter) {
        chip.classList.add('hidden');
        chip.innerHTML = '';
        return;
    }

    let label = breakdownFilter.value;
    if (breakdownFilter.type === 'task') {
        if (breakdownFilter.value === '__none__') {
            label = 'Direct Session Log';
        } else {
            const t = taskKnowledge.get(breakdownFilter.value);
            label = t ? t.title : '(deleted task)';
        }
    }

    chip.classList.remove('hidden');
    chip.innerHTML = `
        <span class="text-purple-200">Filtered: ${escapeHtml(label)}</span>
        <button type="button" onclick="clearBreakdownFilter()" class="text-purple-300 hover:text-white font-black ml-2">Clear filter</button>
    `;
}

function renderBreakdownLists() {
    const activityList = document.getElementById('activity_totals_list');
    const sortedTags = Object.entries(lastTagSecs).sort((a, b) => b[1] - a[1]);
    if (activityList) {
        if (sortedTags.length === 0) {
            activityList.innerHTML = '<div class="text-xs text-slate-500">No activities in this range.</div>';
        } else {
            activityList.innerHTML = sortedTags.map(([tag, secs]) => {
                const isActive = breakdownFilter && breakdownFilter.type === 'tag' && breakdownFilter.value === tag;
                const isDimmed = breakdownFilter && !isActive;
                const pct = lastGrandTotalSecs > 0 ? ((secs / lastGrandTotalSecs) * 100).toFixed(1) : '0.0';
                return `
                    <button type="button" data-breakdown-tag="${escapeHtml(tag)}" onclick="toggleBreakdownFilter('tag', this.dataset.breakdownTag)" class="bg-[#161824] border border-[var(--border-muted)] p-2.5 rounded-lg flex justify-between items-center cursor-pointer transition ${isActive ? 'ring-2 ring-purple-400' : ''} ${isDimmed ? 'opacity-40' : ''}">
                        <span class="text-xs font-bold text-emerald-400">${escapeHtml(tag)}</span>
                        <span class="text-xs font-black text-white">${(secs / 3600).toFixed(1)}h <span class="text-slate-500 font-medium">(${pct}%)</span></span>
                    </button>
                `;
            }).join('');
            activityList.insertAdjacentHTML('beforeend', '<p class="text-[10px] text-slate-500 pt-1">Multi-tag sessions are counted in full under each tag, so totals overlap.</p>');
        }
    }

    const totalsList = document.getElementById('weekly_totals_list');
    const sortedTasks = Object.entries(lastTaskSecs).sort((a, b) => b[1] - a[1]);
    if (totalsList) {
        if (sortedTasks.length === 0) {
            totalsList.innerHTML = '<div class="text-xs text-slate-500">No tracked tasks in this range.</div>';
        } else {
            totalsList.innerHTML = sortedTasks.map(([tid, secs], idx) => {
                const isNone = tid === '__none__';
                const task = isNone ? null : (taskKnowledge.get(tid));
                const title = isNone ? 'Direct Session Log' : (task ? task.title : '(deleted task)');
                const color = task ? getTaskColor(task, idx) : '#334155';
                const isActive = breakdownFilter && breakdownFilter.type === 'task' && String(breakdownFilter.value) === String(tid);
                const isDimmed = breakdownFilter && !isActive;
                const hrs = (secs / 3600).toFixed(1);
                return `
                    <button type="button" onclick="toggleBreakdownFilter('task', '${tid}')" style="background-color: ${escapeHtml(color)}; color: ${getContrastingTextColor(color)};" class="p-2.5 rounded-lg shadow text-white flex justify-between items-center cursor-pointer transition ${isActive ? 'ring-2 ring-purple-400' : ''} ${isDimmed ? 'opacity-40' : ''}">
                        <span class="font-bold text-xs truncate">${escapeHtml(title)}</span>
                        <span class="text-sm font-black">${hrs}h</span>
                    </button>
                `;
            }).join('');
        }
    }
}

function fetchRangeTotals() {
    if (!calendar) return;
    const viewType = calendar.view.type;
    let rangeLabel = "Week";
    if (viewType === 'timeGridDay') rangeLabel = "Day";
    if (viewType === 'timeGridThreeDay') rangeLabel = "3 Day";
    if (viewType === 'dayGridMonth') rangeLabel = "Month";

    const labelEl = document.getElementById('range_breakdown_label');
    const headerEl = document.getElementById('range_total_header');
    if (labelEl) labelEl.innerText = `${rangeLabel} Breakdown`;
    if (headerEl) headerEl.innerText = `${rangeLabel} Total`;

    const viewStart = calendar.view.activeStart;
    const viewEnd = calendar.view.activeEnd;

    const taskSecs = {};
    const tagSecs = {};
    let grandTotalSecs = 0;

    const visibleSessions = allSessions.filter(s => {
        const start = new Date(s.start_time);
        return start >= viewStart && start < viewEnd;
    });

    visibleSessions.forEach(s => {
        const dur = s.duration_seconds || 0;
        grandTotalSecs += dur;

        const tid = s.task_id || '__none__';
        taskSecs[tid] = (taskSecs[tid] || 0) + dur;

        const tagStr = s.tags || '#general';
        const tags = tagStr.split(/\s+/).filter(t => t.startsWith('#'));
        if (tags.length === 0) tags.push('#general');
        tags.forEach(tg => {
            tagSecs[tg] = (tagSecs[tg] || 0) + dur;
        });
    });

    lastTagSecs = tagSecs;
    lastTaskSecs = taskSecs;
    lastGrandTotalSecs = grandTotalSecs;

    const badgeEl = document.getElementById('weekly_total_badge');
    const sideEl = document.getElementById('side_total_hours');
    if (badgeEl) badgeEl.innerText = `${(grandTotalSecs / 3600).toFixed(1)}h`;
    if (sideEl) sideEl.innerText = `${(grandTotalSecs / 3600).toFixed(1)}h`;

    renderBreakdownLists();
    renderBreakdownFilterChip();
}
