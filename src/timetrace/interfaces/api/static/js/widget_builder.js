/**
 * Widget builder / editor for the statistics dashboards (slices 2-4).
 *
 * Moved out of dashboards.js when widgets became real DB rows: this file owns the modal in
 * templates/components/widget_builder_modal.html and nothing else. It writes through
 * POST/PUT /api/dashboards/{id}/widgets and then asks dashboards.js to reload; it never
 * renders a widget itself.
 *
 * Two modes, matching the WidgetSpec discriminated union on the server:
 *   structured -> { mode: 'structured', query: AnalyticsQuery }
 *   sql        -> { mode: 'sql', sql: SqlWidgetQuery }
 * The SQL tab only appears when GET /analytics/capabilities reports sql_enabled.
 */

let capabilitiesBySource = null;  // cached GET /analytics/capabilities projection
let sqlWidgetsEnabled = false;
let wbSqlSchemaLoaded = false;
let wbMode = 'structured';
let wbEditing = null;             // { dashboardId, widgetId } when editing, else null
let wbDashboardId = null;

async function _ensureCapabilitiesLoaded() {
    if (capabilitiesBySource) return capabilitiesBySource;
    const resp = await api.get('/analytics/capabilities');
    capabilitiesBySource = {};
    resp.sources.forEach(s => { capabilitiesBySource[s.source] = s; });
    sqlWidgetsEnabled = !!resp.sql_enabled;
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

function _wbSetValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function _wbValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

function _wbShowError(message) {
    const box = document.getElementById('wb_error');
    box.innerText = message;
    box.classList.remove('hidden');
}

function _wbResetForm() {
    _wbSetValue('wb_title', '');
    _wbSetValue('wb_width', 'half');
    _wbSetValue('wb_chart', 'bar');
    _wbSetValue('wb_date_range', 'all_time');
    _wbSetValue('wb_tag_attribution', 'fan_out');
    _wbSetValue('wb_comparison', 'none');
    _wbSetValue('wb_comparison_start', '');
    _wbSetValue('wb_comparison_end', '');
    _wbSetValue('wb_filter_op', 'eq');
    _wbSetValue('wb_filter_value', '');
    _wbSetValue('wb_sql', '');
    _wbSetValue('wb_sql_limit', '200');
    _wbSetValue('wb_sql_chart', 'table');
    document.getElementById('wb_error').classList.add('hidden');
    document.getElementById('wb_sql_preview').classList.add('hidden');
    document.getElementById('wb_sql_columns').classList.add('hidden');
    document.getElementById('wb_sql_meta').innerText = '';
}

async function openWidgetBuilder(dashboardId) {
    const modal = document.getElementById('widget_builder_modal');
    if (!modal) return;

    wbEditing = null;
    wbDashboardId = dashboardId || (typeof getCurrentDashboardId === 'function' ? getCurrentDashboardId() : null);
    document.getElementById('wb_heading').innerText = 'Add Widget';
    document.getElementById('wb_submit').innerText = 'Add Widget';

    _wbResetForm();

    const caps = await _ensureCapabilitiesLoaded();
    document.getElementById('wb_mode_tabs').classList.toggle('hidden', !sqlWidgetsEnabled);
    _fillSelect(document.getElementById('wb_source'),
        Object.keys(caps).map(src => ({ value: src, label: src.replace(/_/g, ' ') })));
    _onWidgetBuilderSourceChange();
    wbSwitchMode('structured');

    modal.classList.remove('hidden');
}

async function openWidgetEditor(dashboardId, widgetId) {
    const modal = document.getElementById('widget_builder_modal');
    if (!modal) return;

    const widget = typeof getWidgetById === 'function' ? getWidgetById(widgetId) : null;
    if (!widget) return;

    wbEditing = { dashboardId, widgetId };
    wbDashboardId = dashboardId;
    document.getElementById('wb_heading').innerText = 'Edit Widget';
    document.getElementById('wb_submit').innerText = 'Save Widget';

    _wbResetForm();

    const caps = await _ensureCapabilitiesLoaded();
    document.getElementById('wb_mode_tabs').classList.toggle('hidden', !sqlWidgetsEnabled);
    _fillSelect(document.getElementById('wb_source'),
        Object.keys(caps).map(src => ({ value: src, label: src.replace(/_/g, ' ') })));

    _wbSetValue('wb_title', widget.title || '');
    _wbSetValue('wb_width', widget.width || 'half');

    const spec = widget.spec;
    if (spec && spec.mode === 'sql') {
        _wbSetValue('wb_sql', spec.sql.sql || '');
        _wbSetValue('wb_sql_limit', String(spec.sql.limit || 200));
        _wbSetValue('wb_sql_chart', spec.sql.chart || 'table');
        _onWidgetBuilderSourceChange();
        wbSwitchMode('sql');
        wbOnSqlChartChange();
        if (spec.sql.label_column || spec.sql.value_column) {
            // The column pickers are populated from a preview run; remember the saved choice
            // so the run below can re-select it.
            _wbPendingColumns = { label: spec.sql.label_column, value: spec.sql.value_column };
            wbRunSqlPreview();
        }
    } else if (spec && spec.mode === 'structured') {
        const q = spec.query;
        _wbSetValue('wb_source', q.source);
        _onWidgetBuilderSourceChange();
        _wbSetValue('wb_measure', q.measure);
        _wbSetValue('wb_group_by_1', (q.group_by && q.group_by[0]) || '');
        _wbSetValue('wb_group_by_2', (q.group_by && q.group_by[1]) || '');
        _wbSetValue('wb_chart', q.chart || 'bar');
        _wbSetValue('wb_date_range', (q.date_range && q.date_range.preset) || 'all_time');
        _wbSetValue('wb_tag_attribution', q.tag_attribution || 'fan_out');
        if (q.comparison) {
            _wbSetValue('wb_comparison', q.comparison.mode || 'none');
            _wbSetValue('wb_comparison_start', q.comparison.start_date || '');
            _wbSetValue('wb_comparison_end', q.comparison.end_date || '');
        }
        const filter = (q.filters || [])[0];
        if (filter) {
            _wbSetValue('wb_filter_field', filter.field);
            _wbSetValue('wb_filter_op', filter.op);
            _wbSetValue('wb_filter_value', (filter.values || []).join(', '));
        }
        wbSwitchMode('structured');
        wbOnComparisonChange();
    } else {
        // Unreadable stored spec: offer a blank builder rather than a half-filled one.
        _onWidgetBuilderSourceChange();
        wbSwitchMode('structured');
        _wbShowError('This widget\'s saved definition could not be read. Rebuild it below.');
    }

    modal.classList.remove('hidden');
}

function closeWidgetBuilder() {
    document.getElementById('widget_builder_modal').classList.add('hidden');
}

/**
 * Escape always closes, even while typing in the SQL textarea (which would otherwise swallow
 * it as a no-op keystroke). Ctrl+Enter submits, except from inside the SQL textarea where it
 * runs the preview instead - a bare Enter there must stay a newline, never a submit.
 */
function setupWidgetBuilderKeyboard() {
    const modal = document.getElementById('widget_builder_modal');
    if (!modal) return;
    modal.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            e.stopPropagation();
            closeWidgetBuilder();
        } else if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            const active = document.activeElement;
            if (wbMode === 'sql' && active && active.id === 'wb_sql') {
                wbRunSqlPreview();
            } else {
                submitWidgetBuilder();
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', setupWidgetBuilderKeyboard);

function wbSwitchMode(mode) {
    wbMode = (mode === 'sql' && sqlWidgetsEnabled) ? 'sql' : 'structured';
    document.getElementById('wb_pane_structured').classList.toggle('hidden', wbMode !== 'structured');
    document.getElementById('wb_pane_sql').classList.toggle('hidden', wbMode !== 'sql');

    const active = 'bg-purple-600 text-white';
    const idle = 'bg-[#181a28] text-slate-300';
    const structuredTab = document.getElementById('wb_tab_structured');
    const sqlTab = document.getElementById('wb_tab_sql');
    structuredTab.className = `flex-1 h-[30px] rounded border border-[var(--border-muted)] font-bold ${wbMode === 'structured' ? active : idle}`;
    sqlTab.className = `flex-1 h-[30px] rounded border border-[var(--border-muted)] font-bold ${wbMode === 'sql' ? active : idle}`;

    if (wbMode === 'sql') wbLoadSqlSchema();
}

function _onWidgetBuilderSourceChange() {
    const source = _wbValue('wb_source');
    const spec = capabilitiesBySource ? capabilitiesBySource[source] : null;
    if (!spec) return;

    _fillSelect(document.getElementById('wb_measure'), spec.measures.map(m => ({ value: m.value, label: m.label })));

    const dimOptions = spec.dimensions.map(d => ({ value: d.value, label: d.label }));
    _fillSelect(document.getElementById('wb_group_by_1'), dimOptions, 'None');
    _fillSelect(document.getElementById('wb_group_by_2'), dimOptions, 'None');

    _fillSelect(document.getElementById('wb_filter_field'),
        spec.filter_fields.map(f => ({ value: f.value, label: f.label })), 'No filter');
}

function wbOnGroupByChange() {
    wbOnComparisonChange();
}

/**
 * Keep the comparison controls and the alignment prerequisites consistent.
 *
 * The API rejects a day/week/month widget that has comparison on without
 * sort=dimension_asc and fill_gaps=true (positional bucket-for-bucket pairing is undefined
 * otherwise, and silently coercing the widget's own sort would change what it shows). The
 * builder therefore sets both for the user here, so only a raw API caller ever sees that
 * error. `submitWidgetBuilder` is where the flags are actually written into the spec.
 */
function wbOnComparisonChange() {
    const mode = _wbValue('wb_comparison');
    document.getElementById('wb_comparison_custom').classList.toggle('hidden', mode !== 'custom');

    const note = document.getElementById('wb_comparison_note');
    const groupBy1 = _wbValue('wb_group_by_1');
    const hasSecondGroupBy = !!_wbValue('wb_group_by_2');
    const isCalendar = ['day', 'week', 'month'].includes(groupBy1);
    const messages = [];

    if (mode !== 'none' && _wbValue('wb_date_range') === 'all_time') {
        messages.push('Pick a bounded date range: "all time" has no previous period.');
    }
    if (mode !== 'none' && isCalendar && hasSecondGroupBy) {
        messages.push('Comparison isn\'t supported with a second group-by alongside day/week/month - remove it or turn comparison off.');
    } else if (mode !== 'none' && isCalendar) {
        messages.push('Sorted by date with empty buckets filled, so the two periods line up.');
    }

    note.innerText = messages.join(' ');
    note.classList.toggle('hidden', messages.length === 0);
}

// ---- SQL mode ----

let _wbPendingColumns = null;
let _wbSqlColumns = [];

function wbOnSqlChartChange() {
    const chart = _wbValue('wb_sql_chart');
    const needsColumns = chart !== 'table';
    document.getElementById('wb_sql_columns').classList.toggle('hidden', !needsColumns || _wbSqlColumns.length === 0);
}

async function wbLoadSqlSchema() {
    if (wbSqlSchemaLoaded) return;
    const box = document.getElementById('wb_sql_schema');
    try {
        const resp = await api.get('/analytics/sql/schema');
        box.innerHTML = '';
        resp.tables.forEach(t => {
            const row = document.createElement('div');
            const name = document.createElement('span');
            name.className = 'text-purple-300 font-bold';
            name.textContent = t.name;
            const cols = document.createElement('span');
            cols.textContent = ' (' + t.columns.map(c => c.name).join(', ') + ')';
            row.appendChild(name);
            row.appendChild(cols);
            box.appendChild(row);
        });
        wbSqlSchemaLoaded = true;
    } catch (err) {
        box.textContent = 'Could not load the schema reference.';
    }
}

function wbToggleSchema() {
    const box = document.getElementById('wb_sql_schema');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) wbLoadSqlSchema();
}

async function wbRunSqlPreview() {
    const errorBox = document.getElementById('wb_error');
    errorBox.classList.add('hidden');
    const meta = document.getElementById('wb_sql_meta');

    let result;
    try {
        result = await api.post('/analytics/sql', _wbSqlSpec());
    } catch (err) {
        meta.innerText = '';
        _wbShowError(err.message || 'That query could not be run.');
        return null;
    }

    _wbSqlColumns = result.columns || [];
    const head = document.getElementById('wb_sql_preview_head');
    const body = document.getElementById('wb_sql_preview_body');
    head.innerHTML = '';
    body.innerHTML = '';

    _wbSqlColumns.forEach(col => {
        const th = document.createElement('th');
        th.className = 'text-left py-1 pr-3';
        th.textContent = col;   // textContent, never innerHTML: this is user-authored SQL output
        head.appendChild(th);
    });
    (result.rows || []).slice(0, 20).forEach(row => {
        const tr = document.createElement('tr');
        tr.className = 'border-t border-[var(--border-color)]';
        row.forEach(cell => {
            const td = document.createElement('td');
            td.className = 'py-1 pr-3';
            td.textContent = cell === null || cell === undefined ? '' : String(cell);
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });

    document.getElementById('wb_sql_preview').classList.remove('hidden');
    const notes = [`${result.row_count} row(s) in ${result.elapsed_ms}ms`].concat(result.warnings || []);
    meta.innerText = notes.join(' - ');

    const colOptions = _wbSqlColumns.map(c => ({ value: c, label: c }));
    _fillSelect(document.getElementById('wb_sql_label_column'), colOptions, 'None');
    _fillSelect(document.getElementById('wb_sql_value_column'), colOptions, 'None');
    if (_wbPendingColumns) {
        _wbSetValue('wb_sql_label_column', _wbPendingColumns.label || '');
        _wbSetValue('wb_sql_value_column', _wbPendingColumns.value || '');
        _wbPendingColumns = null;
    }
    wbOnSqlChartChange();
    return result;
}

function _wbSqlSpec() {
    const limit = parseInt(_wbValue('wb_sql_limit'), 10);
    const spec = {
        sql: _wbValue('wb_sql'),
        limit: Number.isFinite(limit) && limit > 0 ? limit : 200,
        chart: _wbValue('wb_sql_chart')
    };
    if (spec.chart !== 'table') {
        spec.label_column = _wbValue('wb_sql_label_column') || null;
        spec.value_column = _wbValue('wb_sql_value_column') || null;
    }
    return spec;
}

// ---- Save ----

function _wbStructuredQuery() {
    const source = _wbValue('wb_source');
    const measure = _wbValue('wb_measure');
    if (!source || !measure) {
        _wbShowError('Pick a source and a measure.');
        return null;
    }

    const groupBy = [_wbValue('wb_group_by_1'), _wbValue('wb_group_by_2')].filter(Boolean);
    const comparisonMode = _wbValue('wb_comparison');
    // fill_gaps keys rows by the first group-by only, so with a second dimension it collapses
    // every (bucket, dimension2) row down to one row per bucket -- only meaningful with a
    // single calendar dimension. See wbOnComparisonChange() for the matching UI guard.
    const isCalendar = groupBy.length === 1 && ['day', 'week', 'month'].includes(groupBy[0]);
    if (comparisonMode !== 'none' && groupBy.length > 1 && ['day', 'week', 'month'].includes(groupBy[0])) {
        _wbShowError('Comparison isn\'t supported with a second group-by alongside day/week/month.');
        return null;
    }

    const query = {
        source,
        measure,
        group_by: groupBy,
        chart: _wbValue('wb_chart'),
        tag_attribution: _wbValue('wb_tag_attribution'),
        sort: 'value_desc',
        fill_gaps: false,
        date_range: { preset: _wbValue('wb_date_range') }
    };

    if (comparisonMode !== 'none') {
        query.comparison = { mode: comparisonMode };
        if (comparisonMode === 'custom') {
            const start = _wbValue('wb_comparison_start');
            const end = _wbValue('wb_comparison_end');
            if (!start || !end) {
                _wbShowError('A custom comparison needs both a start and an end date.');
                return null;
            }
            query.comparison.start_date = start;
            query.comparison.end_date = end;
        }
        if (isCalendar) {
            // Required by the API for positional alignment; see wbOnComparisonChange().
            query.sort = 'dimension_asc';
            query.fill_gaps = true;
        }
    } else if (isCalendar) {
        query.sort = 'dimension_asc';
        query.fill_gaps = query.date_range.preset !== 'all_time';
    }

    const filterField = _wbValue('wb_filter_field');
    if (filterField) {
        const op = _wbValue('wb_filter_op');
        let values = [];
        if (op !== 'is_null' && op !== 'is_not_null') {
            values = _wbValue('wb_filter_value').split(',').map(v => v.trim()).filter(v => v.length > 0).map(v => {
                const n = Number(v);
                return (v !== '' && !Number.isNaN(n)) ? n : v;
            });
        }
        query.filters = [{ field: filterField, op, values }];
    }

    return query;
}

async function submitWidgetBuilder() {
    document.getElementById('wb_error').classList.add('hidden');

    const dashboardId = wbDashboardId || (typeof getCurrentDashboardId === 'function' ? getCurrentDashboardId() : null);
    if (!dashboardId) {
        _wbShowError('No dashboard selected.');
        return;
    }

    let spec;
    if (wbMode === 'sql') {
        const sqlSpec = _wbSqlSpec();
        if (!sqlSpec.sql.trim()) {
            _wbShowError('Write a SELECT query first.');
            return;
        }
        spec = { mode: 'sql', sql: sqlSpec };
    } else {
        const query = _wbStructuredQuery();
        if (!query) return;
        spec = { mode: 'structured', query };
    }

    const title = _wbValue('wb_title').trim() || (wbMode === 'sql' ? 'SQL Widget' : 'Custom Widget');
    const width = _wbValue('wb_width') || 'half';

    // The server validates the spec by running it, so a bad combination is reported here
    // rather than persisting as a permanently broken card.
    try {
        if (wbEditing) {
            await api.put(`/api/dashboards/${dashboardId}/widgets/${wbEditing.widgetId}`, { title, width, spec });
        } else {
            await api.post(`/api/dashboards/${dashboardId}/widgets`, { title, width, spec });
        }
    } catch (err) {
        _wbShowError(err.message || 'That widget could not be saved.');
        return;
    }

    closeWidgetBuilder();
    if (typeof reloadCurrentDashboard === 'function') reloadCurrentDashboard();
}
