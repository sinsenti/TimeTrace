/**
 * TimeTrace statistics dashboards.
 *
 * Widgets are DB rows now (slice 2). The page loads the dashboard list from
 * GET /api/dashboards, then renders one dashboard per tab with a single
 * POST /api/dashboards/{id}/data call that returns the widget list plus each widget's result
 * (or its own error, so one broken widget never blanks the page). The old localStorage-only
 * widget list is gone -- see _importLegacyWidgets() for the one-time hand-off.
 *
 * This file renders; it does not build. The builder/editor modal lives in widget_builder.js.
 *
 * All cell/label text goes in through textContent, never innerHTML interpolation: widget
 * titles and SQL result values are user-authored strings, and SQL widgets make that an
 * injection surface rather than a theoretical one.
 */

const ACCENT_CLASSES = {
    purple: { badge: 'bg-purple-900/40 border-purple-700/50', text: 'text-purple-400' },
    emerald: { badge: 'bg-emerald-900/40 border-emerald-700/50', text: 'text-emerald-400' },
    amber: { badge: 'bg-amber-900/40 border-amber-700/50', text: 'text-amber-400' },
    blue: { badge: 'bg-blue-900/40 border-blue-700/50', text: 'text-blue-400' }
};

/**
 * Presentation extras for the seeded Overview widgets only, keyed by `seed_key`.
 *
 * Deliberately not stored in the DB: accent colours, badge text and which drilldown a click
 * opens are how *these specific* charts have always looked, not properties of a widget spec.
 * A user-built widget gets a generic presentation derived from its result's column unit.
 */
const SEED_PRESENTATION = {
    total_time: { accent: 'purple', badge: 'LOGGED' },
    total_sessions: { accent: 'emerald', badge: 'SESSIONS' },
    total_tasks: { accent: 'amber', badge: 'TASKS' },
    estimation_score: { accent: 'blue', badge: 'ACCURACY', subtitle: 'estimation_ratio' },
    est_total_hours: { accent: 'blue', badge: 'ESTIMATE' },
    estimation_breakdown: { clickable: true },
    daily_trend: { clickable: true },
    peak_hours: {},
    tags_breakdown: { clickable: true }
};

// UI preference only (which tab was open last), never data.
const LAST_DASHBOARD_KEY = 'tt_last_dashboard_id';
// Pre-slice-2 widget specs, imported once into the Overview dashboard then renamed.
const LEGACY_WIDGETS_KEY = 'tt_custom_widgets_v1';

let dashboardCharts = {};
let dashboardList = [];
let currentDashboardId = null;
let currentDashboardData = null;

function getCurrentDashboardId() {
    return currentDashboardId;
}

function getWidgetById(widgetId) {
    if (!currentDashboardData) return null;
    return currentDashboardData.widgets.find(w => w.id === widgetId) || null;
}

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

function _measureUnit(result) {
    if (!result || !result.columns || !result.columns.length) return null;
    return result.columns[result.columns.length - 1].unit || null;
}

function _el(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
}

document.addEventListener('DOMContentLoaded', () => {
    loadDashboards();
});

// ---- Dashboard list / tabs ----

async function loadDashboards() {
    const grid = document.getElementById('widget_grid');
    if (!grid) return;

    try {
        dashboardList = await api.get('/api/dashboards');
    } catch (err) {
        console.error('Failed to load dashboards:', err);
        grid.innerHTML = '';
        grid.appendChild(_el('div', 'text-xs text-slate-500 py-6 text-center', 'Failed to load dashboards.'));
        return;
    }

    if (await _importLegacyWidgets()) {
        dashboardList = await api.get('/api/dashboards');
    }

    if (!dashboardList.length) {
        renderDashboardTabs();
        grid.innerHTML = '';
        grid.appendChild(_el('div', 'text-xs text-slate-500 py-6 text-center', 'No dashboards yet.'));
        return;
    }

    const remembered = localStorage.getItem(LAST_DASHBOARD_KEY);
    const exists = dashboardList.some(d => d.id === remembered);
    currentDashboardId = exists ? remembered : dashboardList[0].id;

    renderDashboardTabs();
    await loadDashboard(currentDashboardId);
}

/**
 * One-time hand-off of the pre-slice-2 localStorage widgets into the Overview dashboard.
 *
 * Skipping this would silently delete every widget an existing user had saved. The key is
 * renamed rather than deleted, so a failed run can still be recovered by hand, and so this
 * cannot run twice.
 */
