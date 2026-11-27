const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createTimerController} = require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');
function setup({paused=false,lost=false}={}) {
    const calls=[], store=new Map();
    let timer={id:'timer-uuid',revision:2,state:paused?'paused':'running',task_id:null};
    const control=createTimerController({storage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},operationId:()=>`op-${calls.length}`,onState(){},api:{
        get:async url=>{calls.push(['GET',url]);return url==='/timers'?{timers:[timer],revision:1}:{status:'pending_reconciliation'};},
        post:async (url,payload)=>{calls.push(['POST',url,payload]);if(lost)throw Error('lost ACK');
            timer={...timer,state:'paused',revision:3,stop_review:{id:payload.operation_id,cutoff:'2026-01-01T10:00:00Z',was_running:!paused}};
            return {operation_id:payload.operation_id,timer};}
    }});
    return {control,calls,store};
}
test('Stop durably prepares review instead of recording, and reopening a paused review sends no new mutation',async()=>{
    const {control,calls}=setup();await control.refresh();await control.act('timer-uuid','stop',{expected_revision:2});await control.refresh();
    assert.equal(calls.find(c=>c[0]==='POST')[1],'/timers/timer-uuid/stop-review');
    assert.equal(control.snapshot().timers[0].state,'paused');
    await control.act('timer-uuid','stop',{expected_revision:3});
    assert.equal(calls.filter(c=>c[0]==='POST').length,1);
});
test('uncertain Stop preparation can only inspect its journal, including Retry',async()=>{
    const {control,calls}=setup({lost:true});await control.refresh();await control.act('timer-uuid','stop',{expected_revision:2});await control.retry();
    assert.equal(calls.filter(c=>c[0]==='POST').length,1);
    assert.match(calls.at(-1)[1],/^\/operations\//);
});

const {mountStopReview} = require('../src/timetrace/interfaces/api/static/js/stop_review.js');
function dialogDocument() {
    let doc;
    class Element {
        constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.isConnected=true;this.value='';this.ownerDocument=doc;}
        append(...nodes){this.children.push(...nodes);}
        replaceChildren(...nodes){this.children=nodes;}
        setAttribute(k,v){this[k]=v;}
        addEventListener(k,v){this.listeners[k]=v;}
        focus(){doc.activeElement=this;}
        showModal(){this.open=true;}
        close(){this.open=false;}
        remove(){this.isConnected=false;}
        contains(node){return node===this||this.children.some(c=>c.contains?.(node));}
    }
    doc={createElement:t=>new Element(t)};doc.body=new Element('body');doc.activeElement=new Element('button');return doc;
}
const descendants = el => [el,...el.children.flatMap(descendants)];
test('mounted Stop review requires an explicit plan and shows separated actual parts; Escape only dismisses',async()=>{
    const doc=dialogDocument(),calls=[];
    const timer={id:'timer',revision:3,state:'paused',stop_review:{id:'review',was_running:true}};
    const preview={consent_token:'token',candidates:[{id:'plan-uuid',revision:7,start_time:'2025-01-01T09:00:00Z',end_time:'2025-01-01T10:00:00Z',original_start:'2025-01-01T08:00:00Z',original_end:'2025-01-01T09:00:00Z'}],actual_parts:[{start_time:'2025-01-01T09:10:00Z',end_time:'2025-01-01T09:20:00Z'},{start_time:'2025-01-01T09:30:00Z',end_time:'2025-01-01T09:40:00Z'}],blocked:{actual:[],continue:[],fit:['Separated work parts require explicit Split.'],split:['Choose a plan'],scheduled:['Choose a plan']},effects:{}};
    const control={snapshot:()=>({timers:[timer]}),previewStop:async(id,payload)=>{calls.push(['preview',payload]);return preview;},commitStop:async(id,payload)=>{calls.push(['commit',payload]);return true;}};
    const dialog=await mountStopReview({document:doc,control,id:'timer'});
    const nodes=descendants(dialog);
    assert.ok(nodes.some(n=>n.textContent==='Save actual time'));
    assert.equal(nodes.find(n=>n.tagName==='select').value,'');
    assert.ok(nodes.some(n=>n.textContent?.includes('2 actual work parts')));
    assert.equal(nodes.find(n=>n.textContent==='Save work and split schedule').disabled,true);
    dialog.listeners.cancel({preventDefault(){}});
    assert.deepEqual(calls.map(c=>c[0]),['preview']);
    assert.equal(doc.activeElement.tagName,'button');
});

