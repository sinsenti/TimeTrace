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
