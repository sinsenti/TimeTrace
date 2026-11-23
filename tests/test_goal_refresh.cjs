const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('acknowledged hierarchy writes and deletion notify authoritative goal readers, failures do not',async()=>{
 const events=[];let success=true;
 const context=vm.createContext({console,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},window:{dispatchEvent:event=>events.push(event.type)},fetch:async()=>success?new Response(JSON.stringify({id:'task'}),{status:200,headers:{'content-type':'application/json'}}):new Response(JSON.stringify({detail:'failed'}),{status:409})});
 vm.runInContext(fs.readFileSync('src/timetrace/interfaces/api/static/js/api_client.js','utf8'),context);
 await vm.runInContext("api.put('/api/tasks/task',{parent_id:'new-parent'})",context);
 assert.deepEqual(events,['timetrace:tasks-mutated']);
 success=false;await assert.rejects(vm.runInContext("api.delete('/api/tasks/task')",context));
 assert.equal(events.length,1);
 await vm.runInContext("api.get('/api/tasks')",context).catch(()=>{});assert.equal(events.length,1);
});
