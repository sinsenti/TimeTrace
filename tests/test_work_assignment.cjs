const test = require('node:test');
const assert = require('node:assert/strict');
const {createWorkAssignmentController} = require('../src/timetrace/interfaces/api/static/js/work_assignment.js');
function storage() { const map = new Map(); return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}; }
test('Stop ACK precedes optional assignment; dismissal performs no write', async()=>{
    const writes=[];
    const controller=createWorkAssignmentController({api:{post:async(...args)=>writes.push(args)},storage:storage(),onState:()=>{}});
    controller.offer({operation_id:'stop',saved_taskless_work:[{id:'work',revision:1,start_time:'2000-01-04T10:00Z',end_time:'2000-01-04T11:00Z'}]});
    assert.equal(controller.snapshot().prompt.works[0].id,'work');
    controller.dismiss();
    assert.equal(controller.snapshot().prompt.hidden,true);
    assert.deepEqual(writes,[]);
});
test('a second Stop cannot replace an active assignment draft or silently enlarge its manifest',()=>{
 const store=storage();const c=createWorkAssignmentController({api:{},storage:store,onState:()=>{}});
 c.offer({operation_id:'first-stop',saved_taskless_work:[{id:'one',revision:1},{id:'two',revision:1}]});
 c.edit({kind:'new',task_draft:{title:'Keep this draft'}});c.select(['two']);
 c.offer({operation_id:'second-stop',saved_taskless_work:[{id:'three',revision:1}]});
 const reloaded=createWorkAssignmentController({api:{},storage:store,onState:()=>{}});
 assert.equal(reloaded.snapshot().prompt.stop_id,'first-stop');
 assert.equal(reloaded.snapshot().prompt.destination.task_draft.title,'Keep this draft');
 assert.deepEqual(reloaded.snapshot().prompt.selected_ids,['two']);
 assert.equal(reloaded.snapshot().queued.length,1);
 reloaded.dismiss();assert.equal(reloaded.snapshot().prompt.stop_id,'second-stop');
 assert.deepEqual(reloaded.snapshot().prompt.works.map(w=>w.id),['three']);
});
for (const fails of [false,true]) test(`obsolete target ${fails?'error':'success'} cannot cross queued Stops`,async()=>{
    const store=storage(),reads=[],writes=[];let finishWrite;
    const api={get:url=>new Promise((resolve,reject)=>reads.push({url,resolve,reject})),
        post:(url,payload)=>{writes.push([url,payload]);return new Promise(resolve=>{finishWrite=resolve;});}};
    const make=()=>createWorkAssignmentController({api,storage:store,onState:()=>{},operationId:()=> 'assign-B'});
    const c=make();
    c.offer({operation_id:'A',saved_taskless_work:[{id:'a',revision:1}]});
    const stale=c.refetchTargets();
    c.offer({operation_id:'B',saved_taskless_work:[{id:'b1',revision:2},{id:'b2',revision:3}]});
    c.dismiss();
    assert.equal(c.snapshot().pending,false);
    c.select(['b2']);c.edit({kind:'existing',task_id:'destination'});
    const fresh=c.refetchTargets();
    assert.deepEqual(reads.map(r=>r.url),['/recorded-work/a','/recorded-work/b1','/recorded-work/b2']);
    const row=(id,revision)=>({id,revision,task_id:null,scheduled_session_id:null});
    if (fails) reads[0].reject(Error('A unavailable')); else reads[0].resolve(row('a',5));
    assert.equal(await stale,false);
    assert.equal(c.snapshot().pending,true);
    assert.doesNotMatch(c.snapshot().message,/unavailable|Exact listed IDs refreshed/);
    reads[1].resolve(row('b1',2));reads[2].resolve(row('b2',4));
    assert.equal(await fresh,true);
    const reloaded=make();
    assert.equal(reloaded.snapshot().prompt.stop_id,'B');
    assert.deepEqual(reloaded.snapshot().prompt.works.map(w=>w.id),['b1','b2']);
    assert.deepEqual(reloaded.snapshot().prompt.selected_ids,['b2']);
    const committing=reloaded.assign(reloaded.snapshot().prompt.selected_ids);
    reloaded.dismiss();
    assert.equal(reloaded.snapshot().pending,true);
    assert.deepEqual(writes,[['/recorded-work/assignment',{
        operation_id:'assign-B',works:[{id:'b2',expected_revision:4}],destination:{kind:'existing',task_id:'destination'}
    }]]);
    finishWrite({operation_id:'assign-B'});
    assert.equal(await committing,true);
    assert.equal(make().snapshot().journal.outcome,'acknowledged');
});
test('lost assignment ACK looks up receipt before any exact retry, never repeats Stop/create',async()=>{
    const calls=[]; const store=storage(); let lost=true;
    const api={post:async(url,payload)=>{calls.push([url,payload]); if(lost) throw Error('lost response'); return {operation_id:'assign',task_id:'task',works:[{id:'work',revision:2}]};},
        get:async url=>{calls.push([url]); return {status:'finalized',result:{operation_id:'assign',task_id:'task',works:[{id:'work',revision:2}]}};}};
    const controller=createWorkAssignmentController({api,storage:store,onState:()=>{},operationId:()=> 'assign'});
    controller.offer({operation_id:'stop',saved_taskless_work:[{id:'work',revision:1}]});
    controller.edit({kind:'new',task_draft:{title:'Retain draft'}});
    await controller.assign(['work']);
    assert.equal(controller.snapshot().journal.outcome,'uncertain');
    const reloaded=createWorkAssignmentController({api,storage:store,onState:()=>{}});
    await reloaded.retry();
    assert.equal(calls.length,2);
    assert.equal(calls[1][0],'/operations/assign');
    assert.equal(reloaded.snapshot().journal.outcome,'acknowledged');
    await reloaded.retry();
    assert.equal(calls.length,2);
});
