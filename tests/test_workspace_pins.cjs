const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createWorkspacePins} = require('../src/timetrace/interfaces/api/static/js/workspace_pins.js');
test('pins preserve identity and explicit order across reload without creating work', () => {
    const values = new Map();
    const storage = {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
    let pins = createWorkspacePins(storage);
    pins.pin('task-b'); pins.pin('task-a'); pins.pin('task-b');
    assert.deepEqual(pins.ids(),['task-b','task-a']);
    pins = createWorkspacePins(storage);
    assert.deepEqual(pins.ids(),['task-b','task-a']);
    pins.unpin('task-b'); pins.pin('task-b');
    assert.deepEqual(pins.ids(),['task-a','task-b']);
});
test('storage failure is visible and never claims persistence', () => {
    const pins = createWorkspacePins({getItem:()=>null,setItem(){throw Error('quota');}});
    assert.throws(()=>pins.pin('task'),/quota/);
    assert.deepEqual(pins.ids(),[]);
});
