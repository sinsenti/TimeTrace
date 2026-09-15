/**
 * TimeTrace AI drawer insights -- deterministic weekly review and shortcut wiring.
 *
 * The weekly report comes from the daemon so local week boundaries and metrics use the same
 * timezone as the rest of the application. Values originating in the database or server
 * response are always inserted with textContent; this file deliberately has no HTML/Markdown
 * renderer.
 */

let aiWeeklyReviewRequestNumber = 0;
let aiWeeklyReviewData = null;

const AI_PRESET_PROMPTS = {
    dailyBriefing: 'Give me a concise daily briefing for today.',
    restOfToday: 'Propose a schedule for the rest of today, from now until local midnight, using free time and unscheduled work.',
    tomorrow: 'Propose a schedule for tomorrow using free time and unscheduled work.',
    nextWeek: 'Propose a schedule for the next local calendar week, respecting my scheduling preferences.'
};

function aiInsightElement(id) {
    return document.getElementById(id);
}

function aiInsightNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
}

function aiInsightRows(stat) {
    return stat && Array.isArray(stat.rows) ? stat.rows : [];
}

function aiInsightScalar(stat) {
    if (!stat || typeof stat !== 'object') return null;
    const direct = stat.total;
    if (direct !== null && direct !== undefined && Number.isFinite(Number(direct))) {
        return Number(direct);
    }
    const first = aiInsightRows(stat)[0];
    if (!first || first.value === null || first.value === undefined) return null;
    return Number.isFinite(Number(first.value)) ? Number(first.value) : null;
}

function aiInsightNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function aiInsightHasBreakdownValues(stat) {
    return aiInsightRows(stat).some((row) => {
        const value = aiInsightNumber(row && row.value);
        return value !== null && value > 0;
    });
}

function aiInsightFormatHours(value) {
    const number = aiInsightNumber(value);
    return number === null ? '0.0 h' : `${number.toFixed(1)} h`;
}

function aiInsightFormatMinutes(value) {
    const number = aiInsightNumber(value);
    return number === null ? '—' : `${Math.round(number)} min`;
}

function aiInsightFormatCount(value) {
    const number = aiInsightNumber(value);
    return number === null ? '0' : String(Math.round(number));
}

function aiInsightFormatBreakdownValue(value, unit) {
    const number = aiInsightNumber(value);
    if (number === null) return '—';
    return unit === 'count' ? aiInsightFormatCount(number) : aiInsightFormatHours(number);
}

function aiInsightRowLabel(row) {
    const labels = row && Array.isArray(row.labels) ? row.labels : [];
    const keys = row && Array.isArray(row.keys) ? row.keys : [];
    const label = labels.length ? labels.join(' / ') : (keys[0] || 'Unlabeled');
    if (label === '__none__' || label === '') return 'Unlabeled';
    return label;
}

function aiInsightBuildKpi(label, value, detail) {
    const card = aiInsightNode('div', 'ai-weekly-kpi');
    card.appendChild(aiInsightNode('div', 'ai-weekly-kpi-label', label));
    card.appendChild(aiInsightNode('div', 'ai-weekly-kpi-value', value));
    if (detail) card.appendChild(aiInsightNode('div', 'ai-weekly-kpi-detail', detail));
    return card;
}

