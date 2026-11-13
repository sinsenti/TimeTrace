const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync('src/timetrace/interfaces/api/static/js/sidebar_totals.js', 'utf8');

class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attributes = {}; this.hidden = false; this.textContent = ''; this.innerHTML = ''; this.checked = false; this.value = ''; this.isConnected = true; this.classes = new Set(['hidden']); this.classList = { add: c => this.classes.add(c), remove: c => this.classes.delete(c), contains: c => this.classes.has(c) }; }
    append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    setAttribute(k,v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k]; }
    addEventListener(name, fn) { this[name] = fn; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) { return this.children.flatMap(c => [c, ...c.querySelectorAll('*')]).filter(c => selector === '*' || (selector === '.sidebar-tab-row' ? c.className?.includes('sidebar-tab-row') : selector === 'input[type="checkbox"]' ? c.tagName === 'input' : c.tagName === selector)); }
    focus() { this.focused = true; }
    contains(element) { return element === this || this.querySelectorAll('*').includes(element); }
    insertBefore(node, before) { node.parentNode.children = node.parentNode.children.filter(c => c !== node); const idx = this.children.indexOf(before); if (idx < 0) this.children.push(node); else this.children.splice(idx, 0, node); }
    get previousElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this)-1] || null; }
    get nextElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this)+1] || null; }
}
function setup(saved = null, get = async () => []) {
    const elements = new Map(['sidebar_status_tabs','sidebar_tab_config_modal','sidebar_tab_config_list','sidebar_tab_config_feedback','sidebar_task_feedback','sidebar_status_feedback','selected_tasks_count','task_card_list'].map(id => [id,new Element()]));
    const storage = new Map(saved === null ? [] : [['timetrace_dashboard_visible_sidebar_tabs',saved]]);
    const context = vm.createContext({ console, document: { activeElement: new Element('button'), getElementById: id => elements.get(id) || null, createElement: tag => new Element(tag), addEventListener() {} }, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) }, api: { get }, taskKnowledge: { state: () => ({ generation: 0 }), viewResult() {} }, activeTasks: [], matchesCustomFilter: () => true });
    vm.runInContext(source, context);
    vm.runInContext('fetchRangeTotals = () => {}', context);
    return { context, elements, storage, run: code => vm.runInContext(code,context) };
}
test('malformed tab storage leaves sidebar and totals handlers operational', async () => {
    const h = setup('{broken');
    await h.run('renderDynamicStatusTabs()');
    assert.equal(h.elements.get('sidebar_status_tabs').children[0].textContent, 'All');
    assert.equal(h.run('typeof sessionMatchesBreakdownFilter'), 'function');
});
test('empty saved tabs stay empty and hostile names are text with no inline handlers', async () => {
    const h = setup('[]', async () => [{ name: '\"><img src=x onerror=alert(1)>' }]);
    await h.run('renderDynamicStatusTabs()');
    assert.equal(h.elements.get('sidebar_status_tabs').children.length, 0);
    assert.match(h.elements.get('sidebar_status_feedback').textContent, /No status tabs/);
    await h.run('openSidebarTabsConfigModal()');
    const rows = h.elements.get('sidebar_tab_config_list').children;
    assert.equal(rows[2].querySelector('span').textContent, '\"><img src=x onerror=alert(1)>');
    assert.equal(rows[2].getAttribute('onclick'), undefined);
});
test('unavailable selections survive edits and keyboard reorder persists string order', async () => {
    const h = setup('["Missing","all","Missing",4]', async () => [{ name: 'Ready' }]);
    await h.run('openSidebarTabsConfigModal()');
    const list = h.elements.get('sidebar_tab_config_list');
    assert.match(list.children[0].querySelector('span').textContent, /unavailable; retained/);
    list.children[1].querySelectorAll('button')[0].click();
    assert.equal(h.storage.get('timetrace_dashboard_visible_sidebar_tabs'), '["all","Missing"]');
    list.children[0].querySelector('input[type="checkbox"]').checked = false;
    list.children[0].querySelector('input[type="checkbox"]').change();
    assert.equal(h.storage.get('timetrace_dashboard_visible_sidebar_tabs'), '["Missing"]');
});
test('late config metadata adds current choices while preserving edits and cannot reopen a closed dialog', async () => {
    let resolve;
    const h = setup('["all"]', url => url.includes('/statuses') ? new Promise(r => { resolve = r; }) : Promise.resolve([]));
    const opening = h.run('openSidebarTabsConfigModal()');
    const resolver = resolve;
    const row = h.elements.get('sidebar_tab_config_list').children[0];
    row.querySelector('input[type="checkbox"]').checked = false;
    row.querySelector('input[type="checkbox"]').change();
    resolver([{ name: 'Late' }]); await opening;
    const lateRows = h.elements.get('sidebar_tab_config_list').children;
    assert.equal(lateRows.some(r => r.querySelector('span').textContent === 'Late'), true);
    assert.equal(lateRows.some(r => r.querySelector('input[type="checkbox"]').checked), false);
    assert.equal(h.storage.get('timetrace_dashboard_visible_sidebar_tabs'), '[]');
    const second = h.run('openSidebarTabsConfigModal()'); const secondResolver = resolve;
    h.run('closeSidebarTabsConfigModal()'); secondResolver([{ name: 'Late' }]); await second;
    assert.equal(h.elements.get('sidebar_tab_config_modal').classList.contains('hidden'), true);
});
test('failed status read keeps saved selections and exposes retry', async () => {
    const h = setup('["Unavailable"]', async () => { throw new Error('offline'); });
    await h.run('openSidebarTabsConfigModal()');
    assert.equal(h.elements.get('sidebar_tab_config_list').children[0].querySelector('input[type="checkbox"]').checked, true);
    assert.match(h.elements.get('sidebar_tab_config_feedback').textContent, /could not be loaded/);
    assert.equal(h.elements.get('sidebar_tab_config_feedback').children[0].textContent, 'Retry');
    assert.equal(h.storage.get('timetrace_dashboard_visible_sidebar_tabs'), '["Unavailable"]');
});
test('latest sidebar read wins and failed refresh retains rows with retry instead of empty matches', async () => {
    const pending = [];
    const h = setup('[]', () => new Promise((resolve,reject) => pending.push({resolve,reject})));
    const first = h.run('fetchTasks()'); const second = h.run('fetchTasks()');
    pending[1].resolve([]); await second;
    h.elements.get('selected_tasks_count').innerText = 'newest';
    pending[0].resolve([]); await first;
    assert.equal(h.elements.get('selected_tasks_count').innerText, 'newest');
    const third = h.run('fetchTasks()'); pending[2].reject(new Error('offline')); await third;
    assert.match(h.elements.get('sidebar_task_feedback').textContent, /could not be refreshed/);
    assert.equal(h.elements.get('sidebar_task_feedback').children[0].textContent, 'Retry');
    assert.equal(h.elements.get('selected_tasks_count').innerText, 'newest');
});

