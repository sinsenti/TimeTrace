const {test} = require('node:test');
const assert = require('node:assert/strict');
const {workspaceShortcut} = require('../src/timetrace/interfaces/api/static/js/workspace_shortcuts.js');
test('shortcut actions are explicit and ignore typing, modal, composition and conflicting modifiers', () => {
    const event = {code:'KeyP',altKey:true,shiftKey:true};
    assert.equal(workspaceShortcut(event,false),'toggle');
    for (const key of ['defaultPrevented','isComposing','ctrlKey','metaKey']) assert.equal(workspaceShortcut({...event,[key]:true},false),null);
    assert.equal(workspaceShortcut(event,true),null);
    assert.equal(workspaceShortcut({...event,code:'Digit3'},false),'select:2');
    assert.equal(workspaceShortcut({...event,code:'Enter'},false),'start');
    assert.equal(workspaceShortcut({...event,altKey:false},false),null);
});
