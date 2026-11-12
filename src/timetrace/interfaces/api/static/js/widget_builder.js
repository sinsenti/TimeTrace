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
let wbOpenGeneration = 0;
let wbOriginalQuery = null;
let wbReturnFocus = null;
let wbReady = false;
let wbSavePending = false;
let wbUnreadable = false;
let wbPreviewGeneration = 0;
let wbSqlPreviewGeneration = 0;
let wbSqlInputIdentity = null;
let wbSelectionAtOpen = null;

function _wbSelection() {
    return typeof getCurrentDashboardId === 'function' ? getCurrentDashboardId() : null;
}

function _wbSnapshot() {
    return JSON.stringify(Array.from(document.getElementById('widget_builder_modal').querySelectorAll('input, select, textarea'))
        .map(el => [el.id, el.value, el.type === 'checkbox' ? el.checked : null]));
}

function _wbUpdateSaveButton() {
    document.getElementById('wb_submit').disabled = !wbReady || wbSavePending || wbUnreadable;
}

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
    if (!el) return;
    if (el.tagName === 'SELECT' && value !== '' && !Array.from(el.options).some(o => o.value === String(value))) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = `${value} (saved; unavailable)`;
        el.appendChild(option);
    }
    el.value = value;
    if (el.type === 'date' && value && el.value !== value) {
        el.type = 'text'; // Retain invalid saved input for explicit correction, never erase it.
        el.value = value;
    }
}

function _wbValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

function _wbSqlInputIdentity() {
    return JSON.stringify([_wbValue('wb_sql'), _wbValue('wb_sql_limit'), _wbValue('wb_sql_chart')]);
}

function _wbShowError(message) {
    const box = document.getElementById('wb_error');
    box.innerText = message;
    box.classList.remove('hidden');
}

