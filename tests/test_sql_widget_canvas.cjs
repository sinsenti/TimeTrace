const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');

class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.className = ''; this._text = ''; }
    appendChild(child) { this.children.push(child); return child; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(' '); }
    set innerHTML(value) { assert.equal(value, '', 'untrusted output must never be interpreted as HTML'); this.children = []; }
    getContext() { return { canvas: this }; }
}

const warning = 'Row limit reduced to the server maximum of 2. <img src=x onerror="FAKE_13">';
const result = {
    columns: ['label', 'amount'], rows: [['<svg onload="FAKE_LABEL_13">', 0], [null, 2.5]],
    row_count: 2, truncated: true, elapsed_ms: 4, warnings: [warning, 'Result truncated to 2 rows.']
};
function render(chart, labelColumn = 'label') {
    const charts = [];
    const context = vm.createContext({
        document: { addEventListener() {}, createElement: tag => new Element(tag), documentElement: {} },
        localStorage: { getItem: () => null },
        window: { addEventListener() {} },
        getComputedStyle: () => ({ getPropertyValue: () => '#777777' }),
        Chart: class { constructor(canvas, config) { charts.push(config); } destroy() {} }
    });
    for (const file of ['settings.js', 'dashboards.js']) {
        vm.runInContext(fs.readFileSync(path.join(js, file), 'utf8'), context, { filename: file });
    }
    context.widget = { id: '00000000-0000-7000-8000-000000000013', title: '<b>SQL title</b>', spec: {
        mode: 'sql', sql: { sql: 'SELECT label, amount FROM task', chart, label_column: labelColumn, value_column: 'amount' }
    } };
    context.result = structuredClone(result);
    const card = vm.runInContext('renderSqlWidget(widget, result)', context);
    assert.ok(card instanceof Element, 'public renderer returns the existing card shape');
    assert.equal(card.tagName, 'DIV');
    assert.equal(context.widget.spec.sql.chart, chart, 'renderer never rewrites saved definition');
    assert.deepEqual(context.result, result, 'renderer never mutates authoritative result');
    return { card, charts };
}
function assertResourceNotes(card) {
    assert.match(card.textContent, /Showing the first 2 rows\./);
    assert.ok(card.textContent.includes(warning), 'returned warning is retained verbatim as inert text');
    assert.equal(card.textContent.split(warning).length - 1, 1, 'warning is shown once');
    assert.match(card.textContent, /Result truncated to 2 rows\./);
}

for (const chart of ['bar', 'line', 'doughnut']) test(`G4 SQL ${chart} preserves exact chart data and returned resource warnings`, () => {
    const { card, charts } = render(chart);
    assert.equal(charts.length, 1);
    const config = charts[0];
    assert.equal(config.type, chart);
    assert.deepEqual(Array.from(config.data.labels), ['<svg onload="FAKE_LABEL_13">', '']);
    assert.deepEqual(Array.from(config.data.datasets[0].data), [0, 2.5]);
    assertResourceNotes(card);
});

for (const fallback of [false, true]) test(`control: SQL ${fallback ? 'missing-column table fallback' : 'table'} retains inert resource notes`, () => {
    const { card, charts } = render(fallback ? 'bar' : 'table', fallback ? 'unavailable' : 'label');
    assert.equal(charts.length, 0);
    assert.match(card.textContent, /<b>SQL title<\/b>/);
    assert.match(card.textContent, /<svg onload="FAKE_LABEL_13">/);
    assertResourceNotes(card);
    const all = root => root.children.flatMap(child => [child, ...all(child)]);
    const nodes = all(card);
    assert.equal(nodes.filter(el => el.tagName === 'TABLE').length, 1);
    assert.deepEqual(nodes.filter(el => el.tagName === 'TD').map(el => el.textContent), ['<svg onload="FAKE_LABEL_13">', '0', '', '2.5']);
    assert.equal(nodes.some(el => ['IMG', 'SVG', 'B'].includes(el.tagName)), false);
});
