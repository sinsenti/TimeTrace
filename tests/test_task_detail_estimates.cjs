const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const root='src/timetrace/interfaces/api/static/js/';
function element(value='') {return {value,checked:false,disabled:false,dataset:{},style:{},classList:{add(){},remove(){},contains:()=>false},querySelectorAll:()=>[],focus(){},select(){}};}
function fixture(files,estimate) {
    const fields=Object.fromEntries(['inspector_task_id','inspector_edit_title','inspector_edit_desc','inspector_edit_status','inspector_edit_category','inspector_edit_priority','inspector_edit_attachments','inspector_edit_est','modal_input_title','modal_input_est','task_modal'].map(id=>[id,element()]));
    fields.inspector_task_id.value='task';fields.modal_input_title.value='Task';fields.modal_input_est.value=`${estimate}m`;
    const writes=[],row={id:'task',title:'Task',estimated_minutes:estimate,status:'To Do',category:'work',subtasks:[]};
    const context=vm.createContext({console:{error(){}},localStorage:{getItem:()=>null},setTimeout:fn=>fn(),
        document:{getElementById:id=>fields[id]||null,addEventListener(){},removeEventListener(){},querySelectorAll:()=>[]},
        window:{location:{},addEventListener(){}},alert(){},
        api:{get:async url=>url.endsWith('/tree')?row:{sessions:[],progress_pct:null},put:async(url,payload)=>{writes.push(payload);return {...row,...payload};},post:async(url,payload)=>{writes.push(payload);return {...row,...payload};}},
        taskKnowledge:{state:()=>({generation:0}),viewResult(){},changed:async()=>{},invalidate(){}}
    });
    for(const file of ['utils.js',...files])vm.runInContext(fs.readFileSync(root+file,'utf8'),context);
    return {context,fields,writes,run:code=>vm.runInContext(code,context)};
}
for(const [text,expected] of [['-30m',-30],['-1.5h',-90],['-2d',-2880],['-12.5',-12],['30m',30],['2 hours',120],['-',null],['none',null],['null',null],['',null],['junk',null],[undefined,15],[null,15]])
    test(`utils.parseDurationToMinutes existing estimate grammar: ${text}`,()=>{
        const b=fixture([],0);assert.equal(b.context.parseDurationToMinutes(text),expected);
    });
for(const estimate of [-60,0,null])test(`subtasks preserves unchanged persisted ${estimate} estimate on unrelated property save`,async()=>{
    const b=fixture(['subtasks.js'],estimate);await b.run('loadTaskDetailTree()');
    b.fields.inspector_edit_desc.value='Unrelated edit';await b.run('saveInspectorTaskProperties()');
    assert.equal(b.writes[0].estimated_minutes,estimate);
});
test('subtasks saves explicitly changed signed estimate using the actual shared parser',async()=>{
    const b=fixture(['subtasks.js'],60);await b.run('loadTaskDetailTree()');
    b.fields.inspector_edit_est.value='-2h';await b.run('saveInspectorTaskProperties()');
    assert.equal(b.writes[0].estimated_minutes,-120);
});
test('task_modal keeps negative estimate in real human Save payload',async()=>{
    const b=fixture(['task_modal.js'],-60);await b.run('saveTask()');
    assert.equal(b.writes[0].estimated_minutes,-60);
});
