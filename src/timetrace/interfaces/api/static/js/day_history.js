/** Bottom history; expanded editor DOM is independent of list refreshes. */
let dayHistoryGeneration = 0;
let allDayHistoryList = [];
async function loadDayHistoryOverview() {
    const generation = ++dayHistoryGeneration;
    try {
        const days = await api.get('/revision/day-history') || [];
        if (generation !== dayHistoryGeneration) return;
        allDayHistoryList = days;
        document.getElementById('day_history_status').textContent = '';
        renderDayHistoryGrid();
    } catch (error) {
        if (generation === dayHistoryGeneration) document.getElementById('day_history_status').textContent = 'History load failed. Refresh to retry. Existing editors retained.';
    }
}
function toggleDayHistory(force = !dayHistoryVisible) {
    dayHistoryVisible = force;
    const button = document.getElementById('day_history_toggle');
    button.textContent = force ? 'Hide history' : 'Show history';
    button.setAttribute('aria-expanded',String(force));
    document.getElementById('day_history_panel').classList.toggle('hidden',!force);
    positionDayEditors();
    if (force) loadDayHistoryOverview();
}
function setHistoryFilter(filter) {
    currentDayHistoryFilter = filter;
    for (const value of ['all','reviewed','missed','dismissed']) document.getElementById(`hist_filter_${value}`)?.setAttribute('aria-pressed',String(value === filter));
    renderDayHistoryGrid();
}
function renderDayHistoryGrid() {
    const grid = document.getElementById('day_history_grid');
    if (!grid) return;
    const days = allDayHistoryList.filter(day => day.date_str !== dayReviewEditor?.date &&
        (currentDayHistoryFilter === 'all' || currentDayHistoryFilter === 'reviewed' && day.has_review && !day.review_skipped ||
         currentDayHistoryFilter === 'missed' && !day.has_review && !day.review_skipped || currentDayHistoryFilter === 'dismissed' && day.review_skipped));
    grid.replaceChildren();
    for (const day of days) {
        const button = document.createElement('button'); button.type = 'button';button.className = 'day-history-card';
        button.textContent = `${day.date_str} · ${day.review_skipped ? 'Dismissed' : day.has_review ? `Reviewed (${day.rating}/5)` : 'Missing review'} · ${day.total_hours}h · ${day.session_count} sessions${day.highlights ? ` · ${day.highlights}` : ''}`;
        button.setAttribute('aria-expanded',String(expandedHistoryDate === day.date_str));
        button.addEventListener('click',()=>expandDayHistory(day.date_str)); grid.appendChild(button);
    }
    if (!days.length) grid.textContent = 'No matching other days in history.';
}
async function expandDayHistory(date) {
    if (date === dayReviewEditor?.date) return;
    expandedHistoryDate = expandedHistoryDate === date ? null : date;
    if (expandedHistoryDate) getDayEditor(date);
    positionDayEditors(); renderDayHistoryGrid();
    if (expandedHistoryDate) await loadDayEditor(getDayEditor(date));
}
function jumpToDayReview(dateStr) {
    document.getElementById('day_review_date_input').value = dateStr;
    switchRevisionTab('day');
}
