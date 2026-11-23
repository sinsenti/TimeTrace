const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHistoryExportController} = require('../src/timetrace/interfaces/api/static/js/history_export.js');
const {workspaceHistoryMatches} = require('../src/timetrace/interfaces/api/static/js/workspace_history.js');
test('visible cohort predicate uses literal Unicode title/tag/note conjunction', () => {
    assert.equal(workspaceHistoryMatches({tags:'#ÉTÉ',notes:'Literal 100%_ text'},'CAFÉ', {title:'café',tag:'été',note:'100%_'}), true);
    assert.equal(workspaceHistoryMatches({tags:'#ÉTÉ',notes:'other'},'CAFÉ', {title:'café',tag:'été',note:'100%_'}), false);
});
test('clipboard failure retains frozen bytes; known mutation invalidates output', async () => {
    const response = {rows:[],markdown:{content:'frozen'},csv:{content:'csv'}};
    const controller = createHistoryExportController({preview: async () => response, copy:async () => {throw Error('denied');}});
    controller.configure({timezone:'UTC'});
    await controller.preview('filtered');
    response.markdown.content = 'changed externally';
    controller.state().envelope.markdown.content = 'attempted accepted-state mutation';
    assert.equal(await controller.copy('markdown'), false);
    assert.equal(controller.state().envelope.markdown.content, 'frozen');
    assert.match(controller.state().error, /denied/);
    controller.invalidate();
    assert.equal(await controller.copy('markdown'), false);
});
test('selection is independent, empty stays empty, and late preview is refused', async () => {
    let finish;
    const requests = [];
    const controller = createHistoryExportController({preview: request => {requests.push(request); return new Promise(resolve => finish = resolve);}});
    controller.configure({start_date:'2000-01-04',end_date:'2000-01-04',timezone:'UTC'});
    const read = controller.preview('selected');
    assert.deepEqual(requests[0].selected_ids, []);
    controller.select('saved', true);
    finish({rows:[],markdown:{content:'old'},csv:{content:'old'}});
    await read;
    assert.equal(controller.state().envelope, null);
});
