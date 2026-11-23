const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createTimerController} = require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');
const {calendarLiveEvents} = require('../src/timetrace/interfaces/api/static/js/calendar_live.js');
test('Calendar shows only uncommitted exact coverage, never bridges pause gaps', () => {
    const events = calendarLiveEvents({observed_at:'2026-01-01T12:00:00Z', timers:[{
        id:'timer', state:'paused', task_title:'Example', segments:[
            {id:'saved',recorded_work_id:'work',start_time:'2026-01-01T10:00:00Z',end_time:'2026-01-01T10:10:00Z'},
            {id:'buffer',start_time:'2026-01-01T10:20:00Z',end_time:'2026-01-01T10:30:00Z',notes:'note'}]
    }]});
    assert.equal(events.length,1);
    assert.equal(events[0].id,'live:timer:buffer');
    assert.equal(events[0].end,'2026-01-01T10:30:00Z');
    assert.match(events[0].title,/LIVE.*paused.*Example.*note/);
    assert.equal(events[0].editable,false);
});
test('a status started during Stop cannot restore live work after ACK while replacement GET hangs', async () => {
    let release;
    const stale = new Promise(resolve => {release=resolve;});
    let reads=0, ack;
    const controller=createTimerController({api:{get:()=> ++reads===1 ? stale : new Promise(()=>{}),
        post:(_url,payload)=>new Promise(resolve=>{ack=()=>resolve({operation_id:payload.operation_id,timer:{id:'t',state:'stopped'}});})},
        storage:{getItem:()=>null,setItem(){},removeItem(){}},onState(){},operationId:()=> 'stop'});
    const stopping=controller.act('t','stop');
    const reading=controller.refresh();
    ack();assert.equal(await stopping,true);
    release({timers:[{id:'t',state:'running',running_start:'2026-01-01T10:00:00Z',running_segment_id:'s'}],observed_at:'2026-01-01T10:01:00Z'});
    await reading;
    assert.deepEqual(calendarLiveEvents(controller.snapshot()),[]);
    assert.equal(controller.snapshot().timers.length,0);
});
test('recovered Stop fences overlapping status and retry never sends POST', async () => {
    let releaseStatus, releaseReceipt, posts=0, reads=0;
    const status=new Promise(resolve=>{releaseStatus=resolve;});
    const receipt=new Promise(resolve=>{releaseReceipt=resolve;});
    let stored=JSON.stringify({url:'/timers/t/stop',payload:{operation_id:'stop'},outcome:'uncertain'});
    const controller=createTimerController({api:{get:url=>url.startsWith('/operations/')?receipt:(++reads===1?status:new Promise(()=>{})),post(){posts++;}},
        storage:{getItem:key=>key==='timetrace_timer_v2_operation'?stored:null,setItem(_key,value){stored=value;},removeItem(){stored=null;}},onState(){}});
    const recovering=controller.recover(),reading=controller.refresh();
    releaseReceipt({status:'finalized',result:{operation_id:'stop',timer:{id:'t',state:'stopped'}}});await recovering;
    releaseStatus({timers:[{id:'t',state:'running'}],observed_at:'2026-01-01T10:00:00Z'});await reading;
    assert.deepEqual(controller.snapshot().timers,[]);
    assert.equal(posts,0);
    assert.equal(controller.snapshot().lastResult.timer.state,'stopped');
});
test('running coverage uses only server cutoff; frozen and unknown cutoffs never project', () => {
    const timer = {id:'t',state:'running',running_segment_id:'s',running_start:'2026-01-01T10:00:00Z',segments:[]};
    const events = calendarLiveEvents({timers:[timer],observed_at:'2026-01-01T10:05:00Z'});
    assert.equal(events[0].end,'2026-01-01T10:05:00Z');
    assert.deepEqual(calendarLiveEvents({timers:[timer]}),[]);
    assert.deepEqual(calendarLiveEvents({timers:[{...timer,state:'stopped'}],observed_at:'2026-01-01T11:00:00Z'}),[]);
});
