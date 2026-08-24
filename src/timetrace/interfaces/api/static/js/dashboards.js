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

// User-built widgets, created via the "+ Add Widget" button. Persisted only in this browser's
// localStorage -- there is no dashboard/widget table (that's slice 2's builder UI, deliberately
// not built yet), so a custom widget doesn't follow the user across devices/browsers.
const CUSTOM_WIDGETS_KEY = 'tt_custom_widgets_v1';
let capabilitiesBySource = null; // GET /analytics/capabilities, cached for the builder modal's lifetime

function _fmtNum(val, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round((val + Number.EPSILON) * factor) / factor;
}

function _unitFormatter(unit) {
    switch (unit) {
        case 'hours': return (v) => `${_fmtNum(v || 0, 1)}h`;
        case 'minutes': return (v) => `${_fmtNum(v || 0, 1)}m`;
        case 'percent': return (v) => (v === null || v === undefined) ? 'n/a' : `${_fmtNum(v, 1)}%`;
        case 'count': return (v) => `${Math.round(v || 0)}`;
        default: return (v) => (v === null || v === undefined) ? 'n/a' : `${_fmtNum(v, 2)}`;
    }
}

function _loadCustomWidgetSpecs() {
    try {
        const raw = localStorage.getItem(CUSTOM_WIDGETS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error('Failed to read saved widgets from localStorage:', e);
        return [];
    }
}

function _saveCustomWidgetSpecs(specs) {
    try {
        localStorage.setItem(CUSTOM_WIDGETS_KEY, JSON.stringify(specs));
    } catch (e) {
        console.error('Failed to save widgets to localStorage:', e);
    }
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

    const customSpecs = _loadCustomWidgetSpecs();
    customSpecs.forEach(spec => { queries[spec.key] = spec.query; });

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

    renderCustomWidgets(customSpecs, batchResult);
}

function renderCustomWidgets(specs, batchResult) {
    const section = document.getElementById('custom_widget_section');
    const grid = document.getElementById('custom_widget_grid');
    if (!section || !grid) return;

    grid.innerHTML = '';
    section.classList.toggle('hidden', specs.length === 0);

    specs.forEach(spec => {
        const result = batchResult.results[spec.key];
        if (!result) {
            console.error(`Custom widget '${spec.key}' failed:`, batchResult.errors[spec.key]);
            const errCard = document.createElement('div');
            errCard.className = 'widget-card text-xs text-red-400';
            errCard.innerHTML = `<div class="flex justify-between"><span>${spec.title} failed to load</span>` +
                `<button onclick="removeCustomWidget('${spec.key}')" class="text-slate-400 hover:text-white font-bold">&times;</button></div>`;
            grid.appendChild(errCard);
            return;
        }

        let card;
        if (spec.query.chart === 'tile') {
            card = renderTileWidget(
                { title: spec.title, badge: 'CUSTOM', accent: 'blue', format: _unitFormatter(spec.unit) },
                result
            );
        } else if (spec.query.chart === 'table') {
            card = renderTableWidget(spec, result);
        } else {
            card = renderChartWidget(
                { key: spec.key, kind: spec.query.chart, title: spec.title, clickable: false },
                result
            );
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'absolute top-3 right-3 text-slate-500 hover:text-red-400 font-bold text-sm';
        removeBtn.innerText = '×';
        removeBtn.title = 'Remove this widget';
        removeBtn.onclick = () => removeCustomWidget(spec.key);
        card.classList.add('relative');
        card.appendChild(removeBtn);

        grid.appendChild(card);
    });
}

function renderTableWidget(spec, result) {
    const card = document.createElement('div');
    card.className = 'widget-card space-y-2';
    const rowsHtml = result.rows.map(r =>
        `<tr class="border-t border-[var(--border-color)]"><td class="py-1 pr-3">${r.labels.join(' / ')}</td><td class="py-1 text-right font-bold">${r.value === null ? 'n/a' : _fmtNum(r.value, 2)}</td></tr>`
    ).join('');
    card.innerHTML = `
        <h3 class="font-bold text-sm text-slate-200">${spec.title}</h3>
        <table class="w-full text-xs text-slate-300">
            <tbody>${rowsHtml || '<tr><td class="py-2 text-slate-500">No data</td></tr>'}</tbody>
        </table>
    `;
    return card;
}

function removeCustomWidget(key) {
    const specs = _loadCustomWidgetSpecs().filter(s => s.key !== key);
    _saveCustomWidgetSpecs(specs);
    if (dashboardCharts[key]) {
        dashboardCharts[key].destroy();
        delete dashboardCharts[key];
    }
    loadOverviewDashboard();
}

// ---- Manual widget builder ----

async function _ensureCapabilitiesLoaded() {
    if (capabilitiesBySource) return capabilitiesBySource;
    const resp = await api.get('/analytics/capabilities');
    capabilitiesBySource = {};
    resp.sources.forEach(s => { capabilitiesBySource[s.source] = s; });
    return capabilitiesBySource;
}

function _fillSelect(select, options, placeholder) {
    select.innerHTML = '';
    if (placeholder) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.innerText = placeholder;
        select.appendChild(opt);
    }
    options.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.innerText = o.label;
        select.appendChild(opt);
    });
}