async function _importLegacyWidgets() {
    let raw;
    try {
        raw = localStorage.getItem(LEGACY_WIDGETS_KEY);
    } catch (e) {
        return false;
    }
    if (!raw) return false;

    let specs;
    try {
        specs = JSON.parse(raw);
    } catch (e) {
        console.error('Could not parse saved widgets; leaving them untouched:', e);
        return false;
    }

    const target = dashboardList.find(d => d.slug === 'overview') || dashboardList[0];
    if (!target || !Array.isArray(specs) || !specs.length) {
        localStorage.setItem(LEGACY_WIDGETS_KEY + '_migrated', raw);
        localStorage.removeItem(LEGACY_WIDGETS_KEY);
        return false;
    }

    let imported = 0;
    for (const spec of specs) {
        if (!spec || !spec.query) continue;
        try {
            await api.post(`/api/dashboards/${target.id}/widgets`, {
                title: spec.title || 'Custom Widget',
                width: 'half',
                spec: { mode: 'structured', query: spec.query }
            });
            imported += 1;
        } catch (err) {
            console.error(`Could not import saved widget '${spec.title}':`, err.message);
        }
    }

    localStorage.setItem(LEGACY_WIDGETS_KEY + '_migrated', raw);
    localStorage.removeItem(LEGACY_WIDGETS_KEY);
    console.info(`Imported ${imported} saved widget(s) into the '${target.name}' dashboard.`);
    return imported > 0;
}

function renderDashboardTabs() {
    const bar = document.getElementById('dashboard_tabs');
    if (!bar) return;
    bar.innerHTML = '';

    dashboardList.forEach(d => {
        const isActive = d.id === currentDashboardId;
        const tab = _el(
            'button',
            'h-8 px-3 rounded-lg border text-xs font-bold transition ' + (isActive
                ? 'bg-purple-600 border-purple-500 text-white'
                : 'bg-[#181a28] border-[var(--border-muted)] text-slate-300 hover:text-white'),
            d.name
        );
        tab.onclick = () => switchDashboard(d.id);
        bar.appendChild(tab);
    });

    const addTab = _el('button',
        'h-8 px-3 rounded-lg border border-dashed border-[var(--border-muted)] text-xs font-bold text-slate-400 hover:text-white transition',
        '+ Dashboard');
    addTab.onclick = () => createDashboard();
    bar.appendChild(addTab);
}

async function switchDashboard(dashboardId) {
    currentDashboardId = dashboardId;
    localStorage.setItem(LAST_DASHBOARD_KEY, dashboardId);
    renderDashboardTabs();
    await loadDashboard(dashboardId);
}

async function createDashboard() {
    const name = prompt('Name for the new dashboard:');
    if (!name || !name.trim()) return;
    try {
        const created = await api.post('/api/dashboards', { name: name.trim() });
        dashboardList = await api.get('/api/dashboards');
        await switchDashboard(created.id);
    } catch (err) {
        alert(err.message || 'Could not create that dashboard.');
    }
}

async function renameDashboard() {
    const current = dashboardList.find(d => d.id === currentDashboardId);
    if (!current) return;
    const name = prompt('Rename dashboard:', current.name);
    if (!name || !name.trim() || name.trim() === current.name) return;
    try {
        await api.put(`/api/dashboards/${currentDashboardId}`, { name: name.trim() });
        dashboardList = await api.get('/api/dashboards');
        renderDashboardTabs();
    } catch (err) {
        alert(err.message || 'Could not rename that dashboard.');
    }
}

async function deleteDashboard() {
    const current = dashboardList.find(d => d.id === currentDashboardId);
    if (!current) return;
    if (!confirm(`Delete the dashboard "${current.name}" and all of its widgets?`)) return;
    try {
        await api.delete(`/api/dashboards/${currentDashboardId}`);
        localStorage.removeItem(LAST_DASHBOARD_KEY);
        await loadDashboards();
    } catch (err) {
        alert(err.message || 'Could not delete that dashboard.');
    }
}

