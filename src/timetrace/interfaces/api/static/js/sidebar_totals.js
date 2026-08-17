/**
 * TimeTrace Dashboard Sidebar Manager
 * Configurable status tabs, task cards, and range totals with persistent local storage.
 */

const STORAGE_STATUS_FILTER_KEY = 'timetrace_status_filter';
const STORAGE_VISIBLE_TABS_KEY = 'timetrace_visible_sidebar_tabs';

currentFilter = localStorage.getItem(STORAGE_STATUS_FILTER_KEY) || 'all';

// Default visible sidebar tabs
let visibleSidebarTabs = JSON.parse(localStorage.getItem(STORAGE_VISIBLE_TABS_KEY) || 'null');
if (!visibleSidebarTabs) {
    visibleSidebarTabs = ['all', 'hide_completed', 'To Do', 'Ongoing', 'Scheduled', 'Done', 'Backlog'];
}

document.addEventListener('DOMContentLoaded', () => {
    initSidebarResizers();
    renderDynamicStatusTabs();
});

// ----------------------------------------------------
// 1. Configurable Dynamic Status Tabs
// ----------------------------------------------------
function setTaskFilter(filterName) {
    currentFilter = filterName;
    localStorage.setItem(STORAGE_STATUS_FILTER_KEY, filterName);
    renderDynamicStatusTabs();
    fetchTasks();
}

async function renderDynamicStatusTabs() {
    const container = document.getElementById('sidebar_status_tabs');
    if (!container) return;

    try {
        const dbStatuses = await api.get('/tasks/statuses') || [];
        const allAvailableTabs = [
            { id: 'all', label: 'All' },
            { id: 'hide_completed', label: 'Active' },
            ...dbStatuses.map(s => ({ id: s.name, label: s.name }))
        ];

        // Filter tabs based on user's tab visibility configuration
        const activeVisibleTabs = allAvailableTabs.filter(t => visibleSidebarTabs.includes(t.id));

        container.innerHTML = activeVisibleTabs.map(t => {
            const isSelected = currentFilter === t.id;
            const activeClass = "px-2 py-0.5 text-[10px] rounded bg-purple-600 text-white font-bold whitespace-nowrap";
            const inactiveClass = "px-2 py-0.5 text-[10px] rounded bg-[#181a28] text-slate-400 hover:text-white whitespace-nowrap";
            return `<button onclick="setTaskFilter('${t.id}')" class="${isSelected ? activeClass : inactiveClass}">${t.label}</button>`;
        }).join('');
    } catch(e) {
        console.error("Failed to render dynamic status tabs:", e);
    }
}

function openSidebarTabsConfigModal() {
    api.get('/tasks/statuses').then(dbStatuses => {
        const allAvailableTabs = [
            { id: 'all', label: 'All' },
            { id: 'hide_completed', label: 'Active (Hide Completed)' },
            ...dbStatuses.map(s => ({ id: s.name, label: s.name }))
        ];

        const listContainer = document.getElementById('sidebar_tab_config_list');
        if (!listContainer) return;

        listContainer.innerHTML = allAvailableTabs.map(t => {
            const isChecked = visibleSidebarTabs.includes(t.id);
            return `
                <label class="flex items-center justify-between p-2 bg-[#0f1016] rounded-lg border border-[var(--border-muted)] cursor-pointer hover:border-purple-500">
                    <span class="font-bold text-xs text-white">${t.label}</span>
                    <input type="checkbox" value="${t.id}" ${isChecked ? 'checked' : ''} onchange="toggleSidebarTabVisibility('${t.id}', this.checked)" class="w-4 h-4 accent-purple-600 rounded">
                </label>
            `;
        }).join('');

        document.getElementById('sidebar_tab_config_modal').classList.remove('hidden');
    });
}

function closeSidebarTabsConfigModal() {
    const modal = document.getElementById('sidebar_tab_config_modal');
    if (modal) modal.classList.add('hidden');
    renderDynamicStatusTabs();
    fetchTasks();
}

function toggleSidebarTabVisibility(tabId, isVisible) {
    if (isVisible) {
        if (!visibleSidebarTabs.includes(tabId)) visibleSidebarTabs.push(tabId);
    } else {
        visibleSidebarTabs = visibleSidebarTabs.filter(id => id !== tabId);
    }
    localStorage.setItem(STORAGE_VISIBLE_TABS_KEY, JSON.stringify(visibleSidebarTabs));
}