async function openWidgetBuilder() {
    const modal = document.getElementById('widget_builder_modal');
    if (!modal) return;

    document.getElementById('wb_title').value = '';
    document.getElementById('wb_filter_value').value = '';
    document.getElementById('wb_error').classList.add('hidden');
    document.getElementById('wb_chart').value = 'bar';
    document.getElementById('wb_date_range').value = 'all_time';
    document.getElementById('wb_tag_attribution').value = 'fan_out';
    document.getElementById('wb_filter_op').value = 'eq';

    const caps = await _ensureCapabilitiesLoaded();
    const sourceSelect = document.getElementById('wb_source');
    _fillSelect(sourceSelect, Object.keys(caps).map(src => ({ value: src, label: src.replace('_', ' ') })));
    _onWidgetBuilderSourceChange();

    modal.classList.remove('hidden');
}

function closeWidgetBuilder() {
    document.getElementById('widget_builder_modal').classList.add('hidden');
}

function _onWidgetBuilderSourceChange() {
    const source = document.getElementById('wb_source').value;
    const spec = capabilitiesBySource[source];
    if (!spec) return;

    _fillSelect(document.getElementById('wb_measure'), spec.measures.map(m => ({ value: m.value, label: m.label })));

    const dimOptions = spec.dimensions.map(d => ({ value: d.value, label: d.label }));
    _fillSelect(document.getElementById('wb_group_by_1'), dimOptions, 'None');
    _fillSelect(document.getElementById('wb_group_by_2'), dimOptions, 'None');

    _fillSelect(document.getElementById('wb_filter_field'), spec.filter_fields.map(f => ({ value: f.value, label: f.label })), 'No filter');
}

function _genWidgetKey() {
    return 'custom_' + Math.random().toString(36).slice(2, 10);
}

async function submitWidgetBuilder() {
    const errorBox = document.getElementById('wb_error');
    errorBox.classList.add('hidden');

    const title = document.getElementById('wb_title').value.trim() || 'Custom Widget';
    const source = document.getElementById('wb_source').value;
    const measure = document.getElementById('wb_measure').value;
    const groupBy1 = document.getElementById('wb_group_by_1').value;
    const groupBy2 = document.getElementById('wb_group_by_2').value;
    const chart = document.getElementById('wb_chart').value;
    const dateRangePreset = document.getElementById('wb_date_range').value;
    const tagAttribution = document.getElementById('wb_tag_attribution').value;
    const filterField = document.getElementById('wb_filter_field').value;
    const filterOp = document.getElementById('wb_filter_op').value;
    const filterValueRaw = document.getElementById('wb_filter_value').value.trim();

    if (!source || !measure) {
        errorBox.innerText = 'Pick a source and a measure.';
        errorBox.classList.remove('hidden');
        return;
    }

    const query = {
        source, measure,
        group_by: [groupBy1, groupBy2].filter(Boolean),
        chart,
        tag_attribution: tagAttribution,
        sort: 'value_desc',
        date_range: { preset: dateRangePreset }
    };

    if (filterField) {
        let values = [];
        if (filterOp !== 'is_null' && filterOp !== 'is_not_null') {
            values = filterValueRaw.split(',').map(v => v.trim()).filter(v => v.length > 0).map(v => {
                const n = Number(v);
                return (v !== '' && !Number.isNaN(n)) ? n : v;
            });
        }
        query.filters = [{ field: filterField, op: filterOp, values }];
    }

    const measureSpec = (capabilitiesBySource[source].measures || []).find(m => m.value === measure);
    const key = _genWidgetKey();
    const spec = { key, title, unit: measureSpec ? measureSpec.unit : null, query };

    // Run it once here so a bad combination (e.g. hour_of_day on a date-only source) surfaces
    // immediately in the modal instead of silently failing in the dashboard batch call later.
    try {
        await api.post('/analytics/query', { ...getQueryContext(), query });
    } catch (err) {
        errorBox.innerText = err.message || 'That combination is not supported.';
        errorBox.classList.remove('hidden');
        return;
    }

    const specs = _loadCustomWidgetSpecs();
    specs.push(spec);
    _saveCustomWidgetSpecs(specs);

    closeWidgetBuilder();
    loadOverviewDashboard();
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

    const chartType = widget.kind === 'doughnut' ? 'doughnut' : (widget.kind === 'line' ? 'line' : 'bar');

    dashboardCharts[widget.key] = new Chart(canvas.getContext('2d'), {
        type: chartType,
        data: {
            labels,
            datasets: [{
                label: widget.title,
                data: values,
                backgroundColor: chartType === 'doughnut' ? palette : (palette[0] || '#8b5cf6'),
                borderColor: chartType === 'line' ? (palette[0] || '#8b5cf6') : undefined,
                fill: chartType === 'line' ? false : undefined,
                tension: chartType === 'line' ? 0.3 : undefined,
                borderRadius: chartType === 'bar' ? 6 : 0,
                borderWidth: chartType === 'doughnut' ? 0 : undefined
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: chartType === 'doughnut'
                    ? { position: 'right', labels: { color: '#94a3b8', boxWidth: 12 } }
                    : { display: false }
            },
            scales: chartType !== 'doughnut' ? {
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
