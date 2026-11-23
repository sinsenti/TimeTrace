const {test} = require('node:test');
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
