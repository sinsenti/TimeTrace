/* THROWAWAY DOM relocation only: real tasks, calendar, timers, editors, API and synthetic DB. */
(() => {
const variant=document.documentElement.dataset.layout,settingsPage=location.pathname==='/timer-settings';
const make=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
function initialize(){
 const focus=document.querySelector('.timer-focus-panel'),goals=document.querySelector('.personal-goals');
 if(!focus||!goals||!window.multipleTimers){setTimeout(initialize,30);return;}
 const dock=make('aside','','real-prototype-dock');dock.setAttribute('aria-label','Prototype comparison');
 const label=make('strong',variant==='A'?'Current app · unchanged reference':'Proposal · revision 6');dock.append(label);
 const current=make('a','Current');current.href=`${settingsPage?'/dashboard':location.pathname}?variant=A`;
 const proposal=make('a','Proposal');proposal.href=`${location.pathname}?variant=B`;
 const calendar=make('a','Calendar');calendar.href=`/dashboard?variant=${variant}`;
 const agenda=make('a','Agenda');agenda.href=`/agenda-view?variant=${variant}`;
 const settings=make('a','Focus & goals');settings.href='/timer-settings?variant=B';
 dock.append(current,proposal,calendar,agenda,settings);
 const state=make('details'),summary=make('summary','Preview details');state.append(summary,make('p','Actual app renderers and APIs. Sample tasks/work only. Saves affect a disposable database; notifications and AI/provider calls are disabled. Calendar task cards are not mocked.'));
 state.append(make('pre',JSON.stringify({variant,synthetic:true,focusDefault:'off',goalsDefault:'sample Work goal: 2h/day; not a product default',route:location.pathname},null,2)));dock.append(state);document.body.append(dock);
 if(variant==='A'&&!settingsPage){document.body.dataset.realPreviewReady='true';return;}
 document.documentElement.classList.add('real-layout-proposal');
 // Keep original controllers and controls alive; only their presentation/placement changes.
 const quiet=make('div');quiet.id='real-settings-staging';quiet.hidden=true;document.body.append(quiet);
 if(settingsPage){
  const context=goals.querySelectorAll('details')[1];if(context){context.open=true;document.querySelector('[data-report-settings-host]').append(context);}
  focus.querySelector('h3')?.remove();focus.querySelector('details').open=true;
  document.querySelector('[data-focus-settings-host]').append(focus);
  document.querySelector('[data-goal-settings-host]').append(goals);goals.querySelector('details').open=true;
  const scope=focus.querySelector('select[aria-label="Settings scope"]');scope.value='defaults';scope.dispatchEvent(new Event('change',{bubbles:true}));
  const picker=make('div','','real-focus-scope');picker.append(make('label','For a specific timer: '));
  const select=make('select');select.setAttribute('aria-label','Selected timer for focus settings');
  let timerSignature='';const updateTimerOptions=()=>{const snapshot=multipleTimers.snapshot(),signature=JSON.stringify(snapshot.timers.map(t=>[t.id,t.task_title]));if(signature!==timerSignature){timerSignature=signature;select.replaceChildren();snapshot.timers.forEach(t=>{const o=make('option',t.task_title||'Unassigned');o.value=t.id;select.append(o);});}select.value=snapshot.selectedTimerId||'';};updateTimerOptions();window.addEventListener('timetrace:timer-state',updateTimerOptions);
  select.onchange=()=>{multipleTimers.select(select.value);scope.value='timer';scope.dispatchEvent(new Event('change',{bubbles:true}));};picker.append(select);focus.prepend(picker);
 }else{
  quiet.append(focus,goals);
  const nav=document.querySelector('.app-navigation nav'),link=make('a','Focus & goals');link.href='/timer-settings?variant=B';nav.append(link);
  const timers=document.getElementById('multiple_timers');
  // Retain recovery/idle review and targeted timer controls, but collapse launch boilerplate.
  if(location.pathname==='/dashboard'){
   const row=timers.querySelector('.multiple-timer-row'),list=timers.querySelector('[data-timer-list]'),review=timers.querySelector('[data-idle-review]');
   const panel=make('details','','timer-strip-others'),heading=make('summary','Other timers'),content=make('div','','timer-strip-popover');panel.append(heading,content);content.append(list,review,timers.querySelector('[data-timer-refresh]'));row.append(panel);
   const selected=make('a','','timer-strip-current');row.insertBefore(selected,panel);timers.classList.add('unified-timer-strip');document.querySelector('body > header').after(timers);
   const updateStrip=()=>{const state=multipleTimers.snapshot(),timer=state.timers.find(t=>t.id===state.selectedTimerId),seconds=Math.floor(timer?.elapsed_seconds||0);selected.textContent=timer?`${timer.task_title||'Unassigned'} · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · ${timer.state}`:'Open timer workspace';selected.href=timer?`/agenda-view?variant=B&timer=${encodeURIComponent(timer.id)}`:'/agenda-view?variant=B';heading.textContent=`Other timers · ${state.timers.filter(t=>t.id!==state.selectedTimerId).length}`;if(state.receipt?.outcome==='uncertain'||state.timers.some(t=>(t.idle_gaps||[]).some(g=>!g.decision)))panel.open=true;};window.addEventListener('timetrace:timer-state',updateStrip);updateStrip();
  }
  if(location.pathname==='/agenda-view'){
   const main=document.getElementById('agenda-workspace');
   const mast=main.querySelector('.folio-masthead');mast.querySelector('h1').textContent='Activity';mast.querySelector('.folio-eyebrow').hidden=true;mast.querySelector('.folio-deck').hidden=true;
   const intro=main.querySelector(':scope > p');
   const help=make('dialog','','real-help-dialog'),close=make('button','Close');close.type='button';close.onclick=()=>help.close();help.append(make('h2','Shortcuts & recording help'),close,intro);intro.hidden=false;document.body.append(help);
   const helpButton=make('button','Shortcuts ?');helpButton.type='button';helpButton.onclick=()=>help.showModal();main.querySelector('.folio-strip').append(helpButton);
   const unfinished=make('details','','real-other-timers');unfinished.append(make('summary','Other timers & recovery'));const host=document.getElementById('agenda-unfinished');host.append(unfinished);unfinished.append(timers);
   const discovery=main.querySelector('[aria-label="Activity discovery"]'),activities=document.getElementById('agenda-activities'),search=document.getElementById('agenda-search');
   search.placeholder='Find an activity to start…';
   const filters=make('details','','real-activity-filters');filters.append(make('summary','Filters'));
   for(const id of ['agenda-filter-tag','agenda-filter-note'])filters.append(document.getElementById(id).closest('label'));
   const explanation=[...discovery.querySelectorAll('p')].find(p=>p.textContent.includes('History reads'));if(explanation)help.append(explanation);
   discovery.insertBefore(filters,activities);activities.hidden=!search.value;search.addEventListener('input',()=>{activities.hidden=!search.value;});
   const progress=document.getElementById('agenda-progress');
   const humanizeProgress=()=>{if(progress.firstElementChild?.classList.contains('friendly-time-summary'))return;const text=progress.firstElementChild?.textContent||'';const values=[...text.matchAll(/: ([\d.,\s]+) h/g)].map(m=>{const parts=new Intl.NumberFormat().formatToParts(1234.5),group=parts.find(p=>p.type==='group')?.value||'',decimal=parts.find(p=>p.type==='decimal')?.value||'.';return Number(m[1].split(group).join('').replace(decimal,'.').replace(/\s/g,''));});if(values.length!==3)return;const human=hours=>{const mins=Math.round(hours*60);return `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,'0')}m`;};const summary=make('div','','friendly-time-summary');summary.append(make('strong',human(values[1])),make('span','recorded time'));if(Math.abs(values[0]-values[1])>0.0005)summary.append(make('span',`${human(values[0])} task credit`));if(values[2]>0)summary.append(make('span',`${human(values[2])} unassigned`));const details=make('details','','friendly-time-details');details.append(make('summary','How time is counted & breakdown'),make('p','Recorded time counts overlapping minutes once. Task credit counts overlaps once within each task; simultaneous work on different tasks can count more than once. Unassigned work can overlap assigned work. These figures are not additive.'));while(progress.firstChild)details.append(progress.firstChild);progress.append(summary,details);};new MutationObserver(humanizeProgress).observe(progress,{childList:true});humanizeProgress();
   const exportButton=document.getElementById('history-export-open');if(exportButton.nextElementSibling?.tagName==='P')help.append(exportButton.nextElementSibling);
   const currentNote=document.getElementById('workspace-current-note'),note=make('details','','real-note');note.append(make('summary','Work note'));while(currentNote.firstChild)note.append(currentNote.firstChild);currentNote.append(note);
   // Preserve the real inspector and its selection/editor handlers; make it contextual, not empty space.
   const inspector=main.querySelector('.folio-inspector');
   const updateInspector=()=>{const active=!document.getElementById('agenda-form').hidden||Boolean(document.getElementById('agenda-detail').textContent.trim());if(inspector.hidden===active)inspector.hidden=!active;main.querySelector('.folio-columns').classList.toggle('has-inspector',active);};
   new MutationObserver(updateInspector).observe(inspector,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});updateInspector();
   const hideDisplayIds=()=>{for(const row of discovery.querySelectorAll('#agenda-pins > div,#agenda-activities > div')){const text=row.firstChild;if(text?.nodeType===Node.TEXT_NODE&&!text.textContent.startsWith('Unavailable')){const clean=text.textContent.replace(/ · [a-f0-9]{8}\s*$/i,' ');if(clean!==text.textContent)text.textContent=clean;}}};
   new MutationObserver(hideDisplayIds).observe(discovery,{subtree:true,childList:true,characterData:true});hideDisplayIds();
   const ledger=document.getElementById('agenda-ledger');const hideHistoryIds=()=>{for(const summary of ledger.querySelectorAll('summary')){const text=summary.firstChild;if(text?.nodeType===Node.TEXT_NODE){const clean=text.textContent.replace(/ · [a-f0-9]{8}(?= ·)/ig,'');if(clean!==text.textContent)text.textContent=clean;}}};new MutationObserver(hideHistoryIds).observe(ledger,{subtree:true,childList:true,characterData:true});hideHistoryIds();
  }
  // Urgent phases/recovery are not settings: retain a visible route to their actions.
  const attention=make('a','','real-attention');attention.href='/timer-settings?variant=B';document.querySelector('.app-navigation').append(attention);
  const updateAttention=()=>{const hasAction=focus.querySelector('.focus-actions')?.childElementCount>0;attention.textContent=hasAction?'Focus needs attention':'';attention.hidden=!hasAction;};
  new MutationObserver(updateAttention).observe(focus,{subtree:true,childList:true});updateAttention();
 }
 document.querySelectorAll('.app-navigation nav a[href]').forEach(a=>{const url=new URL(a.href);if(url.origin===location.origin){url.searchParams.set('variant',variant);a.href=url.href;}});
 document.body.dataset.realPreviewReady='true';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);else initialize();
})();

