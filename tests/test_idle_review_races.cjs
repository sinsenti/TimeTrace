const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createTimerController} = require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');

test('late pre-decision status cannot resurrect an acknowledged gap', async () => {
    let release, gets = 0;
    const old = {id:'a',state:'frozen',idle_gaps:[{id:'gap',decision:null}]};
    const resolved = {id:'a',state:'paused',idle_gaps:[{id:'gap',decision:'claim'}]};
    const control = createTimerController({api:{
        get:async () => ++gets === 1 ? new Promise(r=>{release=r;}) : {timers:[resolved]},
        post:async (url,payload) => ({operation_id:payload.operation_id,timer:resolved})
    },storage:{getItem:()=>null,setItem(){},removeItem(){}},operationId:()=> 'claim-op',onState(){}});
    const earlier = control.refresh();
    assert.equal(await control.act('a','resolve',{gap_id:'gap',decision:'claim'}),true);
    release({timers:[old]}); await earlier;
    assert.equal(control.snapshot().timers[0].state,'paused');
    assert.equal(control.snapshot().timers[0].idle_gaps[0].decision,'claim');
});

test('navigation reload recovers only saved selected gap without sending another decision', async () => {
    const values = new Map();
    const storage = {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
    let posts = 0;
    const api = {post:async()=>{posts++;throw Error('lost ACK');},get:async path=>path.startsWith('/operations/') ? {status:'finalized',result:{operation_id:'saved',timer:{id:'a',state:'paused'}}} : {timers:[{id:'a',state:'paused'},{id:'b',state:'frozen'}]}};
    const first = createTimerController({api,storage,operationId:()=> 'saved',onState(){}});
    await first.act('a','resolve',{gap_id:'gap-a',decision:'claim',expected_revision:3});
    const reloaded = createTimerController({api,storage,onState(){}});
    await reloaded.recover();
    assert.equal(posts,1);
    assert.equal(reloaded.snapshot().timers.find(t=>t.id==='b').state,'frozen');
    assert.equal(reloaded.snapshot().receipt,null);
});
