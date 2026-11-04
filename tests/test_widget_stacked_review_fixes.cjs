const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function renderer() {
    const events = {}, charts = [], clicks = [];
    const element = () => ({ children: [], appendChild(child) { this.children.push(child); }, getContext() { return {}; } });
    const context = vm.createContext({
        document: { createElement: element, addEventListener: (name, fn) => { events[name] = fn; } },
        defaultPalette: ['#123456', '#abcdef'],
        chartAppearanceColors: () => ({ legend: 'legend', ticks: 'ticks', grid: 'grid' }),
        applyChartAppearance: instances => instances.forEach(chart => { chart.themed = true; }),
        Chart: function (_canvas, config) { Object.assign(this, config); this.destroy = () => { this.destroyed = true; }; charts.push(this); },
        console
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/timetrace/interfaces/api/static/js/dashboards.js'), 'utf8'), context);
    context.captureClick = (seed, row) => clicks.push({ seed, row });
    vm.runInContext('handleWidgetClick = captureClick', context);
    const draw = (rows, chart = 'stacked_bar', comparison = null, dimensions = 2) => {
        context.widget = { id: 'chart', title: 'Custom', seed_key: 'daily_trend', spec: { mode: 'structured', query: { chart } } };
        context.result = { rows, columns: Array.from({ length: dimensions }, () => ({ kind: 'dimension' })), meta: {}, comparison };
        vm.runInContext('renderChartWidget(widget, result, {clickable:true})', context);
        return charts.at(-1);
    };
    return { draw, charts, clicks, events };
}
const row = (primary, secondary, value, comparison_value = null, labels = ['Same primary', 'Same secondary']) => ({ keys: [primary, secondary], labels, value, comparison_value });
const plain = value => JSON.parse(JSON.stringify(value));

test('stacked renderer keys primary slots and secondary series independently of duplicate human labels', () => {
    const b = renderer();
    const rows = [row('task-a', 'category-a', 2), row('task-b', 'category-a', 3), row('task-a', 'category-b', 4), row('task-b', 'category-b', 5)];
    const chart = b.draw(rows);
    assert.deepEqual(plain(chart.data.labels), ['Same primary', 'Same primary']);
    assert.deepEqual(plain(chart.data.datasets.map(d => d.data)), [[2, 3], [4, 5]]);
    assert.deepEqual(plain(chart.data.datasets.map(d => d.label)), ['Same secondary', 'Same secondary']);
    assert.equal(chart.options.scales.x.stacked, true);
    assert.equal(chart.options.scales.y.stacked, true);
    assert.equal(chart.options.plugins.legend.display, true);
    assert.equal(chart.data.datasets[1].backgroundColor, '#abcdef');
});

test('sparse stacked cells retain real zero, negative and null without inventing missing rows', () => {
    const b = renderer();
    const rows = [row('a', 'x', 0), row('a', 'y', -2), row('b', 'y', null), row('c', 'x', 7)];
    const chart = b.draw(rows);
    assert.deepEqual(plain(chart.data.datasets.map(d => d.data)), [[0, null, 7], [-2, null, null]]);
    chart.options.onClick({}, [{ datasetIndex: 1, index: 0 }]);
    chart.options.onClick({}, [{ datasetIndex: 0, index: 1 }]);
    chart.options.onClick({}, [{ datasetIndex: 1, index: 1 }]);
    assert.equal(b.clicks.length, 2);
    assert.equal(b.clicks[0].row, rows[1]);
    assert.equal(b.clicks[1].row, rows[2]);
    assert.equal(b.clicks[0].seed, 'daily_trend');
});

test('stacked comparison preserves ghost cells in a distinct baseline stack with exact source click mapping', () => {
    const b = renderer();
    const rows = [row('a', 'x', 0, 4), row('b', 'x', -3, 0), row('a', 'y', null, 8), row('c', 'z', 5, null)];
    const chart = b.draw(rows, 'stacked_bar', { label: 'Previous period' });
    const primary = chart.data.datasets.filter(d => d.stack === 'primary');
    const baseline = chart.data.datasets.filter(d => d.stack === 'comparison');
    assert.deepEqual(plain(primary.map(d => d.data)), [[0, -3, null], [null, null, null], [null, null, 5]]);
    assert.deepEqual(plain(baseline.map(d => d.data)), [[4, 0, null], [8, null, null], [null, null, null]]);
    assert.ok(baseline.every(d => d.label.includes('Previous period')));
    const ghostIndex = chart.data.datasets.indexOf(baseline[1]);
    chart.options.onClick({}, [{ datasetIndex: ghostIndex, index: 0 }]);
    chart.options.onClick({}, [{ datasetIndex: ghostIndex, index: 1 }]);
    assert.equal(b.clicks.length, 1);
    assert.equal(b.clicks[0].row, rows[2]);
    assert.deepEqual(rows.map(r => r.value), [0, -3, null, 5]);
});

test('typed primary and secondary keys do not coalesce numeric-looking identities', () => {
    const chart = renderer().draw([row('00123', '1', 1), row('123', 1, 2), row(123, '1', 3)]);
    assert.deepEqual(plain(chart.data.datasets.map(d => d.data)), [[1, null, 3], [null, 2, null]]);
});

test('ordinary bar, line, doughnut and zero/one-dimensional stacked contracts stay unchanged', () => {
    const b = renderer();
    for (const [kind, dimensions] of [['bar', 2], ['line', 2], ['doughnut', 2], ['stacked_bar', 1], ['stacked_bar', 0]]) {
        const rows = [row('a', 'x', null, 3), row('a', 'y', -2, null)];
        const chart = b.draw(rows, kind, { label: 'Baseline' }, dimensions);
        assert.deepEqual(plain(chart.data.labels), ['Same primary', 'Same primary']);
        assert.deepEqual(plain(chart.data.datasets[0].data), [0, -2]);
        assert.equal(chart.data.datasets.length, kind === 'doughnut' ? 1 : 2);
        assert.equal(chart.options.scales?.x.stacked, undefined);
        chart.options.onClick({}, [{ datasetIndex: 0, index: 1 }]);
        assert.equal(b.clicks.at(-1).row, rows[1]);
    }
});

test('stacked replacement destroys only previous instance and remains in live appearance registry', () => {
    const b = renderer();
    const old = b.draw([row('a', 'x', 1)]);
    const current = b.draw([row('b', 'y', 2)]);
    assert.equal(old.destroyed, true);
    assert.equal(current.destroyed, undefined);
    b.events['timetrace:appearance']();
    assert.equal(current.themed, true);
    assert.equal(old.themed, undefined);
});