/* Round four THROWAWAY presentation: original focus form and correction engine stay authoritative. */
(() => {
if(document.documentElement.dataset.layout==='A')return;
const make=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
function focusCards(){
 if(location.pathname!=='/timer-settings')return;
 const region=document.querySelector('.timer-focus-panel'),form=region?.querySelector('form');
 if(!form||!region.querySelector('.real-focus-scope')){setTimeout(focusCards,40);return;}
 if(region.dataset.friendlyFocus)return;region.dataset.friendlyFocus='true';
 const scope=form.querySelector('[aria-label="Settings scope"]'),picker=region.querySelector('.real-focus-scope');
 const target=make('div','','friendly-focus-target'),label=make('label','Apply to '),select=make('select');select.setAttribute('aria-label','Focus routine applies to');
 for(const [value,text] of [['defaults','Future timers'],['timer','Selected timer']]){const o=make('option',text);o.value=value;select.append(o);}select.value=scope.value;label.append(select);target.append(label,picker);region.prepend(target);scope.hidden=true;
 const card=make('article','','friendly-goal-card friendly-focus-card'),heading=make('div','','goal-card-heading'),title=make('h3','Focus routine'),badge=make('span','','focus-state-badge');heading.append(title,badge);
 const periods=make('div','','focus-periods'),work=make('div'),pause=make('div');periods.append(work,make('span','→'),pause);const behavior=make('p','','focus-behavior-summary'),edit=make('button','Edit routine');edit.type='button';const draft=make('small','','focus-draft-label');card.append(heading,periods,behavior,edit,draft);target.after(card);
 const editor=make('section','','friendly-focus-editor');editor.hidden=true;editor.append(make('h3','Edit focus routine'),form);card.after(editor);region.querySelector('details')?.remove();
 const advanced=make('details','','focus-advanced');advanced.append(make('summary','Notifications & details'));region.append(advanced);
 const clock=region.querySelector(':scope > p'),warning=clock?.nextElementSibling;if(clock)advanced.append(clock);if(warning?.tagName==='P')advanced.append(warning);
 const explanation=form.querySelector('p');if(explanation)advanced.append(explanation);
 const permission=[...region.children].find(n=>n.tagName==='BUTTON');if(permission)advanced.append(permission);
 const submit=form.querySelector('button[type=submit]');submit.textContent='Save changes';const reset=[...form.querySelectorAll('button')].find(b=>b!==submit);if(reset)reset.textContent='Reset to saved';
 const close=make('button','Close editor');close.type='button';editor.append(make('p','Settings affect subsequent periods. You choose when to resume after a break.','focus-editor-help'),close);close.onclick=()=>{editor.hidden=true;render();};edit.onclick=()=>{editor.hidden=false;form.querySelector('[name=enabled]').focus();};
 for(const [name,text] of [['enabled','Enable focus routine'],['work_minutes','Work period (minutes)'],['break_minutes','Break (minutes)'],['sound_enabled','Play a sound']]){const input=form.querySelector(`[name=${name}]`);if(input?.parentElement.firstChild?.nodeType===Node.TEXT_NODE)input.parentElement.firstChild.textContent=text+' ';}
 const behaviorField=form.querySelector('[name=behavior]');behaviorField.options[0].textContent='Notify me; keep recording';behaviorField.options[1].textContent='Pause this timer for a break';behaviorField.setAttribute('aria-label','When the work period ends');
 let defaults=null,read=0;
 function render(){const timer=multipleTimers.snapshot().timers.find(t=>t.id===multipleTimers.snapshot().selectedTimerId),saved=scope.value==='defaults'?defaults:timer?.focus?.settings;
  badge.textContent=saved?.enabled?'On':'Off';badge.classList.toggle('is-on',Boolean(saved?.enabled));work.replaceChildren(make('strong',`${saved?.work_minutes??25} min`),make('span','Work'));pause.replaceChildren(make('strong',`${saved?.break_minutes??5} min`),make('span','Break'));
  behavior.textContent=saved?.behavior==='automatic_break'?'When time is up: pause this timer for a break.':'When time is up: notify me and keep recording.';draft.textContent=multipleTimers.hasFocusDraft?.()?'Unsaved changes kept':'';select.value=scope.value;picker.hidden=scope.value!=='timer';
 }
 async function refresh(){const own=++read;const value=await api.get('/timer-focus/defaults').catch(()=>null);if(value&&own===read)defaults=value;render();}
 select.onchange=()=>{scope.value=select.value;scope.dispatchEvent(new Event('change',{bubbles:true}));};scope.addEventListener('change',render);form.addEventListener('input',()=>queueMicrotask(render));window.addEventListener('timetrace:timer-state',render);window.addEventListener('timetrace:timer-mutated',()=>void refresh());
 const status=[...region.children].find(n=>n.tagName==='P');if(status){new MutationObserver(()=>{if(status.textContent.startsWith('Settings acknowledged.')){editor.hidden=true;void refresh();}}).observe(status,{childList:true,characterData:true,subtree:true});}
 void refresh();
}
function correctionDialog(){
 if(location.pathname!=='/agenda-view')return;
 function decorate(){
 const dialog=document.getElementById('timer-correction-dialog');if(!dialog||dialog.dataset.friendlyCorrection)return;dialog.dataset.friendlyCorrection='true';
 const heading=dialog.querySelector('h2'),context=heading.nextElementSibling,choices=dialog.querySelector('fieldset'),fields=dialog.querySelector('.correction-fields'),raw=dialog.querySelector('pre'),message=dialog.querySelector('[role=status]'),actions=dialog.querySelector('.workspace-actions');
 heading.textContent='Adjust recorded time';choices.querySelector('legend').textContent='Which work interval?';
 const intro=make('p','Change recorded work only. Plans stay unchanged; paused timers stay paused.','correction-intro');heading.after(intro);
 const advanced=make('details','','correction-advanced');advanced.append(make('summary','Advanced time settings & technical details'));dialog.append(advanced);advanced.append(context,raw);
 const labels=[...fields.querySelectorAll('label')],inputs=labels.map(l=>l.querySelector('input,select')),kind=inputs[0];labels[0].firstChild.textContent='What would you like to do? ';kind.options[0].textContent='Change start time';kind.options[1].textContent='Remove a break';
 for(const index of [1,3,5])advanced.append(labels[index]);
 const rawInputs=make('div','','correction-exact-inputs');advanced.append(rawInputs);
 for(const [index,text] of [[2,'New start'],[4,'Break ends']]){
  const original=inputs[index],label=labels[index],proxy=make('input');proxy.type='datetime-local';proxy.step='0.001';proxy.setAttribute('aria-label',text);label.firstChild.textContent=text+' ';const exactLabel=make('label',index===2?'Exact start value':'Exact break-end value');exactLabel.append(original);rawInputs.append(exactLabel);label.append(proxy);
  const sync=()=>{const display=original.value.replace(/(\.\d{3})\d+/,'$1');if(document.activeElement!==proxy)proxy.value=display;};proxy.addEventListener('input',()=>{original.value=proxy.value;original.dispatchEvent(new Event('input',{bubbles:true}));});dialog.addEventListener('toggle',sync);sync();original.dataset.proxy='true';original._displayProxy=proxy;
 }
 const humanStatus=make('p','','friendly-correction-status');humanStatus.setAttribute('role','status');const beforeAfter=make('section','','friendly-correction-preview');beforeAfter.hidden=true;message.before(humanStatus,beforeAfter);advanced.append(message);
 const review=dialog.querySelector('a');if(review){advanced.append(review);review.addEventListener('click',()=>{const panel=document.getElementById('multiple_timers')?.closest('details');if(panel)panel.open=true;});}
 const setup=make('div','','correction-setup-actions');humanStatus.after(setup);let initializeButton=null,reloadButton=null;const buttons=[...actions.querySelectorAll('button')];for(const b of buttons){if(b.textContent.startsWith('Initialize')){b.textContent='Enable time adjustments';b.hidden=true;initializeButton=b;setup.append(b);}else if(b.textContent.startsWith('Refresh target')){b.textContent='Refresh intervals';b.hidden=true;reloadButton=b;setup.append(b);}else if(b.textContent.startsWith('Preview'))b.textContent='Preview changes';else if(b.textContent.startsWith('Apply this'))b.textContent='Apply changes';else if(b.textContent.startsWith('Close'))b.textContent='Close (keep draft)';else if(b.textContent.startsWith('Discard'))b.textContent='Discard draft';}
 let lastRaw='',lastChoices='';
 const format=iso=>{const d=new Date(iso);return Number.isFinite(d.getTime())?d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}):iso;};
 function update(){
  const text=message.textContent,needsInitialization=text.startsWith('Preview refused:')&&text.includes('initialization is required');if(initializeButton)initializeButton.hidden=!needsInitialization;if(reloadButton)reloadButton.hidden=!text.startsWith('Initialization acknowledged.');const readable=needsInitialization?'Enable time adjustments once before the first edit. This does not change your times.':text.startsWith('Initialization acknowledged.')?'Time adjustments enabled. Refresh intervals, then preview your edit.':text.startsWith('Target identities/revisions reloaded.')?'Intervals refreshed. Your typed dates are unchanged; select the interval and preview again.':text.startsWith('Enter complete dates')?'Choose the new time, then preview the change.':text.startsWith('Input changed.')?'Your edit changed. Preview again before applying.':text.startsWith('Review exact signed')?'Check the before and after, then apply.':text.startsWith('Known work/timer change invalidated')?'This work changed elsewhere. Refresh and preview again.':text.startsWith('Correction acknowledged.')?'Time correction saved. Display is refreshing.':text;if(humanStatus.textContent!==readable)humanStatus.textContent=readable;
  labels[2].firstChild.textContent=kind.value==='exclude'?'Break starts ':'New start ';inputs[2]._displayProxy?.setAttribute('aria-label',kind.value==='exclude'?'Break starts':'New start');labels[4].hidden=kind.value!=='exclude';
  for(const input of inputs)if(input?._displayProxy){if(document.activeElement!==input._displayProxy)input._displayProxy.value=input.value.replace(/(\.\d{3})\d+/,'$1');input._displayProxy.disabled=input.disabled;}
  const choiceLabels=[...choices.querySelectorAll('label')];const diagnostics=[];
  for(const label of choiceLabels){const input=label.querySelector('input'),node=[...label.childNodes].find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());if(!node||!node.textContent.trim().startsWith('{'))continue;const rawText=node.textContent.trim(),parts=rawText.split(' · ');diagnostics.push(rawText);const dates=parts[1]?.split(' — ');if(dates){const note=parts.slice(5).join(' · ');node.textContent=` ${format(dates[0])} — ${dates[1]==='recording'?'Now (recording)':format(dates[1])}${note&&note!=='no work note'?' · '+note:''}`;}}
  if(diagnostics.length){lastChoices=diagnostics.join('\n');let detail=advanced.querySelector('.correction-target-diagnostics');if(!detail){detail=make('pre','','correction-target-diagnostics');advanced.append(detail);}detail.textContent=lastChoices;}
  if(raw.textContent!==lastRaw){lastRaw=raw.textContent;beforeAfter.replaceChildren();beforeAfter.hidden=!lastRaw;
   if(lastRaw){beforeAfter.append(make('h3','Last preview — review before applying'));
    const sections=lastRaw.match(/Before:\n([\s\S]*?)\nRetained after:\n([\s\S]*?)(?=\n(?:Removed selected work|Retained credited duration))/);
    if(sections){const grid=make('div','','correction-comparison');for(const [title,lines] of [['Before',sections[1]],['After',sections[2]]]){const col=make('div');col.append(make('h4',title));for(const line of lines.split('\n')){const dates=[...line.matchAll(/\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})/g)].map(m=>m[0]);if(dates.length>=2)col.append(make('p',`${format(dates[0])} → ${format(dates[1])}`));}grid.append(col);}beforeAfter.append(grid);}
    const removed=lastRaw.match(/Removed selected work: ([\d.]+)s/);if(removed)beforeAfter.append(make('p',`${(Number(removed[1])/60).toLocaleString(undefined,{maximumFractionDigits:2})} minutes of selected work removed.`));
    const warnings=lastRaw.split('\n').filter(line=>line&&!/^(Signed local context:|Accepted cutoff:|Before:|Retained after:|Removed selected work:|Retained credited duration at cutoff:)/.test(line)&&!line.includes(' → ')&&!line.startsWith('If recording continues'));
    if(warnings.length)beforeAfter.append(make('p',warnings.join('\n'),'correction-visible-warnings'));
    beforeAfter.append(make('p','Later recording is not included in this preview. Plans and pause state stay unchanged.','correction-preview-note'));
   }
  }
  if(message.textContent.startsWith('Preview refused:')&&!needsInitialization)advanced.open=true;
 }
 kind.addEventListener('change',update);
 new MutationObserver(update).observe(choices,{childList:true,subtree:true});new MutationObserver(update).observe(raw,{childList:true,characterData:true,subtree:true});new MutationObserver(update).observe(message,{childList:true,characterData:true,subtree:true});dialog.addEventListener('toggle',update);update();
 }
 new MutationObserver(decorate).observe(document.body,{childList:true});decorate();
}
function begin(){focusCards();correctionDialog();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',begin);else begin();
})();

