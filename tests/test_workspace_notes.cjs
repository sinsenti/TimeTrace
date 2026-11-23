const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createWorkNoteEditor} = require('../src/timetrace/interfaces/api/static/js/workspace_notes.js');
test('work note ACK precedes refresh and failed display refresh never repeats PATCH', async () => {
    let writes = 0;
    const editor = createWorkNoteEditor({api:{request:async()=>{writes++; return {id:'work',revision:2,notes:'saved'};}},row:{id:'work',revision:1},refresh:async()=>{throw Error('offline');}});
    await editor.save('saved');
    assert.equal(editor.state().saved.notes,'saved');
    await editor.retry();
    assert.equal(writes,1);
});
