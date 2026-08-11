/**
 * TimeTrace Vim Engine for FullCalendar Web UI
 * Enforces 15-minute fixed navigation steps (j/k) and day shifts (h/l).
 * Session creation triggers only upon pressing 'i'.
 */

let vimMode = 'NORMAL'; // 'NORMAL' | 'VISUAL'
let suppressModalOnSelect = false;

let cursorStart = null;
let cursorEnd = null;
let visualAnchorStart = null;

let pendingGKey = false;
let pendingGTimer = null;

const VIM_STEP_MS = 15 * 60 * 1000; // Fixed 15-minute step
const VIM_DAY_MS = 24 * 60 * 60 * 1000; // Fixed 24-hour step for h/l

function initVimCursor() {
    const now = new Date();
    now.setMinutes(Math.floor(now.getMinutes() / 15) * 15, 0, 0);
    cursorStart = new Date(now);
    cursorEnd = new Date(now.getTime() + VIM_STEP_MS);
}

function getSessionUnderCursor() {
    if (!cursorStart || typeof allSessions === 'undefined' || !allSessions || allSessions.length === 0) {
        return null;
    }
    const cursorMs = cursorStart.getTime();
    return allSessions.find(s => {
        const sStart = new Date(s.start_time).getTime();
        const sEnd = s.end_time ? new Date(s.end_time).getTime() : (sStart + VIM_STEP_MS);
        return cursorMs >= sStart && cursorMs < sEnd;
    });
}

function navigateToNextTab(direction) {
    const pages = ['/api/v1/dashboard', '/api/v1/habits-view', '/api/v1/stats'];
    const currentPath = window.location.pathname;
    let idx = pages.findIndex(p => currentPath.endsWith(p) || currentPath === p);
    if (idx === -1) idx = 0;
    
    const nextIdx = (idx + direction + pages.length) % pages.length;
    window.location.href = pages[nextIdx];
}

function handleOpenSessionAfter() {
    const s = getSessionUnderCursor();
    let start, end;
    if (s) {
        const sStart = new Date(s.start_time).getTime();
        const sEnd = s.end_time ? new Date(s.end_time).getTime() : (sStart + VIM_STEP_MS);
        start = new Date(sEnd);
    } else {
        start = cursorEnd ? new Date(cursorEnd) : new Date(cursorStart.getTime() + VIM_STEP_MS);
    }
    end = new Date(start.getTime() + VIM_STEP_MS);
    if (typeof openCreateSessionModal === 'function') {
        openCreateSessionModal(start, end);
    }
}

function handleOpenSessionBefore() {
    const s = getSessionUnderCursor();
    let start, end;
    if (s) {
        end = new Date(s.start_time);
    } else {
        end = new Date(cursorStart);
    }
    start = new Date(end.getTime() - VIM_STEP_MS);
    if (typeof openCreateSessionModal === 'function') {
        openCreateSessionModal(start, end);
    }
}

async function handleDeleteUnderCursor() {
    const s = getSessionUnderCursor();
    if (s && s.id) {
        const label = s.notes || s.tags || `#${s.id}`;
        const confirmed = await showCustomConfirm(
            "Delete Session", 
            `Delete session "${label}"? Press Enter to confirm.`
        );
        if (confirmed) {
            fetch(`/api/v1/sessions/${s.id}`, { method: 'DELETE' })
                .then(res => {
                    if (res.ok && typeof calendar !== 'undefined' && calendar) {
                        calendar.refetchEvents();
                    }
                })
                .catch(() => {});
        }
    }
}

