/**
 * TimeTrace statistics dashboards.
 *
 * Saved dashboard detail supplies the canvas; each card reads through the existing
 * structured query or optional read-only SQL endpoint independently. Selection, context
 * and request identity prevent late results from replacing newer cards.
 * See _importLegacyWidgets() for the journaled local-browser hand-off.
 *
 * This file renders; it does not build. The builder/editor modal lives in widget_builder.js.
 *
 * All cell/label text goes in through textContent, never innerHTML interpolation: widget
 * titles and SQL result values are user-authored strings, and SQL widgets make that an
 * injection surface rather than a theoretical one.
 */

const ACCENT_CLASSES = {
    purple: { text: 'text-purple-400' },
    emerald: { text: 'text-emerald-400' },
    amber: { text: 'text-amber-400' },
    blue: { text: 'text-blue-400' }
};

/**
 * Presentation extras for the seeded Overview widgets only, keyed by `seed_key`.
 *
 * Deliberately not stored in the DB: accent colours, badge text and which drilldown a click
 * opens are how *these specific* charts have always looked, not properties of a widget spec.
 * A user-built widget gets a generic presentation derived from its result's column unit.
 */
// Alias only untouched historical default titles; never rewrite saved rows or custom names.
function _widgetDisplayTitle(widget) {
    if (widget.seed_key === 'total_time' && widget.title === 'Total Time Logged') return 'Recorded session time';
    if (widget.seed_key === 'total_sessions' && widget.title === 'Logged Sessions') return 'Recorded sessions';
    return widget.title;
}

const SEED_PRESENTATION = {
    total_time: { accent: 'purple', badge: 'RECORDED' },
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

document.addEventListener('timetrace:appearance', () => applyChartAppearance(Object.values(dashboardCharts)));
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
    const grid = document.getElementById('widget_grid');
    if (grid) dashboardDrag = createDashboardDrag({
        grid,
        getState: () => currentDashboardData && ({ owner: currentDashboardData,
            ids: currentDashboardData.widgets.map(w => w.id), blocked: _dashboardReorderBlocked() }),
        commit: (ids, data) => reorderDashboardWidgets(ids, data)
    });
    loadDashboards();
});

// ---- Dashboard list / tabs ----

let dashboardListGeneration = 0;
let dashboardWritePending = false;
let dashboardDrag = null;
// A failed reorder may have committed. Only a subsequent successful detail read releases it.
const dashboardReorderUncertain = new Set();
let savedDashboardNotice = '';
let dashboardNotice = { message: '', retry: null };
let dashboardDetailNoticeGeneration = null;

function _dashboardNotice(message, retry, detailGeneration = null) {
    if (detailGeneration === null) dashboardNotice = { message, retry };
    dashboardDetailNoticeGeneration = detailGeneration;
    const notice = document.getElementById('dashboard_notice');
    if (!notice) return;
    notice.innerHTML = '';
    notice.appendChild(_el('span', '', message));
    if (retry) {
        const button = _el('button', 'canvas-button', 'Retry refresh');
        button.onclick = retry;
        notice.appendChild(button);
    }
}

async function loadDashboards() {
    const grid = document.getElementById('widget_grid');
    if (!grid) return;
    const generation = ++dashboardListGeneration;
    const selection = canvasGeneration;
    let list;
    try {
        list = await api.get('/api/dashboards');
    } catch (err) {
        if (generation === dashboardListGeneration && selection === canvasGeneration) {
            _dashboardNotice(`${savedDashboardNotice}Could not refresh dashboards.`, () => loadDashboards());
        }
        return;
    }
    if (generation !== dashboardListGeneration || selection !== canvasGeneration) return;
    dashboardList = list;
    await _importLegacyWidgets();
    if (generation !== dashboardListGeneration || selection !== canvasGeneration) return;
    const remembered = currentDashboardId || localStorage.getItem(LAST_DASHBOARD_KEY);
    currentDashboardId = dashboardList.some(d => d.id === remembered) ? remembered : (dashboardList[0]?.id || null);
    renderDashboardTabs();
    _dashboardNotice(savedDashboardNotice || (dashboardWritePending ? 'Saving…' : ''));
    if (currentDashboardId) {
        localStorage.setItem(LAST_DASHBOARD_KEY, currentDashboardId);
        await loadDashboard(currentDashboardId);
    } else {
        ++canvasGeneration;
        _clearDashboardCanvas();
        grid.appendChild(_el('p', 'canvas-empty', 'No dashboards yet. Create a dashboard to add widgets.'));
    }
}