function _wbResetForm() {
    wbSqlInputIdentity = null;
    wbReady = false;
    wbUnreadable = false;
    _wbUpdateSaveButton();
    wbOriginalQuery = null;
    ['wb_range_start', 'wb_range_end', 'wb_comparison_start', 'wb_comparison_end'].forEach(id => { document.getElementById(id).type = 'date'; });
    _wbSetValue('wb_sort', 'value_desc');
    _wbSetValue('wb_limit', '200');
    document.getElementById('wb_fill_gaps').checked = false;
    ['wb_source', 'wb_measure', 'wb_group_by_1', 'wb_group_by_2', 'wb_filter_field'].forEach(id => _wbSetValue(id, ''));
    _wbSetValue('wb_range_start', '');
    _wbSetValue('wb_range_end', '');
    document.getElementById('wb_filters_extra').innerHTML = '';
    document.getElementById('wb_preview_result').classList.add('hidden');
    _wbPendingColumns = null;
    _wbSqlColumns = [];
    _wbSetValue('wb_sql_label_column', '');
    _wbSetValue('wb_sql_value_column', '');
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

async function _wbLoadCapabilities(modal) {
    const generation = ++wbOpenGeneration;
    const selection = _wbSelection();
    const context = JSON.stringify(getQueryContext());
    modal.classList.add('hidden');
    let caps;
    try {
        caps = await _ensureCapabilitiesLoaded();
    } catch (err) {
        if (generation === wbOpenGeneration) alert('Could not load widget capabilities. Reopen the builder to retry.');
        return null;
    }
    if (generation !== wbOpenGeneration || selection !== _wbSelection() || context !== JSON.stringify(getQueryContext())) return null;
    wbSelectionAtOpen = selection;
    document.getElementById('wb_mode_tabs').classList.toggle('hidden', !sqlWidgetsEnabled);
    _fillSelect(document.getElementById('wb_source'),
        Object.keys(caps).map(src => ({ value: src, label: src.replace(/_/g, ' ') })));
    return generation;
}

async function openWidgetBuilder(dashboardId) {
    const modal = document.getElementById('widget_builder_modal');
    if (!modal) return;

    wbReturnFocus = document.activeElement;
    wbEditing = null;
    wbDashboardId = dashboardId || (typeof getCurrentDashboardId === 'function' ? getCurrentDashboardId() : null);
    document.getElementById('wb_heading').innerText = 'Add Widget';
    document.getElementById('wb_submit').innerText = 'Add Widget';

    _wbResetForm();

    if (await _wbLoadCapabilities(modal) !== wbOpenGeneration) return;
    _onWidgetBuilderSourceChange();
    wbSwitchMode('structured');

    wbOnComparisonChange(false);
    const context = getQueryContext();
    document.getElementById('wb_context').textContent = `Requested timezone: ${context.timezone}. Week starts: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][context.first_day_of_week]}. Buckets use local session start dates; preview reports the daemon's effective context and any fallback warnings.`;
    wbSyncFilters();
    wbReady = true;
    _wbUpdateSaveButton();
    modal.classList.remove('hidden');
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('widget_builder_modal');
    document.getElementById('wb_title').focus();
}

async function openWidgetEditor(dashboardId, widgetId) {
    const modal = document.getElementById('widget_builder_modal');
    if (!modal) return;

    const widget = typeof getWidgetById === 'function' ? getWidgetById(widgetId) : null;
    if (!widget) return;

    wbReturnFocus = document.activeElement;
    wbEditing = { dashboardId, widgetId };
    wbDashboardId = dashboardId;
    document.getElementById('wb_heading').innerText = 'Edit Widget';
    document.getElementById('wb_submit').innerText = 'Save Widget';

    _wbResetForm();

    if (await _wbLoadCapabilities(modal) !== wbOpenGeneration) return;

    _wbSetValue('wb_title', widget.title || '');
    _wbSetValue('wb_width', widget.width || 'half');

    const spec = widget.spec;
    if (spec && spec.mode === 'sql') {
        _wbSetValue('wb_sql', spec.sql.sql || '');
        _wbSetValue('wb_sql_limit', String(spec.sql.limit || 200));
        _wbSetValue('wb_sql_chart', spec.sql.chart || 'table');
        _onWidgetBuilderSourceChange();
        if (!sqlWidgetsEnabled) {
            wbUnreadable = true;
            _wbShowError('This saved SQL widget is retained, but SQL widgets are disabled on this daemon.');
        }
        wbSwitchMode('sql');
        wbOnSqlChartChange();
        if (spec.sql.label_column || spec.sql.value_column) {
            // Saved choices own the form immediately; preview only enriches the options.
            _wbPendingColumns = { label: spec.sql.label_column, value: spec.sql.value_column };
            ['wb_sql_label_column', 'wb_sql_value_column'].forEach(id => _fillSelect(document.getElementById(id), [], 'None'));
            _wbSetValue('wb_sql_label_column', spec.sql.label_column || '');
            _wbSetValue('wb_sql_value_column', spec.sql.value_column || '');
            wbOnSqlChartChange();
            wbRunSqlPreview();
        }
    } else if (spec && spec.mode === 'structured') {
        const q = spec.query;
        wbOriginalQuery = JSON.parse(JSON.stringify(q));
        _wbSetValue('wb_source', q.source);
        _onWidgetBuilderSourceChange();
        _wbSetValue('wb_sort', q.sort || 'value_desc');
        _wbSetValue('wb_limit', q.limit === undefined ? '200' : String(q.limit));
        document.getElementById('wb_fill_gaps').checked = !!q.fill_gaps;
        _wbSetValue('wb_range_start', q.date_range?.start_date || '');
        _wbSetValue('wb_range_end', q.date_range?.end_date || '');
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
            _wbSetValue('wb_filter_value', JSON.stringify(filter.values || []));
        }
        (q.filters || []).slice(1).forEach(filter => wbAddFilter(filter));
        wbSwitchMode('structured');
        wbOnComparisonChange(false);
    } else {
        wbUnreadable = true;
        // An unreadable saved definition must never be overwritten with defaults.
        _onWidgetBuilderSourceChange();
        wbSwitchMode('structured');
        _wbShowError('This widget\'s saved definition could not be read. It has not been changed. Close this editor and create a new widget instead.');
    }

    wbOnComparisonChange(false);
    const context = getQueryContext();
    document.getElementById('wb_context').textContent = `Requested timezone: ${context.timezone}. Week starts: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][context.first_day_of_week]}. Buckets use local session start dates; preview reports the daemon's effective context and any fallback warnings.`;
    wbSyncFilters();
    wbReady = true;
    _wbUpdateSaveButton();
    modal.classList.remove('hidden');
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('widget_builder_modal');
    document.getElementById('wb_title').focus();
}

