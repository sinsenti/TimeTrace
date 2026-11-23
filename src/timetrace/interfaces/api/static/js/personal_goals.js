/** Explicit settings drafts survive polling, uncertain writes, late ACKs and read failures. */
function createGoalController({api,storage,onState,operationId=()=>crypto.randomUUID()}) {
 const key='timetrace_goal_settings_v1';let goals=[],draft=null,journal=null,pending=false,message='',blocked=false,readGeneration=0,draftGeneration=0;
 try{const value=JSON.parse(storage.getItem(key)||'null');draft=value?.draft||null;journal=value?.journal||null;}catch(_){blocked=true;message='Goal safety storage unavailable.';}
 const snapshot=()=>({goals,draft,journal,pending,message,blocked});const publish=()=>onState(snapshot());
 function persist(){try{storage.setItem(key,JSON.stringify({draft,journal}));return true;}catch(_){blocked=true;message='Goal settings safety storage unavailable; no new write sent.';return false;}}
 async function refresh(){const generation=++readGeneration;try{const result=await api.get('/goals?include_disabled=true');if(generation!==readGeneration)return;goals=result.goals;publish();return result;}catch(_){if(generation===readGeneration){message='Goal read failed. Retained settings drafts and last progress; Retry reads only.';publish();}return null;}}
 function edit(id,settings){const goal=goals.find(g=>g.id===id);if(!draft||draft.id!==id){draft={id,expected_revision:goal?.revision,enabled:goal?.enabled??true,include_descendants:goal?.include_descendants??false,start_date:goal?.start_date??null,...settings};}else draft={...draft,...settings};draftGeneration++;persist();publish();}
 async function send(){const sending=journal,version=draftGeneration;pending=true;++readGeneration;publish();try{
  const result=await api[sending.method](sending.url,sending.payload);
  if(journal!==sending)return false;
  journal={...sending,outcome:'acknowledged',result};
  if(draftGeneration===version)draft=null;
  else if(draft?.id===sending.goal_id)draft={...draft,id:result.id,expected_revision:result.revision};
  pending=false;message='Goal settings saved. Refresh is read-only.';persist();publish();
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('timetrace:goals-mutated',{detail:result}));
  void refresh();return true;
 }catch(error){message=error.message||'Settings outcome uncertain. Retry the retained exact request.';if([400,404,409,422].includes(error.status)){journal=null;message+=' Your draft is retained; refresh and explicitly reload the latest revision before saving again.';}persist();return false;}
 finally{pending=false;publish();}}
 async function save(){if(pending||blocked||!draft)return false;if(journal?.outcome==='uncertain')return send();
  const {id,expected_revision,...settings}=draft;
  const payload=id?{operation_id:operationId(),expected_revision,target_seconds:settings.target_seconds,enabled:settings.enabled??true,include_descendants:settings.include_descendants??false,start_date:settings.start_date??null}:{operation_id:operationId(),...settings};
  journal={method:id?'put':'post',url:id?`/goals/${encodeURIComponent(id)}`:'/goals',goal_id:id,payload:JSON.parse(JSON.stringify(payload)),outcome:'uncertain'};
  if(!persist()){publish();return false;}return send();}
 return {snapshot,refresh,edit,save,
  cancel(){if(pending||journal?.outcome==='uncertain')return false;draft=null;persist();publish();return true;},
  rebase(){if(!draft||pending||journal?.outcome==='uncertain')return false;const goal=goals.find(g=>g.id===draft.id);if(!goal)return false;draft.expected_revision=goal.revision;persist();publish();return true;}
 };
}
if(typeof module!=='undefined')module.exports={createGoalController};
if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',()=>{
 const root=document.querySelector('[data-personal-goals]');if(!root)return;
 let selectedTask=null,formKey=null;
 const summary=document.createElement('div'),status=document.createElement('p');status.setAttribute('role','status');
 const details=document.createElement('details'),label=document.createElement('summary');label.textContent='Goal settings';details.append(label);
 const form=document.createElement('div');details.append(form);root.append(summary,status,details);
 const button=(text,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',fn);return b;};
 const link=document.createElement('a');link.href='/weekly-review-view';link.textContent='Weekly overview / review';root.append(link);
 function render(state){
  status.textContent=state.message;summary.replaceChildren();
  const currentTask=document.getElementById('inspector_task_id')?.value||selectedTask;
  for(const goal of state.goals.filter(g=>g.enabled&&(g.owner_kind==='global'||g.task_id===currentTask))){
   const item=document.createElement('span');item.className='goal-chip';
   item.textContent=`${goal.owner_kind==='global'?'Global':'Selected task'} ${goal.cadence}: ${((goal.summed_recorded_work_seconds||0)/3600).toFixed(2)} / ${(goal.target_seconds/3600).toFixed(2)}h · ${goal.percentage?.toFixed(1)??'unavailable'}% summed recorded work `;
   item.append(button('Edit',()=>{controller.edit(goal.id,{target_seconds:goal.target_seconds,enabled:goal.enabled,include_descendants:goal.include_descendants,start_date:goal.start_date});details.open=true;}));summary.append(item);
  }
  if(!state.goals.some(g=>g.enabled&&g.owner_kind==='global')){const p=document.createElement('span');p.textContent='Global goals not configured. ';summary.append(p);}
  const newKey=state.draft?`${state.draft.id||'new'}`:'none';
  if(formKey!==newKey){formKey=newKey;form.replaceChildren();
   if(!state.draft){form.append(button('Add optional goal',()=>{controller.edit(null,{owner_kind:'global',cadence:'day',target_seconds:null});details.open=true;}));
    for(const g of state.goals.filter(g=>!g.enabled)){form.append(button(`Edit disabled ${g.owner_kind} ${g.cadence} goal`,()=>controller.edit(g.id,{target_seconds:g.target_seconds,enabled:g.enabled,include_descendants:g.include_descendants,start_date:g.start_date})));}
   }else{
    const draft=state.draft;
    const hours=document.createElement('input');hours.type='number';hours.step='any';hours.min='0';hours.value=draft.target_seconds?draft.target_seconds/3600:'';hours.setAttribute('aria-label','Goal target hours');
    hours.addEventListener('input',()=>controller.edit(draft.id,{target_seconds:Number(hours.value)*3600}));
    const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=draft.enabled??true;enabled.setAttribute('aria-label','Goal enabled');enabled.addEventListener('change',()=>controller.edit(draft.id,{enabled:enabled.checked}));
    const descendants=document.createElement('input');descendants.type='checkbox';descendants.checked=draft.include_descendants??false;descendants.setAttribute('aria-label','Include all nested subtasks');descendants.addEventListener('change',()=>controller.edit(draft.id,{include_descendants:descendants.checked}));
    const start=document.createElement('input');start.type='date';start.value=draft.start_date||'';start.setAttribute('aria-label','Optional total goal start date');start.addEventListener('change',()=>controller.edit(draft.id,{start_date:start.value||null}));
    if(!draft.id){
     const owner=document.createElement('select');owner.setAttribute('aria-label','Goal owner');for(const value of ['global','task']){const o=document.createElement('option');o.value=value;o.textContent=value;owner.append(o);}owner.value=draft.owner_kind||'global';owner.addEventListener('change',()=>controller.edit(null,{owner_kind:owner.value,task_id:owner.value==='task'?currentTask:null,include_descendants:false}));
     const task=document.createElement('select');task.setAttribute('aria-label','Goal task');const none=document.createElement('option');none.value='';none.textContent='Choose task';task.append(none);api.get('/api/tasks').then(rows=>{for(const r of rows){const o=document.createElement('option');o.value=r.id;o.textContent=r.title;task.append(o);}task.value=draft.task_id||currentTask||'';}).catch(()=>{});task.addEventListener('change',()=>controller.edit(null,{task_id:task.value||null,owner_kind:'task'}));
     const cadence=document.createElement('select');cadence.setAttribute('aria-label','Goal cadence');for(const value of ['day','week','total']){const o=document.createElement('option');o.value=value;o.textContent=value;cadence.append(o);}cadence.value=draft.cadence||'day';cadence.addEventListener('change',()=>controller.edit(null,{cadence:cadence.value}));
     form.append(owner,task,cadence);
    }
    const explain=document.createElement('p');explain.textContent='Positive target hours; no default. Global: day/week only. Task: day/week/total. Include subtasks and optional start date apply only to their supported scopes. Estimates remain separate.';
    form.append(explain,hours,document.createTextNode(' enabled '),enabled,document.createTextNode(' all nested subtasks '),descendants,start,
     button('Save goal settings',()=>controller.save()),button('Refresh latest settings (read only)',()=>controller.refresh()),button('Use latest revision, keep draft',()=>controller.rebase()),button('Cancel settings draft',()=>controller.cancel()));
   }
  }
  for(const control of form.querySelectorAll('button'))control.disabled=state.pending||state.blocked;
 }
 const controller=createGoalController({api,storage:sessionStorage,onState:render});window.personalGoals=controller;render(controller.snapshot());void controller.refresh();
 window.addEventListener('timetrace:timer-state',event=>{selectedTask=event.detail.timers.find(t=>t.id===event.detail.selectedTimerId)?.task_id||null;render(controller.snapshot());});
 for(const event of ['timetrace:timer-mutated','timetrace:goals-mutated','timetrace:tasks-mutated'])window.addEventListener(event,()=>controller.refresh());
 window.addEventListener('timetrace:task-selected',()=>render(controller.snapshot()));
 window.addEventListener('beforeunload',event=>{if(controller.snapshot().draft){event.preventDefault();event.returnValue='';}});
 setInterval(()=>controller.refresh(),30000);
});
