const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = 'src/timetrace/interfaces/api/static/js/';
const held = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
function element(id, value = '') {
    const classes = new Set();
    return {id, value, type:'text', checked:false, disabled:false, dataset:{}, style:{},
        classList:{add:x=>classes.add(x), remove:x=>classes.delete(x), contains:x=>classes.has(x)},
        focus(){}, addEventListener(){}, querySelectorAll:()=>[]};
}
function fixture() {
    const fields = Object.fromEntries(['inspector_task_id', 'edit_subtask_id', 'subtask_parent_id',
        'modal_subtask_title', 'modal_subtask_tags', 'modal_subtask_est', 'modal_subtask_status',
        'modal_subtask_priority', 'subtask_modal', 'subtask_save_btn', 'subtask_save_status'].map(id=>[id, element(id)]));
    fields.inspector_task_id.value = 'parent';
    const list = Object.values(fields).filter(field=>field.id.startsWith('modal_subtask_') || field.id === 'edit_subtask_id');
    const select = (items, selector) => selector.includes('#')
        ? items.filter(field=>selector.split(',').some(part=>part.trim() === '#'+field.id)) : items;
    fields.subtask_modal.querySelectorAll = selector=>select(list, selector);
    fields.subtask_modal.cloneNode = () => {
        const copy = element('subtask_modal');
        const children = list.map(field=>Object.assign(element(field.id, field.value), {checked:field.checked}));
        copy.querySelectorAll = selector=>select(children, selector);
        return copy;
    };
    const writes = [], events = {};
    let tree = {id:'parent', title:'Parent', category:'work', tags:'#parent', subtasks:[]};
    let fail = false, mutation = async (url, body) => ({...body, id:'child'});
    const context = vm.createContext({console:{error(){}}, localStorage:{getItem:()=>null}, setTimeout:fn=>fn(),
        window:{location:{}, addEventListener(){}}, alert:message=>{throw Error(message);},
        document:{getElementById:id=>fields[id] || null, querySelectorAll:()=>[],
            addEventListener:(name,handler)=>(events[name] ||= []).push(handler)},
        api:{get:async url=>{if(fail) throw Error('503'); return url.endsWith('/tree') ? tree : {sessions:[]};},
            post:async (url,body)=>{writes.push({method:'POST',url,body}); return mutation(url,body);},
            put:async (url,body)=>{writes.push({method:'PUT',url,body}); return mutation(url,body);}},
        taskKnowledge:{state:()=>({generation:0}), viewResult(){}, changed:async()=>context.loadTaskDetailTree(true)}
    });
    for (const file of ['utils.js', 'settings.js', 'subtasks.js']) vm.runInContext(fs.readFileSync(source+file,'utf8'), context);
    return {fields, writes, context, run:code=>vm.runInContext(code,context),
        input(id,value) {fields[id].value=value; for(const handler of events.input || []) handler({target:fields[id]});},
        set tree(value){tree=value;}, set fail(value){fail=value;}, set mutation(value){mutation=value;}};
}

for (const estimate of [0, null, -60]) test(`subtasks real-utils child ACK ${estimate}, failed tree, later explicit canonical-ID PUT`, async()=>{
    const b = fixture(), ack = held();
    await b.run('loadTaskDetailTree()'); b.run('openSubtaskCreationModal()');
    b.input('modal_subtask_title','Submitted child'); b.mutation=()=>ack.promise;
    const saving=b.run('saveSubtaskFromModal()');
    b.input('modal_subtask_title','Concurrent title'); b.fail=true;
    ack.resolve({id:'canonical-child', parent_id:'parent', title:'Submitted child', estimated_minutes:estimate,
        category:'work', tags:'#parent', status:'To Do', priority:'-'});
    await saving;
    assert.equal(b.fields.edit_subtask_id.value,'canonical-child');
    assert.equal(b.fields.modal_subtask_est.value,estimate === -60 ? '-60m' : '-');
    assert.equal(b.run("hasSettingsDrafts(['subtask_modal'])"),true);
    await b.run('loadTaskDetailTree(true)');
    assert.equal(b.writes.length,1,'Read-only retry must not repeat the POST');
    b.mutation=async (url,body)=>({...body,id:'canonical-child'});
    await b.run('saveSubtaskFromModal()');
    assert.equal(b.writes.length,2);
    assert.equal(b.writes[1].method,'PUT');
    assert.equal(b.writes[1].url,'/api/tasks/canonical-child');
    assert.equal(b.writes[1].body.estimated_minutes,estimate);
    assert.equal(b.writes[1].body.category,'work');
    assert.equal(b.writes[1].body.parent_id,'parent');
    assert.equal(b.writes[1].body.title,'Concurrent title');
});