function closeWidgetBuilder() {
    ++wbOpenGeneration;
    wbReady = false;
    _wbUpdateSaveButton();
    document.getElementById('widget_builder_modal').classList.add('hidden');
    const target = wbReturnFocus?.isConnected && wbReturnFocus.getClientRects().length ? wbReturnFocus
        : document.querySelector('.canvas-actions button');
    if (target) target.focus({ preventScroll: true });
}

/**
 * Escape always closes, even while typing in the SQL textarea (which would otherwise swallow
 * it as a no-op keystroke). Ctrl+Enter submits, except from inside the SQL textarea where it
 * runs the preview instead - a bare Enter there must stay a newline, never a submit.
 */
function setupWidgetBuilderKeyboard() {
    const modal = document.getElementById('widget_builder_modal');
    if (!modal) return;
    modal.addEventListener('input', wbInvalidatePreview);
    modal.addEventListener('change', wbInvalidatePreview);
    modal.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            e.stopPropagation();
            closeWidgetBuilder();
        } else if (e.key === 'Tab') {
            const fields = Array.from(modal.querySelectorAll('button:not(:disabled), a[href], input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), summary'))
                .filter(el => el.getClientRects().length);
            const first = fields[0], last = fields[fields.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        } else if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
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
    wbMode = (mode === 'sql' && (sqlWidgetsEnabled || wbUnreadable)) ? 'sql' : 'structured';
    _wbSetValue('wb_mode', wbMode);
    document.getElementById('wb_pane_structured').classList.toggle('hidden', wbMode !== 'structured');
    document.getElementById('wb_pane_sql').classList.toggle('hidden', wbMode !== 'sql');

    document.getElementById('wb_tab_structured').setAttribute('aria-pressed', String(wbMode === 'structured'));
    document.getElementById('wb_tab_sql').setAttribute('aria-pressed', String(wbMode === 'sql'));

    if (wbMode === 'sql' && sqlWidgetsEnabled) wbLoadSqlSchema();
}

