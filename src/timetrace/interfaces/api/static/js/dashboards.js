/**
 * TimeTrace "Overview" statistics dashboard.
 *
 * The `/stats` page used to be a hardcoded set of four KPI cards + four Chart.js charts backed
 * by `GET /analytics/detailed`. It is now a seeded dashboard: a fixed list of widget specs, each
 * a real `AnalyticsQuery`, sent together as one `POST /analytics/query/batch` call and rendered
 * generically by chart type. `stats.js` keeps only the drilldown-inspector functions that a
 * widget click opens.
 */

const ACCENT_CLASSES = {
    purple: { badge: 'bg-purple-900/40 border-purple-700/50', text: 'text-purple-400' },
    emerald: { badge: 'bg-emerald-900/40 border-emerald-700/50', text: 'text-emerald-400' },
    amber: { badge: 'bg-amber-900/40 border-amber-700/50', text: 'text-amber-400' },
    blue: { badge: 'bg-blue-900/40 border-blue-700/50', text: 'text-blue-400' }
};

const OVERVIEW_SEED = [
    {
        key: 'total_time', kind: 'tile', accent: 'purple', badge: 'LOGGED', title: 'Total Time Logged',
        query: { source: 'sessions', measure: 'sum_duration', chart: 'tile' },
        format: (v) => `${_fmtNum(v || 0, 1)}h`
    },
    {
        key: 'total_sessions', kind: 'tile', accent: 'emerald', badge: 'SESSIONS', title: 'Logged Sessions',
        query: { source: 'sessions', measure: 'session_count', chart: 'tile' },
        format: (v) => `${Math.round(v || 0)}`
    },
    {
        key: 'total_tasks', kind: 'tile', accent: 'amber', badge: 'TASKS', title: 'Total Tasks',
        query: { source: 'tasks', measure: 'task_count', chart: 'tile' },
        format: (v) => `${Math.round(v || 0)}`
    },
    {
        key: 'estimation_score', kind: 'tile', accent: 'blue', badge: 'ACCURACY', title: 'Estimation Score',
        query: { source: 'tasks', measure: 'estimation_accuracy', chart: 'tile' },
        format: (v) => (v === null || v === undefined) ? 'n/a' : `${_fmtNum(v, 1)}%`
    },
    {
        key: 'estimation_breakdown', kind: 'doughnut', clickable: true,
        title: 'Estimation Accuracy Breakdown',
        query: {
            source: 'tasks', measure: 'task_count', group_by: ['estimation_bucket'],
            chart: 'doughnut', sort: 'dimension_asc'
        }
    },
    {
        key: 'daily_trend', kind: 'bar', clickable: true,
        title: 'Daily Focus Trend (last 14 days)',
        query: {
            source: 'sessions', measure: 'sum_duration', group_by: ['day'],
            chart: 'bar', sort: 'dimension_asc', fill_gaps: true,
            date_range: { preset: 'last_14_days' }
        }
    },
    {
        key: 'peak_hours', kind: 'bar', clickable: false,
        title: 'Peak Focus Hours (24h distribution)',
        query: {
            source: 'sessions', measure: 'sum_duration', group_by: ['hour_of_day'],
            chart: 'bar', sort: 'dimension_asc', fill_gaps: true
        }
    },
    {
        key: 'tags_breakdown', kind: 'doughnut', clickable: true,
        title: 'Activity Breakdown (#tags)',
        query: {
            source: 'sessions', measure: 'sum_duration', group_by: ['tag'],
            chart: 'doughnut', sort: 'value_desc', tag_attribution: 'fan_out'
        }
    }
];

let dashboardCharts = {};

function _fmtNum(val, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round((val + Number.EPSILON) * factor) / factor;
}

document.addEventListener('DOMContentLoaded', () => {
    loadOverviewDashboard();
});

async function loadOverviewDashboard() {
    const grid = document.getElementById('widget_grid');
    if (!grid) return;

    const queryCtx = getQueryContext();
    const queries = {};
    OVERVIEW_SEED.forEach(w => { queries[w.key] = w.query; });
    // Widget 4's subtitle ("Tracked: Xh / Est: Yh") reuses widget 1's total for "Tracked" and
    // needs exactly one extra query for "Est".
    queries['est_total_hours'] = { source: 'tasks', measure: 'sum_estimated_duration', chart: 'tile' };

    let batchResult;
    try {
        batchResult = await api.post('/analytics/query/batch', { ...queryCtx, queries });
    } catch (err) {
        console.error('Failed to load Overview dashboard:', err);
        grid.innerHTML = '<div class="text-xs text-slate-500 py-6 text-center">Failed to load statistics.</div>';
        return;
    }

    grid.innerHTML = '';

    const kpiRow = document.createElement('div');
    kpiRow.className = 'grid grid-cols-1 md:grid-cols-4 gap-4';
    grid.appendChild(kpiRow);

    const chartRow = document.createElement('div');
    chartRow.className = 'grid grid-cols-1 md:grid-cols-2 gap-6 mt-6';
    grid.appendChild(chartRow);

    OVERVIEW_SEED.forEach(widget => {
        const result = batchResult.results[widget.key];
        if (!result) {
            console.error(`Widget '${widget.key}' failed:`, batchResult.errors[widget.key]);
            return;
        }
        if (widget.kind === 'tile') {
            kpiRow.appendChild(renderTileWidget(widget, result, batchResult));
        } else {
            chartRow.appendChild(renderChartWidget(widget, result));
        }
    });
}

