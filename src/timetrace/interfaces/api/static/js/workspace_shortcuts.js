/** Agenda-only chords; never infer a target from the number of running timers. */
function workspaceShortcut(event, guarded) {
    if (guarded || event.defaultPrevented || event.isComposing || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return null;
    if (/^Digit[1-9]$/.test(event.code)) return `select:${Number(event.code.slice(-1)) - 1}`;
    return {KeyP:'toggle',KeyS:'stop',KeyF:'search',Enter:'start'}[event.code] || null;
}
if (typeof module !== 'undefined') module.exports = {workspaceShortcut};
if (typeof document !== 'undefined') document.addEventListener('keydown', event => {
    const guarded = Boolean(event.target.closest?.('input,textarea,select,[contenteditable="true"]')) ||
        [...document.querySelectorAll('[role="dialog"]')].some(dialog=>dialog.getClientRects().length) ||
        document.getElementById('ai_drawer')?.classList.contains('ai-drawer-open');
    const action = workspaceShortcut(event,guarded);
    const control = window.multipleTimers;
    if (!action || !control) return;
    event.preventDefault();
    const state = control.snapshot();
    if (action === 'search') { document.querySelector('.task-launcher-shared [data-launcher-input]')?.focus(); return; }
    if (action.startsWith('select:')) {
        const timer = state.timers[Number(action.split(':')[1])];
        if (timer) control.select(timer.id);
        return;
    }
    if (!state.fresh || state.pending || state.receipt) return;
    if (action === 'start') {
        if(window.sharedTaskLauncher){void window.sharedTaskLauncher.start();return;}
        control.start({task_id:document.querySelector('[data-timer-task]').value || null}); return;
    }
    const timer = state.timers.find(timer=>timer.id === state.selectedTimerId);
    if (!timer || timer.state === 'frozen') return;
    control.act(timer.id,action === 'toggle' ? (timer.state === 'running' ? 'pause' : 'resume') : 'stop',{expected_revision:timer.revision});
});
