const test=require('node:test');const assert=require('node:assert/strict');
const vm=require('node:vm');const fs=require('node:fs');
const {createTimerController}=require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.textContent='';this.value='';}
 append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}
 setAttribute(name,value){this[name]=value;}addEventListener(name,fn){this.listeners[name]=fn;}
 querySelectorAll(tag){return this.children.flatMap(n=>[...(n.tagName===tag?[n]:[]),...n.querySelectorAll(tag)]);}
 querySelector(tag){return this.querySelectorAll(tag)[0]||null;}
}
function page(){const document={createElement:tag=>new Element(tag),activeElement:null};const scope=vm.createContext({document});vm.runInContext(fs.readFileSync(require.resolve('../src/timetrace/interfaces/api/static/js/current_note_editor.js'),'utf8'),scope);return {document,root:new Element('section'),create:scope.createCurrentNoteView};}
test('current note offers one Save and a secondary explicit discard, with dirty state',async()=>{
 const {root,create}=page();let timer={id:'a',revision:1,state:'running',notes:'Saved note'};let view;
 const control=createTimerController({api:{get:async()=>({timers:[timer]})},storage:{getItem:()=>null,setItem(){},removeItem(){}},onState:s=>view?.render(s)});
 view=create(root,control);await control.refresh();
 const save=root.querySelectorAll('button')[0];assert.equal(save.textContent,'Save');assert.equal(save.disabled,true);
 const input=root.querySelector('textarea');input.value='Edited';input.listeners.input();assert.equal(save.disabled,false);assert.match(save.className,/is-dirty/);
 const secondary=root.querySelector('details');assert.equal(secondary.hidden,false);const discard=secondary.querySelector('button');assert.equal(discard.textContent,'Discard my changes');discard.listeners.click();
 assert.equal(input.value,'Saved note');assert.equal(save.disabled,true);assert.equal(secondary.hidden,true);assert.equal(view.hasDraft(),false);
});
