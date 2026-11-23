const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createTimerController} = require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');

test('selecting a paused timer is local and Start ACK selects existing identity before refresh', async () => {
    const values = new Map();
    const states = [];
    let posts = 0;
    const control = createTimerController({
        api: {get: async () => ({timers: [
            {id:'running',state:'running'}, {id:'paused',state:'paused'}
        ]}), post: async (_, payload) => {
            posts++;
            return {operation_id:payload.operation_id, timer:{id:'paused',state:'paused'}};
        }},
        storage: {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},
        operationId:()=> 'select-existing', onState:state=>states.push(state)
    });
    await control.refresh();
    assert.equal(control.select('paused'), true);
    assert.equal(control.snapshot().selectedTimerId, 'paused');
    assert.equal(posts, 0);
    assert.equal(control.snapshot().timers[1].state, 'paused');
    assert.equal(control.select('missing'), false);
    control.select('running');
    await control.start({task_id:'same-task'});
    assert.equal(posts, 1);
    assert.equal(control.snapshot().selectedTimerId, 'paused');
    assert.ok(states.some(state => state.receipt?.outcome === 'acknowledged' && state.selectedTimerId === 'paused'));
});
