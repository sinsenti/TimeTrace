let vimMode = 'NORMAL'; // 'NORMAL' | 'VISUAL'
let suppressModalOnSelect = false;

let cursorStart = null;
let cursorEnd = null;
let visualAnchorStart = null;

function setupVimKeyboardListeners() {
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
        const isMonthView = typeof calendar !== 'undefined' && calendar && calendar.view.type === 'dayGridMonth';

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
    if (typeof calendar === 'undefined' || !calendar) return;
    const range = getActiveSelectionRange();
    if (range) {
        suppressModalOnSelect = true;
        calendar.select(range.start, range.end);
        suppressModalOnSelect = false;

        // Auto-scroll screen vertically to keep selection centered in viewport
        if (calendar.view.type !== 'dayGridMonth') {
            const targetHour = Math.max(0, range.start.getHours() - 1);
            const targetMin = range.start.getMinutes();
            const timeStr = `${String(targetHour).padStart(2, '0')}:${String(targetMin).padStart(2, '0')}:00`;
            calendar.scrollToTime(timeStr);
        }
    }
}

function updateVimModeIndicator() {
    const el = document.getElementById('vim_mode_indicator');
    if (!el) return;

    if (vimMode === 'VISUAL') {
        el.innerText = '-- VISUAL --';
        el.className = 'h-8 px-2.5 rounded-lg text-[11px] font-black uppercase tracking-wider bg-amber-900/80 text-amber-300 border border-amber-600 shadow-md shadow-amber-500/20 flex items-center justify-center whitespace-nowrap';
    } else {
        el.innerText = '-- NORMAL --';
        el.className = 'h-8 px-2.5 rounded-lg text-[11px] font-black uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700 flex items-center justify-center whitespace-nowrap';
    }
}