function _onWidgetBuilderSourceChange() {
    const source = _wbValue('wb_source');
    const spec = capabilitiesBySource ? capabilitiesBySource[source] : null;
    if (!spec) { _wbShowError('This source is unavailable. Its saved definition is retained for correction.'); return; }

    const refill = (id, options, placeholder) => {
        const value = _wbValue(id);
        _fillSelect(document.getElementById(id), options, placeholder);
        if (wbOriginalQuery || value && options.some(o => o.value === value)) _wbSetValue(id, value);
    };
    refill('wb_measure', spec.measures.map(m => ({ value: m.value, label: m.label })));
    const dimensions = spec.dimensions.map(d => ({ value: d.value, label: d.label }));
    refill('wb_group_by_1', dimensions, 'None');
    refill('wb_group_by_2', dimensions, 'None');
    const fields = spec.filter_fields.map(f => ({ value: f.value, label: f.label }));
    document.querySelectorAll('#wb_filters .wb-filter-row').forEach(row => refill(row.querySelector('select').id, fields, 'No filter'));
    wbSyncFilters();

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
function wbOnComparisonChange(align = true) {
    document.getElementById('wb_range_custom').classList.toggle('hidden', _wbValue('wb_date_range') !== 'custom');
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
        messages.push('Calendar comparison requires ascending date sort and filled empty buckets, so the periods line up.');
    }

    if (align && mode !== 'none' && isCalendar && !hasSecondGroupBy) {
        _wbSetValue('wb_sort', 'dimension_asc');
        document.getElementById('wb_fill_gaps').checked = true;
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
    const hasChoices = _wbSqlColumns.length > 0 || _wbValue('wb_sql_label_column') || _wbValue('wb_sql_value_column');
    document.getElementById('wb_sql_columns').classList.toggle('hidden', !needsColumns || !hasChoices);
}

async function wbLoadSqlSchema() {
    if (wbSqlSchemaLoaded) return;
    const box = document.getElementById('wb_sql_schema');
    const generation = wbOpenGeneration;
    try {
        const resp = await api.get('/analytics/sql/schema');
        if (generation !== wbOpenGeneration) return;
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
        if (generation !== wbOpenGeneration) return;
        box.textContent = 'Could not load the schema reference.';
    }
}

function wbToggleSchema() {
    const box = document.getElementById('wb_sql_schema');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) wbLoadSqlSchema();
}

