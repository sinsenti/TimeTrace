const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createPlanExtensionAction} = require('../src/timetrace/interfaces/api/static/js/plan_extension.js');
const plan = {id:'plan/selected', revision:3, start_time:'2000-01-04T09:00:00Z', end_time:'2000-01-04T10:00:00Z'};
const saved = {...plan, revision:4, end_time:'2000-01-04T11:00:00.000Z'};
test('preview is not consent; Apply checkpoints revision before failed refresh and retry reads only', async () => {
    let writes=0, ack, reads=0;
    const action = createPlanExtensionAction({operationId:()=> 'op',
        api:{post:async (url, body)=>{ writes++; assert.equal(url,'/scheduled-sessions/plan%2Fselected/extend'); assert.equal(body.expected_revision,3); return saved;}},
        acknowledge:value=>{ack=value;}, refresh:async()=>{assert.equal(ack,saved); if (++reads===1) throw Error('offline');}});
    action.preview(plan, saved.end_time);
    assert.equal(writes,0);
    await action.apply();
    assert.equal(action.snapshot().phase,'refresh_failed');
    await action.recover(); await action.apply();
    assert.equal(writes,1); assert.equal(reads,2); assert.equal(action.snapshot().phase,'complete');
});
test('lost ACK reconciles receipt without replaying write', async()=>{
    let writes=0, ack;
    const action=createPlanExtensionAction({operationId:()=> 'lost', api:{
        post:async()=>{writes++; throw Error('lost');},
        get:async url=>{assert.equal(url,'/operations/lost'); return {status:'finalized',result:saved};}},
        acknowledge:value=>{ack=value;},refresh:async()=>{}});
    action.preview(plan,saved.end_time); await action.apply();
    assert.equal(action.snapshot().phase,'uncertain');
    await action.apply(); await action.recover();
    assert.equal(writes,1); assert.equal(ack,saved);
});
test('stale response retains attempted interval for explicit review',async()=>{
    const action=createPlanExtensionAction({operationId:()=> 'stale',api:{post:async()=>{throw Object.assign(Error('changed'),{status:409});}},acknowledge:()=>assert.fail(),refresh:()=>assert.fail()});
    action.preview(plan,saved.end_time); await action.apply();
    assert.equal(action.snapshot().phase,'stale'); assert.equal(action.snapshot().end,saved.end_time);
    await action.apply();
});
