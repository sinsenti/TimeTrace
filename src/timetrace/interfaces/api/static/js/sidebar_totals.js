/**
 * TimeTrace Dashboard Sidebar Manager
 */

const STORAGE_STATUS_FILTER_KEY = 'timetrace_dashboard_status_filter';
const STORAGE_VISIBLE_TABS_KEY = 'timetrace_dashboard_visible_sidebar_tabs';

function getCurrentStatusFilter() {
    return localStorage.getItem(STORAGE_STATUS_FILTER_KEY) || (typeof activeCustomFilter !== 'undefined' ? activeCustomFilter.status : 'all') || 'all';
}

let visibleSidebarTabs = JSON.parse(localStorage.getItem(STORAGE_VISIBLE_TABS_KEY) || 'null');
if (!visibleSidebarTabs) {
    visibleSidebarTabs = ['all', 'hide_completed', 'To Do', 'Ongoing', 'Scheduled', 'Done', 'Backlog'];
}

document.addEventListener('DOMContentLoaded', () => {
    initSidebarResizers();
    renderDynamicStatusTabs();
});

function setTaskFilter(filterName) {
    localStorage.setItem(STORAGE_STATUS_FILTER_KEY, filterName);
    
    if (typeof activeCustomFilter !== 'undefined') {
        activeCustomFilter.status = filterName;
        activeCustomFilter.isActive = Boolean(
            activeCustomFilter.query || 
            activeCustomFilter.status !== 'all' || 
            activeCustomFilter.category !== 'all' || 
            activeCustomFilter.estOp || 
            activeCustomFilter.priority !== 'all'
        );
        if (typeof saveCustomFilterState === 'function') saveCustomFilterState();
        if (typeof updateFilterButtonIndicators === 'function') updateFilterButtonIndicators();
    }

    renderDynamicStatusTabs();
    fetchTasks();
}

async function renderDynamicStatusTabs() {
    const container = document.getElementById('sidebar_status_tabs');
    if (!container) return;

    try {
        const dbStatuses = await api.get('/api/tasks/statuses') || [];
        const allAvailableTabs = [
            { id: 'all', label: 'All' },
            { id: 'hide_completed', label: 'Active' },
            ...dbStatuses.map(s => ({ id: s.name, label: s.name }))
        ];

        const activeVisibleTabs = [];
        visibleSidebarTabs.forEach(vid => {
            const found = allAvailableTabs.find(t => t.id === vid);
            if (found) activeVisibleTabs.push(found);
        });

        const activeFilterLower = getCurrentStatusFilter().toLowerCase();

        container.innerHTML = activeVisibleTabs.map(t => {
            const isSelected = activeFilterLower === t.id.toLowerCase();
            const activeClass = "px-2 py-0.5 text-[10px] rounded bg-purple-600 text-white font-bold whitespace-nowrap";
            const inactiveClass = "px-2 py-0.5 text-[10px] rounded bg-[#181a28] text-slate-400 hover:text-white whitespace-nowrap";
            return `<button onclick="setTaskFilter('${t.id}')" class="${isSelected ? activeClass : inactiveClass}">${t.label}</button>`;
        }).join('');
    } catch(e) {
        console.error("Failed to render dynamic status tabs:", e);
    }
}

function openSidebarTabsConfigModal() {
    api.get('/api/tasks/statuses').then(dbStatuses => {
        const allAvailableTabs = [
            { id: 'all', label: 'All' },
            { id: 'hide_completed', label: 'Active (Hide Completed)' },
            ...dbStatuses.map(s => ({ id: s.name, label: s.name }))
        ];

        const orderedTabs = [];
        visibleSidebarTabs.forEach(vid => {
            const found = allAvailableTabs.find(t => t.id === vid);
            if (found) orderedTabs.push({...found, checked: true});
        });
        
        allAvailableTabs.forEach(t => {
            if (!visibleSidebarTabs.includes(t.id)) {
                orderedTabs.push({...t, checked: false});
            }
        });

        const listContainer = document.getElementById('sidebar_tab_config_list');
        if (!listContainer) return;

        listContainer.innerHTML = orderedTabs.map(t => `
            <div data-tab-id="${t.id}" class="sidebar-tab-row flex items-center justify-between p-2 bg-[#0f1016] rounded-lg border border-[var(--border-muted)] cursor-grab hover:border-purple-500">
                <span class="font-bold text-xs text-white">${t.label}</span>
                <input type="checkbox" ${t.checked ? 'checked' : ''} onchange="updateVisibleTabsFromDOM()" class="w-4 h-4 accent-purple-600 rounded cursor-pointer">
            </div>
        `).join('');

        if (typeof Sortable !== 'undefined') {
            Sortable.create(listContainer, {
                animation: 150,
                ghostClass: 'sortable-ghost',
                onEnd: function() {
                    updateVisibleTabsFromDOM();
                }
            });
        }

        document.getElementById('sidebar_tab_config_modal').classList.remove('hidden');
    });
}

