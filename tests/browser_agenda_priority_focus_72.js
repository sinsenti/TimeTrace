/** On the isolated Agenda preview, Tab to a priority heading and run this check.
 * Repeat after native Space/Enter folds/unfolds it. Read-only: no task/timer writes.
 * This checks browser-computed focus geometry, not a screenshot or AT certification.
 */
function verifyAgendaPriorityFocus72() {
    const button = document.activeElement;
    if (!button?.matches('.launcher-group-toggle:focus-visible')) {
        throw Error('Use keyboard focus on a priority heading before checking its outline.');
    }
    const style = getComputedStyle(button);
    const width = parseFloat(style.outlineWidth), offset = parseFloat(style.outlineOffset);
    if (style.outlineStyle === 'none' || width <= 0 || offset + width > 0) {
        throw Error(`Priority focus must sit inside its clipping group: ${style.outlineStyle} ${width}px / ${offset}px.`);
    }
    const body = document.getElementById(button.getAttribute('aria-controls'));
    const expanded = button.getAttribute('aria-expanded') === 'true';
    if (!body || body.hidden === expanded) throw Error('Disclosure state and controlled body disagree.');
    return {expanded, outlineWidth: width, outlineOffset: offset, focusRetained: document.activeElement === button};
}