function setupVimKeyboardListeners() {
    document.addEventListener('keydown', function(e) {
        const settings = typeof getUserSettings === 'function' ? getUserSettings() : {};
        if (settings.enableVimMotions === false) {
            return;
        }

        const activeEl = document.activeElement;
        const isEditingText = activeEl.tagName === 'INPUT' || 
                              activeEl.tagName === 'TEXTAREA' || 
                              activeEl.tagName === 'SELECT';

        if (isEditingText) {
            if (e.key === 'Escape') activeEl.blur();
            return;
        }

        if (!cursorStart) {
            initVimCursor();
        }

        // Handle multi-key 'g' sequences (gt / gT)
        if (pendingGKey) {
            pendingGKey = false;
            if (pendingGTimer) clearTimeout(pendingGTimer);
            
            if (e.key === 't') {
                e.preventDefault();
                navigateToNextTab(1);
                return;
            } else if (e.key === 'T') {
                e.preventDefault();
                navigateToNextTab(-1);
                return;
            }
        }

        if (e.key === 'g' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            pendingGKey = true;
            pendingGTimer = setTimeout(() => { pendingGKey = false; }, 1000);
            return;
        }

        const isMonthView = typeof calendar !== 'undefined' && calendar && calendar.view.type === 'dayGridMonth';

        switch (e.key) {
            // Toggle Visual Mode
            case 'v':
            case 'V':
                e.preventDefault();
                if (vimMode === 'NORMAL') {
                    vimMode = 'VISUAL';
                    visualAnchorStart = new Date(cursorStart);
                } else {
                    vimMode = 'NORMAL';
                    visualAnchorStart = null;
                    cursorEnd = new Date(cursorStart.getTime() + VIM_STEP_MS);
                }
                updateVimModeIndicator();
                renderHighlightSelection();
                break;

            // Move Down (Fixed 15 Minutes)
            case 'j':
                e.preventDefault();
                const stepDownMs = isMonthView ? (7 * VIM_DAY_MS) : VIM_STEP_MS;
                cursorStart = new Date(cursorStart.getTime() + stepDownMs);
                cursorEnd = new Date(cursorStart.getTime() + VIM_STEP_MS);
                checkAndShiftCalendarView();
                renderHighlightSelection();
                break;

            // Move Up (Fixed 15 Minutes)
            case 'k':
                e.preventDefault();
                const stepUpMs = isMonthView ? (7 * VIM_DAY_MS) : VIM_STEP_MS;
                cursorStart = new Date(cursorStart.getTime() - stepUpMs);
                cursorEnd = new Date(cursorStart.getTime() + VIM_STEP_MS);
                checkAndShiftCalendarView();
                renderHighlightSelection();
                break;

            // Move Left (1 Day Back)
            case 'h':
                e.preventDefault();
                cursorStart = new Date(cursorStart.getTime() - VIM_DAY_MS);
                cursorEnd = new Date(cursorStart.getTime() + VIM_STEP_MS);
                checkAndShiftCalendarView();
                renderHighlightSelection();
                break;

            // Move Right (1 Day Forward)
            case 'l':
                e.preventDefault();
                cursorStart = new Date(cursorStart.getTime() + VIM_DAY_MS);
                cursorEnd = new Date(cursorStart.getTime() + VIM_STEP_MS);
                checkAndShiftCalendarView();
                renderHighlightSelection();
                break;

            // Open Session After / Before
            case 'o':
                e.preventDefault();
                handleOpenSessionAfter();
                break;
            case 'O':
                e.preventDefault();
                handleOpenSessionBefore();
                break;

            // Delete Session Under Cursor with Confirmation
            case 'x':
                e.preventDefault();
                handleDeleteUnderCursor();
                break;

            // Change Session Under Cursor
            case 'c':
                e.preventDefault();
                const sessionToEdit = getSessionUnderCursor();
                if (sessionToEdit && typeof openEditSessionModal === 'function') {
                    openEditSessionModal(sessionToEdit.id);
                }
                break;

            // Insert Mode: Start Session Creation Modal
            case 'i':
            case 's':
            case 'Enter':
                e.preventDefault();
                const selectedRange = getActiveSelectionRange();
                if (selectedRange) {
                    openCreateSessionModal(selectedRange.start, selectedRange.end);
                }
                break;

            // Jump to Today
            case 't':
                e.preventDefault();
                initVimCursor();
                if (typeof calendar !== 'undefined' && calendar) {
                    calendar.today();
                }
                renderHighlightSelection();
                break;

            // Calendar View Switchers
            case 'd':
                if (typeof switchView === 'function') switchView('timeGridDay');
                break;
            case 'w':
                if (typeof switchView === 'function') switchView('timeGridWeek');
                break;
            case 'm':
                if (typeof switchView === 'function') switchView('dayGridMonth');
                break;

            // Add Task Modal
            case 'a':
                e.preventDefault();
                if (typeof openNewTaskModal === 'function') openNewTaskModal();
                break;

            // Reset Mode to NORMAL on Escape
            case 'Escape':
                if (vimMode === 'VISUAL') {
                    vimMode = 'NORMAL';
                    visualAnchorStart = null;
                    cursorEnd = new Date(cursorStart.getTime() + VIM_STEP_MS);
                    updateVimModeIndicator();
                    renderHighlightSelection();
                } else {
                    if (typeof closeTaskModal === 'function') closeTaskModal();
                    if (typeof closeSessionModal === 'function') closeSessionModal();
                    if (typeof closeSettingsModal === 'function') closeSettingsModal();
                    if (typeof calendar !== 'undefined' && calendar) calendar.unselect();
                }
                break;
        }
    });
}