test('configuration Escape closes its focused owner and restores the launcher', async () => {
    const h = setup('[]');
    const modal = h.elements.get('sidebar_tab_config_modal');
    const close = new Element('button'); modal.append(close);
    const launcher = h.context.document.activeElement;
    await h.run('openSidebarTabsConfigModal()');
    h.context.document.activeElement = close;
    let stopped = false;
    modal.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true; } });
    assert.equal(stopped, true);
    assert.equal(modal.classList.contains('hidden'), true);
    assert.equal(launcher.focused, true);
});
test('corrupt status responses retain useful tabs and offer retry in tabs and configuration', async () => {
    let response = [{ name: 'Ready' }];
    const h = setup('["Ready"]', async () => response);
    await h.run('renderDynamicStatusTabs()');
    const original = h.elements.get('sidebar_status_tabs').children[0];
    response = null;
    await h.run('renderDynamicStatusTabs()');
    assert.equal(h.elements.get('sidebar_status_tabs').children[0], original);
    assert.equal(h.elements.get('sidebar_status_feedback').children[0].textContent, 'Retry');
    response = { error: 'unexpected response' };
    await h.run('openSidebarTabsConfigModal()');
    assert.equal(h.elements.get('sidebar_tab_config_list').children[0].querySelector('input[type="checkbox"]').checked, true);
    assert.equal(h.elements.get('sidebar_tab_config_feedback').children[0].textContent, 'Retry');
    assert.equal(h.storage.get('timetrace_dashboard_visible_sidebar_tabs'), '["Ready"]');
});