async function wbRunSqlPreview() {
    if (!sqlWidgetsEnabled) { _wbShowError('SQL widgets are disabled on this daemon.'); return null; }
    const generation = wbOpenGeneration;
    const request = ++wbSqlPreviewGeneration;
    const selection = _wbSelection();
    const spec = _wbSqlSpec();
    const snapshot = _wbSqlInputIdentity();
    wbSqlInputIdentity = snapshot;
    const current = () => generation === wbOpenGeneration && request === wbSqlPreviewGeneration && selection === _wbSelection() && snapshot === _wbSqlInputIdentity();
    const errorBox = document.getElementById('wb_error');
    errorBox.classList.add('hidden');
    const meta = document.getElementById('wb_sql_meta');
    document.getElementById('wb_sql_preview').classList.add('hidden');
    meta.innerText = 'Loading SQL preview…';

    let result;
    try {
        result = await api.post('/analytics/sql', spec);
    } catch (err) {
        if (!current()) return null;
        meta.innerText = 'Preview unavailable. Your inputs are retained; run preview again to retry.';
        _wbShowError(err.message || 'That query could not be run.');
        return null;
    }

    if (!current()) return null;
    const columnDrafts = ['wb_sql_label_column', 'wb_sql_value_column'].map(id => ({
        id, value: _wbValue(id), dirty: typeof hasSettingsDrafts === 'function' && hasSettingsDrafts(['widget_builder_modal'], `#${id}`)
    }));
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
    const notes = [`${result.row_count} row(s) in ${result.elapsed_ms}ms`];
    if ((result.rows || []).length > 20) notes.push('Showing the first 20 preview rows.');
    if (result.truncated) notes.push('The server truncated this result at the row limit.');
    meta.innerText = notes.concat(result.warnings || []).join(' - ');

    const pendingColumns = _wbPendingColumns;
    const colOptions = _wbSqlColumns.map(c => ({ value: c, label: c }));
    _fillSelect(document.getElementById('wb_sql_label_column'), colOptions, 'None');
    _fillSelect(document.getElementById('wb_sql_value_column'), colOptions, 'None');
    if (_wbPendingColumns) {
        _wbSetValue('wb_sql_label_column', _wbPendingColumns.label || '');
        _wbSetValue('wb_sql_value_column', _wbPendingColumns.value || '');
        _wbPendingColumns = null;
    }
    columnDrafts.forEach(({id, value, dirty}) => {
        if (dirty || !pendingColumns) _wbSetValue(id, value);
        if (!dirty && typeof rememberSettingsDraft === 'function') rememberSettingsDraft('widget_builder_modal', `#${id}`);
    });
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

function wbInvalidatePreview(event) {
    if (['wb_sql', 'wb_sql_limit', 'wb_sql_chart'].includes(event?.target?.id) && _wbSqlInputIdentity() !== wbSqlInputIdentity) {
        // Textarea change arrives on blur, possibly after Ctrl+Enter already previewed this input.
        wbSqlInputIdentity = _wbSqlInputIdentity();
        ++wbSqlPreviewGeneration;
        document.getElementById('wb_sql_preview').classList.add('hidden');
        document.getElementById('wb_sql_meta').innerText = 'Inputs changed. Run SQL preview to update the result.';
    }
    ++wbPreviewGeneration;
    const box = document.getElementById('wb_preview_result');
    if (!box.classList.contains('hidden')) box.textContent = 'Inputs changed. Run query preview to update the result.';
}

function wbAddFilter(filter = null) {
    if (document.querySelectorAll('#wb_filters .wb-filter-row').length >= 20) { _wbShowError('Use at most 20 filters.'); return; }
    const row = document.getElementById('wb_filter_first').cloneNode(true);
    const suffix = `_${++wbFilterCounter}`;
    row.id = `wb_filter_row${suffix}`;
    row.querySelectorAll('input, select').forEach(el => { el.id += suffix; });
    row.querySelectorAll('label[for]').forEach(el => { el.htmlFor += suffix; });
    row.querySelector('button').onclick = () => { row.remove(); wbSyncFilters(); wbInvalidatePreview(); };
    document.getElementById('wb_filters_extra').appendChild(row);
    const fields = row.querySelectorAll('select, input');
    _fillSelect(fields[0], (capabilitiesBySource[_wbValue('wb_source')]?.filter_fields || []).map(f => ({ value: f.value, label: f.label })), 'No filter');
    fields[0].value = '';
    fields[1].value = 'eq';
    fields[2].value = '';
    if (filter) {
        _wbSetValue(fields[0].id, filter.field);
        _wbSetValue(fields[1].id, filter.op);
        fields[2].value = JSON.stringify(filter.values || []);
    }
    wbSyncFilters();
    wbInvalidatePreview();
}

let wbFilterCounter = 0;

function wbSyncFilters() {
    // A stable field makes row additions/removals visible to the shared departure guard.
    _wbSetValue('wb_filters_state', JSON.stringify(Array.from(document.querySelectorAll('#wb_filters .wb-filter-row')).map(row =>
        Array.from(row.querySelectorAll('input, select')).map(el => el.value))));
}

function _wbDatesValid(start, end, label) {
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    for (const value of [start, end]) {
        dateInput.value = value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || dateInput.value !== value) {
            _wbShowError(`${label} needs valid start and end dates (YYYY-MM-DD).`); return false;
        }
    }
    if (end < start) { _wbShowError(`${label} end must not be before its start.`); return false; }
    return true;
}