const LEGACY_IMPORT_KEY = LEGACY_WIDGETS_KEY + '_import_progress';
let legacyImportPending = false;

function _legacyNotice(message, actions = []) {
    const notice = document.getElementById('legacy_notice');
    if (!notice) return;
    notice.innerHTML = '';
    if (message) notice.appendChild(_el('span', '', message));
    actions.forEach(([label, handler]) => {
        const button = _el('button', 'canvas-button', label);
        button.onclick = handler;
        notice.appendChild(button);
    });
}

// Persist the source and every acknowledged index. A pending index is deliberately
// ambiguous after transport/storage loss: only explicit user reconciliation may resume it.
async function _importLegacyWidgets(resume = false, skipUncertain = false) {
    if (legacyImportPending) return;
    legacyImportPending = true;
    try {
        const raw = localStorage.getItem(LEGACY_WIDGETS_KEY);
        if (!raw) { _legacyNotice(''); return; }
        let specs;
        try { specs = JSON.parse(raw); } catch (err) {
            _legacyNotice('Saved browser widgets could not be read. The original source is unchanged.');
            return;
        }
        if (!Array.isArray(specs)) {
            _legacyNotice('Saved browser widgets are not a widget list. The original source is unchanged.');
            return;
        }
        const stored = localStorage.getItem(LEGACY_IMPORT_KEY);
        const progress = stored ? JSON.parse(stored) : {
            source: raw, target: (dashboardList.find(d => d.slug === 'overview') || dashboardList[0])?.id,
            completed: {}, pending: null
        };
        const target = dashboardList.find(d => d.id === progress.target);
        if (progress.source !== raw || !progress.completed || !target) {
            _legacyNotice('Browser widget import needs manual recovery: source or target changed. Original source and import progress are retained.');
            return;
        }
        const save = () => localStorage.setItem(LEGACY_IMPORT_KEY, JSON.stringify(progress));
        const uncertainMessage = () => `Browser widget import is uncertain: "${specs[progress.pending]?.title || 'Custom Widget'}" into "${target.name}". Original source and acknowledged imports are retained; nothing is automatically repeated. Review that dashboard before continuing.`;
        const retry = async () => {
            const journal = localStorage.getItem(LEGACY_IMPORT_KEY);
            if (!await window.appDialogs.confirm({title:'Review uncertain import', message:'The last import may already be saved. Review the dashboard first. Retry can create a duplicate. Continue?'})) return;
            if (localStorage.getItem(LEGACY_IMPORT_KEY) !== journal || localStorage.getItem(LEGACY_WIDGETS_KEY) !== raw) return;
            await _importLegacyWidgets(true);
            await reloadCurrentDashboard();
        };
        const verified = async () => {
            const journal = localStorage.getItem(LEGACY_IMPORT_KEY);
            if (!await window.appDialogs.confirm({title:'Review uncertain import', message:'Have you verified the uncertain widget is already saved? It will not be sent again.'})) return;
            if (localStorage.getItem(LEGACY_IMPORT_KEY) !== journal || localStorage.getItem(LEGACY_WIDGETS_KEY) !== raw) return;
            await _importLegacyWidgets(true, true);
            await reloadCurrentDashboard();
        };
        if (progress.pending !== null && !resume) {
            _legacyNotice(uncertainMessage(),
                [['Retry uncertain import', retry], ['I verified this item is saved', verified]]);
            return;
        }
        if (skipUncertain && progress.pending !== null) {
            progress.completed[progress.pending] = 'user-verified';
            progress.pending = null;
            save();
        }
        for (let index = 0; index < specs.length; index++) {
            const spec = specs[index];
            if (progress.completed[index] || !spec || !spec.query || typeof spec.query !== 'object') continue;
            progress.pending = index;
            save(); // Never send a write if recovery progress cannot be stored first.
            try {
                const widget = await api.post(`/api/dashboards/${progress.target}/widgets`, {
                    title: spec.title || 'Custom Widget', width: 'half',
                    spec: { mode: 'structured', query: spec.query }
                });
                progress.completed[index] = widget.id;
                progress.pending = null;
                save();
            } catch (err) {
                progress.pending = index;
                _legacyNotice(uncertainMessage(),
                    [['Retry uncertain import', retry], ['I verified this item is saved', verified]]);
                return;
            }
        }
        if (specs.some((spec, index) => !progress.completed[index])) {
            _legacyNotice('Valid browser widgets were imported. Unreadable entries remain in the original source; acknowledged imports will not be repeated.');
            save();
            return;
        }
        const archive = localStorage.getItem(LEGACY_WIDGETS_KEY + '_migrated');
        if (archive && archive !== raw) {
            _legacyNotice('Browser widgets imported. An earlier backup exists, so the original source and import progress are retained.');
            return;
        }
        localStorage.setItem(LEGACY_WIDGETS_KEY + '_migrated', raw);
        localStorage.removeItem(LEGACY_WIDGETS_KEY);
        localStorage.removeItem(LEGACY_IMPORT_KEY);
        _legacyNotice('Browser widgets imported and original source backed up.');
    } catch (err) {
        _legacyNotice('Browser widget import paused: recovery storage could not be read or saved. Original source is retained.');
    } finally {
        legacyImportPending = false;
    }
}

