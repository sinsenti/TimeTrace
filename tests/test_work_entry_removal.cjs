const test=require('node:test'),assert=require('node:assert/strict');
const {createWorkEntryRemoval}=require('../src/timetrace/interfaces/api/static/js/workspace_notes.js');
test('permanent removal uses the captured row and revision once',async()=>{
 const calls=[];const r=createWorkEntryRemoval({api:{request:async(url,options)=>{calls.push({url,options});}},row:{id:'opaque-id',revision:3}});
 assert.equal(await r.remove(),true);assert.equal(await r.remove(),false);assert.equal(r.state().deleted,true);
 assert.deepEqual(calls,[{url:'/recorded-work/opaque-id?expected_revision=3',options:{method:'DELETE'}}]);
});
test('lost deletion ACK resolves through reads only; unavailable reads never replay deletion',async()=>{
 let deletes=0,reads=0,missing=false;const r=createWorkEntryRemoval({api:{request:async()=>{deletes++;throw Error('lost ACK');},get:async()=>{reads++;throw Object.assign(Error('read'),{status:missing?404:503});}},row:{id:'a',revision:1}});
 assert.equal(await r.remove(),false);assert.equal(r.state().blocked,true);assert.equal(await r.remove(),false);
 missing=true;await r.read();assert.equal(r.state().deleted,true);assert.equal(deletes,1);assert.equal(reads,2);
});
