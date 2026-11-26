const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createWorkNoteEditor} = require('../src/timetrace/interfaces/api/static/js/workspace_notes.js');
test('background saved-note refresh never adopts over newer typing or a write ACK',async()=>{
 let release,dirty=false;const editor=createWorkNoteEditor({api:{get:()=>new Promise(resolve=>{release=resolve;}),request:async()=>({id:'work',revision:3,notes:'ack'})},row:{id:'work',revision:1,notes:'old'},refresh:async()=>{},isDirty:()=>dirty});
 const late=editor.readSaved();dirty=true;release({id:'work',revision:2,notes:'external'});await late;assert.equal(editor.state().saved.revision,1);
 dirty=false;const older=editor.readSaved();await editor.save('ack');release({id:'work',revision:2,notes:'external'});await older;assert.equal(editor.state().saved.revision,3);
 const fresh=editor.readSaved();release({id:'work',revision:4,notes:'new saved'});await fresh;assert.equal(editor.state().saved.notes,'new saved');
});
test('known correction invalidates saved-note ownership without overwriting a draft or sending PATCH',async()=>{
    let writes=0;
    const row={id:'work',revision:1,notes:'saved'};
    const editor=createWorkNoteEditor({api:{request:async()=>writes++},row,refresh:async()=>{}});
    editor.invalidate('Actual time changed; review saved interval.');
    assert.equal(await editor.save('unsaved typing'),false);
    assert.equal(writes,0); assert.equal(editor.state().saved,row);
    assert.equal(editor.state().blocked,true); assert.match(editor.state().message,/review/);
});
test('work note ACK precedes refresh and failed display refresh never repeats PATCH', async () => {
    let writes = 0;
    const editor = createWorkNoteEditor({api:{request:async()=>{writes++; return {id:'work',revision:2,notes:'saved'};}},row:{id:'work',revision:1},refresh:async()=>{throw Error('offline');}});
    await editor.save('saved');
    assert.equal(editor.state().saved.notes,'saved');
    await editor.retry();
    assert.equal(writes,1);
});
