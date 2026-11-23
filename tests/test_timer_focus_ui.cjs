const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createTimerController}=require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');
const {createFocusController} = require('../src/timetrace/interfaces/api/static/js/timer_focus.js');
test('focus action carries exact selected identity/generation and settings drafts survive refresh', async () => {
    const sent=[];
    let state={fresh:true,pending:false,receipt:null,selectedTimerId:'timer-a',timers:[{id:'timer-a',revision:4,state:'running',focus:{generation:2,phase:'work_due',settings:{enabled:true,work_minutes:25,break_minutes:5,behavior:'notify_only'}}}]};
    const control={snapshot:()=>state,act:async (...args)=>{sent.push(args);return true;}};
    const focus=createFocusController({control,api:{get:async()=>({})}});
    focus.edit('timer-a',{work_minutes:40});
    state={...state,timers:[{...state.timers[0],revision:5}]};
    assert.equal(focus.draft('timer-a').work_minutes,40);
    await focus.action('take_break');
    assert.deepEqual(sent[0],['timer-a','focus-action',{expected_revision:5,expected_generation:2,action:'take_break'}]);
    await focus.saveTimer();
    assert.equal(sent[1][2].work_minutes,40);
    assert.equal(sent[1][2].expected_revision,4);
});

test('native acceptance preference prevents browser fanout and sound stays single-channel',async()=>{
    let native=true,status='pending';const alerts=[];
    class Fake {static permission='granted';constructor(title,options){alerts.push(options);}}
    const api={get:async url=>url.endsWith('capability')?{available:native}:url==='/timer-notifications'?{notices:[{id:'e',kind:'work_due',timer_id:'timer',status}]}:{sound_enabled:false},
        post:async(url,payload)=>{if(url.endsWith('/claim')){status='unknown';return {send_authorized:true,claim_token:'t'};}status=payload.outcome;return {};}};
    const f=createFocusController({control:{snapshot:()=>({timers:[]})},api,notifications:Fake,operationId:()=> 'op'});
    await f.refreshNotices();assert.equal(alerts.length,0);
    native=false;await f.refreshNotices();assert.equal(alerts.length,1);assert.equal(alerts[0].silent,true);
    await f.refreshNotices();assert.equal(alerts.length,1);
});

test('selected identity survives reload independently of receipt journal',async()=>{
    const saved=new Map(),storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
    const api={get:async()=>({revision:1,timers:[{id:'a'},{id:'b'}]})};
    const first=createTimerController({api,storage,onState:()=>{}});await first.refresh();first.select('b');
    const second=createTimerController({api,storage,onState:()=>{}});await second.refresh();assert.equal(second.snapshot().selectedTimerId,'b');
});

test('defaults use shared ACK journal and hung display cannot replay a write',async()=>{
    const sent=[],saved=new Map();const storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
    const controller=createTimerController({storage,onState:()=>{},operationId:()=> 'fixed',api:{
        get:()=>new Promise(()=>{}),post:async(url,payload)=>{sent.push({url,payload});return {operation_id:payload.operation_id,timer:null};}}});
    assert.equal(await controller.saveFocusDefaults({enabled:true,work_minutes:25,break_minutes:5,behavior:'notify_only',sound_enabled:false,expected_revision:0,revision:999}),true);
    assert.equal(sent[0].url,'/timer-focus/defaults');assert.equal(sent[0].payload.revision,undefined);
    assert.equal(controller.snapshot().receipt.outcome,'acknowledged');
    controller.retry();await Promise.resolve();assert.equal(sent.length,1);
});

test('denied permission requests nothing and claims in-app once; unknown send is never retried',async()=>{
    let status='pending',sent=0,requests=0;const posts=[];
    class FakeNotification {static permission='denied';static requestPermission(){requests++;}constructor(){sent++;}}
    const api={get:async url=>url==='/timer-notifications'?{notices:[{id:'event',kind:'work_due',timer_id:'timer',status}]}:url.endsWith('capability')?{available:false}:{sound_enabled:false},
        post:async(url,payload)=>{posts.push({url,payload});if(url.endsWith('/claim')){status='unknown';return {send_authorized:true,claim_token:'private'};}throw Error('lost result');}};
    const focus=createFocusController({control:{snapshot:()=>({timers:[]})},api,notifications:FakeNotification,operationId:()=> 'claim'});
    await focus.refreshNotices();await focus.refreshNotices();
    assert.equal(sent,0);assert.equal(requests,0);assert.equal(posts.filter(p=>p.url.endsWith('/claim')).length,1);
    assert.equal(posts[0].payload.channel,'in_app');assert.match(focus.snapshot().deliveryMessage,/uncertain/);
    await focus.requestPermission();assert.equal(requests,1);
});