function aiInsightBuildBreakdownSection({ title, description, stat, unit, emptyText, limit, includeZeroRows, overlap }) {
    const section = aiInsightNode('section', 'ai-weekly-breakdown');
    const header = aiInsightNode('div', 'ai-weekly-breakdown-header');
    const heading = aiInsightNode('div', 'ai-weekly-breakdown-heading');
    heading.appendChild(aiInsightNode('h3', 'ai-weekly-breakdown-title', title));
    if (description) heading.appendChild(aiInsightNode('p', 'ai-weekly-breakdown-description', description));
    header.appendChild(heading);
    if (overlap) {
        const warning = aiInsightNode('span', 'ai-weekly-overlap-warning', 'Totals overlap');
        warning.title = 'A session tagged with multiple tags is counted in full under each tag; totals can overlap.';
        header.appendChild(warning);
    }
    section.appendChild(header);

    const rows = aiInsightRows(stat);
    const numericRows = rows.filter((row) => aiInsightNumber(row && row.value) !== null);
    const hasValues = numericRows.some((row) => aiInsightNumber(row.value) > 0);
    if (!hasValues) {
        section.appendChild(aiInsightNode('div', 'ai-weekly-empty-list', emptyText));
        return section;
    }

    let displayRows = numericRows;
    if (!includeZeroRows) displayRows = displayRows.filter((row) => Number(row.value) > 0);
    if (limit) displayRows = displayRows.slice(0, limit);
    const maximum = Math.max(...displayRows.map((row) => Number(row.value)), 0);
    const list = aiInsightNode('div', 'ai-weekly-breakdown-list');

    displayRows.forEach((row) => {
        const value = Number(row.value);
        const rowNode = aiInsightNode('div', 'ai-weekly-breakdown-row');
        const top = aiInsightNode('div', 'ai-weekly-breakdown-row-top');
        top.appendChild(aiInsightNode('span', 'ai-weekly-breakdown-label', aiInsightRowLabel(row)));
        top.appendChild(aiInsightNode('span', 'ai-weekly-breakdown-value', aiInsightFormatBreakdownValue(value, unit)));
        rowNode.appendChild(top);

        const track = aiInsightNode('div', 'ai-weekly-bar-track');
        const fill = aiInsightNode('div', 'ai-weekly-bar-fill');
        const percentage = maximum > 0 ? Math.min(100, Math.max(0, (value / maximum) * 100)) : 0;
        fill.style.width = `${percentage}%`;
        track.appendChild(fill);
        rowNode.appendChild(track);
        list.appendChild(rowNode);
    });
    section.appendChild(list);
    return section;
}

function aiInsightReportHasData(report) {
    const scalarFields = ['logged_total', 'scheduled_total', 'average_session_length', 'session_count'];
    if (scalarFields.some((field) => (aiInsightScalar(report[field]) || 0) > 0)) return true;
    return ['logged_by_day', 'scheduled_by_day', 'logged_by_tag', 'logged_by_task', 'tasks_created_by_status']
        .some((field) => aiInsightHasBreakdownValues(report[field]));
}

