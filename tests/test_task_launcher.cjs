const test=require('node:test'),assert=require('node:assert/strict');
const {createTaskLauncher}=require('../src/timetrace/interfaces/api/static/js/task_launcher.js');
test('fuzzy choices require deliberate selection; Tab, composition and repeats never start',async()=>{
 let starts=0;const l=createTaskLauncher({api:{get:async()=>({suggestions:[{id:'reading',title:'Reading',match_kind:'fuzzy'}]})},startTask:async()=>{starts++;return true;}});
 await l.input('raeding');assert.equal(l.snapshot().activeIndex,-1);await l.key({key:'Enter'});assert.equal(starts,0);
 l.key({key:'ArrowDown'});await l.key({key:'Enter',isComposing:true});await l.key({key:'Enter',repeat:true});assert.equal(starts,0);
 assert.equal(l.key({key:'Tab'}),false);await l.key({key:'Enter'});assert.equal(starts,0);
 await l.input('raeding');l.choose(0);await l.key({key:'Enter'});assert.equal(starts,1);
 await l.focus();l.key({key:'Escape'});await l.key({key:'Enter'});assert.equal(starts,1);
});
test('finalized recovery clears only its original query and is applied once',async()=>{
 const l=createTaskLauncher({api:{get:async()=>({suggestions:[{id:'reading',title:'Reading',match_kind:'default'}]})},startTask:async(payload,hooks)=>{hooks.onSubmitted('recover-1');return false;}});
 await l.input('read');await l.key({key:'Enter'});assert.equal(l.snapshot().query,'read');
 const ack={operation_id:'recover-1',timer:{id:'timer',task_id:'reading',state:'paused'}};
 assert.equal(l.reconcile(ack),true);assert.equal(l.snapshot().query,'');assert.match(l.snapshot().actionMessage,/paused/);assert.equal(l.snapshot().message,'');
 await l.input('new query');assert.equal(l.reconcile(ack),false);assert.equal(l.snapshot().query,'new query');
});
test('launcher Start acknowledges before a hung read and never requests page navigation',async()=>{
 const {createTimerController,createTimerStartFocus}=require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');
 let reads=0,focus=0,ack=null;const values=new Map();
 const observe=createTimerStartFocus({interaction:()=>0,guarded:()=>false,focus:()=>focus++});
 const control=createTimerController({api:{get:async()=>++reads===1?{timers:[],revision:1}:new Promise(()=>{}),post:async(_,p)=>({operation_id:p.operation_id,timer:{id:'timer',task_id:'reading',state:'running'}})},storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},operationId:()=> 'focusless',onState:observe});
 await control.refresh();assert.equal(await control.start({task_id:'reading'},r=>ack=r,{preservePage:true}),true);
 assert.equal(ack.operation_id,'focusless');assert.equal(focus,0);assert.equal(control.snapshot().pending,false);
 assert.equal(JSON.parse(values.get('timetrace_timer_v2_operation')).preserve_page,true);
});
test('explicit Start button can use a seen selection after Tab, but Enter in a closed field cannot',async()=>{
 let calls=0;const l=createTaskLauncher({api:{get:async()=>({suggestions:[{id:'r',title:'Reading',match_kind:'default'}]})},startTask:async()=>{calls++;return true;}});
 await l.focus();l.key({key:'Tab'});await l.key({key:'Enter'});assert.equal(calls,0);await l.start({explicitButton:true});assert.equal(calls,1);
});
test('obsolete search responses and late Start acknowledgements never replace newer typing',async()=>{
 let oldRead,ack;const l=createTaskLauncher({api:{get:url=>url.includes('q=old')?new Promise(r=>oldRead=r):Promise.resolve({suggestions:url.includes('q=write')?[]:[{id:'reading',title:'Reading',match_kind:'prefix'}]})},startTask:(p,h)=>{h.onSubmitted('late');return new Promise(r=>{ack=()=>{h.onAcknowledged({operation_id:'late',timer:{id:'t',state:'running'}});r(true);};});}});
 const old=l.input('old');await l.input('read');oldRead({suggestions:[{id:'stale',title:'Stale',match_kind:'exact'}]});await old;assert.equal(l.snapshot().rows[0].id,'reading');
 const saving=l.key({key:'Enter'});await Promise.resolve();await l.input('write');ack();await saving;assert.equal(l.snapshot().query,'write');assert.match(l.snapshot().message,/No matching/);assert.equal(l.snapshot().pending,false);
});
test('Agenda tag filter uses the same bounded suggestion request without changing work-note filters',async()=>{
 const urls=[];const l=createTaskLauncher({api:{get:async url=>{urls.push(url);return {suggestions:[]};}},startTask:async()=>true});
 await l.input('read');await l.tag('Study%_work');const p=new URL(urls.at(-1),'http://test').searchParams;assert.equal(p.get('q'),'read');assert.equal(p.get('tag_contains'),'Study%_work');assert.equal(p.get('limit'),'20');
});
test('a start captures the idle preference before asynchronous metadata checks',async()=>{
 let idle=true,release,payload;const l=createTaskLauncher({api:{get:async()=>({suggestions:[{id:'r',title:'Reading',match_kind:'default'}]})},pauseWhenIdle:()=>idle,validateTask:()=>new Promise(r=>release=r),startTask:async p=>{payload=p;return true;}});
 await l.focus();const pending=l.key({key:'Enter'});idle=false;release(true);await pending;assert.deepEqual(payload,{task_id:'r',pause_when_idle:true});
});
const reading={id:'reading-uuid',title:'Reading',match_kind:'default',scheduled_state:'now'};
test('focus shows defaults and Enter starts the highlighted task only',async()=>{
 const calls=[];const launcher=createTaskLauncher({api:{get:async()=>({suggestions:[reading]})},startTask:async(payload,hooks)=>{calls.push(payload);hooks.onSubmitted('op-1');hooks.onAcknowledged({operation_id:'op-1',timer:{id:'timer-1',task_id:reading.id,state:'running'}});return true;}});
 await launcher.focus();assert.equal(launcher.snapshot().activeIndex,0);assert.equal(launcher.snapshot().open,true);
 await launcher.key({key:'Enter'});assert.deepEqual(calls,[{task_id:'reading-uuid'}]);assert.equal(launcher.snapshot().query,'');assert.match(launcher.snapshot().actionMessage,/Reading.*recording/);assert.equal(launcher.snapshot().pending,false);
});
