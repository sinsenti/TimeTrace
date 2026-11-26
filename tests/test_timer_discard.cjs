const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createTimerController, renderTimerWorkspaceCard} = require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');
const {createCurrentNoteView} = require('../src/timetrace/interfaces/api/static/js/current_note_editor.js');

const deferred = () => { let resolve; const promise = new Promise(done=>{resolve=done;}); return {promise,resolve}; };
function controller(options={}) {
    const values=new Map(), posts=[];
    const timers=[{id:'a',revision:1,state:'running',notes:'A note'}, {id:'b',revision:3,state:'paused',notes:'B note'}];
    let data={timers,revision:4};
    const control=createTimerController({api:{get:async()=>data,post:async(url,payload)=>{
        posts.push([url,payload]);
        const result={operation_id:payload.operation_id,timer:{...timers[0],revision:2,state:'stopped',discarded:true}};
        data={timers:[timers[1]],revision:5};return result;
    }},storage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},operationId:()=> 'discard-op',onState(){},...options});
    return {control,posts,timers,values};
}

test('discard captures selected ID/revision/selection and note generations before in-app approval',async()=>{
    let dialog=deferred(), noteVersion=1;
    const prompts=[];
    const {control,posts}=controller({confirmDiscard:options=>{prompts.push(options);return dialog.promise;},noteDraftVersion:()=>noteVersion});
    await control.refresh();
    let action=control.discardSelected();control.select('b');control.select('a');dialog.resolve(true);
    assert.equal(await action,false);assert.deepEqual(posts,[]);
    dialog=deferred();action=control.discardSelected();noteVersion++;dialog.resolve(true);
    assert.equal(await action,false);assert.deepEqual(posts,[]);
    dialog=deferred();action=control.discardSelected();dialog.resolve(false);
    assert.equal(await action,false);assert.deepEqual(posts,[]);
    dialog=deferred();action=control.discardSelected();dialog.resolve(true);
    assert.equal(await action,true);
    assert.deepEqual(posts,[['/timers/a/discard',{expected_revision:1,operation_id:'discard-op'}]]);
    assert.equal(prompts[0].confirmLabel,'Discard timer');assert.equal(prompts[0].danger,true);
    assert.match(prompts[0].message,/saved.*unchanged/i);
});

class Element {
    constructor(tag) { this.tagName=tag;this.children=[];this.dataset={};this.listeners={}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children=children; }
    setAttribute(name,value) { this[name]=value; }
    addEventListener(name,handler) { this.listeners[name]=handler; }
}
const descendants = root => [root,...root.children.flatMap(descendants)];
const field = root => descendants(root).find(n=>n.tagName==='textarea');
function type(root,value) {field(root).value=value;field(root).listeners.input();}
for(const outcome of ['refused','unknown','acknowledged']) test(`discard ${outcome}: only target note freezes until its own ACK`,async()=>{
    global.document={createElement:tag=>new Element(tag)};
    const root=new Element('section'), request=deferred();let view=null, finalized=false, failReads=false;
    const timers=[{id:'a',revision:1,state:'running',notes:'Old A'},{id:'b',revision:2,state:'paused',notes:'Old B'}];
    const result={operation_id:'discard-op',timer:{...timers[0],revision:2,state:'stopped',discarded:true}};
    const posts=[];
    const {control}=controller({api:{get:async path=>{
        if(path.startsWith('/operations/')) {
            if(finalized)return {status:'finalized',result};
            throw Object.assign(Error('not found'),{status:404});
        }
        if(failReads)throw Error('offline');
        return {timers:finalized?[timers[1]]:timers,revision:4};
    },post:(url,payload)=>{posts.push([url,payload]);return request.promise;}},
    onState:state=>view?.render(state),confirmDiscard:async()=>true,noteDraftVersion:id=>view.draftVersion(id)});
    view=createCurrentNoteView(root,control);await control.refresh();
    assert.equal(root.children[0].textContent,'Entry note');
    type(root,'Draft A');control.select('b');type(root,'Draft B');control.select('a');
    const discard=control.discardSelected();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(field(root).readOnly,true);assert.equal(field(root).value,'Draft A');
    control.select('b');assert.equal(field(root).readOnly,false);assert.equal(field(root).value,'Draft B');
    type(root,'Newer B');control.select('a');
    if(outcome==='acknowledged') {
        failReads=true;request.resolve(result);
    } else request.resolve(Promise.reject(outcome==='refused'?Object.assign(Error('Timer changed'),{status:409,code:'revision_stale'}):Error('lost response')));
    assert.equal(await discard,outcome==='acknowledged');
    if(outcome==='refused') {
        assert.equal(field(root).readOnly,false);assert.equal(field(root).value,'Draft A');assert.equal(view.hasDraft('a'),true);
    } else {
        if(outcome==='unknown') {
            assert.equal(field(root).readOnly,true);assert.equal(view.hasDraft('a'),true);
            await control.retry();assert.equal(posts.length,1,'uncertain discard retry must only GET');
            control.select('b');finalized=true;failReads=true;await control.recover();
            assert.equal(control.snapshot().selectedTimerId,'b');
        }
        assert.equal(view.hasDraft('a'),false,'own confirmed removal releases its draft even if refresh fails');
        assert.equal(view.hasDraft('b'),true);control.select('b');assert.equal(field(root).value,'Newer B');
    }
    assert.equal(posts.length,1);
    delete global.document;
});

