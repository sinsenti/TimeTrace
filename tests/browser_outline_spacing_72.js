/** Run in the isolated /tasks Outline view after selecting a child task.
 * Read-only, browser-computed geometry; not a raster/AT certification.
 */
function verifyOutlineInspectorSpacing72() {
    const header = document.querySelector('#outline_inspector .outline-inspector-header');
    const notice = document.getElementById('outline_selection_notice');
    const panel = document.getElementById('outline_inspector_panel');
    const first = panel?.querySelector('#task_breadcrumbs');
    if (!header || !notice || notice.textContent || !first || !first.getClientRects().length) {
        throw Error('Select a synthetic child task with no outstanding selection notice.');
    }
    const gap = first.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
    const padding = parseFloat(getComputedStyle(panel).paddingTop);
    if (Math.abs(gap - padding) > 1 || gap > 24) {
        throw Error(`Inspector has ${gap}px of blank space; expected only ${padding}px content padding.`);
    }
    return {gap, padding, noticeRole: notice.getAttribute('role')};
}
