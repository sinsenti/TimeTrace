const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PlanRemovalController} = require('../src/timetrace/interfaces/api/static/js/plan_removal.js');
test('preview is read only, approval exact, lost ACK recovery reads receipt without replay', async () => {
    const calls = [];
    const api = {
        get: async path => { calls.push(['GET', path]); return {consent_token:'scope', manifest:{work:[]}}; },
        post: async (path, payload) => { calls.push(['POST', path, payload]); throw Error('lost ACK'); },
    };
    const c = new PlanRemovalController(api, 'plan');
    await c.load();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'GET');
    await assert.rejects(c.apply('delete_everything'), /lost ACK/);
    assert.equal(calls[1][2].consent_token, 'scope');
    await c.recover();
    assert.equal(calls[2][0], 'GET');
    assert.ok(decodeURIComponent(calls[2][1]).includes('plan-removal:' + c.attempt.operation_id));
    await assert.rejects(c.apply('squeeze'), /fresh manifest/);
    assert.equal(calls.filter(c => c[0] === 'POST').length, 1);
});

test('plan action DOM calls it Fit schedule to recorded work but keeps squeeze wire action and read-only recovery',async()=>{
    class Element {
        constructor(tag,text=''){this.tag=tag;this.textContent=text;this.children=[];this.listeners={};}
        appendChild(node){this.children.push(node);}
        setAttribute(key,value){this[key]=value;}
        addEventListener(key,fn){this.listeners[key]=fn;}
    }
    const old=global.document;global.document={createElement:tag=>new Element(tag)};
    const calls=[];const container=new Element('div');
    try{
        global.planRemoval.mount(container,{id:'plan'}, {available:async()=>true,lock(){},ack(){},api:{
            get:async path=>{calls.push(['GET',path]);return {manifest:{},consent_token:'exact',blocked:{delete_everything:[],squeeze:[]}};},
            post:async(path,payload)=>{calls.push(['POST',path,payload]);throw Error('lost response');}
        }});
        assert.equal(container.children[0].textContent,'Remove schedule / Delete / Fit schedule to recorded work');
        await container.children[0].listeners.click();
        const panel=container.children[1];
        assert.equal(panel['aria-label'],'Remove, delete or fit schedule confirmation');
        assert.match(panel.children[0].textContent,/earliest start.*latest end.*gaps/i);
        const fit=panel.children.find(n=>n.textContent==='Fit schedule to recorded work');
        await fit.listeners.click();
        assert.equal(calls[1][2].action,'squeeze');
        await panel.children.find(n=>n.textContent==='Check operation (read only)').listeners.click();
        assert.equal(calls.filter(c=>c[0]==='POST').length,1);
        assert.equal(calls[2][0],'GET');
    }finally{global.document=old;}
});

test('#67 a projected occurrence offers exact schedule-only removal, never legacy series deletion',async()=>{
    class Element {constructor(tag){this.tag=tag;this.children=[];this.listeners={};}appendChild(n){this.children.push(n);}setAttribute(k,v){this[k]=v;}addEventListener(k,v){this.listeners[k]=v;}}
    const old=global.document;global.document={createElement:t=>new Element(t)};
    try {
        const container=new Element('div'),calls=[];
        global.planRemoval.mount(container,{id:'virt:task:20990101T090000Z',is_virtual:true},{available:async()=>true,lock(){},ack(){},api:{get:async()=>({manifest:{plan:{is_virtual:true}},consent_token:'exact',blocked:{remove_schedule:[],delete_everything:['virtual'],squeeze:['virtual']}}),post:async(url,payload)=>{calls.push([url,payload]);return {action:'remove_schedule',plan_id:'virt:task:20990101T090000Z',operation_id:`plan-removal:${payload.operation_id}`};}}});
        assert.equal(container.children.length,1);
        await container.children[0].listeners.click();
        const panel=container.children[1],remove=panel.children.find(n=>n.textContent==='Remove schedule only — keep recorded work');
        assert.equal(remove.disabled,false);
        await remove.listeners.click();
        assert.equal(calls[0][1].action,'remove_schedule');
        assert.match(calls[0][0],/^\/scheduled-sessions\/virt%3A/);
    }finally{global.document=old;}
});

test('#67 lost removal ACK remains recoverable after reload even when its source plan no longer exists',async()=>{
    const store=new Map(),storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
    const calls=[];let op;const api={get:async path=>{calls.push(['GET',path]);return path.startsWith('/operations/')?{status:'finalized',result:{action:'remove_schedule',plan_id:'gone-plan',operation_id:`plan-removal:${op}`,removed_plan:{id:'gone-plan'}}}:{consent_token:'exact'};},post:async (path,payload)=>{op=payload.operation_id;calls.push(['POST',path]);throw Error('lost ACK');}};
    const first=new PlanRemovalController(api,'gone-plan',storage);await first.load();await assert.rejects(first.apply('remove_schedule'),/lost ACK/);
    class Element {constructor(){this.children=[];this.listeners={};}appendChild(n){this.children.push(n);}setAttribute(){}addEventListener(k,v){this.listeners[k]=v;}}
    const old=global.document;global.document={createElement:()=>new Element()};
    try {
        const panel=new Element();let acknowledged;
        global.planRemoval.mountRecovery(panel,{api,storage,ack:result=>{acknowledged=result;}});
        assert.equal(panel.hidden,false);
        await panel.children.find(n=>n.textContent==='Check plan action (read only)').listeners.click();
        assert.equal(acknowledged.removed_plan.id,'gone-plan');
        assert.equal(store.size,0);
        assert.equal(calls.filter(c=>c[0]==='POST').length,1);
    }finally{global.document=old;}
});

test('#67 malformed success acknowledgement retains the fixed removal journal for GET-only recovery',async()=>{
    const store=new Map(),storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
    const calls=[];const controller=new PlanRemovalController({get:async path=>{calls.push(['GET',path]);return {consent_token:'exact'};},post:async path=>{calls.push(['POST',path]);return {}; }},'plan',storage);
    await controller.load();await assert.rejects(controller.apply('remove_schedule'),/acknowledgement/);
    assert.equal(store.size,1);await controller.recover();assert.equal(calls.filter(c=>c[0]==='POST').length,1);
});
