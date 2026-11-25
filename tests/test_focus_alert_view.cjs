const test=require('node:test');const assert=require('node:assert/strict');
const {createTimerController}=require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');
const {createFocusController,renderFocusAlerts}=require('../src/timetrace/interfaces/api/static/js/timer_focus.js');
class Element{constructor(tag){this.tagName=tag;this.children=[];this.textContent='';this.listeners={};}append(...n){this.children.push(...n);}replaceChildren(...n){this.children=n;}setAttribute(k,v){this[k]=v;}addEventListener(k,fn){this.listeners[k]=fn;}}
const all=n=>[n,...n.children.flatMap(all)];
test('quiet focus adds no persistent block but another timer due retains its own actions',async()=>{
 let timers=[{id:'a',task_title:'Selected',revision:1,state:'running',focus:{phase:'disabled',generation:1}},{id:'b',task_title:'Parallel',revision:9,state:'running',focus:{phase:'work_due',generation:2}}];const calls=[];
 const control=createTimerController({api:{get:async()=>({timers}),post:async(url,payload)=>{calls.push({url,payload});timers=timers.map(t=>t.id==='b'?{...t,revision:10,focus:{...t.focus,phase:'break'}}:t);return {operation_id:payload.operation_id,timer:timers[1]};}},storage:{getItem:()=>null,setItem(){},removeItem(){}},onState(){},operationId:()=> 'focus-action'});
 await control.refresh();const focus=createFocusController({control,api:{}}),root=new Element('section');root.ownerDocument={createElement:t=>new Element(t)};
 renderFocusAlerts(root,focus,control);assert.equal(root.hidden,false);assert.ok(all(root).some(n=>n.textContent.includes('Parallel')));
 const take=all(root).find(n=>n.tagName==='button'&&n.textContent==='Take break');await take.listeners.click();
 assert.equal(control.snapshot().timers.find(t=>t.id==='a').revision,1);assert.equal(control.snapshot().timers.find(t=>t.id==='a').state,'running');assert.deepEqual(calls,[{url:'/timers/b/focus-action',payload:{operation_id:'focus-action',expected_revision:9,expected_generation:2,action:'take_break'}}]);
 timers=timers.map(t=>({...t,focus:{...t.focus,phase:'disabled'}}));await control.refresh();renderFocusAlerts(root,focus,control);assert.equal(root.hidden,true);
});