/* Round five THROWAWAY reporting presentation; existing context controller owns epochs/receipts. */
(() => {
if(location.pathname!=='/timer-settings'||document.documentElement.dataset.layout==='A')return;
const make=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
function start(){
 const controller=window.goalReportingContext,host=document.querySelector('[data-report-settings-host]'),legacy=host?.querySelector('details');
 if(!controller||!legacy){setTimeout(start,40);return;}
 const outer=document.getElementById('report-settings');outer.querySelector(':scope > summary').textContent='Reporting preferences';
 const recovery=make('details','','reporting-recovery');recovery.append(make('summary','History & recovery details'));host.append(recovery);recovery.append(legacy);legacy.open=true;legacy.querySelector('summary').textContent='Saved reporting history';
 const native=legacy.querySelector('select');native.hidden=true;
 const oldButtons=[...legacy.querySelectorAll('button')];oldButtons[0].hidden=true;oldButtons[1].textContent='Refresh latest settings';oldButtons[2].textContent='Keep my choice with latest settings';oldButtons[3].textContent='Cancel pending choice';
 const row=make('div','','reporting-preference-row'),info=make('div'),title=make('strong'),zone=make('small');info.append(title,zone);const edit=make('button','Edit');edit.type='button';edit.setAttribute('aria-label','Edit reporting week start');row.append(info,edit);host.prepend(row);
 const editor=make('section','','reporting-preference-editor');editor.hidden=true;editor.append(make('h3','Start the week on'),make('p','Used for goals and weekly reviews. Changes affect current and future periods; completed earlier periods keep their settings.'));
 const days=make('div','','reporting-weekdays');days.setAttribute('role','group');days.setAttribute('aria-label','First day of reporting week');
 const names=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
 for(const value of [1,2,3,4,5,6,0]){const b=make('button',names[value].slice(0,3));b.type='button';b.dataset.weekday=String(value);b.setAttribute('aria-label',names[value]);b.onclick=()=>{controller.edit(value);render();};days.append(b);}
 const actions=make('div','','reporting-preference-actions'),save=make('button','Save changes','goal-primary'),cancel=make('button','Cancel');save.type=cancel.type='button';actions.append(save,cancel);editor.append(days,actions);row.after(editor);
 const status=make('p','','reporting-preference-status');status.setAttribute('role','status');editor.after(status);
 let lastSavedMessage='';
 function render(){const state=controller.snapshot(),current=state.context,uncertain=state.journal?.outcome==='uncertain';
  title.textContent=current?`Week starts ${names[current.first_day_of_week]}`:'Reading reporting preferences…';zone.textContent=current?`Time zone · ${current.timezone}`:'';
  const selected=state.draft?.first_day_of_week??current?.first_day_of_week;
  for(const b of days.children){b.setAttribute('aria-pressed',String(Number(b.dataset.weekday)===selected));b.disabled=state.pending||state.blocked||uncertain;}
  edit.disabled=state.pending||state.blocked||!current;
  save.textContent=uncertain?'Confirm earlier save':'Save changes';save.disabled=state.pending||state.blocked||(!uncertain&&(!state.draft||state.draft.first_day_of_week===current?.first_day_of_week));cancel.disabled=state.pending||uncertain;
  status.textContent=state.pending?'Saving…':state.message.startsWith('Reporting epoch saved.')?'Saved. Completed earlier periods keep their original settings.':state.message;
  if(uncertain){editor.hidden=false;recovery.open=true;}
  if(!state.pending&&!state.draft&&state.message.startsWith('Reporting epoch saved.')&&lastSavedMessage!==state.message){editor.hidden=true;lastSavedMessage=state.message;}
 }
 edit.onclick=()=>{editor.hidden=false;render();};cancel.onclick=()=>{if(controller.cancel()){editor.hidden=true;render();}};
 save.onclick=async()=>{if(save.disabled)return;const promise=controller.save();render();await promise;render();if(!controller.snapshot().draft&&!controller.snapshot().pending)editor.hidden=true;};
 new MutationObserver(render).observe(legacy,{childList:true,subtree:true});window.addEventListener('timetrace:goals-mutated',render);render();if(controller.snapshot().draft)editor.hidden=false;
 outer.dataset.friendlyReporting='true';if(location.hash==='#report-settings')outer.open=true;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();

/* Round six THROWAWAY: one primary Save; existing note draft/ACK handlers remain unchanged. */
(() => {
if(location.pathname!=='/agenda-view'||document.documentElement.dataset.layout==='A')return;
function start(){
 const root=document.getElementById('workspace-current-note');if(!root||!window.multipleTimers){setTimeout(start,40);return;}
 function update(){
  const buttons=root.querySelectorAll('button'),save=buttons[0],reload=buttons[1];if(!save||!reload)return;
  let toolbar=save.closest('.friendly-note-actions');
  if(!toolbar){
   toolbar=document.createElement('div');toolbar.className='friendly-note-actions';save.before(toolbar);toolbar.append(save);
   const state=document.createElement('span');state.className='note-save-state';state.setAttribute('aria-live','polite');toolbar.append(state);
   const menu=document.createElement('details');menu.className='note-secondary-actions';const summary=document.createElement('summary');summary.textContent='More';summary.setAttribute('aria-label','More note actions');menu.append(summary,reload);toolbar.append(menu);
   reload.textContent='Discard my changes';reload.title='Discard unsaved typing and restore the latest saved note.';reload.addEventListener('click',()=>{menu.open=false;});save.classList.add('friendly-note-save');
  }
  const snapshot=multipleTimers.snapshot(),dirty=Boolean(multipleTimers.hasNoteDraft?.(snapshot.selectedTimerId)),saving=Boolean(snapshot.pending&&snapshot.receipt?.url?.endsWith('/note'));
  const label=saving?'Saving…':'Save';if(save.textContent!==label)save.textContent=label;save.classList.toggle('is-dirty',dirty);
  const status=saving?'Saving…':dirty?'Unsaved changes':snapshot.fresh?'Saved':'Last saved state';const state=toolbar.querySelector('.note-save-state');if(state.textContent!==status)state.textContent=status;
  toolbar.querySelector('details').hidden=!dirty;
 }
 new MutationObserver(update).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});window.addEventListener('timetrace:timer-state',update);root.addEventListener('input',()=>queueMicrotask(update));update();root.dataset.friendlyNote='true';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