function aiRenderWeeklyReview(report) {
    const content = aiInsightElement('ai_weekly_review_content');
    if (!content) return;
    content.textContent = '';

    const loggedHours = aiInsightScalar(report.logged_total) || 0;
    const scheduledHours = aiInsightScalar(report.scheduled_total) || 0;
    const averageMinutes = aiInsightScalar(report.average_session_length);
    const sessionCount = aiInsightScalar(report.session_count) || 0;

    const card = aiInsightNode('div', 'ai-weekly-review-card');
    const summary = aiInsightNode('div', 'ai-weekly-review-summary');
    summary.textContent = 'Logged time is completed work. Future scheduled time is upcoming work and is not included in logged totals.';
    card.appendChild(summary);

    const kpis = aiInsightNode('div', 'ai-weekly-kpi-grid');
    kpis.appendChild(aiInsightBuildKpi('Logged time', aiInsightFormatHours(loggedHours), 'Completed sessions'));
    kpis.appendChild(aiInsightBuildKpi('Future scheduled time', aiInsightFormatHours(scheduledHours), 'Upcoming sessions'));
    kpis.appendChild(aiInsightBuildKpi('Average session length', aiInsightFormatMinutes(averageMinutes), 'Logged sessions'));
    kpis.appendChild(aiInsightBuildKpi('Logged session count', aiInsightFormatCount(sessionCount), 'Completed sessions'));
    card.appendChild(kpis);

    const breakdowns = aiInsightNode('div', 'ai-weekly-breakdown-grid');
    breakdowns.appendChild(aiInsightBuildBreakdownSection({
        title: 'Logged time by day',
        description: 'Completed sessions grouped by local calendar day.',
        stat: report.logged_by_day,
        unit: 'hours',
        emptyText: 'No logged sessions in this week.',
        includeZeroRows: true
    }));
    breakdowns.appendChild(aiInsightBuildBreakdownSection({
        title: 'Future scheduled time by day',
        description: 'Upcoming sessions grouped by local calendar day.',
        stat: report.scheduled_by_day,
        unit: 'hours',
        emptyText: 'No future sessions in this week.',
        includeZeroRows: true
    }));
    breakdowns.appendChild(aiInsightBuildBreakdownSection({
        title: 'Top tags',
        description: 'Logged time attributed to tags.',
        stat: report.logged_by_tag,
        unit: 'hours',
        emptyText: 'No logged tags in this week.',
        limit: 8,
        overlap: Boolean(report.logged_by_tag && report.logged_by_tag.meta && report.logged_by_tag.meta.totals_overlap)
    }));
    breakdowns.appendChild(aiInsightBuildBreakdownSection({
        title: 'Top tasks',
        description: 'Logged time attributed to tasks.',
        stat: report.logged_by_task,
        unit: 'hours',
        emptyText: 'No logged tasks in this week.',
        limit: 8
    }));
    breakdowns.appendChild(aiInsightBuildBreakdownSection({
        title: 'Task status totals',
        description: 'Tasks created in this week grouped by their current status.',
        stat: report.tasks_created_by_status,
        unit: 'count',
        emptyText: 'No tasks were created in this week.',
        limit: 8
    }));
    card.appendChild(breakdowns);
    content.appendChild(card);
}

function aiSetWeeklyReviewState(state, message = '') {
    const loading = aiInsightElement('ai_weekly_review_loading');
    const empty = aiInsightElement('ai_weekly_review_empty');
    const error = aiInsightElement('ai_weekly_review_error');
    const content = aiInsightElement('ai_weekly_review_content');
    const actions = aiInsightElement('ai_weekly_review_actions');
    const status = aiInsightElement('ai_weekly_review_status');
    const refresh = aiInsightElement('ai_weekly_review_refresh_btn');
    const panel = aiInsightElement('ai_weekly_review_panel');

    if (panel) panel.setAttribute('aria-busy', String(state === 'loading'));
    if (loading) loading.classList.toggle('hidden', state !== 'loading');
    if (error) {
        error.classList.toggle('hidden', state !== 'error');
        if (state === 'error') error.textContent = message;
    }
    if (content) content.classList.toggle('hidden', state === 'loading' || state === 'error');
    if (empty) empty.classList.toggle('hidden', state !== 'ready-empty');
    if (actions) actions.classList.toggle('hidden', state !== 'ready' && state !== 'ready-empty');
    if (status) status.textContent = state === 'loading' ? 'Loading weekly review.' : '';
    if (refresh) refresh.disabled = state === 'loading';
}

function aiInsightsFirstDayOfWeek() {
    if (typeof getUserSettings !== 'function') return 1;
    const settings = getUserSettings();
    const value = Number(settings && settings.firstDayOfWeek);
    return Number.isInteger(value) && value >= 0 && value <= 6 ? value : 1;
}

function aiOpenWeeklyReviewPanel() {
    const panel = aiInsightElement('ai_weekly_review_panel');
    const button = aiInsightElement('ai_action_weekly_review');
    if (!panel) return;
    panel.classList.remove('hidden');
    if (button) button.setAttribute('aria-expanded', 'true');
    aiLoadCurrentWeeklyReview();
}

