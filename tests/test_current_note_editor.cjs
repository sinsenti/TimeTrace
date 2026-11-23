const {test} = require('node:test');
for (const state of ['running','paused']) test(state+' ACK releases draft during hung display recovery', async () => {
    let finishRead, finishPost;
    const oldRead = new Promise(resolve=>{finishRead=resolve;});
    const nextPost = new Promise(resolve=>{finishPost=resolve;});
    let reads=0, writes=0;
    const timer={id:'timer',revision:1,state,notes:'Old',manual_pause_note_segment_id:'segment'};
    let current=timer;
    const control=createTimerController({api:{get:()=>++reads===1?oldRead:Promise.resolve({timers:[current]}),post:async(url,payload)=>{
        if(++writes===2) return nextPost;
        current={...timer,revision:2,notes:'Saved'};
        return {operation_id:payload.operation_id,timer:current};
    }},storage:{getItem:()=>null,setItem(){},removeItem(){}},operationId:()=>String(writes+1),onState(){}});
    const draft=createCurrentNoteDraft(timer,control);
    draft.input('Saved');const oldSave=draft.save();
    await new Promise(resolve=>setImmediate(resolve));
    await control.refresh();
    assert.equal(control.snapshot().fresh,true);
    assert.equal(control.snapshot().receipt,null);
    assert.equal(draft.state().pending,false);
    assert.equal(draft.state().dirty || draft.state().pending,false,'Stop must not be draft-blocked');
    draft.input('Newer');const newerSave=draft.save();
    finishRead({timers:[timer]});await oldSave;
    assert.equal(draft.state().pending,true,'old completion must not release newer mutation');
    finishPost({operation_id:'2',timer:{...current,revision:3,notes:'Newer'}});await newerSave;
    assert.equal(draft.state().pending,false);
});
const assert = require('node:assert/strict');
const {createCurrentNoteDraft} = require('../src/timetrace/interfaces/api/static/js/current_note_editor.js');
const {createTimerController} = require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');
test('current note draft sends only note action with captured revision and paused segment identity; late reads retain typing', async () => {
    const mutations = [];
    const values = new Map();
    const timer = {id:'timer',revision:7,state:'paused',notes:'Old',manual_pause_note_segment_id:'current'};
    const control = createTimerController({api:{get:async()=>({timers:[timer]}),post:async(url,payload)=>{
        mutations.push([url,payload]);
        return {operation_id:payload.operation_id,timer:{...timer,revision:8,notes:'New'}};
    }},storage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},operationId:()=> 'note-op',onState(){}});
    const draft = createCurrentNoteDraft(timer,control);
    draft.input('New');
    draft.adopt({...timer,revision:9,notes:'External',manual_pause_note_segment_id:'other'});
    assert.equal(draft.state().value,'New');
    await draft.save();
    assert.deepEqual(mutations,[['/timers/timer/note',{operation_id:'note-op',expected_revision:7,expected_note_segment_id:'current',new_notes:'New'}]]);
    assert.equal(draft.state().dirty,false);
    assert.equal(draft.state().baseline.revision,8);
});

test('later current-note typing survives its own delayed ACK and failed refresh', async () => {
    let release;
    const response = new Promise(resolve=>{ release = resolve; });
    const values = new Map();
    const timer = {id:'timer',revision:1,state:'running',notes:'Old'};
    const control = createTimerController({api:{get:async()=>{throw Error('offline');},post:()=>response},
        storage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},operationId:()=> 'late-note',onState(){}});
    const draft = createCurrentNoteDraft(timer,control);
    draft.input('Submitted'); const save = draft.save(); draft.input('Later typing');
    release({operation_id:'late-note',timer:{...timer,revision:2,notes:'Submitted'}});
    await save;
    assert.equal(draft.state().value,'Later typing');
    assert.equal(draft.state().baseline.notes,'Submitted');
    assert.equal(draft.state().dirty,true);
    assert.equal(control.snapshot().receipt.outcome,'acknowledged');
});