test('subtasks last ACK empty category and zero estimate outlive a newer display tree', async()=>{
    const b=fixture(), ack=held();
    await b.run('loadTaskDetailTree()'); b.run('openSubtaskCreationModal()');
    b.input('modal_subtask_title','Child'); b.mutation=()=>ack.promise;
    const saving=b.run('saveSubtaskFromModal()'); b.input('modal_subtask_title','Later');
    b.tree={id:'parent',title:'Parent',category:'personal',subtasks:[{id:'child',estimated_minutes:90,category:'stale'}]};
    ack.resolve({id:'child',title:'Child',estimated_minutes:0,category:'',parent_id:'parent'}); await saving;
    b.mutation=async (url,body)=>({...body,id:'child'});
    await b.run('saveSubtaskFromModal()');
    assert.equal(b.writes[1].body.estimated_minutes,0);
    assert.equal(b.writes[1].body.category,'');
});

for(const estimate of [0,null,-60]) test(`subtasks Edit initializes ${estimate} and empty category independently of missing display nodes`,async()=>{
    const b=fixture();
    b.tree={id:'parent',title:'Parent',category:'work',subtasks:[{id:'edit-child',parent_id:'parent',title:'Child',estimated_minutes:estimate,category:''}]};
    await b.run('loadTaskDetailTree()'); b.run("openSubtaskEditModal('edit-child')");
    b.tree={id:'parent',title:'Parent',category:'personal',subtasks:[]};
    await b.run('loadTaskDetailTree(true)'); b.input('modal_subtask_title','Edited child');
    b.mutation=async (url,body)=>({...body,id:'edit-child'});
    await b.run('saveSubtaskFromModal()');
    assert.equal(b.writes[0].method,'PUT');
    assert.equal(b.writes[0].url,'/api/tasks/edit-child');
    assert.equal(b.writes[0].body.estimated_minutes,estimate);
    assert.equal(b.writes[0].body.category,'');
    assert.equal(b.writes[0].body.parent_id,'parent');
});

test('subtasks closed ACK owner cannot leak its receipt into new Create or another Edit',async()=>{
    const b=fixture(), ack=held();
    b.tree={id:'parent',title:'Parent',category:'study',subtasks:[{id:'other-child',title:'Other',parent_id:'parent',estimated_minutes:-30,category:'personal'}]};
    await b.run('loadTaskDetailTree()'); b.run('openSubtaskCreationModal()');
    b.input('modal_subtask_title','Old child'); b.mutation=()=>ack.promise;
    const saving=b.run('saveSubtaskFromModal()'); b.run('closeSubtaskModal(true)');
    ack.resolve({id:'old-child',title:'Old child',estimated_minutes:0,category:''}); await saving;
    assert.equal(b.fields.edit_subtask_id.value,'');
    assert.equal(b.fields.subtask_modal.classList.contains('hidden'),true);
    b.run('openSubtaskCreationModal()'); b.input('modal_subtask_title','New child');
    b.mutation=async (url,body)=>({...body,id:'new-child'});
    await b.run('saveSubtaskFromModal()');
    assert.equal(b.writes[1].method,'POST');
    assert.equal(b.writes[1].body.estimated_minutes,15);
    assert.equal(b.writes[1].body.category,'study');
    b.run("openSubtaskEditModal('other-child')"); b.input('modal_subtask_title','Other edit');
    await b.run('saveSubtaskFromModal()');
    assert.equal(b.writes[2].url,'/api/tasks/other-child');
    assert.equal(b.writes[2].body.estimated_minutes,-30);
    assert.equal(b.writes[2].body.category,'personal');
});

for(const [input,expected] of [['-2h',-120],['0m',0],['-',null]]) test(`subtasks explicit changed estimate ${input} uses real parser, not persisted receipt`,async()=>{
    const b=fixture();
    b.tree={id:'parent',subtasks:[{id:'child',title:'Child',estimated_minutes:45,category:'',parent_id:'parent'}]};
    await b.run('loadTaskDetailTree()'); b.run("openSubtaskEditModal('child')");
    b.input('modal_subtask_est',input); b.fail=true;
    await b.run('saveSubtaskFromModal()');
    assert.equal(b.writes[0].body.estimated_minutes,expected);
    assert.equal(b.writes[0].body.category,'');
});

test('subtasks canonical receipt is not authority to resurrect a deleted child',async()=>{
    const b=fixture();
    b.tree={id:'parent',subtasks:[{id:'deleted-child',title:'Child',estimated_minutes:0,category:'',parent_id:'parent'}]};
    await b.run('loadTaskDetailTree()'); b.run("openSubtaskEditModal('deleted-child')");
    b.input('modal_subtask_title','Retained draft'); b.fail=true;
    b.mutation=async()=>{throw Error('404 task not found');};
    await b.run('saveSubtaskFromModal()');
    assert.equal(b.writes.length,1);
    assert.equal(b.writes[0].method,'PUT');
    assert.equal(b.fields.edit_subtask_id.value,'deleted-child');
    assert.equal(b.fields.modal_subtask_title.value,'Retained draft');
    assert.match(b.fields.subtask_save_status.textContent,/Save not confirmed/);
    assert.equal(b.fields.subtask_modal.classList.contains('hidden'),false);
    assert.equal(b.fields.subtask_save_btn.disabled,false);
});
