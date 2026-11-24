/** Explicit settings drafts survive polling, uncertain writes, late ACKs and read failures. */
function createGoalController({api,storage,onState,operationId=()=>crypto.randomUUID()}) {
 const key='timetrace_goal_settings_v1';let goals=[],draft=null,journal=null,checkpoints={},pending=false,fresh=false,message='',blocked=false,readGeneration=0;
 try{const value=JSON.parse(storage.getItem(key)||'null');draft=value?.draft||null;journal=value?.journal||null;checkpoints=value?.checkpoints||{};}catch(_){blocked=true;message='Goal safety storage unavailable.';}
 const snapshot=()=>({goals,draft,journal,pending,fresh,message,blocked});const publish=()=>onState(snapshot());
 function persist(){try{storage.setItem(key,JSON.stringify({draft,journal,checkpoints}));return true;}catch(_){blocked=true;message='Goal settings safety storage unavailable; no new write sent.';return false;}}
 async function refresh(invalidate=false){if(invalidate){fresh=false;publish();}const generation=++readGeneration;
  try{const result=await api.get('/goals?include_disabled=true');if(generation!==readGeneration)return null;
   if(!Array.isArray(result.goals))throw Error('Unknown goal response');
   if(result.goals.some(g=>g.revision<(checkpoints[g.id]?.revision||0))){fresh=false;message='Read predates acknowledged settings; retained checkpoint and drafts. Refresh reads only.';publish();return null;}
   goals=result.goals;fresh=true;publish();return result;
  }catch(_){if(generation===readGeneration){fresh=false;message='Goal read failed. Retained settings drafts and last progress; Retry reads only.';publish();}return null;}
 }
 function edit(id,settings={}){
  if(draft&&draft.id!==id){message='Save or explicitly cancel the current goal draft before editing another goal.';publish();return false;}
  const goal=goals.find(g=>g.id===id),checkpoint=checkpoints[id];
  const known=checkpoint&&checkpoint.revision>=(goal?.revision||0)?checkpoint.settings:goal;
  if(!draft){draft={id,expected_revision:checkpoint&&checkpoint.revision>=(goal?.revision||0)?checkpoint.revision:goal?.revision,
   target_seconds:known?.target_seconds,enabled:known?.enabled??true,include_descendants:known?.include_descendants??false,start_date:known?.start_date??null,...settings};}
  else draft={...draft,...settings};persist();publish();return true;
 }
 async function send(){const sending=journal;pending=true;fresh=false;++readGeneration;publish();try{
  const method=sending.goal_id?'put':'post',url=sending.goal_id?`/goals/${encodeURIComponent(sending.goal_id)}`:'/goals';
  if(sending.method!==method||sending.url!==url)throw Error('Unrecognized settings request family; no write sent');
  const result=await api[method](url,sending.payload);
  if(journal!==sending)return false;
  if(typeof result?.id!=='string'||!Number.isInteger(result.revision)||result.revision<1||(sending.goal_id&&result.id!==sending.goal_id))throw Error('Unrecognized goal acknowledgement');
  ++readGeneration;checkpoints[result.id]={revision:result.revision,settings:{...(sending.submitted_draft||{}),...sending.payload}};
  journal={...sending,outcome:'acknowledged',result};
  const submitted=sending.submitted_draft;
  if(submitted&&JSON.stringify(draft)===JSON.stringify(submitted))draft=null;
  else if(draft?.id===sending.goal_id&&(draft.id||(submitted&&draft.owner_kind===submitted.owner_kind&&draft.cadence===submitted.cadence&&draft.task_id===submitted.task_id)))draft={...draft,id:result.id,expected_revision:result.revision};
  pending=false;message=`Goal settings revision ${result.revision} saved. Displayed progress is last-read until authoritative refresh completes.`;persist();publish();
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('timetrace:goals-mutated',{detail:result}));
  void refresh();return true;
 }catch(error){message=error.message||'Settings outcome uncertain. Retry the retained exact request.';if([400,404,409,422].includes(error.status)){journal=null;message+=' Your draft is retained; refresh and explicitly reload the latest revision before saving again.';}else message+=' Original request retained; retry confirms only that request, while newer typing remains a separate draft.';persist();return false;}
 finally{pending=false;publish();}}
 async function save(){if(pending||blocked||!draft)return false;if(journal?.outcome==='uncertain')return send();
  const {id,expected_revision,...settings}=draft;
  const payload=id?{operation_id:operationId(),expected_revision,target_seconds:settings.target_seconds,enabled:settings.enabled??true,include_descendants:settings.include_descendants??false,start_date:settings.start_date??null}:{operation_id:operationId(),...settings};
  journal={method:id?'put':'post',url:id?`/goals/${encodeURIComponent(id)}`:'/goals',goal_id:id,payload:JSON.parse(JSON.stringify(payload)),submitted_draft:JSON.parse(JSON.stringify(draft)),outcome:'uncertain'};
  if(!persist()){publish();return false;}return send();}
 return {snapshot,refresh,edit,save,
  cancel(){if(pending||journal?.outcome==='uncertain')return false;draft=null;persist();publish();return true;},
  async rebase(){if(!draft||pending||journal?.outcome==='uncertain')return false;
   if(!draft.id){const owner=JSON.stringify([draft.owner_kind,draft.task_id,draft.cadence]);try{const context=await api.get('/goal-reporting-context');
    if(!draft||draft.id||pending||journal?.outcome==='uncertain'||JSON.stringify([draft.owner_kind,draft.task_id,draft.cadence])!==owner)return false;
    if(!Number.isInteger(context.first_day_of_week))throw Error('Unknown reporting context');
    draft={...draft,first_day_of_week:context.first_day_of_week,timezone:context.timezone};persist();publish();return true;
   }catch(_){message='Latest reporting context unavailable; retained the new-goal target and draft.';publish();return false;}}
   const goal=goals.find(g=>g.id===draft.id);const revision=Math.max(goal?.revision||0,checkpoints[draft.id]?.revision||0);if(!revision)return false;draft.expected_revision=revision;persist();publish();return true;
  }
 };
}
function createGoalContextController({api,storage,onState,operationId=()=>crypto.randomUUID()}) {
 const key='timetrace_goal_reporting_context_v1';let context=null,draft=null,journal=null,pending=false,message='',blocked=false,generation=0,draftGeneration=0;
 try{const saved=JSON.parse(storage.getItem(key)||'null');draft=saved?.draft||null;journal=saved?.journal||null;}catch(_){blocked=true;message='Reporting-context safety storage unavailable.';}
 const snapshot=()=>({context,draft,journal,pending,message,blocked});const publish=()=>onState(snapshot());
 function persist(){try{storage.setItem(key,JSON.stringify({draft,journal}));return true;}catch(_){blocked=true;message='Reporting-context safety storage unavailable; no request sent.';return false;}}
 async function refresh(){const own=++generation;try{const value=await api.get('/goal-reporting-context');if(own!==generation)return null;context=value;publish();return value;}catch(_){if(own===generation){message='Reporting-context read failed; retained drafts and exact request. Retry reads only.';publish();}return null;}}
 function edit(first){if((!context&&!draft)||blocked)return false;draft={expected_revision:draft?.expected_revision??context.revision,first_day_of_week:first};draftGeneration++;persist();publish();return true;}
 async function save(){if(pending||blocked||(!context&&journal?.outcome!=='uncertain'))return false;if(!draft&&context)edit(context.first_day_of_week);
  if(journal?.outcome!=='uncertain')journal={outcome:'uncertain',payload:{operation_id:operationId(),...draft},submitted_draft:JSON.parse(JSON.stringify(draft))};
  if(!persist()){publish();return false;}pending=true;++generation;publish();
  try{const result=await api.put('/goal-reporting-context',journal.payload);context=result;journal={...journal,outcome:'acknowledged',result};
   if(journal.submitted_draft&&JSON.stringify(draft)===JSON.stringify(journal.submitted_draft))draft=null;else if(draft)draft.expected_revision=result.revision;
   pending=false;message='Reporting epoch saved. Prior periods keep their own context; do not merge epochs.';persist();publish();
   if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('timetrace:goals-mutated',{detail:result}));
   void refresh();return true;
  }catch(error){message=error.message||'Reporting-context outcome uncertain; retry only the saved exact request.';if([400,404,409,422].includes(error.status))journal=null;persist();return false;}
  finally{pending=false;publish();}
 }
 return {snapshot,refresh,edit,save,rebase(){if(!draft||pending||journal?.outcome==='uncertain'||!context)return false;draft.expected_revision=context.revision;persist();publish();return true;},cancel(){if(pending||journal?.outcome==='uncertain')return false;draft=null;persist();publish();return true;}};
}
if(typeof module!=='undefined')module.exports={createGoalController,createGoalContextController};
if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',()=>{
 const root=document.querySelector('[data-personal-goals]');if(!root)return;
 document.querySelector('main')?.before(root);
 let selectedTask=null,formKey=null,summaryKey=null;
 const summary=document.createElement('div'),status=document.createElement('p');status.setAttribute('role','status');
 const details=document.createElement('details'),label=document.createElement('summary');label.textContent='Goal settings';details.append(label);
 const form=document.createElement('div');details.append(form);root.append(summary,status,details);
 const button=(text,fn,action='')=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.dataset.goalAction=action;b.addEventListener('click',fn);return b;};
 const link=document.createElement('a');link.href='/weekly-review-view';link.textContent='Weekly overview / review';root.append(link);
 function render(state){
  status.textContent=state.message+(state.journal?.outcome==='uncertain'?` Retained request target: ${state.journal.payload.target_seconds} seconds; enabled ${state.journal.payload.enabled}; descendants ${state.journal.payload.include_descendants}; start ${state.journal.payload.start_date||'all time / not applicable'}. Newer typing is not included in exact retry.`:'');
  const currentTask=document.getElementById('inspector_task_id')?.value||selectedTask;
  const visible=state.goals.filter(g=>g.enabled&&(g.owner_kind==='global'||g.task_id===currentTask));
  const nextSummary=JSON.stringify([state.fresh,visible.map(g=>[g.id,g.target_seconds,g.summed_recorded_work_seconds,g.percentage_display,g.context?.warnings])]);
  if(summaryKey!==nextSummary){summaryKey=nextSummary;summary.replaceChildren();
  if(!state.fresh){const p=document.createElement('small');p.textContent='Last-read progress; authoritative refresh pending. ';summary.append(p);}
  for(const goal of visible){
   const item=document.createElement('span');item.className='goal-chip';
   const actual=goal.summed_recorded_work_seconds==null?'unavailable':`${(goal.summed_recorded_work_seconds/3600).toFixed(2)}h`;
   const target=goal.target_seconds/3600;const targetLabel=target===0&&goal.target_seconds>0?`${goal.target_seconds.toExponential(3)}s`:target>0&&target<0.005?`${target.toExponential(3)}h`:`${target.toFixed(2)}h`;
   item.textContent=`${goal.owner_kind==='global'?'Global':'Selected task'} ${goal.cadence}: ${actual} / ${targetLabel} · ${goal.percentage_display||'unavailable'} summed recorded work `;
   if(goal.context?.warnings?.length){const warning=document.createElement('small');warning.textContent=goal.context.warnings.join(' ');item.append(warning);}
   item.append(button('Edit',()=>{controller.edit(goal.id);details.open=true;}));summary.append(item);
  }
  if(!state.goals.some(g=>g.enabled&&g.owner_kind==='global')){const p=document.createElement('span');p.textContent=state.fresh?'Global goals not configured. ':'Global goal configuration not yet verified. ';summary.append(p);}
  }
  const newKey=state.draft?`${state.draft.id||'new'}`:`none:${state.goals.filter(g=>!g.enabled).map(g=>g.id+':'+g.revision).join(',')}`;
  if(formKey!==newKey){formKey=newKey;form.replaceChildren();
   if(!state.draft){form.append(button('Add optional goal',()=>{controller.edit(null,{owner_kind:'global',cadence:'day',target_seconds:null,first_day_of_week:contextController.snapshot().context?.revision?contextController.snapshot().context.first_day_of_week:(typeof getUserSettings==='function'?getUserSettings().firstDayOfWeek:1)});details.open=true;}));
    for(const g of state.goals.filter(g=>!g.enabled)){form.append(button(`Edit disabled ${g.owner_kind} ${g.cadence} goal`,()=>controller.edit(g.id)));}
   }else{
    const draft=state.draft;
    const scale=draft.target_seconds>0&&draft.target_seconds/3600===0?1:3600;
    const hours=document.createElement('input');hours.type='number';hours.step='any';hours.min='0';hours.value=draft.target_seconds?draft.target_seconds/scale:'';hours.setAttribute('aria-label',scale===1?'Goal target seconds':'Goal target hours');
    hours.addEventListener('input',()=>controller.edit(draft.id,{target_seconds:Number(hours.value)*scale}));
    const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=draft.enabled??true;enabled.setAttribute('aria-label','Goal enabled');enabled.addEventListener('change',()=>controller.edit(draft.id,{enabled:enabled.checked}));
    const descendants=document.createElement('input');descendants.type='checkbox';descendants.checked=draft.include_descendants??false;descendants.setAttribute('aria-label','Include all nested subtasks');descendants.addEventListener('change',()=>controller.edit(draft.id,{include_descendants:descendants.checked}));
    const start=document.createElement('input');start.type='date';start.value=draft.start_date||'';start.setAttribute('aria-label','Optional total goal start date');start.addEventListener('change',()=>controller.edit(draft.id,{start_date:start.value||null}));
    if(!draft.id){
     const owner=document.createElement('select');owner.setAttribute('aria-label','Goal owner');for(const value of ['global','task']){const o=document.createElement('option');o.value=value;o.textContent=value;owner.append(o);}owner.value=draft.owner_kind||'global';owner.addEventListener('change',()=>controller.edit(null,{owner_kind:owner.value,task_id:owner.value==='task'?currentTask:null,include_descendants:false}));
     const task=document.createElement('select');task.setAttribute('aria-label','Goal task');const none=document.createElement('option');none.value='';none.textContent='Choose task';task.append(none);api.get('/api/tasks').then(rows=>{for(const r of rows){const o=document.createElement('option');o.value=r.id;o.textContent=r.title;task.append(o);}task.value=draft.task_id||currentTask||'';}).catch(()=>{});task.addEventListener('change',()=>controller.edit(null,{task_id:task.value||null,owner_kind:'task'}));
     const cadence=document.createElement('select');cadence.setAttribute('aria-label','Goal cadence');for(const value of ['day','week','total']){const o=document.createElement('option');o.value=value;o.textContent=value;cadence.append(o);}cadence.value=draft.cadence||'day';cadence.addEventListener('change',()=>controller.edit(null,{cadence:cadence.value}));
     form.append(owner,task,cadence);
    }
    const explain=document.createElement('p');explain.textContent='Positive target hours; no default. Global: day/week only. Task: day/week/total. Day/week edits affect current/future periods; total edits are immediate. Include subtasks and optional start date apply only to their supported scopes. Estimates remain separate.';
    form.append(explain,hours,document.createTextNode(' enabled '),enabled,document.createTextNode(' all nested subtasks '),descendants,start,
     button('Save goal settings',()=>controller.save(),'save'),button('Refresh latest settings (read only)',()=>controller.refresh(),'read'),button('Use latest known revision, keep draft',()=>controller.rebase(),'rebase'),button('Cancel settings draft',()=>controller.cancel(),'cancel'));
   }
  }
  for(const control of form.querySelectorAll('button')){
   const action=control.dataset.goalAction,uncertain=state.journal?.outcome==='uncertain';
   control.disabled=action==='read'?false:state.pending||state.blocked||(uncertain&&['cancel','rebase'].includes(action));
   if(action==='save')control.textContent=uncertain?'Retry exact goal settings request':'Save goal settings';
  }
 }
 const controller=createGoalController({api,storage:sessionStorage,onState:render});window.personalGoals=controller;render(controller.snapshot());void controller.refresh();
 const contextRegion=document.createElement('details'),contextHeading=document.createElement('summary');contextHeading.textContent='Goal / weekly reporting context';contextRegion.append(contextHeading);
 const contextDescription=document.createElement('p'),contextStatus=document.createElement('p');contextStatus.setAttribute('role','status');
 const contextWeek=document.createElement('select');contextWeek.setAttribute('aria-label','Goal reporting week start');
 for(const [value,name] of ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].entries()){const o=document.createElement('option');o.value=String(value);o.textContent=name;contextWeek.append(o);}
 const contextSave=button('Start new current/future reporting epoch',()=>contextController.save());
 const contextRefresh=button('Refresh reporting context (read only)',()=>contextController.refresh());
 const contextRebase=button('Use latest context revision, keep draft',()=>contextController.rebase());
 const contextCancel=button('Cancel context draft',()=>contextController.cancel());
 contextRegion.append(contextDescription,contextWeek,contextSave,contextRefresh,contextRebase,contextCancel,contextStatus);root.append(contextRegion);
 function renderContext(state){contextStatus.textContent=state.message;const c=state.context;
  contextDescription.textContent=c?`Reporting epoch ${c.revision}: ${c.timezone}; daemon ${c.daemon_timezone||c.timezone}. Week start ${c.first_day_of_week}. Changes are explicit: prior complete periods retain their context, epochs must not be merged, and arbitrary timezone queries are not supported. Historical epochs: ${(c.epochs||[]).map(e=>`${e.revision} (${e.timezone}, week start ${e.first_day_of_week})`).join('; ')||'none'}.`:'Reading reporting context…';
  contextWeek.value=String(state.draft?.first_day_of_week??c?.first_day_of_week??1);
  for(const b of [contextSave,contextRebase,contextCancel])b.disabled=state.pending||state.blocked||(!c&&state.journal?.outcome!=='uncertain');
 }
 const contextController=createGoalContextController({api,storage:sessionStorage,onState:renderContext});window.goalReportingContext=contextController;renderContext(contextController.snapshot());void contextController.refresh();
 contextWeek.addEventListener('change',()=>contextController.edit(Number(contextWeek.value)));
 window.addEventListener('beforeunload',event=>{if(contextController.snapshot().draft){event.preventDefault();event.returnValue='';}});
 window.addEventListener('timetrace:goals-mutated',()=>contextController.refresh());
 window.addEventListener('timetrace:timer-state',event=>{selectedTask=event.detail.timers.find(t=>t.id===event.detail.selectedTimerId)?.task_id||null;render(controller.snapshot());});
 for(const event of ['timetrace:timer-mutated','timetrace:goals-mutated','timetrace:tasks-mutated','timetrace:work-mutated','timetrace:history-mutated'])window.addEventListener(event,()=>controller.refresh(true));
 window.addEventListener('timetrace:task-selected',()=>{render(controller.snapshot());void controller.refresh();});
 window.addEventListener('beforeunload',event=>{if(controller.snapshot().draft){event.preventDefault();event.returnValue='';}});
 setInterval(()=>controller.refresh(),30000);
});