test('current card offers confirmed discard for frozen timer and compact independently selectable presence',()=>{
    const root=new Element('section');root.ownerDocument={createElement:tag=>new Element(tag)};
    const selected={id:'a',revision:4,task_title:'Writing',state:'frozen',idle_gaps:[{id:'gap'}],elapsed_seconds:600};
    const other={id:'b',revision:2,task_title:'Reading',state:'running',elapsed_seconds:125};
    const paused={id:'c',revision:3,task_title:'Planning',state:'paused',elapsed_seconds:65};
    const state={selectedTimerId:'a',fresh:true,timers:[selected,other,paused]};
    const selections=[],discards=[];
    const control={select:id=>selections.push(id),discardSelected:target=>discards.push(target),act(){throw Error('presence must not mutate');}};
    renderTimerWorkspaceCard(root,state,control);
    const button=descendants(root).find(n=>n.textContent==='Discard timer');
    assert.equal(button.disabled,false);button.listeners.click();assert.deepEqual(discards,[{id:'a',revision:4}]);
    const presence=descendants(root).find(n=>n.className==='workspace-other-timers');
    assert.ok(presence);const choices=descendants(presence).filter(n=>n.tagName==='button');
    assert.equal(choices.length,2);assert.match(choices[0].textContent,/Reading.*2:05.*running/);assert.match(choices[1].textContent,/Planning.*1:05.*paused/);
    choices[0].listeners.click();assert.deepEqual(selections,['b']);
    state.fresh=false;renderTimerWorkspaceCard(root,state,control);
    assert.equal(descendants(root).find(n=>n.textContent==='Discard timer').disabled,true);
});

test('missing in-app provider fails closed, stale revision cannot submit, and an outstanding journal blocks another discard',async()=>{
    const missing=controller();await missing.control.refresh();
    assert.equal(await missing.control.discardSelected(),false);assert.equal(missing.posts.length,0);
    assert.match(missing.control.snapshot().message,/confirmation unavailable/);
    const approval=deferred();let data={timers:[{id:'a',revision:1,state:'paused'}]};
    const {control,posts}=controller({api:{get:async()=>data,post:async()=>{throw Error('not allowed');}},confirmDiscard:()=>approval.promise});
    await control.refresh();const action=control.discardSelected();
    data={timers:[{id:'a',revision:2,state:'paused'}]};await control.refresh();approval.resolve(true);
    assert.equal(await action,false);assert.deepEqual(posts,[]);
    const held=controller({api:{get:async()=>data,post:async()=>{throw Error('unknown');}},confirmDiscard:async()=>true});
    await held.control.refresh();await held.control.discardSelected();
    const journal=held.control.snapshot().receipt;
    assert.equal(await held.control.discardSelected(),false);assert.equal(held.control.snapshot().receipt,journal);
});

test('presence elapsed refresh preserves its selection controls and exposes frozen idle review',()=>{
    const root=new Element('section');root.ownerDocument={createElement:tag=>new Element(tag)};
    root.querySelector=selector=>descendants(root).find(n=>n.className===selector.slice(1));
    const state={fresh:true,selectedTimerId:'a',timers:[{id:'a',state:'running',revision:1,elapsed_seconds:60},{id:'b',task_title:'Review',state:'frozen',revision:1,elapsed_seconds:125}]};
    renderTimerWorkspaceCard(root,state,{act(){},select(){}});
    root.children[1].firstChild={textContent:''};
    const button=descendants(root).find(n=>n.tagName==='button'&&n.textContent.startsWith('Review'));
    assert.match(button.textContent,/frozen.*idle review/);
    state.timers[1].elapsed_seconds=130;
    renderTimerWorkspaceCard(root,state,{act(){},select(){}});
    assert.equal(descendants(root).find(n=>n.tagName==='button'&&n.textContent.startsWith('Review')),button);
    assert.match(button.textContent,/2:10/);
});
