const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createTimerController, renderTimerWorkspaceCard, renderTimerStripStatus} = require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');

const plan = {id:'explicit-plan',task_id:'task',kind:'scheduled_session',start_time:'2026-01-02T09:00:00Z',end_time:'2026-01-02T10:00:00Z'};
const timer = {id:'timer',revision:1,task_id:'task',task_title:'Read <notes>',state:'paused',scheduled_session_id:plan.id};
const tick = () => new Promise(resolve=>setImmediate(resolve));
function controller(get, post = async()=>{throw Error('No write expected');}) {
    return createTimerController({api:{get,post},storage:{getItem:()=>null,setItem(){},removeItem(){}},onState(){},operationId:()=> 'fixed-op'});
}

test('explicit plan context reads the timer association only; task-only timers never infer a link', async()=>{
    const calls=[];
    const control=controller(async path=>{calls.push(path);return path==='/timers'?{timers:[timer,{id:'unlinked',task_id:'task-2',state:'paused'}]}:plan;});
    await control.refresh();await tick();
    assert.equal(control.snapshot().planContext.status,'ready');
    assert.equal(control.snapshot().planContext.plan.id,plan.id);
    assert.deepEqual(calls,['/timers','/scheduled-sessions/explicit-plan']);
    control.select('unlinked');await tick();
    assert.equal(control.snapshot().planContext.status,'none');
    assert.equal(calls.length,2);
});

test('late plan reads cannot replace a newer selection, timer revision, or failed timer read',async()=>{
    let finish,fail=false,current=timer;
    const control=controller(path=>path==='/timers'?(fail?Promise.reject(Error('offline')):Promise.resolve({timers:[current,{id:'other',state:'paused'}]})):new Promise(resolve=>{finish=resolve;}));
    await control.refresh();control.select('other');finish(plan);await tick();
    assert.equal(control.snapshot().planContext.status,'none');
    control.select('timer');const old=finish;
    current={...timer,revision:2,scheduled_session_id:null};await control.refresh();old(plan);await tick();
    assert.equal(control.snapshot().planContext.status,'none');
    current=timer;await control.refresh();const late=finish;fail=true;await control.refresh();late(plan);await tick();
    assert.equal(control.snapshot().planContext.status,'stale');
    assert.equal(control.snapshot().planContext.plan,undefined);
});

test('failed or mismatched plan lookup remains explicitly linked but unavailable; refresh only retries GET',async()=>{
    let response=Promise.reject.bind(Promise),reads=0;
    const control=controller(async path=>{if(path==='/timers')return {timers:[timer]};reads++;return response();});
    await control.refresh();await tick();
    assert.equal(control.snapshot().planContext.status,'unavailable');
    response=()=>({...plan,id:'wrong'});await control.refresh();await tick();
    assert.equal(control.snapshot().planContext.status,'unavailable');
    response=()=>plan;await control.refresh();await tick();
    assert.equal(control.snapshot().planContext.status,'ready');assert.equal(reads,3);
});

test('unknown write recovery and plan display do not replay a write or change selected paused timer association',async()=>{
    const calls=[];let fail=false;
    const control=controller(async path=>{
        calls.push(['GET',path]);
        if(path==='/operations/fixed-op')return {status:'finalized',result:{operation_id:'fixed-op',timer}};
        if(path==='/timers'){if(fail)throw Error('read failed');return {timers:[timer]};}
        return plan;
    },async(path,payload)=>{calls.push(['POST',path,payload]);fail=true;throw Error('lost response');});
    await control.refresh();await tick();
    await control.start({task_id:'task',scheduled_session_id:'different-plan'});
    assert.equal(control.snapshot().planContext.status,'stale');
    await control.recover();await tick();await control.retry();await tick();
    assert.equal(calls.filter(c=>c[0]==='POST').length,1);
    assert.equal(control.snapshot().timers[0].state,'paused');
    assert.equal(control.snapshot().timers[0].scheduled_session_id,plan.id);
    fail=false;await control.refresh();await tick();
    assert.equal(control.snapshot().planContext.plan.id,plan.id);
});

class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.listeners={};this.ownerDocument={createElement:tag=>new Element(tag)};}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    setAttribute(key,value){this[key]=value;}
    addEventListener(key,fn){this.listeners[key]=fn;}
    querySelector(selector){return this.children.find(n=>selector==='.'+n.className);}
}
function card(state){const root=new Element('section');renderTimerWorkspaceCard(root,state,{act(){throw Error('Must not mutate');}});return root;}
const state={selectedTimerId:timer.id,fresh:true,timers:[timer],planContext:{status:'ready',timer_id:timer.id,scheduled_session_id:plan.id,plan}};
test('current-card DOM uses literal task title and local schedule, opens existing plan context, and labels task-only recording',()=>{
    const root=card(state),context=root.querySelector('.timer-plan-context');
    assert.ok(context,'current timer must expose explicit plan context');
    assert.ok(context.children.some(n=>n.textContent.includes('Read <notes>')));
    assert.ok(context.children.some(n=>n.textContent.includes(new Date(plan.start_time).toLocaleString())));
    const link=context.children.find(n=>n.tagName==='a');
    const params=new URLSearchParams(link.href.split('?')[1]);
    assert.equal(params.get('entry'),plan.id);
    const local=new Date(plan.start_time),pad=n=>String(n).padStart(2,'0');
    assert.equal(params.get('date'),`${local.getFullYear()}-${pad(local.getMonth()+1)}-${pad(local.getDate())}`);
    assert.equal(link.textContent,'Open linked plan');
    const unlinked=card({...state,timers:[{...timer,scheduled_session_id:null}],planContext:{status:'none'}}).querySelector('.timer-plan-context');
    assert.equal(unlinked.children[0].textContent,'No linked plan');
});

