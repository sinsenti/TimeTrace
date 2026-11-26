const {test} = require('node:test');
const assert = require('node:assert/strict');
const {workspaceShortcut} = require('../src/timetrace/interfaces/api/static/js/workspace_shortcuts.js');
const fs=require('node:fs'),vm=require('node:vm');
test('Alt+Shift+F focuses Task to time, not the activity or history filter',()=>{
    let handler,focused;
    const shared={focus:()=>focused='shared'},history={focus:()=>focused='history'};
    const document={addEventListener:(_,fn)=>handler=fn,querySelectorAll:()=>[],querySelector:selector=>selector.includes('task-launcher-shared')?shared:null,getElementById:id=>id==='agenda-search'?history:null};
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/timetrace/interfaces/api/static/js/workspace_shortcuts.js'),'utf8'),{document,window:{multipleTimers:{snapshot:()=>({})}}});
    let prevented=false;handler({code:'KeyF',altKey:true,shiftKey:true,target:{closest:()=>null},preventDefault:()=>prevented=true});
    assert.equal(focused,'shared');assert.equal(prevented,true);
});
test('shortcut actions are explicit and ignore typing, modal, composition and conflicting modifiers', () => {
    const event = {code:'KeyP',altKey:true,shiftKey:true};
    assert.equal(workspaceShortcut(event,false),'toggle');
    for (const key of ['defaultPrevented','isComposing','ctrlKey','metaKey']) assert.equal(workspaceShortcut({...event,[key]:true},false),null);
    assert.equal(workspaceShortcut(event,true),null);
    assert.equal(workspaceShortcut({...event,code:'Digit3'},false),'select:2');
    assert.equal(workspaceShortcut({...event,code:'Enter'},false),'start');
    assert.equal(workspaceShortcut({...event,altKey:false},false),null);
});
