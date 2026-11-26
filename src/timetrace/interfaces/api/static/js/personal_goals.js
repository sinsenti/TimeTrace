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
 async function save(){if(pending||blocked||(!context&&journal?.outcome!=='uncertain'))return false;
  if(journal?.outcome!=='uncertain'&&(!draft||draft.first_day_of_week===context?.first_day_of_week))return false;
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
