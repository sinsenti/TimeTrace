const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createTimerController} = require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');
function setup(api) {
    const records = new Map();
    return {records, control:createTimerController({api, storage:{getItem:k=>records.get(k),setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)},onState:()=>{},operationId:()=> 'operation'})};
}
test('known corrections invalidate export bytes and remap only explicitly selected source identities',async()=>{
    const {createHistoryExportController}=require('../src/timetrace/interfaces/api/static/js/history_export.js');
    const requests=[];
    const report=createHistoryExportController({preview:async body=>{requests.push(body);return {rows:[],markdown:{content:'old'},csv:{content:'old'}};}});
    report.configure({timezone:'UTC'}); report.select('original',true);report.select('unrelated',true);
    await report.preview('selected');
    report.corrected({changed_work_ids:['original','unselected'],created_work_ids:['fragment','other'],work_fragments:[{source_work_id:'original',work_ids:['original','fragment']},{source_work_id:'unselected',work_ids:['unselected','other']}]});
    assert.equal(report.state().envelope,null);
    await report.preview('selected');
    assert.deepEqual(new Set(requests.at(-1).selected_ids),new Set(['original','fragment','unrelated']));
    report.corrected({changed_work_ids:['original'],created_work_ids:['legacy-unknown']});
    assert.match(report.state().error,/select.*fragment/i);
    assert.deepEqual(new Set(report.state().selected),new Set(['fragment','unrelated']));
});
test('correction preview is read-only; strict signed commit journals exact resource and envelope', async()=>{
    const posts=[];
    const envelope={schema_version:3,resource:'/recorded-work/work-a',signature:'signed',plan:{after:[]}};
    const {control,records}=setup({get:async()=>({timers:[],revision:1}),post:async(url,payload)=>{
        posts.push({url,payload});
        if(url.endsWith('correction-preview')) {assert.equal(records.size,0);return envelope;}
        assert.deepEqual(JSON.parse([...records.values()][0]).payload,payload);
        return {operation_id:payload.operation_id};
    }});
    const request={target:{kind:'saved',work_id:'work-a',expected_revision:1},change:{kind:'step_start',credited_delta_seconds:300}};
    assert.equal(await control.previewCorrection('/recorded-work/work-a',request),envelope);
    await control.commitCorrection('/recorded-work/work-a',envelope);
    assert.deepEqual(posts,[{url:'/recorded-work/work-a/correction-preview',payload:request},{url:'/recorded-work/work-a/correction',payload:{operation_id:'operation',preview:envelope}}]);
    await control.initializeCorrections();
    assert.deepEqual(posts[2],{url:'/timers/correction-initialize',payload:{operation_id:'operation'}});
});
test('rechecking an acknowledged correction after display failure is reads-only without republishing old ACK',async()=>{
    let operations=0,posts=0;
    const {control}=setup({post:async()=>{posts++;throw Error('lost ACK');},get:async path=>{
        if(path.startsWith('/operations/')){operations++;return {status:'finalized',result:{operation_id:'operation',correction:{changed_work_ids:[]}}};}
        throw Error('display offline');
    }});
    await control.commitCorrection('/timers/a',{resource:'/timers/a'});
    await control.recover(); await new Promise(setImmediate);
    assert.equal(control.snapshot().receipt.outcome,'acknowledged');
    await control.recover();
    assert.equal(posts,1);assert.equal(operations,1);
});
test('late pending status cannot regress an already recovered correction ACK',async()=>{
    const finish=[];
    const {control}=setup({post:async()=>{throw Error('lost ACK');},get:path=>path.startsWith('/operations/')?new Promise(resolve=>finish.push(resolve)):Promise.reject(Error('display unavailable'))});
    await control.commitCorrection('/timers/a',{resource:'/timers/a'});
    const first=control.recover(),late=control.recover();
    finish[0]({status:'finalized',result:{operation_id:'operation',correction:{changed_work_ids:[]}}});await first;
    finish[1]({status:'pending_reconciliation'});await late;
    assert.equal(control.snapshot().receipt.outcome,'acknowledged');
    assert.doesNotMatch(control.snapshot().message,/needs reconciliation/);
});
test('a late uncertain-status lookup cannot release a newer same-operation retry',async()=>{
    let rejectLookup,acceptRetry,posts=0;
    const {control,records}=setup({get:path=>path.startsWith('/operations/') ? new Promise((_,reject)=>rejectLookup=reject) : Promise.resolve({timers:[]}),post:async(url,payload)=>{
        if(++posts===1) throw Object.assign(Error('refused'),{status:422});
        return new Promise(resolve=>acceptRetry=()=>resolve({operation_id:payload.operation_id}));
    }});
    const first=control.act('a','pause'); await new Promise(setImmediate);
    assert.equal(control.snapshot().pending,false);
    const retry=control.retry(); await new Promise(setImmediate);
    rejectLookup(Object.assign(Error('missing'),{status:404})); await first;
    assert.equal(control.snapshot().pending,true);
    assert.equal(JSON.parse([...records.values()][0]).outcome,'uncertain');
    acceptRetry(); assert.equal(await retry,true);
});
test('a correction approved on A never retargets a newer selected timer B',async()=>{
    const timers=[{id:'a',state:'running'},{id:'b',state:'paused'}];
    const {control}=setup({get:async()=>({timers,revision:1}),post:async(url,payload)=>({operation_id:payload.operation_id,timer:timers[0]})});
    await control.refresh(); control.select('b');
    await control.commitCorrection('/timers/a',{resource:'/timers/a'});
    assert.equal(control.snapshot().selectedTimerId,'b');
});
test('acknowledged correction with hung display read does not block a new Stop or release its pending ownership',async()=>{
    let releaseRead, releaseStop;
    const {control}=setup({get:()=>new Promise(resolve=>releaseRead=resolve),post:async(url,payload)=>{
        if(url.endsWith('/stop')) return new Promise(resolve=>releaseStop=()=>resolve({operation_id:payload.operation_id}));
        return {operation_id:payload.operation_id};
    }});
    const first=control.act('a','pause');
    await new Promise(setImmediate);
    const second=control.act('a','stop');
    await new Promise(setImmediate);
    assert.equal(control.snapshot().pending,true);
    releaseRead({timers:[],revision:1});
    await first;
    assert.equal(control.snapshot().pending,true);
    releaseStop();
    await new Promise(setImmediate);
    releaseRead({timers:[],revision:2});
    assert.equal(await second,true);
});