function checkAndShiftCalendarView() {
    if (typeof calendar === 'undefined' || !calendar || !calendar.view) return;
    const viewStart = calendar.view.activeStart;
    const viewEnd = calendar.view.activeEnd;

    if (cursorStart < viewStart) {
        calendar.prev();
    } else if (cursorStart >= viewEnd) {
        calendar.next();
    }
}

function getActiveSelectionRange() {
    if (!cursorStart) return null;

    if (vimMode === 'VISUAL' && visualAnchorStart) {
        const minStartMs = Math.min(visualAnchorStart.getTime(), cursorStart.getTime());
        const maxEndMs = Math.max(visualAnchorStart.getTime() + VIM_STEP_MS, cursorStart.getTime() + VIM_STEP_MS);
        return {
            start: new Date(minStartMs),
            end: new Date(maxEndMs)
        };
    } else {
        return {
            start: cursorStart,
            end: new Date(cursorStart.getTime() + VIM_STEP_MS)
        };
    }
}

function renderHighlightSelection() {
    if (typeof calendar === 'undefined' || !calendar) return;
    const range = getActiveSelectionRange();
    if (range) {
        suppressModalOnSelect = true;
        calendar.select(range.start, range.end);
        suppressModalOnSelect = false;

        if (calendar.view.type !== 'dayGridMonth') {
            const activeTime = cursorStart ? cursorStart : range.start;
            const targetHour = Math.max(0, activeTime.getHours() - 1);
            const targetMin = activeTime.getMinutes();
            const timeStr = `${String(targetHour).padStart(2, '0')}:${String(targetMin).padStart(2, '0')}:00`;
            calendar.scrollToTime(timeStr);
        }
    }
}

function updateVimModeIndicator() {
    const el = document.getElementById('vim_mode_indicator');
    if (!el) return;

    const settings = typeof getUserSettings === 'function' ? getUserSettings() : {};
    if (settings.enableVimMotions === false) {
        el.innerText = '-- VIM OFF --';
        el.className = 'h-8 px-2.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-slate-900 text-slate-600 border border-slate-800 flex items-center justify-center whitespace-nowrap';
        return;
    }

    if (vimMode === 'VISUAL') {
        el.innerText = '-- VISUAL --';
        el.className = 'h-8 px-2.5 rounded-lg text-[11px] font-black uppercase tracking-wider bg-amber-900/80 text-amber-300 border border-amber-600 shadow-md shadow-amber-500/20 flex items-center justify-center whitespace-nowrap';
    } else {
        el.innerText = '-- NORMAL --';
        el.className = 'h-8 px-2.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700 flex items-center justify-center whitespace-nowrap';
    }
}