// ----------------------------------------------------
// 2. Sidebar Resizers
// ----------------------------------------------------
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

// ----------------------------------------------------
// 3. Task Fetching & Sidebar Card List Rendering
// ----------------------------------------------------
async function fetchTasks() {
    try {
        let fetched = await api.get(`/tasks?status=${currentFilter}&sort=smart_gap_filler`) || [];

        // Apply custom filter rules if active
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
            select.innerHTML = '<option value="">-- Attach Task --</option>' + 
                activeTasks.map(t => `<option value="${t.id}">${t.title}</option>`).join('');
        }

        if (cardList) {
            if (activeTasks.length === 0) {
                cardList.innerHTML = '<div class="text-xs text-slate-500 text-center py-4">No tasks match filter.</div>';
            } else {
                cardList.innerHTML = activeTasks.map((t, idx) => {
                    const color = getTaskColor(t, idx);
                    const isOngoing = (t.status || '').toLowerCase() === 'ongoing';
                    const prioLabel = (t.priority || '-').toUpperCase();
                    const estBadge = t.estimated_minutes ? `${t.estimated_minutes}m` : '15m';
                    const hasAttachments = Boolean(t.attachments && t.attachments.trim());
                    const isRecurring = t.is_recurring === true;
                    const dueStr = t.due_date ? `Due ${new Date(t.due_date).toLocaleDateString([], {month:'short', day:'numeric'})}` : '';

                    return `
                        <div onclick="window.location.href='/task-inspector/${t.id}'" data-task-id="${t.id}" data-task-title="${t.title}" data-task-est="${t.estimated_minutes || 15}" data-task-color="${color}" style="background-color: ${color};" class="task-card p-3 rounded-lg shadow-md transition transform hover:-translate-y-0.5 hover:brightness-110 flex flex-col justify-between h-24 text-white cursor-pointer">
                            <div>
                                <div class="flex justify-between items-start">
                                    <span class="font-black text-sm tracking-wide leading-snug truncate hover:underline">${t.title}</span>
                                    ${!isOngoing ? `<span class="text-[9px] font-bold bg-black/40 px-1.5 py-0.5 rounded ml-1 shrink-0">${estBadge}</span>` : ''}
                                </div>
                                <div class="text-[11px] opacity-80 truncate">${t.description || dueStr || ''}</div>
                            </div>
                            <div class="flex justify-between items-center text-[10px] font-semibold opacity-90">
                                <div class="flex items-center space-x-1">
                                    <span class="bg-black/20 px-1.5 py-0.5 rounded uppercase text-[9px]">${t.category || 'work'}</span>
                                    ${isRecurring ? '<span class="text-[9px] font-bold text-emerald-300">↻</span>' : ''}
                                    ${hasAttachments ? '<span class="text-[9px] font-bold text-blue-300">📎</span>' : ''}
                                </div>
                                <div class="flex items-center space-x-1">
                                    <span class="bg-black/30 px-1.5 py-0.5 rounded font-bold">${prioLabel}</span>
                                    <button type="button" onclick="event.stopPropagation(); openEditTaskModal(${t.id});" class="bg-black/40 hover:bg-black/70 px-1.5 py-0.5 rounded font-bold text-[9px]">Edit</button>
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
        await api.delete('/tasks/completed');
        if (typeof fetchAllTasksRegistry === 'function') await fetchAllTasksRegistry();
        fetchTasks();
    }
}

// ----------------------------------------------------
// 4. Range Totals Calculations
// ----------------------------------------------------
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
                <div class="bg-[#161824] border border-[var(--border-muted)] p-2.5 rounded-lg flex justify-between items-center">
                    <span class="text-xs font-bold text-emerald-400">${tag}</span>
                    <span class="text-xs font-black text-white">${(secs / 3600).toFixed(1)}h</span>
                </div>
            `).join('');
        }
    }

    const totalsList = document.getElementById('weekly_totals_list');
    if (totalsList) {
        totalsList.innerHTML = activeTasks.map((t, idx) => {
            const color = getTaskColor(t, idx);
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
