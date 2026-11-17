const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function renderer() {
    const charts = [], clicks = [], events = {};
    const element = tag => ({ tag, children: [], appendChild(child) { this.children.push(child); }, getContext() { return {}; } });
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
    const draw = (result, kind = 'stacked_bar') => {
        const widget = { id: 'collision', title: '<literal>', seed_key: 'daily_trend', spec: { mode: 'structured', query: { chart: kind } } };
        context.widget = widget; context.result = result;
        const before = JSON.stringify({ widget, result });
        const card = vm.runInContext('renderChartWidget(widget, result, {clickable:true})', context);
        assert.equal(JSON.stringify({ widget, result }), before, 'Rendering never mutates authoritative rows or saved spec');
        return { chart: charts.at(-1), card };
    };
    return { draw, clicks, events };
}
const plain = value => JSON.parse(JSON.stringify(value));
const row = (value, comparison_value = null, keys = ['2024-02-26', ''], labels = ['Feb 26', '']) => ({ keys, labels, value, comparison_value, count: 1 });
const result = (rows, comparison = null) => ({ rows, columns: [{ kind: 'dimension' }, { kind: 'dimension' }], meta: {}, comparison });

// Captured by the real HTTP characterization: legal SQL NULL and empty-category groups,
// not an assertion that the query API should change its existing serialization policy.
test('real API duplicate serialized cells retain both authoritative duration values', () => {
    const input = process.env.TIMETRACE_COLLISION_API_RESPONSE
        ? JSON.parse(fs.readFileSync(process.env.TIMETRACE_COLLISION_API_RESPONSE, 'utf8')).result
        : result([row(1), row(2)]);
    assert.equal(input.rows.length, 2);
    assert.deepEqual(input.rows[0].keys, input.rows[1].keys);
    assert.deepEqual(input.rows.map(r => r.value).sort(), [1, 2]);
    const b = renderer();
    const { chart } = b.draw(input);
    assert.deepEqual(plain(chart.data.datasets[0].data), input.rows.map(r => r.value));
    assert.equal(chart.data.labels.length, 2);
    if (input.comparison) {
        assert.deepEqual(plain(chart.data.datasets[1].data), input.rows.map(r => r.comparison_value));
        for (const datasetIndex of [0, 1]) for (let index = 0; index < input.rows.length; index++) {
            chart.options.onClick({}, [{ datasetIndex, index }]);
            assert.equal(b.clicks.at(-1).row, input.rows[index]);
        }
    }
});

test('collision fallback preserves null zero negative baseline values order counts and exact source clicks', () => {
    const b = renderer();
    const rows = [row(null, -3), row(0, null), row(-2, 0), row(5, 7)];
    rows.forEach((r, i) => { r.count = i + 1; });
    const { chart, card } = b.draw(result(rows, { label: '<baseline>' }));
    assert.deepEqual(plain(chart.data.datasets.map(d => d.data)), [[null, 0, -2, 5], [-3, null, 0, 7]]);
    assert.equal(chart.options.scales.x.stacked, undefined);
    assert.equal(chart.options.scales.y.stacked, undefined);
    assert.deepEqual(plain(chart.data.labels), rows.map((r, i) => `${r.labels.join(' / ')} — row ${i + 1}`));
    const notice = card.children.find(child => child.textContent?.includes('separate bars'));
    assert.ok(notice, 'Visible explanation distinguishes fallback from stacking');
    assert.ok(notice.textContent.includes('Repeated group keys'));
    for (const datasetIndex of [0, 1]) for (let index = 0; index < rows.length; index++) {
        chart.options.onClick({}, [{ datasetIndex, index }]);
        assert.equal(b.clicks.at(-1).row, rows[index]);
        assert.equal(b.clicks.at(-1).row.count, index + 1);
        assert.equal(b.clicks.at(-1).seed, 'daily_trend');
    }
});

test('distinct typed keys with identical human labels remain normal sparse comparison stacks', () => {
    const b = renderer();
    const rows = [row(1, 4, ['a', 'x']), row(2, null, ['b', 'x']), row(0, -1, ['a', 'y'])];
    const { chart, card } = b.draw(result(rows, { label: 'Baseline' }));
    assert.deepEqual(plain(chart.data.datasets.map(d => d.data)), [[1, 2], [4, null], [0, null], [-1, null]]);
    assert.equal(chart.options.scales.x.stacked, true);
    assert.equal(chart.options.scales.y.stacked, true);
    assert.equal(card.children.some(child => child.textContent?.includes('separate bars')), false);
    chart.options.onClick({}, [{ datasetIndex: 3, index: 1 }]);
    assert.equal(b.clicks.length, 0, 'Sparse ghost cell has no forged source row');
});

test('collision fallback destroys previous chart and participates in live theme registry', () => {
    const b = renderer();
    const old = b.draw(result([row(1), row(2)])).chart;
    const current = b.draw(result([row(3), row(4)])).chart;
    assert.equal(old.destroyed, true);
    b.events['timetrace:appearance']();
    assert.equal(current.themed, true);
    assert.equal(old.themed, undefined);
});
