const test=require('node:test');const assert=require('node:assert/strict');
const {createGoalController,createGoalContextController}=require('../src/timetrace/interfaces/api/static/js/personal_goals.js');
function storage(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)}}
test('unchanged reporting preferences never create another effective context',async()=>{
 const calls=[];const c=createGoalContextController({api:{get:async()=>({revision:2,timezone:'UTC',first_day_of_week:1}),put:async(...args)=>{calls.push(args);return {revision:3,first_day_of_week:1};}},storage:storage(),onState:()=>{}});
 await c.refresh();assert.equal(await c.save(),false);c.edit(1);assert.equal(await c.save(),false);assert.deepEqual(calls,[]);
});
test('an unchanged current weekday never suppresses an exact uncertain context retry',async()=>{
 const store=storage(),payload={operation_id:'fixed',expected_revision:1,first_day_of_week:1},draft={expected_revision:1,first_day_of_week:1};
 store.setItem('timetrace_goal_reporting_context_v1',JSON.stringify({draft,journal:{outcome:'uncertain',payload,submitted_draft:draft}}));const sent=[];
 const c=createGoalContextController({api:{get:async()=>({revision:2,timezone:'UTC',first_day_of_week:1}),put:async(url,body)=>{sent.push(body);return {revision:2,timezone:'UTC',first_day_of_week:1};}},storage:store,onState:()=>{}});
 await c.refresh();assert.equal(await c.save(),true);assert.deepEqual(sent,[payload]);assert.equal(c.snapshot().draft,null);
});
test('reporting context edit keeps its captured revision through polling and stale refusal',async()=>{
 let revision=1;const calls=[];const api={get:async()=>({revision,timezone:'UTC',first_day_of_week:1}),put:async(url,payload)=>{calls.push(payload);throw Object.assign(Error('stale context'),{status:409});}};
 const c=createGoalContextController({api,storage:storage(),onState:()=>{},operationId:()=> 'context-op'});
 await c.refresh();c.edit(0);revision=2;await c.refresh();await c.save();
 assert.equal(calls[0].expected_revision,1);assert.equal(c.snapshot().draft.first_day_of_week,0);
 assert.equal(c.snapshot().draft.expected_revision,1);
});
test('lost goal settings ACK followed by newer typing and reload retains the newer draft on exact retry',async()=>{
 const store=storage(),payloads=[];let fail=true;const api={get:async()=>({goals:[{id:'goal',revision:1,target_seconds:3600}]}),put:async(url,payload)=>{payloads.push(payload);if(fail){fail=false;throw Error('lost ACK');}return {id:'goal',revision:2};}};
 const c=createGoalController({api,storage:store,onState:()=>{},operationId:()=> 'fixed'});await c.refresh();c.edit('goal',{target_seconds:7200});await c.save();c.edit('goal',{target_seconds:9000});
 const reload=createGoalController({api,storage:store,onState:()=>{}});await reload.save();
 assert.deepEqual(payloads[0],payloads[1]);assert.equal(reload.snapshot().draft.target_seconds,9000);assert.equal(reload.snapshot().draft.expected_revision,2);
});
test('a new-goal stale context can be explicitly rebased without discarding its entered target',async()=>{
 const api={get:async url=>url==='/goal-reporting-context'?{revision:2,first_day_of_week:0,timezone:'UTC'}:{goals:[]}};
 const c=createGoalController({api,storage:storage(),onState:()=>{}});await c.refresh();
 c.edit(null,{owner_kind:'global',cadence:'day',target_seconds:7200,first_day_of_week:1});
 assert.equal(await c.rebase(),true);assert.equal(c.snapshot().draft.target_seconds,7200);assert.equal(c.snapshot().draft.first_day_of_week,0);
});
test('settings ACK is an editable checkpoint before a hung read; another selection cannot erase that draft',async()=>{
 let reads=0;const api={get:async()=>++reads===1?{goals:[{id:'goal',revision:1,target_seconds:3600,enabled:true}]}:new Promise(()=>{}),put:async()=>({id:'goal',revision:2})};
 const store=storage();const c=createGoalController({api,storage:store,onState:()=>{},operationId:()=> 'checkpoint'});
 await c.refresh();c.edit('goal',{target_seconds:7200});await c.save();
 c.edit('goal');assert.equal(c.snapshot().draft.expected_revision,2);assert.equal(c.snapshot().draft.target_seconds,7200);
 assert.equal(c.edit('another',{target_seconds:9000}),false);assert.equal(c.snapshot().draft.id,'goal');
 assert.equal(c.snapshot().fresh,false);
 c.cancel();const reloaded=createGoalController({api,storage:store,onState:()=>{}});reloaded.edit('goal');assert.equal(reloaded.snapshot().draft.expected_revision,2);assert.equal(reloaded.snapshot().draft.target_seconds,7200);
});
test('a restored settings journal can never dispatch a Stop or another mutation family',async()=>{
 const store=storage();store.setItem('timetrace_goal_settings_v1',JSON.stringify({draft:{id:'goal',target_seconds:7200},journal:{goal_id:'goal',method:'post',url:'/timers/live/stop',payload:{operation_id:'wrong-family'},outcome:'uncertain'}}));
 const calls=[];const c=createGoalController({api:{post:async(...args)=>calls.push(args),put:async(...args)=>calls.push(args)},storage:store,onState:()=>{}});
 assert.equal(await c.save(),false);assert.deepEqual(calls,[]);assert.match(c.snapshot().message,/Unrecognized settings request family/);
});
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
