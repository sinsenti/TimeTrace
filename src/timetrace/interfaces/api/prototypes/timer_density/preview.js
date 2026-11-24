/* THROWAWAY: A current rendering, B compact toolbar, C workspace rail, D settings-first. */
const variants={A:'Current layout',B:'Compact toolbar',C:'Workspace rail',D:'Settings-first'};
const params=new URLSearchParams(location.search),variant=params.get('variant') in variants?params.get('variant'):'B';
document.documentElement.dataset.previewVariant=variant;
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
const button=(label,action)=>{const b=el('button',label);b.type='button';b.onclick=action;return b;};
const demo={focus:false,goals:false,variant,page:location.pathname};
function dialog(title,content){const d=el('dialog','','preview-dialog');const h=el('header');h.append(el('h2',title),button('Close',()=>d.close()));d.append(h,content);document.body.append(d);d.addEventListener('click',e=>{if(e.target===d)d.close();});return d;}
function switchTo(key){const url=new URL(location.href);url.searchParams.set('variant',key);location.href=url;}
function build(){
 const agenda=location.pathname!='/dashboard';
 const current=document.querySelector('[data-current-display]');
 const draw=()=>{if(current)renderTimerWorkspaceCard(current,demoState,multipleTimers);};draw();document.addEventListener('demo:timer',draw);
 const tasks=document.querySelector('[data-timer-task]');demoTasks.forEach(t=>{const o=el('option',t.title);o.value=t.id;tasks?.append(o);});
 const list=document.querySelector('[data-timer-list]');if(list)list.textContent=`${demoTimer.task_title} · 5e2e8353 · running · 1:51 live`;
 const status=document.getElementById('timer_status_label');if(status)status.textContent='1:51 · recording';
 const range=document.getElementById('calendar_range_title');if(range)range.textContent='November 23–29, 2026';
 const cards=document.getElementById('task_card_list');if(cards)demoTasks.forEach(t=>cards.append(el('div',t.title,'demo-task')));
 const calendar=document.getElementById('calendar');if(calendar){
  calendar.classList.add('demo-calendar');const hours=el('div','','demo-hours');hours.append(el('strong','GMT+1'));for(let h=8;h<18;h++)hours.append(el('span',`${h}:00`));calendar.append(hours);
  ['Mon 23','Tue 24','Wed 25','Thu 26','Fri 27','Sat 28','Sun 29'].forEach((day,i)=>{const col=el('div','','demo-day');col.append(el('strong',day));if(i<5){const plan=el('div',i%2?'Project planning':'Reading session','demo-event');plan.style.top=`${110+(i%3)*80}px`;plan.append(el('small','Planned · 10:00–11:00'));col.append(plan);}if(i===0){const actual=el('div','Reading habit','demo-event actual');actual.style.top='220px';actual.append(el('small','Recorded · 09:00–09:30'));col.append(actual);}calendar.append(col);});
 }
 if(agenda){
  document.getElementById('agenda-date').value='2026-11-23';
  const pins=document.getElementById('agenda-pins');demoTasks.slice(0,2).forEach(t=>{const row=el('div',`${t.title} · ${t.id.slice(-8)} `,'demo-discovery');row.append(button('Start',()=>demoMessage(`Preview selected: ${t.title}`)),button('Unpin',()=>row.remove()));pins.append(row);});
  const activities=document.getElementById('agenda-activities');demoTasks.forEach(t=>{const row=el('div',`${t.title} · ${t.id.slice(-8)} `,'demo-discovery');row.dataset.title=t.title;row.append(button('Start',()=>demoMessage(`Preview selected: ${t.title}`)),button('Pin',()=>demoMessage('Pin is demonstration-only.')));activities.append(row);});
  const ledger=document.getElementById('agenda-ledger');['Reading habit · 42 min recorded','Language practice · 25 min recorded','Project planning · 11:00–12:00 planned'].forEach(text=>ledger.append(el('div',text,'demo-history')));
  const note=document.getElementById('workspace-current-note'),label=el('label','Current work-entry note (not task description)');const input=el('textarea');input.value='Reading chapter 3';label.append(input);note.append(label,button('Save current work note',()=>demoMessage('Preview only; note is not saved.')),button('Use current saved note',()=>{input.value='Reading chapter 3';}));
 }
 const focus=document.querySelector('.timer-focus-panel'),goals=document.querySelector('.personal-goals'),timers=document.getElementById('multiple_timers');
 const hints=el('div');hints.append(el('h3','Timer shortcuts'),el('p','Outside editors: Alt+Shift+1–9 selects a timer; Enter starts the picked task; P pauses/resumes; S stops; F searches (all with Alt+Shift).'),el('p','Five-minute and exact-interval corrections are previewed before applying. Plans and actual work stay separate.'));
 const helpDialog=dialog('Shortcuts & help',hints),focusDialog=dialog('Focus settings',focus),goalsDialog=dialog('Optional goals',goals);
 // A keeps exact current focus/goals insertion points and verbose discovery text.
 if(variant==='A'){
  const host=document.getElementById('workspace-current-timer')||timers;host.append(focus);document.querySelector('main').before(goals);
 }else{
  const bar=el('div','','preview-toolbar'),quick=el('div','','preview-quick');
  const picker=el('input');picker.type='search';picker.placeholder='Find an activity…';picker.setAttribute('aria-label','Find an activity');
  picker.addEventListener('input',()=>document.querySelectorAll('#agenda-activities .demo-discovery').forEach(r=>{r.hidden=!r.dataset.title.toLowerCase().includes(picker.value.toLowerCase());}));
  quick.append(picker,button('Start unassigned',()=>demoMessage('Unassigned start is a visual demonstration only.')));bar.append(quick);
  document.querySelector('body > header').after(bar);timers.hidden=true;
  const tools=el('div','','preview-tools');bar.append(tools);
  const focusButton=button('Focus settings',()=>focusDialog.showModal()),goalButton=button('Goals',()=>goalsDialog.showModal()),helpButton=button('Shortcuts ?',()=>helpDialog.showModal());
  const activeSummary=el('span','','preview-progress');tools.append(activeSummary);
  if(variant==='B')tools.append(focusButton,goalButton,helpButton);
  if(variant==='C'){
   const rail=el('aside','','preview-rail');rail.append(el('strong','Workspace'),focusButton,goalButton,helpButton,button('Other timers · 1',()=>demoMessage('Only one synthetic timer in this comparison.')));document.body.append(rail);document.body.classList.add('with-rail');
  }
  if(variant==='D'){
   const settings=el('div');settings.append(el('p','Choose what belongs in your workspace.'),focusButton,goalButton,helpButton);const settingsDialog=dialog('Workspace settings',settings);
   [focusButton,goalButton,helpButton].forEach(b=>b.addEventListener('click',()=>settingsDialog.close()));tools.append(button('Workspace settings',()=>settingsDialog.showModal()));
  }
  // Keep normal task discovery but hide IDs, verbose explanations and advanced filters.
  document.querySelectorAll('.demo-discovery').forEach(row=>{const text=row.firstChild;if(text?.nodeType===Node.TEXT_NODE)text.textContent=text.textContent.replace(/ · [^ ]+\s*$/,' ');});
  if(agenda){
   const main=document.getElementById('agenda-workspace');const shortcut=main.querySelector(':scope > p');if(shortcut)shortcut.hidden=true;
   const mast=main.querySelector('.folio-masthead');mast.querySelector('h1').innerHTML='Your day, <em>in focus.</em>';mast.querySelector('.folio-deck').hidden=true;
   const discovery=main.querySelector('[aria-label="Activity discovery"]');discovery.querySelectorAll('p').forEach(p=>p.hidden=true);
   const advanced=el('details','','preview-advanced');advanced.append(el('summary','Filters & details'));['agenda-filter-tag','agenda-filter-note'].forEach(id=>advanced.append(document.getElementById(id).closest('label')));discovery.append(advanced);
   discovery.querySelector('label').hidden=true;
   const exportButton=document.getElementById('history-export-open');if(exportButton?.nextElementSibling?.tagName==='P')exportButton.nextElementSibling.hidden=true;
   const note=document.getElementById('workspace-current-note'),noteDetails=el('details','','preview-note');noteDetails.append(el('summary','Work note · Reading chapter 3'));while(note.firstChild)noteDetails.append(note.firstChild);note.append(noteDetails);
   document.querySelector('.folio-inspector').hidden=true;
  }
  window.updateOptionalProgress=()=>{activeSummary.textContent=[demo.focus?'Focus · 24:00':'',demo.goals?'Today · 42m / 2h':''].filter(Boolean).join('   ·   ');};
 }
 const dock=el('aside','','prototype-switcher');dock.setAttribute('aria-label','Prototype comparison');
 dock.append(button('←',()=>switchTo(Object.keys(variants)[(Object.keys(variants).indexOf(variant)+3)%4])),el('strong',`${variant} · ${variants[variant]}`),button('→',()=>switchTo(Object.keys(variants)[(Object.keys(variants).indexOf(variant)+1)%4])));
 const route=el('a',agenda?'Compare Calendar':'Compare Agenda');route.href=`${agenda?'/dashboard':'/agenda-view'}?variant=${variant}`;dock.append(route);
 const options=el('details'),summary=el('summary','Synthetic state / options');options.append(summary);
 for(const [key,label] of [['focus','Preview focus enabled'],['goals','Preview goals enabled']]){const l=el('label',label),input=el('input');input.type='checkbox';input.checked=demo[key];input.onchange=()=>{demo[key]=input.checked;window.updateOptionalProgress?.();state.textContent=JSON.stringify(demo,null,2);};l.prepend(input);options.append(l);}
 const state=el('pre',JSON.stringify(demo,null,2));options.append(state,el('p','Current templates + real focus/goals renderers; synthetic records and calendar. Layout comparison, not a live screenshot. No persistence or real writes.'));dock.append(options);document.body.append(dock);
 const toast=el('p','','demo-toast');toast.id='demo-toast';toast.setAttribute('role','status');document.body.append(toast);
 document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],dialog')||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();switchTo(Object.keys(variants)[(Object.keys(variants).indexOf(variant)+(e.key==='ArrowLeft'?3:1))%4]);}});
 document.querySelectorAll('a[href]').forEach(a=>{const url=new URL(a.href);if(url.origin===location.origin){if(['/dashboard','/agenda-view'].includes(url.pathname)){url.searchParams.set('variant',variant);a.href=url.href;}else a.onclick=e=>{e.preventDefault();demoMessage('Only Calendar and Agenda are part of this preview.');};}});
 document.body.dataset.prototypeReady='true';
}
document.addEventListener('DOMContentLoaded',()=>setTimeout(build,80));
