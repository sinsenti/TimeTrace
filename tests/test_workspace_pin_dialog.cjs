const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element {
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.listeners=new Map();this.attributes={};this.dataset={};this._text='';this.open=false;}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 set textContent(value){this._text=value;this.children=[];}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this._text='';this.children=[...nodes];}
 setAttribute(name,value){this.attributes[name]=value;}
 addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}
 async fire(name){if(!this.disabled)for(const fn of this.listeners.get(name)||[])await fn({target:this});}
 showModal(){this.open=true;}
 close(){this.open=false;}
 focus(){this.ownerDocument.activeElement=this;}
}
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
function page({ids=[],get=async url=>({id:url.split('/').at(-1),title:'Saved task'})}={}){
 const values=new Map([['timetrace.workspace.pins.v1',JSON.stringify(ids)]]),reads=[],listeners=new Map();
 const document={getElementById:()=>null,createElement:tag=>new Element(tag,document)};document.body=new Element('body',document);
 const window={addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},dispatchEvent:e=>(listeners.get(e.type)||[]).forEach(fn=>fn(e))};
 const api={get:async url=>{reads.push(url);return get(url);}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/timetrace/interfaces/api/static/js/workspace_pins.js'),'utf8'),{window,document,api,URLSearchParams,localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},CustomEvent:class{constructor(type){this.type=type;}}});
 return {window,document,values,reads,dialog:()=>document.body.children[0]};
}
test('pin manager uses the shared named dialog, focused search, honest empty state and footer Close',async()=>{
 const p=page();await p.window.openWorkspacePins();const dialog=p.dialog(),nodes=descendants(dialog);
 assert.ok(dialog.className.split(' ').includes('app-dialog'));
 const title=nodes.find(el=>el.id===dialog.attributes['aria-labelledby']);assert.equal(title.textContent,'Manage pinned activities');
 const search=nodes.find(el=>el.type==='search');assert.equal(p.document.activeElement,search);
 assert.match(dialog.textContent,/Search above/i);assert.doesNotMatch(dialog.textContent,/Open Task details to pin one/);
 const footer=dialog.children.at(-1);assert.equal(footer.tagName,'footer');
 const close=descendants(footer).find(el=>el.textContent==='Close');assert.equal(close.type,'button');await close.fire('click');assert.equal(dialog.open,false);
 assert.deepEqual(p.reads,[]);assert.equal(p.values.get('timetrace.workspace.pins.v1'),'[]');
});
test('pin search renders literal task text and toggles only local identities',async()=>{
 const task={id:'0195e535-0000-7000-8000-00000000000a',title:'Read <literal> Ω'};
 const p=page({get:async url=>url.startsWith('/api/tasks/launcher')?{suggestions:[task]}:task});
 await p.window.openWorkspacePins();let search=descendants(p.dialog()).find(el=>el.type==='search');search.value='read';await search.fire('input');
 let pin=descendants(p.dialog()).find(el=>el.tagName==='button'&&el.textContent==='Pin');assert.ok(pin);
 assert.equal(descendants(p.dialog()).find(el=>el.tagName==='strong').textContent,task.title);
 await pin.fire('click');assert.deepEqual(JSON.parse(p.values.get('timetrace.workspace.pins.v1')),[task.id]);
 await p.window.openWorkspacePins();const remove=descendants(p.dialog()).find(el=>el.tagName==='button'&&el.textContent==='Unpin');await remove.fire('click');
 assert.deepEqual(JSON.parse(p.values.get('timetrace.workspace.pins.v1')),[]);assert.ok(p.reads.every(url=>url.startsWith('/api/tasks/')));
});
test('footer pagination retains all browser-local pins beyond the twenty-row page',async()=>{
 const ids=Array.from({length:21},(_,index)=>`task-${index}`),p=page({ids});await p.window.openWorkspacePins();
 let nodes=descendants(p.dialog());assert.equal(nodes.filter(el=>el.className==='workspace-pin-row').length,20);
 const previous=nodes.find(el=>el.tagName==='button'&&el.textContent==='Previous'),next=nodes.find(el=>el.tagName==='button'&&el.textContent==='Next');
 assert.equal(previous.disabled,true);assert.equal(next.disabled,false);await next.fire('click');await p.window.openWorkspacePins();
 nodes=descendants(p.dialog());assert.equal(nodes.filter(el=>el.className==='workspace-pin-row').length,1);
 assert.match(p.dialog().textContent,/21–21 of 21/);assert.equal(nodes.find(el=>el.tagName==='button'&&el.textContent==='Next').disabled,true);
 assert.deepEqual(JSON.parse(p.values.get('timetrace.workspace.pins.v1')),ids);
});
test('closing and reopening the restyled manager fences an older search response',async()=>{
 let release;const p=page({get:()=>new Promise(resolve=>release=resolve)});
 await p.window.openWorkspacePins();const search=descendants(p.dialog()).find(el=>el.type==='search');search.value='old';const pending=search.fire('input');
 await descendants(p.dialog()).find(el=>el.tagName==='button'&&el.textContent==='Close').fire('click');await p.window.openWorkspacePins();
 release({suggestions:[{id:'old',title:'Late result'}]});await pending;
 assert.doesNotMatch(p.dialog().textContent,/Late result/);assert.equal(p.values.get('timetrace.workspace.pins.v1'),'[]');
});
