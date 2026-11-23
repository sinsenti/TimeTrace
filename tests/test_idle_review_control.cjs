const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createTimerController} = require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');

function harness({failRead = false, wrongAck = false} = {}) {
    const values = new Map(), posts = [];
    let failed = failRead;
    const control = createTimerController({api: {
        get: async () => { if (failed && posts.length) throw Error('offline'); return {timers:[{id:'a',revision:1,state:'frozen',idle_gaps:[{id:'gap-a',return_at:'2025-01-01',decision:null}]},{id:'b',revision:2,state:'frozen',idle_gaps:[{id:'gap-b',return_at:'2025-01-01',decision:null}]}]}; },
        post: async (path,payload) => { posts.push([path,payload]); return {operation_id:wrongAck ? 'another-operation' : payload.operation_id,timer:{id:'a',revision:2,state:'paused',idle_gaps:[{id:'gap-a',decision:'discard'}]}}; }
    }, storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},operationId:()=>`op-${posts.length}`,onState() {}});
    return {control,posts,values,readAgain:()=>{failed=false;}};
}

test('selected review stops after acknowledged decision with failed refresh, preserving other choices', async () => {
    const {control,posts} = harness({failRead:true});
    await control.refresh();
    const result = await control.review([{timer_id:'a',gap_id:'gap-a',decision:'discard',expected_revision:1},{timer_id:'b',gap_id:'gap-b',decision:'claim',expected_revision:2}]);
    assert.deepEqual(result, {acknowledged:['gap-a'],remaining:['gap-b']});
    assert.equal(posts.length,1);
    assert.equal(control.snapshot().receipt.outcome,'acknowledged');
    assert.equal(control.snapshot().timers.find(t=>t.id==='b').state,'frozen');
});

test('wrong-operation ACK cannot mark a selected decision acknowledged', async () => {
    const {control} = harness({wrongAck:true});
    await control.refresh();
    assert.equal(await control.act('a','resolve',{gap_id:'gap-a',decision:'discard'}),false);
    assert.equal(control.snapshot().receipt.outcome,'uncertain');
});