async function resetDashboard() {
    const current = dashboardList.find(d => d.id === currentDashboardId);
    if (!current) return;
    if (!current.is_seeded) {
        alert('Only the seeded Overview dashboard can be reset to its default widgets.');
        return;
    }
    if (!confirm('Replace this dashboard\'s widgets with the default Overview set?')) return;
    try {
        await api.post(`/api/dashboards/${currentDashboardId}/reset`);
        await loadDashboard(currentDashboardId);
    } catch (err) {
        alert(err.message || 'Could not reset that dashboard.');
    }
}

// ---- Rendering one dashboard ----

function reloadCurrentDashboard() {
    if (currentDashboardId) loadDashboard(currentDashboardId);
}

async function loadDashboard(dashboardId) {
    const grid = document.getElementById('widget_grid');
    if (!grid) return;

    let data;
    try {
        data = await api.post(`/api/dashboards/${dashboardId}/data`, getQueryContext());
    } catch (err) {
        console.error('Failed to load dashboard:', err);
        grid.innerHTML = '';
        grid.appendChild(_el('div', 'text-xs text-slate-500 py-6 text-center', 'Failed to load this dashboard.'));
        return;
    }

    currentDashboardData = data;
    localStorage.setItem(LAST_DASHBOARD_KEY, dashboardId);

    Object.values(dashboardCharts).forEach(chart => chart.destroy());
    dashboardCharts = {};

    grid.innerHTML = '';
    grid.className = 'grid grid-cols-1 md:grid-cols-4 gap-4';

    const resetBtn = document.getElementById('reset_dashboard_btn');
    if (resetBtn) resetBtn.classList.toggle('hidden', !data.dashboard.is_seeded);

    if (!data.widgets.length) {
        grid.appendChild(_el('div', 'md:col-span-4 text-xs text-slate-500 py-6 text-center',
            'This dashboard has no widgets yet. Use "+ Add Widget" to build one.'));
        return;
    }

    data.widgets.forEach((widget, index) => {
        const card = renderWidget(widget, data, index);
        grid.appendChild(card);
    });
}

function renderWidget(widget, data, index) {
    const seed = widget.seed_key ? (SEED_PRESENTATION[widget.seed_key] || {}) : null;
    const error = data.errors[widget.id];
    const result = data.results[widget.id];
    const sqlResult = data.sql_results[widget.id];

    let card;
    if (error || (!result && !sqlResult)) {
        card = _el('div', 'widget-card space-y-2');
        card.appendChild(_el('h3', 'font-bold text-sm text-slate-200', widget.title));
        card.appendChild(_el('div', 'text-xs text-red-400', error || 'This widget produced no result.'));
    } else if (sqlResult) {
        card = renderSqlWidget(widget, sqlResult);
    } else if (result.columns && result.columns.length && _isTile(widget, result)) {
        card = renderTileWidget(widget, result, data, seed);
    } else if (_widgetChart(widget) === 'table') {
        card = renderTableWidget(widget, result);
    } else {
        card = renderChartWidget(widget, result, seed);
    }

    card.classList.add('relative');
    card.classList.add(_widgetSpanClass(widget, result));
    _addWidgetControls(card, widget, data, index);
    return card;
}

function _widgetChart(widget) {
    const spec = widget.spec;
    if (!spec) return 'table';
    return spec.mode === 'sql' ? (spec.sql.chart || 'table') : (spec.query.chart || 'bar');
}

function _isTile(widget, result) {
    return _widgetChart(widget) === 'tile';
}

function _widgetSpanClass(widget, result) {
    if (widget.width === 'full') return 'md:col-span-4';
    if (_widgetChart(widget) === 'tile') return 'md:col-span-1';
    return 'md:col-span-2';
}

function _addWidgetControls(card, widget, data, index) {
    const bar = _el('div', 'absolute top-2 right-2 flex items-center gap-1 opacity-60 hover:opacity-100');

    const mkBtn = (label, title, handler, disabled) => {
        const btn = _el('button', 'px-1 text-slate-400 hover:text-white text-xs font-bold', label);
        btn.title = title;
        if (disabled) {
            btn.disabled = true;
            btn.className += ' opacity-30 cursor-default';
        } else {
            btn.onclick = (evt) => { evt.stopPropagation(); handler(); };
        }
        return btn;
    };

    bar.appendChild(mkBtn('‹', 'Move left', () => moveWidget(widget.id, -1), index === 0));
    bar.appendChild(mkBtn('›', 'Move right', () => moveWidget(widget.id, 1),
        index === data.widgets.length - 1));
    bar.appendChild(mkBtn('Edit', 'Edit this widget', () => openWidgetEditor(widget.dashboard_id, widget.id)));
    const del = mkBtn('×', 'Remove this widget', () => deleteWidget(widget.id));
    del.className = 'px-1 text-slate-400 hover:text-red-400 text-sm font-bold';
    bar.appendChild(del);

    card.appendChild(bar);
}

