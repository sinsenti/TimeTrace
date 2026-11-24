/* THROWAWAY synthetic adapter. Never reads or writes the running TimeTrace daemon. */
const sessionStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
window.fetch=()=>Promise.reject(Error('Network APIs are disabled in this visual prototype.'));
Object.defineProperty(window,'Notification',{value:class {static permission='denied';static requestPermission(){return Promise.resolve('denied');}}});
window.demoTasks=['Build a reading habit','Prepare the weekly review','Read distributed systems','Practice a language','Plan the next release','Write project notes'].map((title,i)=>({id:`demo-task-${i}-a3982fc${i}`,title}));
const defaults={enabled:false,work_minutes:25,break_minutes:5,behavior:'notify_only',sound_enabled:false,revision:0};
const initialFocus=location.pathname==='/dashboard'?null:{phase:'disabled',remaining_seconds:null,settings:{...defaults},generation:0};
const demoTimer={id:'demo-timer-1',task_id:demoTasks[0].id,task_title:demoTasks[0].title,state:'running',elapsed_seconds:111,revision:1,running_start:'2026-11-23T09:00:00',segments:[],idle_gaps:[],focus:initialFocus};
const demoState={timers:[demoTimer],selectedTimerId:demoTimer.id,fresh:true,pending:false,receipt:null};
window.demoMessage=text=>{const n=document.getElementById('demo-toast');if(n)n.textContent=text;};
window.api={get:async path=>{
 if(path.startsWith('/goals'))return {goals:[]};
 if(path==='/goal-reporting-context')return {revision:0,timezone:'Europe/Warsaw',daemon_timezone:'Europe/Warsaw',first_day_of_week:1,epochs:[]};
 if(path==='/timer-focus/defaults')return {...defaults};
 if(path==='/timer-notifications')return {notices:[]};
 if(path==='/timer-notifications/capability')return {available:false,sound_supported:false};
 if(path.startsWith('/api/tasks'))return demoTasks;
 return {};
},post:async()=>{throw Error('Preview only; no backend save.');},put:async()=>{throw Error('Preview only; no backend save.');}};
window.multipleTimers={snapshot:()=>demoState,select:id=>{demoState.selectedTimerId=id;return true;},act:async(id,action)=>{
 if(action==='pause')demoTimer.state='paused';else if(action==='resume')demoTimer.state='running';
 else if(action==='stop'){demoMessage('Stop & record is a visual demonstration only; no work was saved.');return false;}
 else {demoMessage('Settings are demonstration-only; nothing was saved.');return false;}
 document.dispatchEvent(new CustomEvent('demo:timer'));return true;
},editTask:()=>demoMessage('Full task editor is unchanged; this prototype compares presentation only.'),correctTime:()=>demoMessage('Existing preview-before-apply correction flow is retained, not implemented in this throwaway.'),initializeFocus:async()=>{demoMessage('No focus initialization or notifications are sent by this preview.');return false;}};
window.getUserSettings=()=>({firstDayOfWeek:1,appearance:'dark'});
