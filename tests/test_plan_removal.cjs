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
        assert.equal(container.children[0].textContent,'Delete / Fit schedule to recorded work');
        await container.children[0].listeners.click();
        const panel=container.children[1];
        assert.equal(panel['aria-label'],'Delete or fit schedule confirmation');
        assert.match(panel.children[0].textContent,/earliest start.*latest end.*gaps/i);
        const fit=panel.children.find(n=>n.textContent==='Fit schedule to recorded work');
        await fit.listeners.click();
        assert.equal(calls[1][2].action,'squeeze');
        await panel.children.find(n=>n.textContent==='Check operation (read only)').listeners.click();
        assert.equal(calls.filter(c=>c[0]==='POST').length,1);
        assert.equal(calls[2][0],'GET');
    }finally{global.document=old;}
});
