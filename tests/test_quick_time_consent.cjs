const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createTimerController}=require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');
class Element {
 constructor(tag,document){this.tagName=tag;this.document=document;this.children=[];this.listeners={};this.open=false;}
 append(...children){this.children.push(...children);}
 setAttribute(name,value){this[name]=value;}
 addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);}
 fire(name,event={preventDefault(){}}){for(const fn of this.listeners[name]||[])fn(event);}
 showModal(){this.open=true;}
 close(){this.open=false;if(!this.document.deferClose)this.fire('close');}
 remove(){this.document.body.children=this.document.body.children.filter(node=>node!==this);}
}
async function setup(){
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 let timer={id:'a',revision:1,state:'running',running_start:'2026-01-01T10:00:00Z',running_segment_id:'segment-a',segments:[]},native=0,operations=0;
 const control=createTimerController({storage,onState(){},operationId:()=> 'consent-op',api:{get:async()=>({timers:[timer],revision:timer.revision}),post:async(url,body)=>{
  if(url.endsWith('/correction-preview'))return {schema_version:1,action:'step_start',timer_revision:timer.revision,resource:'/timers/a',request:body,signature:'signed'};
  operations++;timer={...timer,revision:timer.revision+1};return {operation_id:body.operation_id,timer};
 }}});await control.refresh();
 const document={deferClose:true,createElement:tag=>new Element(tag,document),querySelector:()=>null};document.body=new Element('body',document);
 const window={multipleTimers:control,localStorage:storage,addEventListener(){},confirm(){native++;return false;}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/timetrace/interfaces/api/static/js/timer_corrections.js'),'utf8'),{window,document,URL,Date,console});
 return {window,document,control,storage,native:()=>native,operations:()=>operations,click:()=>window.openTimeCorrection({timer:control.snapshot().timers[0],change:{kind:'step_start',credited_delta_seconds:300}})};
}
test('quick-step explanation is an app modal; Cancel and Escape never consent or mutate',async()=>{
 const s=await setup();
 for(const dismiss of ['cancel','escape']){
  const pending=s.click();assert.equal(s.native(),0,'must not use browser confirm');
  const dialog=s.document.body.children.find(node=>node.tagName==='dialog');assert.ok(dialog?.open);
  assert.ok(dialog['aria-labelledby']);assert.ok(dialog['aria-describedby']);assert.equal(s.operations(),0);
  if(dismiss==='cancel')dialog.children.find(node=>node.tagName==='div').children.find(node=>node.textContent==='Cancel').fire('click');
  else dialog.fire('cancel');
  assert.equal(s.document.body.children.length,0,'settles without waiting for a rendered-frame close event');
  assert.equal(await pending,false);assert.equal(s.storage.getItem('timetrace_quick_time_adjustments_v1'),null);assert.equal(s.operations(),0);assert.equal(s.document.body.children.length,0);
 }
});
test('app-modal approval permits validation/application once and remembers consent',async()=>{
 const s=await setup(),pending=s.click();assert.equal(s.native(),0,'must not use browser confirm');
 const dialog=s.document.body.children.find(node=>node.tagName==='dialog');assert.ok(dialog?.open);
 dialog.children.find(node=>node.tagName==='div').children.find(node=>node.textContent==='Enable and apply').fire('click');
 assert.equal(s.document.body.children.length,0,'approval settles without waiting for a rendered-frame close event');
 assert.equal(await pending,true);assert.equal(s.operations(),1);assert.equal(s.storage.getItem('timetrace_quick_time_adjustments_v1'),'accepted');
 assert.equal(await s.click(),true);assert.equal(s.operations(),2);assert.equal(s.document.body.children.length,0);assert.equal(s.native(),0);
});
