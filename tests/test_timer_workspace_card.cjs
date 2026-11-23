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
test('B controls preview an explicit actual interval and keep Adjust time in the action row',()=>{
    const root=new Element('section'); root.ownerDocument={createElement:tag=>new Element(tag)};
    const timer={id:'a',state:'running',revision:2,running_start:'2026-11-23T11:00:00Z',running_segment_id:'segment',elapsed_seconds:600};
    const calls=[];
    renderTimerWorkspaceCard(root,{selectedTimerId:'a',fresh:true,timers:[timer]}, {act(){},correctTime:(...args)=>calls.push(args)});
    const clock=root.children[1];
    assert.deepEqual(clock.children.map(node=>node.textContent),['−','+']);
    clock.children[0].listeners.click();
    assert.deepEqual(calls,[[timer,{kind:'step_start',credited_delta_seconds:-300}]]);
    assert.match(clock.children[0].title,/2026-11-23T11:00:00Z/);
    assert.deepEqual(root.children[2].children.map(node=>node.textContent),['Adjust time','Pause','Stop & record']);
});
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
