/* THROWAWAY goal presentation; existing public goal controller owns draft/revision/receipt writes. */
(() => {
if(location.pathname!=='/timer-settings')return;
const get=id=>document.getElementById(id),make=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
const duration=seconds=>{const mins=Math.round(Number(seconds||0)/60),h=Math.floor(mins/60),m=mins%60;return [h?`${h}h`:'',m?`${m}m`:''].filter(Boolean).join(' ')||'0m';};
async function start(){
 if(!window.personalGoals||!get('friendly-goal-form')){setTimeout(start,30);return;}
 const controller=window.personalGoals,form=get('friendly-goal-form'),owner=get('friendly-goal-owner'),hours=get('friendly-goal-hours'),cadence=get('friendly-goal-cadence'),desc=get('friendly-goal-descendants'),enabled=get('friendly-goal-enabled'),from=get('friendly-goal-start');
 let goals=[],tasks=[],editing=null,busy=false;
 const status=text=>get('friendly-goal-status').textContent=text;
 function recovery(){get('goal-controller-recovery').open=true;status('An earlier request still needs recovery. Resolve it below before editing another goal.');}
 function updateFields(){const global=owner.value==='global';if(global&&cadence.value==='total')cadence.value='day';cadence.querySelector('[value=total]').disabled=global;desc.disabled=global;if(global)desc.checked=false;get('friendly-goal-start-label').hidden=cadence.value!=='total';get('friendly-goal-form-help').textContent=editing?'Adjust the target directly. The saved activity and repeat period stay the same.':global?'Counts all saved activities.':'Choose one activity, or include child activities to set a group target.';}
 function open(goal=null){
  if(!controller.cancel()){recovery();return;}
  editing=goal;form.hidden=false;get('friendly-goal-title').textContent=goal?`Edit ${goal.owner_kind==='global'?'All activities':tasks.find(t=>t.id===goal.task_id)?.title||'activity'} goal`:'New goal';
  owner.value=goal?(goal.owner_kind==='global'?'global':goal.task_id):'';owner.disabled=Boolean(goal);cadence.value=goal?.cadence||'day';cadence.disabled=Boolean(goal);hours.value=goal?goal.target_seconds/3600:'';desc.checked=Boolean(goal?.include_descendants);enabled.checked=goal?.enabled??true;from.value=goal?.start_date||'';updateFields();form.scrollIntoView({block:'nearest'});hours.focus();
 }
 async function refresh(){
  const [result,rows]=await Promise.all([api.get('/goals?include_disabled=true'),api.get('/api/tasks')]);goals=result.goals;tasks=rows;
  const oldOwner=owner.value;owner.replaceChildren();for(const [value,text] of [['','Choose an activity…'],['global','All activities'],...tasks.map(t=>[t.id,t.title])]){const option=make('option',text);option.value=value;owner.append(option);}owner.value=oldOwner;
  const list=get('friendly-goal-list');list.replaceChildren();
  if(!goals.length)list.append(make('p','No goals yet. Add one when you want a target.','goal-empty'));
  for(const goal of goals){
   const name=goal.owner_kind==='global'?'All activities':tasks.find(t=>t.id===goal.task_id)?.title||'Unavailable activity';
   const card=make('article','','friendly-goal-card');card.setAttribute('aria-label',`${name} goal`);
   const heading=make('div','','goal-card-heading'),title=make('div');title.append(make('h3',name),make('span',goal.owner_kind==='global'?'All recorded activities':goal.include_descendants?'Includes child activities':'Selected activity only','goal-card-scope'));
   const edit=make('button','Edit');edit.type='button';edit.setAttribute('aria-label',`Edit ${name} goal`);edit.onclick=()=>open(goal);heading.append(title,edit);
   const target=goal.target_seconds/3600;card.append(heading,make('p',`${target.toLocaleString(undefined,{maximumFractionDigits:3})} ${target===1?'hour':'hours'} ${goal.cadence==='day'?'per day':goal.cadence==='week'?'per week':'in total'}`,'goal-card-target'));
   const progress=make('progress');progress.max=goal.target_seconds;progress.value=Math.min(goal.summed_recorded_work_seconds||0,goal.target_seconds);progress.setAttribute('aria-label',`${name} recorded work progress`);card.append(progress);
   const foot=make('div','','goal-card-foot');foot.append(make('span',`${duration(goal.summed_recorded_work_seconds)} recorded · ${goal.percentage_display||'progress unavailable'}`),make('span',goal.enabled?'Enabled':'Paused','goal-enabled-label'));card.append(foot);list.append(card);
  }
 }
 get('friendly-goal-add').onclick=()=>open();get('friendly-goal-cancel').onclick=()=>{if(!controller.cancel()){recovery();return;}form.hidden=true;editing=null;status('');};owner.onchange=()=>{desc.checked=owner.value!=='global'&&tasks.some(t=>t.parent_id===owner.value);updateFields();};cadence.onchange=updateFields;
 form.onsubmit=async event=>{event.preventDefault();if(busy||!form.reportValidity())return;busy=true;const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);status('Saving…');
  try{
   await controller.refresh();if(!controller.snapshot().fresh)throw Error('Could not read the latest settings. Try again.');if(!controller.cancel()){recovery();return;}
   const settings={target_seconds:Number(hours.value)*3600,enabled:enabled.checked,include_descendants:owner.value!=='global'&&desc.checked,start_date:cadence.value==='total'?(from.value||null):null};
   if(!editing){const context=await api.get('/goal-reporting-context');Object.assign(settings,{owner_kind:owner.value==='global'?'global':'task',task_id:owner.value==='global'?null:owner.value,cadence:cadence.value,first_day_of_week:context.first_day_of_week,timezone:context.timezone});}
   if(!controller.edit(editing?.id||null,settings)||!await controller.save())throw Error(controller.snapshot().message||'The goal could not be saved.');
   form.hidden=true;editing=null;await refresh();status('Goal saved.');
  }catch(error){status(error.message);}finally{busy=false;buttons.forEach(b=>b.disabled=false);}
 };
 document.querySelectorAll('[data-settings-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-settings-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('[data-settings-panel]').forEach(panel=>panel.hidden=panel.dataset.settingsPanel!==button.dataset.settingsTab);const url=new URL(location.href);url.searchParams.set('tab',button.dataset.settingsTab);history.replaceState(null,'',url);});
 if(new URLSearchParams(location.search).get('tab')==='focus')document.querySelector('[data-settings-tab=focus]').click();
 await refresh();document.body.dataset.goalCardsReady='true';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void start());else void start();
})();