function renderTileWidget(widget, result, batchResult) {
    const accent = ACCENT_CLASSES[widget.accent] || ACCENT_CLASSES.purple;
    const displayValue = widget.format(result.total);

    let subtitleHtml = '';
    if (widget.key === 'estimation_score') {
        const trackedResult = batchResult.results['total_time'];
        const estResult = batchResult.results['est_total_hours'];
        const trackedH = trackedResult ? _fmtNum(trackedResult.total || 0, 1) : 0;
        const estH = estResult ? _fmtNum(estResult.total || 0, 1) : 0;
        subtitleHtml = `<span class="text-[11px] text-blue-400 font-semibold block mt-0.5">Tracked: ${trackedH}h / Est: ${estH}h</span>`;
    }

    const card = document.createElement('div');
    card.className = 'widget-card flex items-center space-x-4';
    card.innerHTML = `
        <div class="p-3 ${accent.badge} border rounded-xl ${accent.text} text-sm font-bold">${widget.badge}</div>
        <div>
            <span class="text-xs text-slate-400 font-semibold block">${widget.title}</span>
            <span class="text-2xl font-black ${accent.text}">${displayValue}</span>
            ${subtitleHtml}
        </div>
    `;
    return card;
}

function renderChartWidget(widget, result) {
    const card = document.createElement('div');
    card.id = `widget_${widget.key}`;
    card.className = 'widget-card flex flex-col space-y-3' + (widget.clickable ? ' cursor-pointer' : '');

    const header = document.createElement('div');
    header.className = 'flex justify-between items-center';
    const titleSuffix = widget.clickable ? ' (Click to inspect)' : '';
    header.innerHTML = `<h3 class="font-bold text-sm text-slate-200">${widget.title}${titleSuffix}</h3>`;

    if (result.meta.totals_overlap) {
        const note = document.createElement('span');
        note.className = 'text-[10px] text-amber-400 font-semibold';
        note.title = 'A session tagged with multiple tags is counted in full under each tag; totals across slices will exceed 100%.';
        note.innerText = 'Totals overlap';
        header.appendChild(note);
    }
    card.appendChild(header);

    const chartWrap = document.createElement('div');
    chartWrap.className = 'h-64 relative' + (widget.kind === 'doughnut' ? ' flex items-center justify-center' : '');
    const canvas = document.createElement('canvas');
    chartWrap.appendChild(canvas);
    card.appendChild(chartWrap);

    const labels = result.rows.map(r => r.labels[0]);
    const values = result.rows.map(r => r.value || 0);
    const palette = (typeof defaultPalette !== 'undefined' && defaultPalette && defaultPalette.length)
        ? defaultPalette
        : ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

    if (dashboardCharts[widget.key]) {
        dashboardCharts[widget.key].destroy();
    }

    dashboardCharts[widget.key] = new Chart(canvas.getContext('2d'), {
        type: widget.kind === 'doughnut' ? 'doughnut' : 'bar',
        data: {
            labels,
            datasets: [{
                label: widget.title,
                data: values,
                backgroundColor: widget.kind === 'doughnut' ? palette : (palette[0] || '#8b5cf6'),
                borderRadius: widget.kind === 'bar' ? 6 : 0,
                borderWidth: widget.kind === 'doughnut' ? 0 : undefined
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: widget.kind === 'doughnut'
                    ? { position: 'right', labels: { color: '#94a3b8', boxWidth: 12 } }
                    : { display: false }
            },
            scales: widget.kind === 'bar' ? {
                x: { ticks: { color: '#64748b' }, grid: { color: '#1a1c26' } },
                y: { ticks: { color: '#64748b' }, grid: { color: '#1a1c26' } }
            } : undefined,
            onClick: widget.clickable ? (evt, elements) => {
                if (!elements.length) return;
                const row = result.rows[elements[0].index];
                handleWidgetClick(widget.key, row);
            } : undefined
        }
    });

    return card;
}

function handleWidgetClick(widgetKey, row) {
    if (!row) return;
    if (widgetKey === 'daily_trend') {
        // row.keys[0] is the local YYYY-MM-DD bucket key produced by the query engine.
        inspectDaySessions(row.keys[0]);
    } else if (widgetKey === 'tags_breakdown') {
        inspectTagSessions(row.labels[0]);
    } else if (widgetKey === 'estimation_breakdown') {
        inspectEstimationCategory(row.keys[0]);
    }
}
