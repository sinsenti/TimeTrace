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
test('a late ACK preserves a newer suggestion selection even when the query is unchanged',async()=>{
 let ack;const rows=[{id:'a',title:'Read A',match_kind:'prefix'},{id:'b',title:'Read B',match_kind:'prefix'}];
 const l=createTaskLauncher({api:{get:async()=>({suggestions:rows})},startTask:(p,h)=>{h.onSubmitted('a-op');return new Promise(resolve=>{ack=()=>{h.onAcknowledged({operation_id:'a-op',timer:{id:'t',state:'running'}});resolve(true);};});}});
 await l.input('read');const saving=l.start();await Promise.resolve();l.key({key:'ArrowDown'});ack();await saving;
 assert.equal(l.snapshot().query,'read');assert.equal(l.snapshot().rows[l.snapshot().activeIndex].id,'b');
});
test('same-query refresh failure after Start belongs to the newer read, not its old ACK',async()=>{
 let reads=0,ack;const l=createTaskLauncher({api:{get:async()=>{if(++reads>1)throw Error('offline');return {suggestions:[{id:'a',title:'Read A',match_kind:'prefix'}]};}},startTask:(p,h)=>{h.onSubmitted('a-op');return new Promise(resolve=>{ack=()=>{h.onAcknowledged({operation_id:'a-op',timer:{id:'t',state:'running'}});resolve(true);};});}});
 await l.input('read');const saving=l.start();await Promise.resolve();await l.refresh();ack();await saving;
 assert.equal(l.snapshot().query,'read');assert.match(l.snapshot().message,/unavailable/);
});
test('timer selection made during metadata preflight survives the eventual Start ACK',async()=>{
 const {createTimerController}=require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');let release;const values=new Map();
 const control=createTimerController({api:{get:async()=>({timers:[{id:'a',state:'running'},{id:'b',state:'paused'}],revision:1}),post:async(_,p)=>({operation_id:p.operation_id,timer:{id:'a',state:'running'}})},storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},operationId:()=> 'preflight',onState(){}});
 await control.refresh();const l=createTaskLauncher({api:{get:async()=>({suggestions:[{id:'task-a',title:'Task A',match_kind:'default'}]})},timerSelection:()=>control.snapshot().selectionGeneration,validateTask:()=>new Promise(r=>release=r),startTask:(p,h)=>{const saving=control.start(p,h.onAcknowledged,{preservePage:true,selectionGeneration:h.selectionGeneration});h.onSubmitted(control.snapshot().receipt.payload.operation_id);return saving;}});
 await l.focus();const saving=l.start();control.select('b');release(true);await saving;assert.equal(control.snapshot().selectedTimerId,'b');
});
test('both launcher presentations share one fresh-or-own-ACK availability policy',()=>{
 const {canStartTaskFromTimerState}=require('../src/timetrace/interfaces/api/static/js/task_launcher.js');
 assert.equal(canStartTaskFromTimerState({fresh:true,pending:false,receipt:null}),true);
 assert.equal(canStartTaskFromTimerState({fresh:false,pending:false,receipt:{outcome:'acknowledged',payload:{operation_id:'a'}},lastResult:{operation_id:'a'}}),true);
 assert.equal(canStartTaskFromTimerState({fresh:true,pending:true,receipt:null}),false);
 assert.equal(canStartTaskFromTimerState({fresh:false,pending:false,receipt:{outcome:'uncertain',payload:{operation_id:'a'}}}),false);
});
test('folding during an in-flight Start owns the view through a late ACK and never refetches or repeats a write',async()=>{
 let ack,reads=0,starts=0;
 const l=createTaskLauncher({view:'priority',api:{get:async()=>{reads++;return {suggestions:[{id:'a',title:'Read A',priority:'high',match_kind:'prefix'}]};}},startTask:(p,h)=>{starts++;h.onSubmitted('fold-op');return new Promise(resolve=>{ack=()=>{h.onAcknowledged({operation_id:'fold-op',timer:{id:'t',state:'running'}});resolve(true);};});}});
 await l.input('read');const saving=l.start();await Promise.resolve();
 assert.equal(l.toggleGroup('prefix','high'),true);ack();await saving;
 assert.equal(l.snapshot().query,'read');assert.equal(l.snapshot().open,true);assert.equal(l.snapshot().activeIndex,-1);
 assert.deepEqual(l.snapshot().collapsedGroups,['prefix:high']);assert.equal(reads,1);assert.equal(starts,1);
 await l.key({key:'Enter'});assert.equal(starts,1);
 l.toggleGroup('prefix','high');l.key({key:'ArrowDown'});assert.equal(l.snapshot().activeIndex,0);
});
test('collapsed close matches still require explicit selection, and search rank groups collapse independently',async()=>{
 let starts=0;
 const l=createTaskLauncher({view:'priority',api:{get:async()=>({suggestions:[{id:'fuzzy',title:'Raed',priority:'high',match_kind:'fuzzy'}]})},startTask:async()=>{starts++;return true;}});
 await l.input('read');assert.equal(l.toggleGroup('unknown','high'),false);assert.equal(l.toggleGroup('fuzzy','all'),false);
 l.toggleGroup('default','high');assert.equal(l.choose(0),true,'default and close-match groups do not share one fold');
 l.toggleGroup('fuzzy','high');assert.equal(l.choose(0),false);await l.start({explicitButton:true});assert.equal(starts,0);
 l.toggleGroup('fuzzy','high');await l.key({key:'Enter'});assert.equal(starts,0,'unfolding is not an explicit close-match selection');
 l.key({key:'ArrowDown'});await l.key({key:'Enter'});assert.equal(starts,1);
 await l.view('suggested');assert.equal(l.toggleGroup('fuzzy','high'),false,'the shared Suggested presentation has no folding state');
});
const reading={id:'reading-uuid',title:'Reading',match_kind:'default',scheduled_state:'now'};
test('focus shows defaults and Enter starts the highlighted task only',async()=>{
 const calls=[];const launcher=createTaskLauncher({api:{get:async()=>({suggestions:[reading]})},startTask:async(payload,hooks)=>{calls.push(payload);hooks.onSubmitted('op-1');hooks.onAcknowledged({operation_id:'op-1',timer:{id:'timer-1',task_id:reading.id,state:'running'}});return true;}});
 await launcher.focus();assert.equal(launcher.snapshot().activeIndex,0);assert.equal(launcher.snapshot().open,true);
 await launcher.key({key:'Enter'});assert.deepEqual(calls,[{task_id:'reading-uuid'}]);assert.equal(launcher.snapshot().query,'');assert.match(launcher.snapshot().actionMessage,/Reading.*recording/);assert.equal(launcher.snapshot().pending,false);
});
test('view and priority changes fence old reads and ACKs without clearing the new query or choice',async()=>{
 const urls=[];let releaseRead,ack;
 const l=createTaskLauncher({view:'priority',api:{get:url=>{urls.push(url);return url.includes('priority=high')&&!releaseRead?new Promise(r=>releaseRead=r):Promise.resolve({suggestions:[{id:'low',title:'Read low',match_kind:'prefix'}]});}},startTask:(p,h)=>{h.onSubmitted('old-view');return new Promise(resolve=>{ack=()=>{h.onAcknowledged({operation_id:'old-view',timer:{id:'t',state:'paused'}});resolve(true);};});}});
 await l.input('read');assert.equal(new URL(urls[0],'http://test').searchParams.get('view'),'priority');
 const saving=l.start();await Promise.resolve();
 const old=l.priority('high');await l.view('suggested');await l.priority('low');
 releaseRead({suggestions:[{id:'old-high',title:'Old high',match_kind:'prefix'}]});await old;ack();await saving;
 assert.equal(l.snapshot().view,'suggested');assert.equal(l.snapshot().priority,'low');assert.equal(l.snapshot().query,'read');assert.equal(l.snapshot().rows[0].id,'low');assert.equal(l.snapshot().open,true);
 const p=new URL(urls.at(-1),'http://test').searchParams;assert.equal(p.get('view'),'suggested');assert.equal(p.get('priority'),'low');
});
for(const [selector,oldChoice,newChoice] of [['view','suggested','priority'],['priority','high','none']]){
 test(`${selector} alone owns its late read and Start ACK fence`,async()=>{
  let release,ack;const rows=[{id:'a',title:'Read A',match_kind:'prefix'},{id:'b',title:'Read B',match_kind:'prefix'}];
  const l=createTaskLauncher({view:'priority',api:{get:async url=>{
   if(new URL(url,'http://test').searchParams.get(selector)===oldChoice&&!release)return new Promise(r=>release=r);
   return {suggestions:rows};
  }},startTask:(p,h)=>{h.onSubmitted('op');return new Promise(resolve=>{ack=()=>{h.onAcknowledged({operation_id:'op',timer:{id:'t',state:'running'}});resolve(true);};});}});
  await l.input('read');const saving=l.start();await Promise.resolve();
  const old=l[selector](oldChoice);await l[selector](newChoice);l.choose(1);
  release({suggestions:[{id:'stale',title:'Old choice',match_kind:'prefix'}]});await old;ack();await saving;
  assert.equal(l.snapshot()[selector],newChoice);assert.equal(l.snapshot().query,'read');assert.equal(l.snapshot().rows[l.snapshot().activeIndex].id,'b');assert.equal(l.snapshot().open,true);
 });
}