const {mountReviewedRecording} = require('../src/timetrace/interfaces/api/static/js/reviewed_recording.js');
test('mounted linked recording edits exact current times, invalidates consent on changes and warns about existing work',async()=>{
    const doc=dialogDocument(),calls=[];
    const api={post:async(url,payload)=>{calls.push([url,payload]);return {consent_token:'exact',existing_work:[{id:'existing',start_time:'2020-01-01T09:00:00Z',end_time:'2020-01-01T10:00:00Z'}],duplicate_warning:true};},saveRecordedWork:async payload=>{calls.push(['save',payload]);return {id:'work',kind:'recorded_work'};}};
    const view=mountReviewedRecording({document:doc,api,payload:{task_id:'task-uuid',scheduled_session_id:'plan-uuid',expected_plan_revision:4,start_time:'2020-01-01T09:00:00Z',end_time:'2020-01-01T10:00:00Z',notes:'<img src=x>',tags:''},operationId:()=> 'op'});
    await new Promise(setImmediate);
    const nodes=descendants(view.dialog),save=nodes.find(n=>n.textContent==='Save linked recorded work');
    assert.equal(save.disabled,true,'existing work needs acknowledgement');
    assert.ok(nodes.some(n=>n.textContent?.includes('existing')));
    const start=nodes.find(n=>n['aria-label']==='Recorded start');
    assert.match(start.value,/2020-01-01/);
    start.value='2020-01-01T08:00';start.listeners.input();
    assert.equal(save.disabled,true,'edits invalidate exact consent');
    assert.equal(calls.length,1);
    view.dialog.listeners.cancel({preventDefault(){}});
    assert.equal(await view.completion,null);
});

async function stopPage({wasRunning=true,lostCommit=false}={}) {
    const doc=dialogDocument(),calls=[],store=new Map();let selected=false;
    let timer={id:'timer-uuid',revision:3,state:'paused',task_id:'task-uuid',stop_review:{id:'review-op',was_running:wasRunning}};
    const plan={id:'plan-uuid',revision:8,start_time:'2020-01-01T09:00:00Z',end_time:'2020-01-01T10:00:00Z',original_start:'2020-01-01T08:00:00Z',original_end:'2020-01-01T09:00:00Z'};
    const control=createTimerController({storage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},operationId:()=> 'commit-op',onState(){},api:{
        get:async url=>{calls.push(['GET',url]);return url==='/timers'?{timers:timer.state==='stopped'?[]:[timer],revision:3}:{status:'pending_reconciliation'};},
        post:async(url,payload)=>{calls.push(['POST',url,payload]);
            if(url.endsWith('/stop-preview')) {selected=payload.scheduled_session_id===plan.id;return {consent_token:selected?'selected-exact':'unselected',selected_plan_id:selected?plan.id:null,candidates:[plan],actual_parts:[{start_time:'2020-01-01T09:10:00Z',end_time:'2020-01-01T09:20:00Z'}],blocked:{actual:[],continue:wasRunning?[]:['Already paused'],fit:selected?[]:['Choose plan'],split:['One part'],scheduled:selected?[]:['Choose plan']},effects:{scheduled:{interval:plan}}};}
            if(lostCommit)throw Error('lost ACK');timer={...timer,state:payload.policy==='continue'?'running':'stopped'};return {operation_id:payload.operation_id,timer};}
    }});
    await control.refresh();const dialog=await mountStopReview({document:doc,control,id:timer.id});return {doc,control,dialog,calls};
}
test('mounted Stop explicitly selects a plan and commits exact preview via shared journal without intermediate stop/discard/create',async()=>{
    const p=await stopPage();let nodes=descendants(p.dialog);const select=nodes.find(n=>n.tagName==='select');
    select.value='plan-uuid';select.listeners.change();await new Promise(setImmediate);
    nodes=descendants(p.dialog);await nodes.find(n=>n.textContent==='Record as scheduled').listeners.click();
    const mutations=p.calls.filter(c=>c[0]==='POST'&&!c[1].endsWith('/stop-preview'));
    assert.equal(mutations.length,1);assert.equal(mutations[0][1],'/timers/timer-uuid/stop-commit');
    assert.deepEqual(mutations[0][2],{review_id:'review-op',expected_revision:3,scheduled_session_id:'plan-uuid',expected_plan_revision:8,consent_token:'selected-exact',policy:'scheduled',operation_id:'commit-op'});
    assert.equal(p.dialog.open,false);
});
test('mounted already-paused Stop disables Continue; uncertain commit remains GET-only on Check and Retry',async()=>{
    const p=await stopPage({wasRunning:false,lostCommit:true});
    assert.equal(descendants(p.dialog).find(n=>n.textContent==='Continue timing').disabled,true);
    await descendants(p.dialog).find(n=>n.textContent==='Save actual time').listeners.click();
    await descendants(p.dialog).find(n=>n.textContent==='Check operation (read only)').listeners.click();await p.control.retry();
    assert.equal(p.calls.filter(c=>c[1].endsWith('/stop-commit')).length,1);
    assert.equal(p.calls.at(-1)[0],'GET');
});
