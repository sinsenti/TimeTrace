const test=require('node:test'),assert=require('node:assert/strict');
const {createTimerController}=require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');
const {createQuickTimeAdjustments}=require('../src/timetrace/interfaces/api/static/js/timer_corrections.js');
const memory=()=>{const rows=new Map();return {getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};};
function setup(){
 let timer={id:'a',revision:1,state:'running',running_start:'2026-01-01T10:00:00Z',running_segment_id:'segment-a',segments:[],notes:'saved'};
 const calls=[];let id=0;
 const api={get:async()=>({timers:[timer],revision:timer.revision}),post:async(url,body)=>{
  calls.push({url,body});if(url.endsWith('/correction-preview'))return {schema_version:1,action:'step_start',timer_revision:timer.revision,resource:'/timers/a',signature:'signed',request:body,warnings:[]};
  timer={...timer,revision:timer.revision+1};return {operation_id:body.operation_id,timer};
 }};
 const control=createTimerController({api,storage:memory(),onState(){},operationId:()=>`op-${++id}`});
 return {control,calls,api,setTimer:value=>{timer={...timer,...value};}};
}
test('cancel, frozen intervals and unavailable browser preferences send no correction',async()=>{
 const s=setup();await s.control.refresh();const quick=createQuickTimeAdjustments({control:s.control,storage:memory(),confirm:()=>false});
 assert.equal(await quick.adjust(s.control.snapshot().timers[0],-300),false);assert.equal(s.calls.length,0);
 s.setTimer({state:'frozen'});await s.control.refresh();assert.equal(await quick.adjust(s.control.snapshot().timers[0],300),false);assert.equal(s.calls.length,0);
 s.setTimer({state:'running'});await s.control.refresh();const blocked=createQuickTimeAdjustments({control:s.control,storage:{getItem(){throw Error('storage unavailable');}},confirm:()=>true});assert.equal(await blocked.adjust(s.control.snapshot().timers[0],300),false);assert.equal(s.calls.length,0);
});
test('a server preview of a newer revision cannot silently rebase a quick click',async()=>{
 const s=setup();await s.control.refresh();const post=s.api.post;s.api.post=(url,body)=>url.endsWith('preview')?{schema_version:1,action:'step_start',timer_revision:2,resource:'/timers/a',request:body,signature:'signed'}:post(url,body);
 const quick=createQuickTimeAdjustments({control:s.control,storage:memory(),confirm:()=>true});assert.equal(await quick.adjust(s.control.snapshot().timers[0],300),false);assert.equal(s.calls.length,0);assert.match(quick.snapshot().message,/changed|revision/i);
});
test('one-time preparation is followed by fresh signed validation, without another prompt',async()=>{
 const s=setup();await s.control.refresh();const post=s.api.post;let initialized=false;
 s.api.post=async(url,body)=>{
  if(url.endsWith('/correction-preview')&&!initialized)throw Object.assign(Error('initialize'),{code:'correction_initialization_required'});
  if(url.endsWith('/correction-initialize')){initialized=true;s.calls.push({url,body});s.setTimer({revision:2});return {operation_id:body.operation_id,correction_initialized:true};}
  return post(url,body);
 };
 let prompts=0;const quick=createQuickTimeAdjustments({control:s.control,storage:memory(),confirm:()=>{prompts++;return true;}});
 assert.equal(await quick.adjust(s.control.snapshot().timers[0],300),true);assert.equal(prompts,1);assert.equal(s.calls[0].url,'/timers/correction-initialize');assert.equal(s.calls.at(-1).url,'/timers/a/correction');
});
test('an acknowledged quick correction permits a new click without replay when display read hangs',async()=>{
 const s=setup();await s.control.refresh();s.api.get=()=>new Promise(()=>{});
 const quick=createQuickTimeAdjustments({control:s.control,storage:memory(),confirm:()=>true});
 assert.equal(await quick.adjust(s.control.snapshot().timers[0],300),true);assert.equal(s.control.snapshot().fresh,false);
 assert.equal(await quick.adjust(s.control.snapshot().timers[0],300),true);assert.equal(s.calls.filter(c=>c.url.endsWith('/correction')).length,2);assert.notEqual(s.calls[1].body.operation_id,s.calls[3].body.operation_id);
});
test('a held preview prevents duplicate clicks and an A to B to A selection invalidates intent',async()=>{
 const s=setup(),get=s.api.get; s.api.get=async()=>{const data=await get();return {...data,timers:[...data.timers,{id:'b',revision:1,state:'running',running_start:'2026-01-01T10:00:00Z',running_segment_id:'b-segment',segments:[]}]};};await s.control.refresh();
 let release;const post=s.api.post;s.api.post=(url,body)=>{if(url.endsWith('/correction-preview')){s.calls.push({url,body});return new Promise(resolve=>{release=()=>resolve({schema_version:1,action:'step_start',timer_revision:1,resource:'/timers/a',request:body,signature:'signed'});});}return post(url,body);};
 const quick=createQuickTimeAdjustments({control:s.control,storage:memory(),confirm:()=>true}),timer=s.control.snapshot().timers[0];const first=quick.adjust(timer,300);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(await quick.adjust(timer,300),false);assert.equal(s.calls.length,1);s.control.select('b');s.control.select('a');release();assert.equal(await first,false);assert.equal(s.calls.length,1);assert.match(quick.snapshot().message,/changed/);
});
test('new note typing during a preview prevents automatic application',async()=>{
 const s=setup();await s.control.refresh();let dirty=false,release;const post=s.api.post;s.api.post=(url,body)=>url.endsWith('/correction-preview')?new Promise(resolve=>{release=()=>resolve({schema_version:1,action:'step_start',timer_revision:1,resource:'/timers/a',request:body,signature:'signed'});}):post(url,body);
 const quick=createQuickTimeAdjustments({control:s.control,storage:memory(),confirm:()=>true,conflicts:()=>dirty});const request=quick.adjust(s.control.snapshot().timers[0],300);await new Promise(resolve=>setImmediate(resolve));dirty=true;release();assert.equal(await request,false);assert.equal(s.calls.length,0);assert.match(quick.snapshot().message,/edits/);
});
test('paused quick adjustments target only the manual pause interval; server refusals never clamp',async()=>{
 const s=setup();s.setTimer({state:'paused',running_start:null,running_segment_id:null,manual_pause_note_segment_id:'latest',segments:[{id:'older',start_time:'2026-01-01T09:00:00Z',end_time:'2026-01-01T09:30:00Z'},{id:'latest',start_time:'2026-01-01T10:00:00Z',end_time:'2026-01-01T10:02:00Z'}]});await s.control.refresh();
 s.api.post=async(url,body)=>{s.calls.push({url,body});throw Object.assign(Error('The selected interval must retain positive work.'),{status:400});};
 const quick=createQuickTimeAdjustments({control:s.control,storage:memory(),confirm:()=>true});assert.equal(await quick.adjust(s.control.snapshot().timers[0],-300),false);assert.equal(s.calls.length,1);assert.deepEqual(s.calls[0].body.target,{kind:'buffered',segment_id:'latest'});assert.match(quick.snapshot().message,/positive work/);
});
test('an uncertain correction retains its journal and blocks a fresh quick click',async()=>{
 const s=setup();await s.control.refresh();const post=s.api.post;s.api.post=async(url,body)=>{if(url.endsWith('/correction')){s.calls.push({url,body});throw Error('lost ACK');}return post(url,body);};
 const quick=createQuickTimeAdjustments({control:s.control,storage:memory(),confirm:()=>true});assert.equal(await quick.adjust(s.control.snapshot().timers[0],300),false);assert.equal(s.control.snapshot().receipt.outcome,'uncertain');assert.equal(await quick.adjust(s.control.snapshot().timers[0],300),false);assert.equal(s.calls.length,2);
});
test('an async explanation cannot approve a timer revision that changed while it was open',async()=>{
 const s=setup();await s.control.refresh();let accept;const quick=createQuickTimeAdjustments({control:s.control,storage:memory(),confirm:()=>new Promise(resolve=>{accept=resolve;})});
 const request=quick.adjust(s.control.snapshot().timers[0],300);s.setTimer({revision:2});await s.control.refresh();accept(true);assert.equal(await request,false);assert.equal(s.calls.length,0);
});
test('concurrent changes during preparation never authorize a later interval automatically',async()=>{
 const s=setup();s.setTimer({running_segment_id:null});await s.control.refresh();s.api.post=async(url,body)=>{s.calls.push({url,body});s.setTimer({revision:3,running_segment_id:'initialized'});return {operation_id:body.operation_id,correction_initialized:true};};
 const quick=createQuickTimeAdjustments({control:s.control,storage:memory(),confirm:()=>true});assert.equal(await quick.adjust(s.control.snapshot().timers[0],300),false);assert.equal(s.calls.length,1);assert.equal(s.calls[0].url,'/timers/correction-initialize');assert.match(quick.snapshot().message,/changed during preparation/);
});
test('finalized recovery updates the quick-action result through reads only',async()=>{
 const s=setup();await s.control.refresh();const post=s.api.post,get=s.api.get;let payload;
 s.api.post=async(url,body)=>{if(url.endsWith('/correction')){s.calls.push({url,body});payload=body;throw Error('lost ACK');}return post(url,body);};
 const quick=createQuickTimeAdjustments({control:s.control,storage:memory(),confirm:()=>true});assert.equal(await quick.adjust(s.control.snapshot().timers[0],300),false);
 s.api.get=async url=>url.startsWith('/operations/')?{status:'finalized',result:{operation_id:payload.operation_id,timer:{...s.control.snapshot().timers[0],revision:2},correction:{changed_work_ids:[]}}}:get(url);
 await s.control.recover();assert.equal(quick.reconcile(),true);assert.match(quick.snapshot().message,/Added.*5 minutes/);assert.equal(s.calls.length,2);
});
test('one explanation authorizes subsequent signed five-minute clicks, including after reload',async()=>{
 const s=setup();await s.control.refresh();const storage=memory();let confirmations=0;
 let quick=createQuickTimeAdjustments({control:s.control,storage,confirm:()=>{confirmations++;return true;}});
 assert.equal(await quick.adjust(s.control.snapshot().timers[0],-300),true);await s.control.refresh();
 quick=createQuickTimeAdjustments({control:s.control,storage,confirm:()=>{throw Error('must remember browser choice');}});
 assert.equal(await quick.adjust(s.control.snapshot().timers[0],300),true);
 assert.equal(confirmations,1);assert.deepEqual(s.calls.map(c=>c.url),['/timers/a/correction-preview','/timers/a/correction','/timers/a/correction-preview','/timers/a/correction']);
 assert.deepEqual(s.calls[0].body,{target:{kind:'running',segment_id:'segment-a'},change:{kind:'step_start',credited_delta_seconds:-300}});
 assert.equal(s.calls[1].body.preview.signature,'signed');assert.equal(s.calls[1].body.operation_id,'op-1');
});
