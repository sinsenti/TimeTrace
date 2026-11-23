const {test} = require('node:test');
const assert = require('node:assert/strict');
const {renderTimerWorkspaceCard} = require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');

class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key,value) { this[key] = value; }
    addEventListener(key, fn) { this.listeners[key] = fn; }
}
test('current card exposes only the selected timer independent controls and honest frozen state', () => {
    const root = new Element('section');
    root.ownerDocument = {createElement:tag=>new Element(tag)};
    const actions = [];
    const state = {selectedTimerId:'paused',fresh:true,timers:[
        {id:'other',task_title:'Parallel',state:'running',revision:3},
        {id:'paused',task_title:'Selected',state:'paused',revision:7,elapsed_seconds:65}
    ]};
    renderTimerWorkspaceCard(root, state, {act:(...args)=>actions.push(args)});
    assert.equal(root.children[0].textContent, 'Selected');
    assert.match(root.children[1].textContent, /1:05.*paused/);
    const row = root.children[2];
    assert.deepEqual(row.children.map(node=>node.textContent), ['Resume', 'Stop & record']);
    row.children[0].listeners.click();
    assert.deepEqual(actions, [['paused','resume',{expected_revision:7}]]);
    state.timers[1].task_id = 'task-identity';
    const edits = [];
    renderTimerWorkspaceCard(root,state,{act(){},editTask:id=>edits.push(id)});
    assert.equal(root.children[2].children[0].textContent,'Edit task');
    root.children[2].children[0].listeners.click();
    assert.deepEqual(edits,['task-identity']);
    state.timers[1].state = 'frozen';
    renderTimerWorkspaceCard(root,state,{act(){throw Error('must not mutate');}});
    assert.ok(root.children[2].children.filter(node=>node.textContent !== 'Edit task').every(node=>node.disabled));
});