async function deleteWidget(widgetId) {
    const widget = getWidgetById(widgetId);
    if (!widget) return;
    if (!confirm(`Remove the widget "${widget.title}" from this dashboard?`)) return;
    try {
        await api.delete(`/api/dashboards/${widget.dashboard_id}/widgets/${widgetId}`);
    } catch (err) {
        alert(err.message || 'Could not remove that widget.');
        return;
    }
    reloadCurrentDashboard();
}

/**
 * Move a widget one slot left/right by POSTing the whole reordered id list.
 *
 * The endpoint takes a full ordered replacement, not a swap: it rejects an id set that
 * doesn't exactly match the dashboard's widgets, so a stale page can't write a half-order.
 */
async function moveWidget(widgetId, delta) {
    if (!currentDashboardData) return;
    const ids = currentDashboardData.widgets.map(w => w.id);
    const from = ids.indexOf(widgetId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;

    ids.splice(to, 0, ids.splice(from, 1)[0]);
    try {
        await api.post(`/api/dashboards/${currentDashboardId}/widgets/reorder`, { widget_ids: ids });
    } catch (err) {
        alert(err.message || 'Could not reorder the widgets.');
        return;
    }
    reloadCurrentDashboard();
}

// ---- Widget renderers ----

function renderTileWidget(widget, result, data, seed) {
    const accent = ACCENT_CLASSES[(seed && seed.accent) || 'blue'] || ACCENT_CLASSES.blue;
    const format = _unitFormatter(_measureUnit(result));
    const badgeText = (seed && seed.badge) || _tileBadge(result);

    const card = _el('div', 'widget-card flex items-center space-x-4');
    card.appendChild(_el('div', `p-3 ${accent.badge} border rounded-xl ${accent.text} text-sm font-bold`, badgeText));

    const body = _el('div', 'min-w-0');
    body.appendChild(_el('span', 'text-xs text-slate-400 font-semibold block', widget.title));
    body.appendChild(_el('span', `text-2xl font-black ${accent.text}`, format(result.total)));

    if (seed && seed.subtitle === 'estimation_ratio') {
        const tracked = _seedTotal(data, 'total_time');
        const estimated = _seedTotal(data, 'est_total_hours');
        if (tracked !== null || estimated !== null) {
            body.appendChild(_el('span', 'text-[11px] text-blue-400 font-semibold block mt-0.5',
                `Tracked: ${_fmtNum(tracked || 0, 1)}h / Est: ${_fmtNum(estimated || 0, 1)}h`));
        }
    }

    if (result.comparison) {
        body.appendChild(_deltaLine(result, _measureUnit(result)));
    }

    card.appendChild(body);
    return card;
}

function _tileBadge(result) {
    const unit = _measureUnit(result);
    switch (unit) {
        case 'hours': return 'HOURS';
        case 'minutes': return 'MINUTES';
        case 'percent': return 'PERCENT';
        case 'count': return 'COUNT';
        default: return 'VALUE';
    }
}

function _seedTotal(data, seedKey) {
    const widget = data.widgets.find(w => w.seed_key === seedKey);
    if (!widget) return null;
    const result = data.results[widget.id];
    return result ? result.total : null;
}

/**
 * "+1.3h vs previous period" -- delta in the measure's own unit.
 *
 * Percent/score measures get points only: the API leaves delta_pct null for them, since a
 * percentage change of a percentage would read as something it is not.
 */
function _deltaLine(result, unit) {
    const row = result.rows && result.rows.length ? result.rows[0] : null;
    const delta = row ? row.delta : null;
    const label = result.comparison ? result.comparison.label : 'baseline';

    if (delta === null || delta === undefined) {
        return _el('span', 'text-[11px] text-slate-500 font-semibold block mt-0.5', `No baseline for ${label}`);
    }

    const format = _unitFormatter(unit);
    const sign = delta > 0 ? '+' : (delta < 0 ? '-' : '');
    const magnitude = format(Math.abs(delta));
    const pct = (row.delta_pct === null || row.delta_pct === undefined)
        ? '' : ` (${delta > 0 ? '+' : '-'}${_fmtNum(Math.abs(row.delta_pct), 1)}%)`;
    const tone = delta > 0 ? 'text-emerald-400' : (delta < 0 ? 'text-red-400' : 'text-slate-400');

    return _el('span', `text-[11px] ${tone} font-semibold block mt-0.5`,
        `${sign}${magnitude}${pct} vs ${label}`);
}

function renderTableWidget(widget, result) {
    const card = _el('div', 'widget-card space-y-2');
    card.appendChild(_el('h3', 'font-bold text-sm text-slate-200', widget.title));

    const table = _el('table', 'w-full text-xs text-slate-300');
    const tbody = _el('tbody');
    if (!result.rows.length) {
        const tr = _el('tr');
        tr.appendChild(_el('td', 'py-2 text-slate-500', 'No data'));
        tbody.appendChild(tr);
    }
    result.rows.forEach(r => {
        const tr = _el('tr', 'border-t border-[var(--border-color)]');
        tr.appendChild(_el('td', 'py-1 pr-3', r.labels.join(' / ')));
        tr.appendChild(_el('td', 'py-1 text-right font-bold', r.value === null ? 'n/a' : String(_fmtNum(r.value, 2))));
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);
    return card;
}

function renderChartWidget(widget, result, seed) {
    const clickable = !!(seed && seed.clickable);
    const kind = _widgetChart(widget);

    const card = _el('div', 'widget-card flex flex-col space-y-3' + (clickable ? ' cursor-pointer' : ''));
    card.id = `widget_${widget.id}`;

    const header = _el('div', 'flex justify-between items-center pr-24');
    header.appendChild(_el('h3', 'font-bold text-sm text-slate-200',
        widget.title + (clickable ? ' (Click to inspect)' : '')));

    if (result.meta.totals_overlap) {
        const note = _el('span', 'text-[10px] text-amber-400 font-semibold', 'Totals overlap');
        note.title = 'A session tagged with multiple tags is counted in full under each tag; totals across slices will exceed 100%.';
        header.appendChild(note);
    }
    card.appendChild(header);

    const chartWrap = _el('div', 'h-64 relative' + (kind === 'doughnut' ? ' flex items-center justify-center' : ''));
    const canvas = document.createElement('canvas');
    chartWrap.appendChild(canvas);
    card.appendChild(chartWrap);

    const labels = result.rows.map(r => r.labels[0]);
    const values = result.rows.map(r => r.value || 0);
    const palette = (typeof defaultPalette !== 'undefined' && defaultPalette && defaultPalette.length)
        ? defaultPalette
        : ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

    const chartType = kind === 'doughnut' ? 'doughnut' : (kind === 'line' ? 'line' : 'bar');

    const datasets = [{
        label: widget.title,
        data: values,
        backgroundColor: chartType === 'doughnut' ? palette : (palette[0] || '#8b5cf6'),
        borderColor: chartType === 'line' ? (palette[0] || '#8b5cf6') : undefined,
        fill: chartType === 'line' ? false : undefined,
        tension: chartType === 'line' ? 0.3 : undefined,
        borderRadius: chartType === 'bar' ? 6 : 0,
        borderWidth: chartType === 'doughnut' ? 0 : undefined
    }];

    // Ghost baseline series. Never on a doughnut: two overlaid rings do not read as a
    // comparison, they read as one wrong chart.
    const hasComparison = !!result.comparison && chartType !== 'doughnut';
    if (hasComparison) {
        datasets.push({
            label: result.comparison.label,
            data: result.rows.map(r => (r.comparison_value === null || r.comparison_value === undefined)
                ? null : r.comparison_value),
            backgroundColor: 'rgba(148, 163, 184, 0.25)',
            borderColor: '#94a3b8',
            borderDash: [4, 3],
            fill: false,
            tension: chartType === 'line' ? 0.3 : undefined,
            borderRadius: chartType === 'bar' ? 6 : 0,
            borderWidth: 1.5
        });
    }

    if (dashboardCharts[widget.id]) dashboardCharts[widget.id].destroy();

    dashboardCharts[widget.id] = new Chart(canvas.getContext('2d'), {
        type: chartType,
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: (chartType === 'doughnut')
                    ? { position: 'right', labels: { color: '#94a3b8', boxWidth: 12 } }
                    : { display: hasComparison, labels: { color: '#94a3b8', boxWidth: 12 } }
            },
            scales: chartType !== 'doughnut' ? {
                x: { ticks: { color: '#64748b' }, grid: { color: '#1a1c26' } },
                y: { ticks: { color: '#64748b' }, grid: { color: '#1a1c26' } }
            } : undefined,
            onClick: clickable ? (evt, elements) => {
                if (!elements.length) return;
                const row = result.rows[elements[0].index];
                handleWidgetClick(widget.seed_key, row);
            } : undefined
        }
    });

    return card;
}

