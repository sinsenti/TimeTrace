const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('task-details pin action stays accurate after a browser-storage change without changing the task',()=>{
 const values=new Map(),listeners=new Map(),button={hidden:true,disabled:false,textContent:'',onclick:null},id={value:'task-id'};
 const window={addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},dispatchEvent:e=>(listeners.get(e.type)||[]).forEach(fn=>fn(e))};
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const context=vm.createContext({window,localStorage:storage,document:{getElementById:name=>name==='task_workspace_pin'?button:name==='edit_task_id'?id:null},CustomEvent:class{constructor(type){this.type=type;}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/timetrace/interfaces/api/static/js/workspace_pins.js'),'utf8'),context);
 window.refreshTaskPinDetail('task-id');assert.equal(button.textContent,'Pin activity on this browser');button.onclick();assert.equal(button.textContent,'Unpin activity');
 values.set('timetrace.workspace.pins.v1','[]');window.dispatchEvent({type:'storage',key:'timetrace.workspace.pins.v1'});
 assert.equal(button.textContent,'Pin activity on this browser');assert.equal(id.value,'task-id');
 window.refreshTaskPinDetail(null);assert.equal(button.hidden,true);assert.equal(button.onclick,null);
});
