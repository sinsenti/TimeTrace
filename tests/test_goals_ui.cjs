const test=require('node:test');const assert=require('node:assert/strict');
const {createGoalController}=require('../src/timetrace/interfaces/api/static/js/personal_goals.js');
function storage(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)}}
test('polling preserves captured settings revision and draft; stale save retains it',async()=>{
 const calls=[];let revision=1;
 const api={get:async()=>({goals:[{id:'goal',revision,target_seconds:3600,enabled:true,include_descendants:false}]}),put:async(url,payload)=>{calls.push(payload);throw Object.assign(Error('stale'),{status:409});}};
 const c=createGoalController({api,storage:storage(),onState:()=>{},operationId:()=> 'edit'});
 await c.refresh();c.edit('goal',{target_seconds:7200,enabled:true});revision=2;await c.refresh();
 assert.equal(c.snapshot().draft.expected_revision,1);
 await c.save();assert.equal(calls[0].expected_revision,1);assert.equal(c.snapshot().draft.target_seconds,7200);
});
test('settings ACK releases writer before a hung read and late ACK does not overwrite a newer draft',async()=>{
 let resolve;let reads=0;const api={get:async()=>++reads===1?{goals:[{id:'goal',revision:1,target_seconds:3600}]}:new Promise(()=>{}),put:()=>new Promise(r=>resolve=r)};
 const c=createGoalController({api,storage:storage(),onState:()=>{},operationId:()=> 'edit'});
 await c.refresh();c.edit('goal',{target_seconds:7200});const saving=c.save();c.edit('goal',{target_seconds:9000});
 resolve({id:'goal',revision:2});await saving;
 assert.equal(c.snapshot().pending,false);assert.equal(c.snapshot().draft.target_seconds,9000);
 assert.equal(c.snapshot().draft.expected_revision,2);
});