function updateVisibleTabsFromDOM() {
    const listContainer = document.getElementById('sidebar_tab_config_list');
    if (!listContainer) return;
    const rows = listContainer.querySelectorAll('.sidebar-tab-row');
    const newOrder = [];
    rows.forEach(row => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox && checkbox.checked) {
            newOrder.push(row.getAttribute('data-tab-id'));
        }
    });
    visibleSidebarTabs = newOrder;
    localStorage.setItem(STORAGE_VISIBLE_TABS_KEY, JSON.stringify(visibleSidebarTabs));
    renderDynamicStatusTabs();
}

function closeSidebarTabsConfigModal() {
    const modal = document.getElementById('sidebar_tab_config_modal');
    if (modal) modal.classList.add('hidden');
    renderDynamicStatusTabs();
    fetchTasks();
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

function escapeTaskCardText(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

async function fetchTasks() {
    try {
        const currentFilterVal = getCurrentStatusFilter();
        let fetched = await api.get(`/api/tasks?status=${encodeURIComponent(currentFilterVal)}&sort=smart_gap_filler`) || [];

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
            const openTasks = activeTasks.filter(t => {
                const st = (t.status || '').toLowerCase();
                return st !== 'done' && st !== 'completed';
            });
            select.innerHTML = '<option value="">-- Attach Task --</option>' + 
                openTasks.map(t => `<option value="${t.id}">${t.title}</option>`).join('');
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
                    const parentTask = t.parent_id && typeof allTasksMap !== 'undefined'
                        ? allTasksMap[t.parent_id]
                        : null;
                    const parentTaskLinkHTML = t.parent_id
                        ? `<div class="text-[10px] truncate mt-1">Subtask of: <a href="/task-inspector/${encodeURIComponent(t.parent_id)}" onclick="event.stopPropagation()" class="font-bold hover:underline" title="Open parent task">${escapeTaskCardText(parentTask ? parentTask.title : 'Parent task')}</a></div>`
                        : '';

                    // Recurring tasks carry the next projected occurrence in next_occurrence_date (derived,
                    // read-only); everything else falls back to the stored assigned_date.
                    const dateBadge = getTaskDateBadge(t.due_date, t.next_occurrence_date || t.assigned_date);
                    let dueBadgeHTML = '';
                    if (dateBadge) {
                        dueBadgeHTML = dateBadge.isUrgent
                            ? `<span class="text-[9px] font-black bg-red-900/90 text-red-200 border border-red-600 px-1.5 py-0.5 rounded uppercase shrink-0">${dateBadge.label}</span>`
                            : `<span class="text-[9px] font-bold bg-black/60 text-white px-1.5 py-0.5 rounded shrink-0">${dateBadge.label}</span>`;
                    }

                    return `
                        <div onclick="window.location.href='/task-inspector/${t.id}'" data-task-id="${t.id}" data-task-title="${t.title}" data-task-est="${t.estimated_minutes || 15}" data-task-color="${color}" style="background-color: ${color}; color: ${getContrastingTextColor(color)};" class="task-card p-3 rounded-lg shadow-md transition transform hover:-translate-y-0.5 hover:brightness-110 flex flex-col justify-between ${t.parent_id ? 'min-h-[7rem]' : 'h-24'} cursor-pointer">
                            <div>
                                <div class="flex justify-between items-start">
                                    <span class="font-semibold text-sm tracking-wide leading-snug truncate hover:underline">${t.title}</span>
                                    ${!isOngoing ? `<span class="text-[9px] font-bold bg-black/60 px-1.5 py-0.5 rounded ml-1 shrink-0 text-white">${estBadge}</span>` : ''}
                                </div>
                                <div class="text-[11px] truncate flex items-center space-x-1 mt-0.5">
                                    ${dueBadgeHTML}
                                    <span class="truncate">${t.description || ''}</span>
                                </div>
                                ${parentTaskLinkHTML}
                            </div>
                            <div class="flex justify-between items-center text-[10px] font-semibold">
                                <div class="flex items-center space-x-1">
                                    <span class="bg-black/60 px-1.5 py-0.5 rounded uppercase text-[9px] text-white">${t.category || 'work'}</span>
                                    ${isRecurring ? '<span class="text-[9px] font-bold text-white">↻</span>' : ''}
                                    ${hasAttachments ? '<span class="text-[9px] font-bold text-white">📎</span>' : ''}
                                </div>
                                <div class="flex items-center space-x-1">
                                    <span class="bg-black/60 px-1.5 py-0.5 rounded font-bold text-white">${prioLabel}</span>
                                    <button type="button" onclick="event.stopPropagation(); openEditTaskModal('${t.id}');" class="bg-black/60 hover:bg-black/80 px-1.5 py-0.5 rounded font-bold text-[9px] text-white">Edit</button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        fetchRangeTotals();
    } catch (err) {
        console.error("Error fetching tasks:", err);
    }
}

async function clearCompletedTasks() {
    const confirmed = await showCustomConfirm("Clear Completed Tasks", "Are you sure you want to remove all completed task slots?");
    if (confirmed) {
        await api.delete('/api/tasks/completed');
        if (typeof fetchAllTasksRegistry === 'function') await fetchAllTasksRegistry();
        fetchTasks();
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
    if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
}

function clearBreakdownFilter() {
    breakdownFilter = null;
    renderBreakdownLists();
    renderBreakdownFilterChip();
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
            const t = typeof allTasksMap !== 'undefined' ? allTasksMap[breakdownFilter.value] : null;
            label = t ? t.title : '(deleted task)';
        }
    }

    chip.classList.remove('hidden');
    chip.innerHTML = `
        <span class="text-purple-200">Filtered: ${label}</span>
        <button type="button" onclick="clearBreakdownFilter()" class="text-purple-300 hover:text-white font-black ml-2">&times;</button>
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
                    <div onclick="toggleBreakdownFilter('tag', '${tag}')" class="bg-[#161824] border border-[var(--border-muted)] p-2.5 rounded-lg flex justify-between items-center cursor-pointer transition ${isActive ? 'ring-2 ring-purple-400' : ''} ${isDimmed ? 'opacity-40' : ''}">
                        <span class="text-xs font-bold text-emerald-400">${tag}</span>
                        <span class="text-xs font-black text-white">${(secs / 3600).toFixed(1)}h <span class="text-slate-500 font-medium">(${pct}%)</span></span>
                    </div>
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
                const task = isNone ? null : (typeof allTasksMap !== 'undefined' ? allTasksMap[tid] : null);
                const title = isNone ? 'Direct Session Log' : (task ? task.title : '(deleted task)');
                const color = task ? getTaskColor(task, idx) : '#334155';
                const isActive = breakdownFilter && breakdownFilter.type === 'task' && String(breakdownFilter.value) === String(tid);
                const isDimmed = breakdownFilter && !isActive;
                const hrs = (secs / 3600).toFixed(1);
                return `
                    <div onclick="toggleBreakdownFilter('task', '${tid}')" style="background-color: ${color};" class="p-2.5 rounded-lg shadow text-white flex justify-between items-center cursor-pointer transition ${isActive ? 'ring-2 ring-purple-400' : ''} ${isDimmed ? 'opacity-40' : ''}">
                        <span class="font-bold text-xs truncate">${title}</span>
                        <span class="text-sm font-black">${hrs}h</span>
                    </div>
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