test('stale or foreign DOM context never offers navigation or renders UUIDs as the association label',()=>{
    for(const changed of [{fresh:false}, {planContext:{...state.planContext,timer_id:'other'}}, {planContext:{status:'unavailable'}}]){
        const context=card({...state,...changed}).querySelector('.timer-plan-context');
        assert.ok(context);assert.ok(context.children.every(n=>n.tagName!=='a'));
        assert.match(context.children[0].textContent,/Linked plan.*(unavailable|loading|last known)/i);
        assert.ok(context.children.every(n=>!n.textContent.includes('explicit-plan')));
    }
});

test('compact shared strip names linked versus task-only context without replacing timer navigation',()=>{
    const nodes={'[data-timer-selected]':{},'[data-timer-count]':{},'[data-timer-expander]':{}};
    const root={querySelector:key=>nodes[key]};renderTimerStripStatus(root,state);
    assert.match(nodes['[data-timer-selected]'].textContent,/Linked plan/);
    assert.equal(nodes['[data-timer-selected]'].href,'/agenda-view?timer=timer');
    renderTimerStripStatus(root,{...state,timers:[{...timer,scheduled_session_id:null}]});
    assert.match(nodes['[data-timer-selected]'].textContent,/No linked plan/);
});

test('a newer status read fences earlier plan completion even before that status resolves',async()=>{
    let releasePlan,releaseStatus,reads=0,planReads=0;
    const control=controller(path=>{
        if(path==='/timers')return ++reads===1?Promise.resolve({timers:[timer]}):new Promise(resolve=>{releaseStatus=resolve;});
        planReads++;return new Promise(resolve=>{releasePlan=resolve;});
    });
    await control.refresh();const refreshing=control.refresh();
    releasePlan(plan);await tick();
    assert.notEqual(control.snapshot().planContext.status,'ready');
    assert.equal(planReads,1,'an obsolete plan response must not launch more display reads');
    releaseStatus({timers:[{...timer,scheduled_session_id:null}]});await refreshing;
    assert.equal(control.snapshot().planContext.status,'none');
});

test('Open linked plan cancellation retains the page and editor draft; approval navigates without a timer action',async()=>{
    const previous=global.hasSettingsDrafts,oldWindow=global.window;
    try{
        let approved=false,prevented=0;
        global.hasSettingsDrafts=()=>true;
        global.window={location:{href:'/agenda-view?timer=timer'},appDialogs:{confirm:async options=>{
            assert.equal(options.title,'Open linked plan?');return approved;
        }}};
        const link=card(state).querySelector('.timer-plan-context').children.find(n=>n.tagName==='a');
        const click=()=>link.listeners.click({currentTarget:link,preventDefault(){prevented++;}});
        click();await tick();assert.equal(global.window.location.href,'/agenda-view?timer=timer');
        approved=true;click();await tick();assert.equal(global.window.location.href,link.href);assert.equal(prevented,2);
    }finally{global.hasSettingsDrafts=previous;global.window=oldWindow;}
});

test('plan-detail completion preserves selected-timer Entry note DOM, focus, and other timers retained drafts',async()=>{
    const {createCurrentNoteView}=require('../src/timetrace/interfaces/api/static/js/current_note_editor.js');
    const oldDocument=global.document;
    global.document={createElement:tag=>new Element(tag),activeElement:null};
    try{
        let completePlan,view;
        const other={id:'other',state:'running',revision:2,notes:'Other saved'};
        const control=createTimerController({api:{get:path=>path==='/timers'?Promise.resolve({timers:[{...timer,notes:'Saved'},other]}):new Promise(resolve=>{completePlan=resolve;}),post:async()=>{throw Error('No write expected');}},
            storage:{getItem:()=>null,setItem(){},removeItem(){}},onState:state=>view?.render(state)});
        const root=new Element('section');view=createCurrentNoteView(root,control);
        await control.refresh();
        let input=root.children[0].children[0];input.value='Timer draft';input.listeners.input();
        control.select('other');input=root.children[0].children[0];input.value='Other draft';input.listeners.input();
        control.select(timer.id);input=root.children[0].children[0];global.document.activeElement=input;
        const version=view.draftVersion(timer.id);completePlan(plan);await tick();
        assert.equal(root.children[0].children[0],input);
        assert.equal(input.value,'Timer draft');assert.equal(global.document.activeElement,input);
        assert.equal(view.draftVersion(timer.id),version);assert.ok(view.hasDraft(timer.id));assert.ok(view.hasDraft('other'));
        assert.equal(control.snapshot().selectedTimerId,timer.id);
        assert.equal(control.snapshot().timers.find(t=>t.id===timer.id).state,'paused');
        control.select('other');assert.equal(root.children[0].children[0].value,'Other draft');
    }finally{global.document=oldDocument;}
});

test('plan-detail reads update only their context, not the selected timer action buttons',()=>{
    const root=card({...state,planContext:{status:'loading'}});
    const row=root.children[2],clock=root.children[1];clock.firstChild={textContent:clock.textContent};
    renderTimerWorkspaceCard(root,state,{act(){throw Error('Must not mutate');}});
    assert.equal(root.children[2],row);
    assert.equal(root.children[1],clock);
    assert.ok(root.querySelector('.timer-plan-context').children.some(n=>n.textContent==='Open linked plan'));
});