async function aiLoadCurrentWeeklyReview() {
    const panel = aiInsightElement('ai_weekly_review_panel');
    if (!panel) return null;
    panel.classList.remove('hidden');

    const requestNumber = ++aiWeeklyReviewRequestNumber;
    aiWeeklyReviewData = null;
    const range = aiInsightElement('ai_weekly_review_range');
    const timezone = aiInsightElement('ai_weekly_review_timezone');
    if (range) range.textContent = '';
    if (timezone) timezone.textContent = '';
    aiSetWeeklyReviewState('loading');

    const firstDay = aiInsightsFirstDayOfWeek();
    const url = `/api/ai/insights/weekly-review/current?firstDayOfWeek=${encodeURIComponent(firstDay)}`;
    try {
        const report = await api.get(url);
        if (requestNumber !== aiWeeklyReviewRequestNumber) return report;
        if (!report || typeof report !== 'object') throw new Error('The weekly review response was empty.');

        aiWeeklyReviewData = report;
        if (range) {
            const start = report.start_date || 'Unknown start';
            const end = report.end_date || 'Unknown end';
            range.textContent = `${start} – ${end}`;
        }
        if (timezone) timezone.textContent = `Timezone: ${report.timezone || 'daemon local time'}`;
        aiRenderWeeklyReview(report);
        aiSetWeeklyReviewState(aiInsightReportHasData(report) ? 'ready' : 'ready-empty');
        return report;
    } catch (err) {
        if (requestNumber !== aiWeeklyReviewRequestNumber) return null;
        console.error('Failed to load current AI weekly review:', err);
        aiSetWeeklyReviewState('error', 'Failed to load weekly review: ' + (err.message || err));
        return null;
    }
}

function aiInsightsRunPreset(prompt) {
    if (typeof window.aiRunPresetPrompt === 'function') {
        return window.aiRunPresetPrompt(prompt);
    }
    console.error('AI preset prompt handler is not available.');
    return null;
}

function aiSetupInsights() {
    const dailyButton = aiInsightElement('ai_action_daily_briefing');
    if (dailyButton) dailyButton.addEventListener('click', () => aiInsightsRunPreset(AI_PRESET_PROMPTS.dailyBriefing));

    const restButton = aiInsightElement('ai_action_plan_rest_today');
    if (restButton) restButton.addEventListener('click', () => aiInsightsRunPreset(AI_PRESET_PROMPTS.restOfToday));

    const tomorrowButton = aiInsightElement('ai_action_plan_tomorrow');
    if (tomorrowButton) tomorrowButton.addEventListener('click', () => aiInsightsRunPreset(AI_PRESET_PROMPTS.tomorrow));

    const nextWeekButton = aiInsightElement('ai_action_plan_next_week');
    if (nextWeekButton) nextWeekButton.addEventListener('click', () => aiInsightsRunPreset(AI_PRESET_PROMPTS.nextWeek));

    const weeklyButton = aiInsightElement('ai_action_weekly_review');
    if (weeklyButton) weeklyButton.addEventListener('click', aiOpenWeeklyReviewPanel);

    const refreshButton = aiInsightElement('ai_weekly_review_refresh_btn');
    if (refreshButton) refreshButton.addEventListener('click', aiLoadCurrentWeeklyReview);

    const askButton = aiInsightElement('ai_weekly_review_ask_btn');
    if (askButton) {
        askButton.addEventListener('click', () => {
            if (!aiWeeklyReviewData || !aiWeeklyReviewData.start_date || !aiWeeklyReviewData.end_date) return;
            const timezone = aiWeeklyReviewData.timezone || 'the daemon local timezone';
            const prompt = `Explain my deterministic weekly review for the local date range ${aiWeeklyReviewData.start_date} through ${aiWeeklyReviewData.end_date} in ${timezone}. Use exactly those returned week dates and be concise about logged time, future scheduled time, daily patterns, tags, tasks, and status totals.`;
            aiInsightsRunPreset(prompt);
        });
    }
}

window.aiLoadCurrentWeeklyReview = aiLoadCurrentWeeklyReview;
document.addEventListener('DOMContentLoaded', aiSetupInsights);
