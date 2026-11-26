const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {createTimerController}=require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');

// Minimal DOM boundary; no controller/presenter replacement. Native layout is a separate gate.
class Element{
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.attributes={};this.listeners={};this.dataset={};this.value='';this.textContent='';}
 append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
 replaceChildren(...children){this.children=[];this.append(...children);}
 setAttribute(k,v){this.attributes[k]=v;}
 removeAttribute(k){delete this.attributes[k];}
 addEventListener(k,fn){this.listeners[k]=fn;}
 querySelector(){return null;}
 contains(el){return this===el||this.children.some(child=>child.contains?.(el));}
 focus(){this.ownerDocument.activeElement=this;}
 async fire(type){if(!this.disabled)return this.listeners[type]?.({preventDefault(){},target:this});}
}
function descendants(el){return el.children.flatMap(child=>[child,...descendants(child)]);}
async function mount(rows){
 const urls=[],writes=[],values=new Map();
 const api={get:async url=>{urls.push(url);if(url==='/timers')return {timers:[],revision:1};if(url.startsWith('/api/tasks/launcher'))return {suggestions:rows};if(url==='/api/tasks/statuses')return [];return rows.find(row=>url.endsWith(row.id));},post:async(url,p)=>{writes.push({url,p});return {operation_id:p.operation_id,timer:{id:'timer',task_id:p.task_id,state:'running'}};}};
 const doc={createElement:tag=>new Element(tag,doc),createTextNode:text=>Object.assign(new Element('#text',doc),{textContent:text}),addEventListener(){},querySelector(){return {checked:true};}};
 const root=new Element('div',doc),input=new Element('input',doc),results=new Element('div',doc),priority=new Element('select',doc);priority.value='all';
 const context=vm.createContext({api,document:doc,window:{addEventListener(){}},Intl,URLSearchParams,console});
 vm.runInContext(fs.readFileSync(require.resolve('../src/timetrace/interfaces/api/static/js/task_launcher.js'),'utf8'),context);
 const control=createTimerController({api,storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},operationId:()=> 'group-start',onState(){}});
 await control.refresh();
 const launcher=context.mountTaskLauncher(root,control,{input,view:'priority',prioritySelect:priority,resultsRoot:results,onDetails:id=>urls.push(`details:${id}`)});
 await launcher.model.refresh();return {launcher,root,input,results,priority,urls,writes};
}
test('shared mounted priority discovery renders headed compact groups and uses the sole task-only timer writer',async()=>{
 const low={id:'low-id',title:'Low <literal>',priority:'low',match_kind:'default',scheduled_state:'now',parent_title:'Parent'};
 const h=await mount([low,{id:'unset-id',title:'Unset',priority:'-',match_kind:'default'},{id:'high-id',title:'High',priority:'high',match_kind:'default'},{id:'medium-id',title:'Medium',priority:'medium',match_kind:'default'}]);
 const nodes=descendants(h.results);
 assert.equal(h.input.attributes.role,'searchbox');
 assert.equal(descendants(h.root).some(el=>el.className==='task-launcher-popup'),false,'persistent results do not duplicate an overlaid popup');
 assert.deepEqual(nodes.filter(el=>el.tagName==='h4').map(el=>el.textContent),['High priority','Medium priority','Low priority','No priority']);
 assert.deepEqual(nodes.filter(el=>el.tagName==='strong').map(el=>el.textContent),['High','Medium','Low <literal>','Unset']);
 assert.match(nodes.find(el=>el.tagName==='small'&&el.textContent.includes('Parent')).textContent,/Scheduled now/);
 assert.match(nodes.find(el=>el.className==='launcher-result-bound').textContent,/20.*search.*more/i);
 const lowSection=h.results.children.find(el=>el.dataset.priority==='low');
 await descendants(lowSection).find(el=>el.tagName==='button'&&el.textContent==='Task details').fire('click');assert.ok(h.urls.includes('details:low-id'));
 await descendants(lowSection).find(el=>el.tagName==='button'&&el.textContent==='Start').fire('click');
 assert.equal(h.writes.length,1);assert.equal(h.writes[0].url,'/timers');assert.equal(h.writes[0].p.task_id,'low-id');assert.equal(h.writes[0].p.pause_when_idle,true);assert.equal(h.writes[0].p.scheduled_session_id,undefined);
 h.priority.value='none';await h.priority.fire('change');assert.equal(new URL(h.urls.findLast(url=>url.startsWith('/api/tasks/launcher')),'http://test').searchParams.get('priority'),'none');
});
test('mounted typed discovery preserves title-rank sections and explicit close-match start behavior',async()=>{
 const h=await mount([{id:'exact',title:'Read',priority:'-',match_kind:'exact'},{id:'prefix',title:'Reading',priority:'high',match_kind:'prefix'},{id:'contains',title:'About read',priority:'medium',match_kind:'contains'},{id:'fuzzy',title:'Raed',priority:'low',match_kind:'fuzzy'}]);
 await h.launcher.model.input('read');
 assert.deepEqual(descendants(h.results).filter(el=>el.tagName==='strong').map(el=>el.textContent),['Read','Reading','About read','Raed']);
 assert.match(descendants(h.results).find(el=>el.tagName==='h4'&&el.textContent.includes('Close matches')).textContent,/select before starting/);
 assert.equal(h.launcher.model.snapshot().activeIndex,0);
 const close=h.results.children.find(el=>el.dataset.priority==='low');
 await descendants(close).find(el=>el.textContent==='Start').fire('click');
 assert.equal(h.writes[0].p.task_id,'fuzzy','click on an explicit row is a deliberate fuzzy choice');
});
test('mounted completed-task opt-in and no-priority filter go to the server with the current title and tag query',async()=>{
 const h=await mount([]);await h.launcher.model.input('Read%_');await h.launcher.model.tag('Study%_');
 const completed=descendants(h.root).find(el=>el.type==='checkbox');completed.checked=true;await completed.fire('change');
 // The checkbox handler is event-driven; the model request begins synchronously.
 h.priority.value='none';await h.priority.fire('change');
 const p=new URL(h.urls.findLast(url=>url.startsWith('/api/tasks/launcher')),'http://test').searchParams;
 assert.equal(p.get('include_completed'),'true');assert.equal(p.get('priority'),'none');assert.equal(p.get('q'),'Read%_');assert.equal(p.get('tag_contains'),'Study%_');
 assert.deepEqual(h.results.children.filter(el=>el.tagName==='section').map(el=>el.dataset.priority),[],'an empty typed search does not invent matching groups');
});
