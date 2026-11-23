/** Weekly A overview / optional C focused reading share one authoritative response. */
function createWeeklyReviewController({api,onState,initialWeek,context}) {
 let week=initialWeek,view='A',data=null,pending=false,message='',generation=0;
 const snapshot=()=>({week,view,data,pending,message,context});const publish=()=>onState(snapshot());
 async function refresh(){const own=++generation;pending=true;publish();try{
  const query=new URLSearchParams({...context,week_start:week});const response=await api.get(`/weekly-review?${query}`);
  if(own!==generation)return null;data=response;week=response.week_start;message='';return response;
 }catch(_){if(own===generation)message='Weekly evidence unavailable. Retry reads only; no review or settings were submitted.';return null;}
 finally{if(own===generation){pending=false;publish();}}}
 return {snapshot,refresh,show(value){view=value==='C'?'C':'A';publish();},
  navigate(days){const d=new Date(`${week}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);week=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;data=null;return refresh();}
 };
}
if(typeof module!=='undefined')module.exports={createWeeklyReviewController};
if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',()=>{
 const root=document.querySelector('[data-weekly-review]');if(!root)return;
 const params=new URLSearchParams(location.search),now=new Date();
 const localToday=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
 const context={timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,first_day_of_week:typeof getUserSettings==='function'?getUserSettings().firstDayOfWeek:1};
 const hours=value=>`${Number(value||0).toFixed(2)}h`;
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const link=(text,url)=>{const a=el('a',text);a.href=url;return a;};
 const action=(text,fn)=>{const b=el('button',text);b.type='button';b.addEventListener('click',fn);return b;};
 function render(state){
  root.replaceChildren();root.dataset.view=state.view;
  const toolbar=el('div');toolbar.className='weekly-toolbar';
  const title=el('h1',state.view==='C'?'Review your week.':'Your week, in perspective.');
  toolbar.append(title,action('Previous week',()=>controller.navigate(-7)),action('Next week',()=>controller.navigate(7)),
   action(state.view==='C'?'Back to overview':'Review this week',()=>controller.show(state.view==='C'?'A':'C')),action('Refresh weekly evidence',()=>controller.refresh()));root.append(toolbar);
  const status=el('p',state.pending?'Reading selected week…':state.message);status.setAttribute('role','status');root.append(status);
  if(!state.data)return;
  const d=state.data,meta=d.summed_recorded_work.meta;
  const url=new URL(location.href);url.searchParams.set('week_start',state.week);url.searchParams.set('view',state.view);history.replaceState(null,'',url);
  root.append(el('p',`${d.week_start} – ${d.week_end} · ${meta.timezone} · week start ${meta.first_day_of_week} · measured ${d.measurement_at}`));
  const notice=el('p','Summed recorded work counts each saved explicit interval in full, including same-task overlaps. Live/paused buffers, plans and uncertain legacy evidence do not advance goals. Existing unions and estimates remain separate.');notice.className='weekly-notice';root.append(notice);
  for(const warning of new Set([...d.warnings,...meta.warnings]))root.append(el('p',warning));
  const metrics=el('section');metrics.className='weekly-metrics';
  for(const [label,value] of [['Summed recorded work',d.summed_recorded_work.total],['Elapsed recorded time · union',d.elapsed_recorded_time.total],['Taskless summed work',d.taskless_summed_recorded_work.total],['Recorded task time · within-task union',d.recorded_task_time.total]]){const card=el('article');card.append(el('h2',label),el('p',hours(value)));metrics.append(card);}root.append(metrics);
  const goals=el('section');goals.append(el('h2','Personal goals · independent of estimates'));
  if(!d.goals.length)goals.append(el('p','No goals configured for this period. Set your own targets using Goal settings above.'));
  for(const g of d.goals){const row=el('p',`${g.owner_kind} ${g.cadence}: ${hours(g.summed_recorded_work_seconds/3600)} / ${hours(g.target_seconds/3600)} · ${g.percentage?.toFixed(1)}% · ${g.period_start} – ${g.period_end} · ${g.include_descendants?'all nested subtasks':'own work only'}`);if(g.task_id)row.append(' ',link('Task details',`/tasks-detail/${encodeURIComponent(g.task_id)}`));goals.append(row);}root.append(goals);
  const daily=el('section');daily.append(el('h2',state.view==='C'?'01 · What did you put in?':'Your daily rhythm'));
  const values=new Map(d.daily.rows.map(row=>[row.keys[0],row.value]));
  const list=el('ul');for(let i=0;i<7;i++){const date=new Date(`${d.week_start}T12:00Z`);date.setUTCDate(date.getUTCDate()+i);const key=`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;const li=el('li',`${key}: ${hours(values.get(key))} summed work `);li.append(link('Existing day review',`/revision?date=${key}`));list.append(li);}daily.append(list);root.append(daily);
  const tasks=el('section');tasks.append(el('h2',state.view==='C'?'02 · Where did your attention go?':'Where your time went'));
  for(const row of d.tasks.rows){const id=row.keys[0],account=d.estimate_accounting[id];const article=el('article');article.append(link(row.labels[0]||id,`/tasks-detail/${encodeURIComponent(id)}`),el('p',`${hours(row.value)} summed recorded work this week`));if(account)article.append(el('p',`Existing estimate accounting (all-time, unchanged): ${hours(account.logged_hours)} logged / ${hours(account.estimated_hours)} estimated · ${account.progress_pct??'unbounded'}%`));tasks.append(article);}if(d.tasks.meta.truncated)tasks.append(el('p','Task display truncated; global totals computed independently.'));root.append(tasks);
  const plans=el('section');plans.append(el('h2',state.view==='C'?'03 · How did reality differ from the plan?':'Plans are not work'));
  if(!d.plans.length)plans.append(el('p','No current plans overlap this selected week.'));
  for(const p of d.plans){plans.append(el('p',`${p.task_title||p.task_id||'Plan'} · original ${p.original_start||'unarchived projection'} → ${p.original_end||'unarchived projection'} · current ${p.start_time} → ${p.end_time}`));}root.append(plans);
  const links=el('section');links.append(el('h2',state.view==='C'?'04 · Make sense of your week':'Explore existing records'),el('p','No new journal or automatic review submission. Notes and ratings remain in existing Revision and task details.'),link('Revision notes / ratings',`/revision?date=${d.week_start}`),' · ',link('Statistics','/stats'),' · ',link('Calendar',`/dashboard?date=${d.week_start}`),' · ',link('Agenda / corrections / export',`/agenda-view?date=${d.week_start}`));root.append(links);
  if(state.view==='C')root.append(action('Return to weekly overview',()=>controller.show('A')));
 }
 const controller=createWeeklyReviewController({api,onState:render,initialWeek:params.get('week_start')||localToday,context});window.weeklyReview=controller;
 controller.show(params.get('view'));void controller.refresh();
 for(const event of ['timetrace:timer-mutated','timetrace:goals-mutated','timetrace:tasks-mutated'])window.addEventListener(event,()=>controller.refresh());
});