/**
 * SQL-mode widget: a table by default, or a chart when the spec names a label and a value
 * column. Every cell goes in via textContent -- the values come from a user-authored query
 * and self-XSS is still XSS.
 */
function renderSqlWidget(widget, sqlResult) {
    const spec = widget.spec && widget.spec.mode === 'sql' ? widget.spec.sql : null;
    const chart = spec ? (spec.chart || 'table') : 'table';
    const labelColumn = spec ? spec.label_column : null;
    const valueColumn = spec ? spec.value_column : null;

    if (chart !== 'table' && labelColumn && valueColumn) {
        const labelIdx = sqlResult.columns.indexOf(labelColumn);
        const valueIdx = sqlResult.columns.indexOf(valueColumn);
        if (labelIdx >= 0 && valueIdx >= 0) {
            // Re-shape into the structured renderer's row format and reuse it wholesale.
            const pseudoResult = {
                columns: [{ key: 'k0', label: labelColumn, kind: 'dimension' },
                          { key: 'value', label: valueColumn, kind: 'measure', unit: null }],
                rows: sqlResult.rows.map(r => ({
                    keys: [String(r[labelIdx])],
                    labels: [r[labelIdx] === null || r[labelIdx] === undefined ? '' : String(r[labelIdx])],
                    value: Number(r[valueIdx]) || 0,
                    count: 0
                })),
                total: null,
                row_count: sqlResult.row_count,
                meta: { totals_overlap: false },
                comparison: null
            };
            return renderChartWidget(widget, pseudoResult, null);
        }
    }

    const card = _el('div', 'widget-card space-y-2');
    const header = _el('div', 'flex justify-between items-center pr-24');
    header.appendChild(_el('h3', 'font-bold text-sm text-slate-200', widget.title));
    header.appendChild(_el('span', 'text-[10px] text-slate-500 font-semibold', 'SQL'));
    card.appendChild(header);

    const wrap = _el('div', 'max-h-64 overflow-auto');
    const table = _el('table', 'w-full text-xs text-slate-300');

    const thead = _el('thead');
    const headRow = _el('tr', 'text-slate-400 font-bold');
    sqlResult.columns.forEach(col => {
        const th = _el('th', 'text-left py-1 pr-3', col);
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = _el('tbody');
    if (!sqlResult.rows.length) {
        const tr = _el('tr');
        const td = _el('td', 'py-2 text-slate-500', 'No rows');
        td.colSpan = Math.max(1, sqlResult.columns.length);
        tr.appendChild(td);
        tbody.appendChild(tr);
    }
    sqlResult.rows.forEach(row => {
        const tr = _el('tr', 'border-t border-[var(--border-color)]');
        row.forEach(cell => {
            tr.appendChild(_el('td', 'py-1 pr-3', cell === null || cell === undefined ? '' : String(cell)));
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);

    const notes = [];
    if (sqlResult.truncated) notes.push(`Showing the first ${sqlResult.row_count} rows.`);
    (sqlResult.warnings || []).forEach(w => notes.push(w));
    if (notes.length) card.appendChild(_el('div', 'text-[10px] text-amber-400', notes.join(' ')));

    return card;
}

function handleWidgetClick(seedKey, row) {
    if (!row || !seedKey) return;
    if (seedKey === 'daily_trend') {
        // row.keys[0] is the local YYYY-MM-DD bucket key produced by the query engine.
        inspectDaySessions(row.keys[0]);
    } else if (seedKey === 'tags_breakdown') {
        inspectTagSessions(row.labels[0]);
    } else if (seedKey === 'estimation_breakdown') {
        inspectEstimationCategory(row.keys[0]);
    }
}