function renderDashboardTabs() {
    const bar = document.getElementById('dashboard_tabs');
    if (!bar) return;
    bar.innerHTML = '';

    dashboardList.forEach(d => {
        const isActive = d.id === currentDashboardId;
        const tab = _el(
            'button',
            'canvas-tab h-8 px-3 rounded-lg border text-xs font-bold transition ' + (isActive
                ? 'canvas-tab-active'
                : 'bg-[var(--bg-card)] border-[var(--border-muted)] text-[var(--text-main)] hover:border-[var(--text-muted)]'),
            d.name
        );
        tab.setAttribute('aria-current', isActive ? 'page' : 'false');
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

async function _writeDashboard(write, apply, refresh) {
    if (dashboardWritePending) return;
    dashboardWritePending = true;
    savedDashboardNotice = '';
    _dashboardNotice('Saving…');
    let result;
    try {
        result = await write();
    } catch (err) {
        // A transport loss can be ambiguous; never replay a write from refresh/retry.
        _dashboardNotice(`Change not acknowledged. ${err.message || ''} It may already be saved; refresh before trying again.`, () => loadDashboards());
        dashboardWritePending = false;
        return;
    }
    savedDashboardNotice = 'Saved. ';
    _dashboardNotice(savedDashboardNotice);
    try {
        await apply(result);
        await refresh();
    } catch (err) {
        _dashboardNotice('Saved. Could not refresh the display.', () => loadDashboards());
    } finally {
        dashboardWritePending = false;
    }
}

async function createDashboard() {
    if (dashboardWritePending) return;
    const selection = canvasGeneration;
    const name = await window.appDialogs.prompt({title:'New dashboard', message:'Name for the new dashboard:'});
    if (dashboardWritePending || selection !== canvasGeneration) return;
    if (!name || !name.trim()) return;
    await _writeDashboard(() => api.post('/api/dashboards', { name: name.trim() }), created => {
        dashboardList.push(created);
        if (selection === canvasGeneration) {
            ++canvasGeneration;
            currentDashboardId = created.id;
            _clearDashboardCanvas();
            document.getElementById('dashboard_title').textContent = created.name;
        }
        renderDashboardTabs();
    }, () => loadDashboards());
}

async function renameDashboard() {
    if (dashboardWritePending) return;
    const current = dashboardList.find(d => d.id === currentDashboardId);
    if (!current) return;
    const selection = canvasGeneration;
    const name = await window.appDialogs.prompt({title:'Rename dashboard', value:current.name});
    if (dashboardWritePending || selection !== canvasGeneration || currentDashboardId !== current.id) return;
    if (!name || !name.trim() || name.trim() === current.name) return;
    await _writeDashboard(() => api.put(`/api/dashboards/${current.id}`, { name: name.trim() }), updated => {
        Object.assign(current, updated);
        if (currentDashboardId === current.id) document.getElementById('dashboard_title').textContent = updated.name;
        renderDashboardTabs();
    }, () => loadDashboards());
}

async function deleteDashboard() {
    if (dashboardWritePending) return;
    const current = dashboardList.find(d => d.id === currentDashboardId);
    if (!current) return;
    const selection = canvasGeneration;
    if (!await window.appDialogs.confirm({title:'Delete dashboard?', message:`Delete the dashboard "${current.name}" and all of its widgets?`, confirmLabel:'Delete dashboard', danger:true})) return;
    if (dashboardWritePending || selection !== canvasGeneration || currentDashboardId !== current.id) return;
    await _writeDashboard(() => api.delete(`/api/dashboards/${current.id}`), () => {
        dashboardList = dashboardList.filter(d => d.id !== current.id);
        if (currentDashboardId === current.id) {
            ++canvasGeneration;
            currentDashboardId = dashboardList[0]?.id || null;
            _clearDashboardCanvas();
            localStorage.removeItem(LAST_DASHBOARD_KEY);
        }
        renderDashboardTabs();
    }, () => loadDashboards());
}

async function resetDashboard() {
    if (dashboardWritePending) return;
    const current = dashboardList.find(d => d.id === currentDashboardId);
    if (!current) return;
    if (!current.is_seeded) {
        window.appDialogs.alert({message:'Only the seeded Overview dashboard can be reset to its default widgets.'});
        return;
    }
    const selection = canvasGeneration;
    if (!await window.appDialogs.confirm({title:'Reset Overview?', message:'Replace this dashboard’s widgets with the default Overview set?', confirmLabel:'Reset widgets', danger:true})) return;
    if (dashboardWritePending || selection !== canvasGeneration || currentDashboardId !== current.id) return;
    await _writeDashboard(() => api.post(`/api/dashboards/${current.id}/reset`), () => {
        if (currentDashboardId !== current.id) return;
        ++canvasGeneration;
        _clearDashboardCanvas();
    }, () => loadDashboards());
}

// ---- Rendering one dashboard ----

function reloadCurrentDashboard() {
    return currentDashboardId ? loadDashboard(currentDashboardId) : loadDashboards();
}

let canvasGeneration = 0;

function _disposeWidgetChart(widgetId) {
    if (dashboardCharts[widgetId]) dashboardCharts[widgetId].destroy();
    delete dashboardCharts[widgetId];
}

function _clearDashboardCanvas() {
    dashboardDrag?.cancel();
    currentDashboardData = null;
    Object.keys(dashboardCharts).forEach(_disposeWidgetChart);
    document.getElementById('widget_grid').innerHTML = '';
}

async function loadDashboard(dashboardId) {
    const grid = document.getElementById('widget_grid');
    if (!grid || dashboardId !== currentDashboardId) return;
    if (dashboardDetailNoticeGeneration !== null) {
        _dashboardNotice(dashboardNotice.message, dashboardNotice.retry);
    }
    const generation = ++canvasGeneration;
    const reconcilesReorder = !dashboardWritePending && dashboardReorderUncertain.has(dashboardId);
    _clearDashboardCanvas();
    grid.appendChild(_el('p', 'canvas-empty', 'Loading dashboard…'));
    const resetBtn = document.getElementById('reset_dashboard_btn');
    if (resetBtn) resetBtn.classList.toggle('hidden', true);
    const selected = dashboardList.find(d => d.id === dashboardId);
    const heading = document.getElementById('dashboard_title');
    if (selected && heading) heading.textContent = selected.name;

    let detail;
    try {
        detail = await api.get(`/api/dashboards/${dashboardId}`);
    } catch (err) {
        if (generation !== canvasGeneration || dashboardId !== currentDashboardId) return;
        grid.innerHTML = '';
        const retryDetail = () => {
            if (generation !== canvasGeneration || dashboardId !== currentDashboardId) return;
            return loadDashboard(dashboardId);
        };
        _dashboardNotice(`${savedDashboardNotice || (dashboardWritePending ? 'Saving… ' : '')}Could not refresh this dashboard.`, retryDetail, generation);
        grid.appendChild(_el('p', 'canvas-empty', 'Failed to load this dashboard.'));
        const retry = _el('button', 'canvas-button', 'Retry refresh');
        retry.onclick = retryDetail;
        grid.appendChild(retry);
        return;
    }
    if (generation !== canvasGeneration || dashboardId !== currentDashboardId) return;
    const data = { dashboard: detail, widgets: detail.widgets, results: {}, sql_results: {}, errors: {},
        loading: {}, cards: {}, requests: {}, context: { ...getQueryContext() } };
    currentDashboardData = data;
    if (reconcilesReorder) dashboardReorderUncertain.delete(dashboardId);
    if (resetBtn) resetBtn.classList.toggle('hidden', !detail.is_seeded);
    const title = document.getElementById('dashboard_title');
    if (title) title.textContent = detail.name;
    grid.innerHTML = '';
    if (!data.widgets.length) {
        grid.appendChild(_el('p', 'canvas-empty', 'This dashboard has no widgets yet. Use "+ Add Widget" to build one.'));
    }
    data.widgets.forEach((widget, index) => {
        data.loading[widget.id] = true;
        const card = renderWidget(widget, data, index);
        data.cards[widget.id] = card;
        grid.appendChild(card);
        _loadWidget(widget, data);
    });
}

function _replaceWidget(widget, data) {
    const previous = data.cards[widget.id];
    const active = document.activeElement;
    const restoreFocus = active && previous.contains(active);
    const label = restoreFocus ? active.getAttribute('aria-label') : null;
    _disposeWidgetChart(widget.id);
    const card = renderWidget(widget, data, data.widgets.indexOf(widget));
    previous.replaceWith(card);
    data.cards[widget.id] = card;
    if (restoreFocus) {
        const target = Array.from(card.querySelectorAll('button:not(:disabled)'))
            .find(button => label && button.getAttribute('aria-label') === label) || card;
        target.focus({ preventScroll: true });
    }
}

async function _loadWidget(widget, data) {
    if (currentDashboardData !== data || !data.widgets.includes(widget)) return;
    if (JSON.stringify(data.context) !== JSON.stringify(getQueryContext())) {
        reloadCurrentDashboard();
        return;
    }
    const request = (data.requests[widget.id] || 0) + 1;
    data.requests[widget.id] = request;
    data.loading[widget.id] = true;
    delete data.errors[widget.id];
    _replaceWidget(widget, data);
    let result, error;
    try {
        if (!widget.spec) throw new Error("This widget's saved definition could not be read.");
        result = widget.spec.mode === 'sql'
            ? await api.post('/analytics/sql', widget.spec.sql)
            : await api.post('/analytics/query', { ...data.context, query: widget.spec.query });
    } catch (err) {
        error = err.message || 'This widget could not be loaded.';
    }
    if (currentDashboardData !== data || currentDashboardId !== widget.dashboard_id ||
        !data.widgets.includes(widget) || data.requests[widget.id] !== request) return;
    if (JSON.stringify(data.context) !== JSON.stringify(getQueryContext())) {
        reloadCurrentDashboard();
        return;
    }
    data.loading[widget.id] = false;
    if (error) data.errors[widget.id] = error;
    else if (widget.spec.mode === 'sql') data.sql_results[widget.id] = result;
    else data.results[widget.id] = result;
    try {
        _replaceWidget(widget, data);
    } catch (err) {
        _disposeWidgetChart(widget.id);
        data.errors[widget.id] = 'Could not display this widget. Retry to load it again.';
        _replaceWidget(widget, data);
    }
    // The seeded accuracy subtitle uses two sibling totals; their completion must not
    // depend on response order, and updating it must not rerun either healthy query.
    if (widget.seed_key === 'total_time' || widget.seed_key === 'est_total_hours') {
        const accuracy = data.widgets.find(w => w.seed_key === 'estimation_score');
        if (accuracy && data.results[accuracy.id] && !data.loading[accuracy.id]) _replaceWidget(accuracy, data);
    }
}

function renderWidget(widget, data, index) {
    const seed = widget.seed_key ? (SEED_PRESENTATION[widget.seed_key] || {}) : null;
    const error = data.errors[widget.id];
    const result = data.results[widget.id];
    const sqlResult = data.sql_results[widget.id];

    let card;
    if (data.loading && data.loading[widget.id]) {
        card = _el('div', 'widget-card space-y-2');
        card.appendChild(_el('h3', 'font-bold text-sm text-slate-200', _widgetDisplayTitle(widget)));
        card.appendChild(_el('p', 'canvas-loading', 'Loading…'));
    } else if (error || (!result && !sqlResult)) {
        card = _el('div', 'widget-card space-y-2');
        card.appendChild(_el('h3', 'font-bold text-sm text-slate-200', _widgetDisplayTitle(widget)));
        card.appendChild(_el('div', 'canvas-error', error || 'This widget produced no result.'));
        const retry = _el('button', 'canvas-button', 'Retry');
        retry.onclick = () => _loadWidget(widget, data);
        card.appendChild(retry);
    } else if (sqlResult) {
        card = renderSqlWidget(widget, sqlResult);
    } else if (result.columns && result.columns.length && _isTile(widget, result)) {
        card = renderTileWidget(widget, result, data, seed);
    } else if (_widgetChart(widget) === 'table') {
        card = renderTableWidget(widget, result);
    } else {
        card = renderChartWidget(widget, result, seed);
    }

    if (result && !error && !data.loading?.[widget.id]) {
        if (result.meta.basis) {
            const basis = result.meta.basis === 'original' ? 'Original plan' : result.meta.basis === 'current' ? 'Current schedule' : 'Recorded work union';
            card.appendChild(_el('p', 'text-xs text-slate-400', `${basis}. Values in hours. ${result.meta.cohort}`));
            if (result.meta.totals_overlap) card.appendChild(_el('p', 'text-xs text-slate-400', 'Non-additive grouped/day/plan totals may overlap; the full-range scalar is independent. Plan fills have no additive scalar.'));
            if (result.meta.physical_cohort_seconds !== undefined) {
                card.appendChild(_el('p', 'text-xs text-slate-400', `Attributed ${result.meta.attributed_total_seconds} seconds; physical cohort ${result.meta.physical_cohort_seconds} seconds; ${result.meta.cohort_count} records. Taskless/unassigned work is not task credit.`));
            }
        } else if (widget.spec?.query?.source === 'sessions') {
            card.appendChild(_el('p', 'text-xs text-slate-400', 'Legacy-inclusive session accounting; additive stored durations/counts, not explicit recorded-work unions.'));
        }
    }
    card.tabIndex = -1;
    card.dataset.widgetId = widget.id;
    card.setAttribute('aria-busy', String(!!data.loading[widget.id]));
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
    const bar = _el('div', 'canvas-widget-controls');

    const mkBtn = (label, title, handler, disabled) => {
        const btn = _el('button', 'px-1 text-slate-400 hover:text-white text-xs font-bold', label);
        btn.title = title;
        btn.dataset.widgetControl = title;
        btn.setAttribute('aria-label', `${title}: ${_widgetDisplayTitle(widget)}`);
        if (disabled) {
            btn.disabled = true;
            btn.className += ' opacity-30 cursor-default';
        } else {
            btn.onclick = (evt) => { evt.stopPropagation(); handler(); };
        }
        return btn;
    };

    const handle = mkBtn('Move', 'Move widget', () => {}, false);
    handle.draggable = true;
    handle.dataset.widgetDragHandle = '';
    handle.setAttribute('aria-describedby', 'dashboard_drag_help');
    handle.setAttribute('aria-description', `Position ${index + 1} of ${data.widgets.length}`);
    handle.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown');
    handle.title = 'Drag to reorder, or focus and use arrow keys';
    handle.classList.add('canvas-drag-handle');
    bar.appendChild(handle);
    bar.appendChild(mkBtn('Edit', 'Edit this widget', () => openWidgetEditor(widget.dashboard_id, widget.id)));
    const del = mkBtn('×', 'Remove this widget', () => deleteWidget(widget.id));
    del.className = 'px-1 text-slate-400 hover:text-red-400 text-sm font-bold';
    bar.appendChild(del);

    card.appendChild(bar);
}

function _renderSavedWidgets(data) {
    const grid = document.getElementById('widget_grid');
    const active = document.activeElement;
    const restoreFocus = active && grid.contains(active);
    const focusOwner = restoreFocus ? {
        widgetId:active.closest('[data-widget-id]')?.dataset.widgetId,
        control:active.dataset.widgetControl
    } : null;
    grid.innerHTML = '';
    if (!data.widgets.length) grid.appendChild(_el('p', 'canvas-empty', 'This dashboard has no widgets yet. Use "+ Add Widget" to build one.'));
    data.widgets.forEach((widget, index) => {
        _disposeWidgetChart(widget.id);
        const card = renderWidget(widget, data, index);
        data.cards[widget.id] = card;
        grid.appendChild(card);
    });
    if (restoreFocus) {
        const buttons = Array.from(grid.querySelectorAll('button:not(:disabled)'));
        const target = buttons.find(button => button.closest('[data-widget-id]')?.dataset.widgetId === focusOwner.widgetId &&
            button.dataset.widgetControl === focusOwner.control) || buttons[0]
            || document.querySelector('.canvas-actions button');
        if (target) target.focus();
    }
}

async function deleteWidget(widgetId) {
    if (dashboardWritePending) return;
    const data = currentDashboardData;
    const widget = getWidgetById(widgetId);
    if (!widget) return;
    const selection = canvasGeneration;
    if (!await window.appDialogs.confirm({title:'Remove widget?', message:`Remove the widget "${_widgetDisplayTitle(widget)}" from this dashboard?`, confirmLabel:'Remove widget', danger:true})) return;
    if (dashboardWritePending || selection !== canvasGeneration || data !== currentDashboardData || getWidgetById(widgetId) !== widget) return;
    await _writeDashboard(() => api.delete(`/api/dashboards/${widget.dashboard_id}/widgets/${widgetId}`), () => {
        if (data !== currentDashboardData) {
            if (currentDashboardId === widget.dashboard_id) return reloadCurrentDashboard();
            return;
        }
        _disposeWidgetChart(widgetId);
        data.widgets = data.widgets.filter(w => w.id !== widgetId);
        _renderSavedWidgets(data);
    }, async () => {});
}

function _dashboardReorderBlocked() {
    const editor = document.getElementById('widget_builder_modal');
    return dashboardWritePending || dashboardReorderUncertain.has(currentDashboardId) ||
        (editor && !editor.classList.contains('hidden')) ||
        (typeof wbSavePending !== 'undefined' && wbSavePending) ||
        (typeof wbReady !== 'undefined' && wbReady);
}

// Reorder sends the full UUID set; the existing service rejects stale/partial orders.
async function reorderDashboardWidgets(ids, data = currentDashboardData) {
    if (_dashboardReorderBlocked() || !data || data !== currentDashboardData) return;
    const previous = data.widgets.map(w => w.id);
    if (ids.length !== previous.length || new Set(ids).size !== ids.length ||
        ids.some(id => !previous.includes(id)) || ids.every((id, i) => id === previous[i])) return;
    dashboardDrag?.cancel();
    dashboardReorderUncertain.add(data.dashboard.id);
    await _writeDashboard(() => api.post(`/api/dashboards/${data.dashboard.id}/widgets/reorder`, { widget_ids: ids }), () => {
        dashboardReorderUncertain.delete(data.dashboard.id);
        if (data !== currentDashboardData) {
            if (currentDashboardId === data.dashboard.id) return reloadCurrentDashboard();
            return;
        }
        data.widgets = ids.map(id => data.widgets.find(w => w.id === id));
        _renderSavedWidgets(data);
    }, async () => {});
}

async function moveWidget(widgetId, delta) {
    if (!currentDashboardData) return;
    const ids = currentDashboardData.widgets.map(w => w.id);
    const from = ids.indexOf(widgetId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await reorderDashboardWidgets(ids);
}

// ---- Widget renderers ----

function renderTileWidget(widget, result, data, seed) {
    const accent = ACCENT_CLASSES[(seed && seed.accent) || 'blue'] || ACCENT_CLASSES.blue;
    const format = _unitFormatter(_measureUnit(result));
    const badgeText = (seed && seed.badge) || _tileBadge(result);

    const card = _el('div', 'widget-card');
    const content = _el('div', 'widget-tile-content');
    content.appendChild(_el('span', `widget-tile-label ${accent.text}`, badgeText));

    const body = _el('div', 'min-w-0');
    body.appendChild(_el('span', 'text-xs text-slate-400 font-semibold block', _widgetDisplayTitle(widget)));
    body.appendChild(_el('span', `text-2xl font-black ${accent.text}`, format(result.total)));
    const query = widget.spec?.mode === 'structured' ? widget.spec.query : null;
    const recordedMeasure = widget.seed_key === 'total_time' ? 'sum_duration'
        : widget.seed_key === 'total_sessions' ? 'session_count' : null;
    if (recordedMeasure && query?.source === 'sessions' && query.measure === recordedMeasure &&
        !query.filters?.length && !query.group_by?.length && (query.date_range?.preset || 'all_time') === 'all_time') {
        body.appendChild(_el('span', 'text-[11px] text-slate-400 block mt-0.5',
            'Includes past and future recorded rows, not only performed work.'));
    }

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

    content.appendChild(body);
    card.appendChild(content);
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
    card.appendChild(_el('h3', 'font-bold text-sm text-slate-200', _widgetDisplayTitle(widget)));

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
        _widgetDisplayTitle(widget) + (clickable ? ' (Click to inspect)' : '')));

    if (result.meta.totals_overlap) {
        const note = _el('span', 'text-[10px] text-amber-400 font-semibold', 'Totals overlap');
        note.title = result.meta.basis ? 'Whole-interval union groups and per-plan fills can overlap. The full-range scalar is calculated independently, not by summing groups.' : 'A session tagged with multiple tags is counted in full under each tag; totals across slices will exceed 100%.';
        header.appendChild(note);
    }
    card.appendChild(header);


    const stackRequested = kind === 'stacked_bar' && result.columns.filter(c => c.kind === 'dimension').length === 2;
    const seenCells = new Map();
    const collision = stackRequested && result.rows.some(row => {
        if (!seenCells.has(row.keys[0])) seenCells.set(row.keys[0], new Set());
        const secondaryKeys = seenCells.get(row.keys[0]);
        if (secondaryKeys.has(row.keys[1])) return true;
        secondaryKeys.add(row.keys[1]);
        return false;
    });
    if (collision) {
        // Serialized keys need not uniquely identify authoritative SQL groups (NULL vs empty text).
        card.appendChild(_el('p', 'text-xs text-[var(--text-main)]',
            'Repeated group keys: showing each result row as separate bars instead of stacking. Values are unchanged.'));
    }

    const chartWrap = _el('div', 'h-64 relative' + (kind === 'doughnut' ? ' flex items-center justify-center' : ''));
    const canvas = document.createElement('canvas');
    chartWrap.appendChild(canvas);
    card.appendChild(chartWrap);

    let labels = result.rows.map((r, index) => collision ? `${r.labels.join(' / ')} — row ${index + 1}` : r.labels[0]);
    const values = result.rows.map(r => collision ? r.value : (r.value || 0));
    const stacked = stackRequested && !collision;
    let stackedRows = null;
    const palette = (typeof defaultPalette !== 'undefined' && defaultPalette && defaultPalette.length)
        ? defaultPalette
        : ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

    const chartType = kind === 'doughnut' ? 'doughnut' : (kind === 'line' ? 'line' : 'bar');

    let datasets = [{
        label: _widgetDisplayTitle(widget),
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
    if (stacked) {
        const primary = new Map();
        const secondary = new Map();
        result.rows.forEach(row => {
            if (!primary.has(row.keys[0])) primary.set(row.keys[0], row.labels[0]);
            if (!secondary.has(row.keys[1])) secondary.set(row.keys[1], { label: row.labels[1], rows: new Map() });
            secondary.get(row.keys[1]).rows.set(row.keys[0], row);
        });
        labels = Array.from(primary.values());
        datasets = [];
        stackedRows = [];
        Array.from(secondary.values()).forEach((series, index) => {
            // Pivot authoritative cells, not totals. A missing cell has no value or click target.
            const rows = Array.from(primary.keys(), key => series.rows.get(key));
            datasets.push({
                label: series.label,
                data: rows.map(row => row ? row.value : null),
                backgroundColor: palette[index % palette.length],
                borderRadius: 6,
                stack: 'primary'
            });
            stackedRows.push(rows);
            if (hasComparison) {
                datasets.push({
                    label: `${series.label} — ${result.comparison.label}`,
                    data: rows.map(row => row?.comparison_value ?? null),
                    backgroundColor: 'rgba(148, 163, 184, 0.25)',
                    borderColor: '#94a3b8',
                    borderDash: [4, 3],
                    borderRadius: 6,
                    borderWidth: 1.5,
                    stack: 'comparison'
                });
                stackedRows.push(rows);
            }
        });
    } else if (hasComparison) {
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
                    ? { position: 'right', labels: { color: chartAppearanceColors().legend, boxWidth: 12 } }
                    : { display: hasComparison || stacked, labels: { color: chartAppearanceColors().legend, boxWidth: 12 } }
            },
            scales: chartType !== 'doughnut' ? {
                x: { ...(stacked ? { stacked: true } : {}), ticks: { color: chartAppearanceColors().ticks }, grid: { color: chartAppearanceColors().grid } },
                y: { ...(stacked ? { stacked: true } : {}), ticks: { color: chartAppearanceColors().ticks }, grid: { color: chartAppearanceColors().grid } }
            } : undefined,
            onClick: clickable ? (evt, elements) => {
                if (!elements.length) return;
                const { datasetIndex, index } = elements[0];
                const row = stackedRows ? stackedRows[datasetIndex]?.[index] : result.rows[index];
                if (row) handleWidgetClick(widget.seed_key, row);
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
    const notes = [];
    if (sqlResult.truncated) notes.push(`Showing the first ${sqlResult.row_count} rows.`);
    (sqlResult.warnings || []).forEach(w => notes.push(w));

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
            const card = renderChartWidget(widget, pseudoResult, null);
            if (notes.length) card.appendChild(_el('div', 'text-[10px] text-amber-400', notes.join(' ')));
            return card;
        }
    }

    const card = _el('div', 'widget-card space-y-2');
    const header = _el('div', 'flex justify-between items-center pr-24');
    header.appendChild(_el('h3', 'font-bold text-sm text-slate-200', _widgetDisplayTitle(widget)));
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
