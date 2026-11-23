const {test} = require('node:test');
const assert = require('node:assert/strict');
const {groupWorkspaceHistory} = require('../src/timetrace/interfaces/api/static/js/workspace_history.js');
test('history keeps same-title identities distinct and uses local start day, never merges raw intervals', () => {
    const rows = [
        {id:'one',task_id:'a',kind:'recorded_work',start_time:'2026-11-23T00:30:00Z'},
        {id:'two',task_id:'a',kind:'recorded_work',start_time:'2026-11-23T01:30:00Z'},
        {id:'three',task_id:'b',kind:'recorded_work',start_time:'2026-11-23T01:30:00Z'},
        {id:'legacy',task_id:'a',kind:'legacy_session',start_time:'2026-11-23T01:30:00Z'}
    ];
    const groups = groupWorkspaceHistory(rows,'America/New_York');
    assert.deepEqual(groups.map(group=>[group.day,group.taskId,group.rows.map(row=>row.id)]),[
        ['2026-11-22','a',['one','two']], ['2026-11-22','b',['three']], ['2026-11-22','a',['legacy']]
    ]);
    assert.equal(groups[0].rows[0],rows[0]);
});