function _wbStructuredQuery() {
    const source = _wbValue('wb_source');
    const measure = _wbValue('wb_measure');
    if (!source || !measure) { _wbShowError('Pick a source and a measure.'); return null; }
    const query = {
        ...wbOriginalQuery,
        source, measure,
        group_by: [_wbValue('wb_group_by_1'), _wbValue('wb_group_by_2')].filter(Boolean),
        chart: _wbValue('wb_chart'),
        tag_attribution: _wbValue('wb_tag_attribution'),
        sort: _wbValue('wb_sort'),
        limit: Number(_wbValue('wb_limit')),
        fill_gaps: document.getElementById('wb_fill_gaps').checked,
        date_range: { ...wbOriginalQuery?.date_range, preset: _wbValue('wb_date_range') },
        filters: []
    };
    if (query.fill_gaps && query.group_by.length > 1 &&
        ['day', 'week', 'month', 'hour_of_day', 'weekday'].includes(query.group_by[0])) {
        _wbShowError('Fill empty buckets supports one time dimension only. Uncheck Fill empty buckets or remove the second group-by dimension.');
        return null;
    }
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 2000) {
        _wbShowError('Row limit must be a whole number from 1 to 2000.'); return null;
    }
    if (query.date_range.preset === 'custom') {
        query.date_range.start_date = _wbValue('wb_range_start');
        query.date_range.end_date = _wbValue('wb_range_end');
        if (!_wbDatesValid(query.date_range.start_date, query.date_range.end_date, 'Custom date range')) return null;
    }
    const mode = _wbValue('wb_comparison');
    if (mode !== 'none') {
        query.comparison = { ...wbOriginalQuery?.comparison, mode };
        if (mode === 'custom') {
            query.comparison.start_date = _wbValue('wb_comparison_start');
            query.comparison.end_date = _wbValue('wb_comparison_end');
            if (!_wbDatesValid(query.comparison.start_date, query.comparison.end_date, 'Custom comparison')) return null;
        }
    } else if (wbOriginalQuery?.comparison?.mode !== 'none') query.comparison = null;
    try {
        document.querySelectorAll('#wb_filters .wb-filter-row').forEach(row => {
            const [field, op, input] = row.querySelectorAll('select, input');
            if (!field.value) return;
            let values;
            if (input.value.trim().startsWith('[')) {
                values = JSON.parse(input.value);
                if (!Array.isArray(values) || values.some(v => !['string', 'number', 'boolean'].includes(typeof v))) {
                    throw new Error('Filter values must be text, numbers or booleans in a JSON array.');
                }
            } else values = input.value.split(',').map(v => v.trim()).filter(Boolean);
            query.filters.push({ field: field.value, op: op.value, values });
        });
    } catch (err) { _wbShowError(`Filter values: ${err.message}`); return null; }
    if (query.filters.length > 20) { _wbShowError('Use at most 20 filters.'); return null; }
    return query;
}

async function wbRunStructuredPreview() {
    if (!wbReady || wbMode !== 'structured') return;
    const request = ++wbPreviewGeneration;
    const query = _wbStructuredQuery();
    if (!query) return;
    const generation = wbOpenGeneration;
    const context = { ...getQueryContext() };
    const selection = _wbSelection();
    const snapshot = _wbSnapshot();
    const current = () => generation === wbOpenGeneration && request === wbPreviewGeneration &&
        snapshot === _wbSnapshot() && selection === _wbSelection() && JSON.stringify(context) === JSON.stringify(getQueryContext());
    const box = document.getElementById('wb_preview_result');
    document.getElementById('wb_error').classList.add('hidden');
    box.classList.remove('hidden');
    box.textContent = 'Loading preview…';
    try {
        const result = await api.post('/analytics/query', { ...context, query });
        if (!current()) {
            if (generation === wbOpenGeneration && request === wbPreviewGeneration) box.textContent = 'Query context changed. Run query preview to update the result.';
            return;
        }
        box.innerHTML = '';
        const meta = document.createElement('p');
        meta.textContent = `${result.row_count} rows · ${result.meta.timezone} · week starts ${result.meta.first_day_of_week} · ${result.meta.range_start_utc || 'all time'} → ${result.meta.range_end_utc || 'unbounded'}`;
        box.appendChild(meta);
        if (result.comparison) {
            const baseline = document.createElement('p');
            baseline.textContent = result.comparison.label;
            box.appendChild(baseline);
        }
        const notes = [...result.meta.warnings];
        if (result.meta.totals_overlap) notes.push('Fan-out: totals overlap across tags.');
        if (result.meta.truncated) notes.push('Results truncated at the row limit.');
        notes.forEach(text => { const note = document.createElement('p'); note.textContent = text; box.appendChild(note); });
        const table = document.createElement('table');
        const header = table.createTHead().insertRow();
        [...result.columns.map(c => c.label), ...(result.comparison ? ['Baseline', 'Change'] : [])].forEach(text => {
            const th = document.createElement('th'); th.textContent = text; header.appendChild(th);
        });
        const body = table.createTBody();
        result.rows.slice(0, 20).forEach(row => {
            const tr = body.insertRow();
            [...row.labels, row.value, ...(result.comparison ? [row.comparison_value, row.delta] : [])].forEach(value => {
                tr.insertCell().textContent = value === null ? '—' : String(value);
            });
        });
        box.appendChild(table);
        if (result.rows.length > 20) {
            const note = document.createElement('p'); note.textContent = 'Showing the first 20 preview rows.'; box.appendChild(note);
        }
    } catch (err) {
        if (!current()) return;
        box.textContent = 'Preview unavailable. Your inputs are retained; run preview again to retry.';
        _wbShowError(err.message || 'Could not preview this query.');
    }
}

