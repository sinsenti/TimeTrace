const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createTimerController, createTimerStartFocus} = require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');

test('start focus never interrupts newer interaction or dirty editors', () => {
    let interactions = 0, dirty = false, focused = 0;
    const observe = createTimerStartFocus({interaction:()=>interactions, guarded:()=>dirty, focus:()=>focused++});
    const pending = {pending:true,receipt:{url:'/timers',payload:{operation_id:'one'},outcome:'uncertain'}};
    const ack = {pending:false,receipt:{...pending.receipt,outcome:'acknowledged'}};
    observe(pending); interactions++; observe(ack);
    assert.equal(focused,0);
    observe({...pending,receipt:{...pending.receipt,payload:{operation_id:'two'}}});
    dirty = true;
    observe({...ack,receipt:{...ack.receipt,payload:{operation_id:'two'}}});
    assert.equal(focused,0);
    dirty = false;
    observe({...pending,receipt:{...pending.receipt,payload:{operation_id:'three'}}});
    observe({...ack,receipt:{...ack.receipt,payload:{operation_id:'three'}}});
    assert.equal(focused,1);
});

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
