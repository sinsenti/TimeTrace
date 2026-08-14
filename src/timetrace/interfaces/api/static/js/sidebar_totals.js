/**
 * Tasks Sidebar, Range Totals Breakdown & Drag-to-Resize Mechanics
 */

function initSidebarResizers() {
    const leftSidebar = document.getElementById('left_sidebar');
    const leftResizer = document.getElementById('left_resizer');
    const rightSidebar = document.getElementById('right_sidebar');
    const rightResizer = document.getElementById('right_resizer');

    let isResizingLeft = false;
    let isResizingRight = false;

    // Restore saved widths from localStorage
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
            
            // Min 160px, Max dynamically calculated to almost full screen (leaves 80px)
            const maxLeftWidth = Math.max(160, window.innerWidth - 80);
            newWidth = Math.max(160, Math.min(newWidth, maxLeftWidth));
            
            leftSidebar.style.width = `${newWidth}px`;
            localStorage.setItem('timetrace_left_sidebar_width', newWidth);
        }

        if (isResizingRight && rightSidebar) {
            const containerRight = rightSidebar.getBoundingClientRect().right;
            let newWidth = containerRight - e.clientX;
            newWidth = Math.max(200, Math.min(newWidth, 600)); // Min 200px, Max 600px
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

document.addEventListener('DOMContentLoaded', () => {
    initSidebarResizers();
});

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
    try {
        activeTasks = await api.get(`/api/v1/tasks?status=${currentFilter}`) || [];

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
                    const color = getTaskColor(t, idx);
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
    } catch (err) {
        console.error("Error fetching tasks:", err);
    }
}

async function clearCompletedTasks() {
    const confirmed = await showCustomConfirm("Clear Completed Tasks", "Are you sure you want to remove all completed task slots?");
    if (confirmed) {
        await api.delete('/api/v1/tasks/completed');
        await fetchAllTasksRegistry();
        fetchTasks();
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

function toggleSidebar(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('hidden');
    const isHidden = el.classList.contains('hidden');

    const settings = getUserSettings();
    if (id === 'left_sidebar') {
        settings.lastHideLeftSidebar = isHidden;
        if (settings.hideLeftSidebar !== 'auto') {
            settings.hideLeftSidebar = isHidden;
        }
    }
    if (id === 'right_sidebar') {
        settings.lastHideRightSidebar = isHidden;
        if (settings.hideRightSidebar !== 'auto') {
            settings.hideRightSidebar = isHidden;
        }
    }
    saveUserSettings(settings);

    setSidebarVisibility(id, !isHidden);
}