async function submitWidgetBuilder() {
    if (!wbReady || wbSavePending || wbUnreadable) return;
    if (wbSelectionAtOpen !== _wbSelection()) {
        _wbShowError('Dashboard selection changed. Close this editor and reopen the widget on its dashboard. Your inputs have not been saved.');
        return;
    }
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

    // Capture the owner and submitted fields before awaiting: only this submission may
    // checkpoint them. A late acknowledgement cannot close or hydrate another editor.
    const generation = wbOpenGeneration;
    const context = JSON.stringify(getQueryContext());
    const selection = _wbSelection();
    const editing = wbEditing && { ...wbEditing };
    const snapshot = _wbSnapshot();
    const checkpoint = settingsDraftCheckpoint('widget_builder_modal');
    let closedAfterSave = false;
    const currentOwner = () => generation === wbOpenGeneration && wbReady &&
        selection === _wbSelection() && context === JSON.stringify(getQueryContext());
    wbSavePending = true;
    _wbUpdateSaveButton();
    try {
        // Canvas owns mutation acknowledgement and read-only recovery. Its retry only
        // reloads detail/cards, never repeats this POST/PUT, even if that read fails.
        await _writeDashboard(async () => {
            try {
                return editing
                    ? await api.put(`/api/dashboards/${dashboardId}/widgets/${editing.widgetId}`, { title, width, spec })
                    : await api.post(`/api/dashboards/${dashboardId}/widgets`, { title, width, spec });
            } catch (err) {
                if (currentOwner()) _wbShowError(err.message || 'That widget could not be saved. Your inputs are retained.');
                throw err;
            }
        }, saved => {
            if (!currentOwner()) {
                if (generation === wbOpenGeneration && wbReady) {
                    wbUnreadable = true;
                    _wbShowError('Saved. Query context changed while saving. Your current inputs are retained; close and refresh the dashboard to edit the saved widget. Do not repeat this write.');
                }
                return;
            }
            checkpoint();
            wbEditing = { dashboardId, widgetId: saved.id };
            wbOriginalQuery = saved.spec?.mode === 'structured' ? saved.spec.query : null;
            document.getElementById('wb_heading').innerText = 'Edit Widget';
            document.getElementById('wb_submit').innerText = 'Save Widget';
            if (_wbSnapshot() === snapshot) { closedAfterSave = true; closeWidgetBuilder(); }
        }, () => {
            if (generation !== wbOpenGeneration && !(closedAfterSave && generation + 1 === wbOpenGeneration)) return;
            if (dashboardId !== getCurrentDashboardId() || context !== JSON.stringify(getQueryContext())) return;
            return Promise.resolve(reloadCurrentDashboard()).then(() => {
                if (!closedAfterSave || generation + 1 !== wbOpenGeneration || document.activeElement !== document.body) return;
                const card = Array.from(document.querySelectorAll('[data-widget-id]')).find(el => el.dataset.widgetId === (editing?.widgetId || wbEditing?.widgetId));
                const target = card?.querySelector('button') || document.querySelector('.canvas-actions button');
                target?.focus({ preventScroll: true });
            });
        });
    } finally {
        wbSavePending = false;
        _wbUpdateSaveButton();
    }
}
