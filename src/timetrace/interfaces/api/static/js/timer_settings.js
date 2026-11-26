/** Dedicated settings views. Domain controllers retain ownership of drafts, revisions and exact retries. */
function settingsNode(tag,text='',className='') {
    const node=document.createElement(tag);node.textContent=text;node.className=className;return node;
}
function settingsDuration(seconds) {
    if(!Number.isFinite(seconds))return 'Unavailable';
    const minutes=Math.round(seconds/60);return `${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,'0')}m`;
}
function mountReportingSettings(root,api,storage) {
    const get=name=>root.querySelector(`[data-report-${name}]`);
    const names=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const days=get('days'),editor=get('editor'),save=get('save'),message=get('message');
    let controller;
    function render(state) {
        const context=state.context,uncertain=state.journal?.outcome==='uncertain';
        get('summary').textContent=context?`Week starts ${names[context.first_day_of_week]}`:'Reporting preferences unavailable';
        get('zone').textContent=context?`Time zone · ${context.timezone}`:'';
        get('history').textContent=context?`Saved revision ${context.revision}. Earlier contexts: ${(context.epochs||[]).map(e=>`${e.timezone}, week starts ${names[e.first_day_of_week]}`).join('; ')||'none'}. Completed earlier periods keep their settings; totals across contexts are not additive.`:'';
        const selected=state.draft?.first_day_of_week??context?.first_day_of_week;
        for(const button of days.children){button.setAttribute('aria-pressed',String(Number(button.dataset.day)===selected));button.disabled=state.pending||state.blocked||uncertain||!context;}
        get('edit').disabled=state.pending||state.blocked||!context;
        save.textContent=uncertain?'Confirm earlier save':'Save changes';
        save.disabled=state.pending||state.blocked||(!uncertain&&(!state.draft||state.draft.first_day_of_week===context?.first_day_of_week));
        get('cancel').disabled=state.pending||uncertain;
        get('rebase').disabled=state.pending||uncertain||!state.draft;
        message.textContent=state.pending?'Saving…':state.message.startsWith('Reporting epoch saved.')?'Saved. Completed earlier periods keep their original settings.':state.message;
        if(uncertain){editor.hidden=false;get('recovery').open=true;}
    }
    controller=createGoalContextController({api,storage,onState:render});
    for(const day of [1,2,3,4,5,6,0]){const button=settingsNode('button',names[day].slice(0,3));button.type='button';button.dataset.day=String(day);button.setAttribute('aria-label',names[day]);button.addEventListener('click',()=>controller.edit(day));days.append(button);}
    get('edit').addEventListener('click',()=>{editor.hidden=false;render(controller.snapshot());});
    get('cancel').addEventListener('click',()=>{if(controller.cancel())editor.hidden=true;});
    save.addEventListener('click',async()=>{if(save.disabled)return;await controller.save();if(!controller.snapshot().draft&&!controller.snapshot().pending)editor.hidden=true;});
    get('refresh').addEventListener('click',()=>controller.refresh());get('rebase').addEventListener('click',()=>controller.rebase());
    window.addEventListener('beforeunload',event=>{if(controller.snapshot().draft){event.preventDefault();event.returnValue='';}});
    window.addEventListener('timetrace:goals-mutated',()=>controller.refresh());
    render(controller.snapshot());if(controller.snapshot().draft)editor.hidden=false;void controller.refresh();return controller;
}
function mountGoalSettings(root,api,storage,contextController) {
    const get=name=>root.querySelector(`[data-goal-${name}]`),form=get('form');
    const fields=Object.fromEntries(['owner','hours','cadence','descendants','enabled','start_date'].map(name=>[name,form.elements.namedItem(name)]));
    let controller,tasks=[],tasksReady=false,formKey=null,summaryKey=null,taskRead=0,taskMessage='';
    form.noValidate=true;let targetScale=3600,targetText='',targetBaseline=null;
    const targetSeconds=()=>fields.hours.value===targetText?targetBaseline:fields.hours.value===''?null:Number(fields.hours.value)*targetScale;
    const title=goal=>goal.owner_kind==='global'?'All activities':goal.task_title||tasks.find(t=>t.id===goal.task_id)?.title||'Unavailable activity';
    function loadFields(draft,goal) {
        const settings={...goal,...draft};fields.owner.value=settings.owner_kind==='global'?'global':settings.task_id||'';
        if(fields.owner.value===''&&settings.task_id){const option=settingsNode('option',settings.task_title||'Activity name awaiting refresh');option.value=settings.task_id;fields.owner.append(option);fields.owner.value=settings.task_id;}
        fields.owner.disabled=Boolean(draft.id);fields.cadence.value=settings.cadence||'day';fields.cadence.disabled=Boolean(draft.id);
        targetBaseline=draft.target_seconds??null;targetScale=targetBaseline>0&&targetBaseline/3600===0?1:3600;
        fields.hours.value=targetBaseline==null?'':targetBaseline/targetScale;targetText=fields.hours.value;get('target-unit').textContent=targetScale===1?'Target seconds':'Target hours';
        fields.enabled.checked=draft.enabled??true;fields.descendants.checked=Boolean(draft.include_descendants);fields.start_date.value=draft.start_date||'';
    }
    function render(state) {
        const uncertain=state.journal?.outcome==='uncertain';
        const message=state.pending?'Saving…':state.message.startsWith('Goal settings revision ')?(state.draft?'Submitted settings saved. Your current draft is still unsaved.':state.fresh?'Goal saved.':'Goal saved. Refreshing progress…'):state.message;
        get('message').textContent=[message,taskMessage].filter(Boolean).join(' ');
        get('request').textContent=state.journal?`Retained ${state.journal.outcome} settings request. Target: ${state.journal.payload.target_seconds} seconds; enabled: ${state.journal.payload.enabled}; include children: ${state.journal.payload.include_descendants}. Exact retry confirms this request only, not newer typing.`:'No retained request.';
        get('rebase').disabled=state.pending||uncertain||!state.draft;
        get('add').disabled=state.pending||state.blocked||Boolean(state.draft)||uncertain;
        if(uncertain)get('recovery').open=true;
        const signature=JSON.stringify([state.fresh,state.goals,tasks.map(t=>[t.id,t.title])]);
        if(signature!==summaryKey){summaryKey=signature;const list=get('list');list.replaceChildren();
            if(!state.goals.length)list.append(settingsNode('p',state.fresh?'No goals yet. Add a target when you want one.':'Reading goals…'));
            for(const goal of state.goals){
                const card=settingsNode('article','','settings-card');card.setAttribute('aria-label',`${title(goal)} goal`);
                const heading=settingsNode('header'),label=settingsNode('div');label.append(settingsNode('h3',title(goal)),settingsNode('small',goal.owner_kind==='global'?'All recorded activities':goal.include_descendants?'Includes child activities':'Selected activity only'));
                const edit=settingsNode('button','Edit');edit.type='button';edit.setAttribute('aria-label',`Edit ${title(goal)} goal`);edit.addEventListener('click',()=>controller.edit(goal.id));heading.append(label,edit);
                const hours=goal.target_seconds/3600;const target=goal.target_seconds>0&&hours<0.001?`${goal.target_seconds.toExponential(3)} seconds`:`${hours.toLocaleString(undefined,{maximumFractionDigits:3})} ${hours===1?'hour':'hours'}`;
                card.append(heading,settingsNode('p',`${target} ${goal.cadence==='day'?'per day':goal.cadence==='week'?'per week':'in total'}`,'goal-target'));
                const progress=settingsNode('progress');progress.max=goal.target_seconds;progress.value=Math.min(goal.target_seconds,goal.summed_recorded_work_seconds||0);progress.setAttribute('aria-label',`${title(goal)} summed recorded-work progress`);card.append(progress);
                card.append(settingsNode('p',`${settingsDuration(goal.summed_recorded_work_seconds)} recorded · ${goal.percentage_display||'unavailable'} · ${goal.enabled?'Enabled':'Paused'}`));
                if(!state.fresh)card.append(settingsNode('small','Last-read progress; authoritative refresh pending.'));
                if(goal.context?.warnings?.length)card.append(settingsNode('p',goal.context.warnings.join(' '),'settings-warning'));
                list.append(card);
            }
        }
        form.hidden=!state.draft;if(!state.draft){formKey=null;return;}
        const goal=state.goals.find(g=>g.id===state.draft.id),key=state.draft.id||'new';
        if(formKey!==key){formKey=key;loadFields(state.draft,goal);}
        get('editor-title').textContent=state.draft.id?`Edit ${title({...goal,...state.draft})} goal`:'New goal';
        const global=fields.owner.value==='global';fields.descendants.disabled=global;
        fields.cadence.querySelector('[value="total"]').disabled=global;
        get('start').hidden=fields.cadence.value!=='total';
        get('help').textContent=state.draft.id?'Adjust the target directly. The saved activity and repeat period stay the same.':'Choose an activity or All activities. Include child activities to set a task-group target.';
        const save=form.querySelector('button[type="submit"]');save.textContent=uncertain?'Confirm earlier save':'Save goal';save.disabled=state.pending||state.blocked||(!uncertain&&!state.draft.id&&state.draft.owner_kind==='task'&&(!tasksReady||!tasks.some(t=>t.id===state.draft.task_id)));
        get('cancel').disabled=state.pending||uncertain;
    }
    controller=createGoalController({api,storage,onState:render});window.personalGoals=controller;
    function input(){const current=controller.snapshot().draft;if(!current)return;
        const global=fields.owner.value==='global';if(global&&fields.cadence.value==='total')fields.cadence.value='day';if(global)fields.descendants.checked=false;
        const values={target_seconds:targetSeconds(),enabled:fields.enabled.checked,include_descendants:!global&&fields.descendants.checked,start_date:fields.cadence.value==='total'?(fields.start_date.value||null):null};
        if(!current.id)Object.assign(values,{owner_kind:global?'global':'task',task_id:global?null:fields.owner.value||(!tasksReady?current.task_id:null)||null,cadence:fields.cadence.value});
        controller.edit(current.id,values);
    }
    form.addEventListener('input',input);form.addEventListener('change',input);
    get('add').addEventListener('click',()=>{const context=contextController.snapshot().context;controller.edit(null,{owner_kind:'task',task_id:null,cadence:'day',target_seconds:null,enabled:true,include_descendants:false,first_day_of_week:context?.first_day_of_week,timezone:context?.timezone});});
    get('cancel').addEventListener('click',()=>controller.cancel());get('refresh').addEventListener('click',()=>{void readTasks();void controller.refresh();});
    get('rebase').addEventListener('click',()=>controller.rebase());
    form.addEventListener('submit',async event=>{event.preventDefault();if(controller.snapshot().journal?.outcome==='uncertain'){await controller.save();return;}if(!form.reportValidity())return;const seconds=targetSeconds();if(!Number.isFinite(seconds)||seconds<=0){fields.hours.setCustomValidity('Enter a positive finite target.');form.reportValidity();fields.hours.setCustomValidity('');return;}input();await controller.save();});
    window.addEventListener('beforeunload',event=>{const state=controller.snapshot();if(state.draft||state.journal?.outcome==='uncertain'){event.preventDefault();event.returnValue='';}});
    for(const event of ['timetrace:timer-mutated','timetrace:goals-mutated','timetrace:tasks-mutated','timetrace:work-mutated','timetrace:history-mutated'])window.addEventListener(event,()=>controller.refresh(true));
    async function readTasks(){const generation=++taskRead;tasksReady=false;render(controller.snapshot());
        try{const rows=await api.get('/api/tasks');if(generation!==taskRead)return;if(!Array.isArray(rows))throw Error('Unrecognized activity response');
            tasks=rows;tasksReady=true;taskMessage='';const selected=fields.owner.value,previous=fields.owner.selectedOptions?.[0]?.textContent;
            fields.owner.replaceChildren();for(const [value,text] of [['','Choose an activity…'],['global','All activities'],...rows.map(t=>[t.id,t.title])]){const option=settingsNode('option',text);option.value=value;fields.owner.append(option);}
            if(selected&&selected!=='global'&&!rows.some(t=>t.id===selected)){const option=settingsNode('option',previous||'Unavailable activity');option.value=selected;fields.owner.append(option);}fields.owner.value=selected;
        }catch(_){if(generation!==taskRead)return;taskMessage='Activity names unavailable. Retained selection and draft; refresh reads only.';}
        render(controller.snapshot());
    }
    window.addEventListener('timetrace:tasks-mutated',()=>void readTasks());void readTasks();
    render(controller.snapshot());void controller.refresh();const interval=setInterval(()=>controller.refresh(),30000);window.addEventListener('pagehide',()=>clearInterval(interval),{once:true});return controller;
}
async function mountFocusSettings(root,control,api) {
    const focus=await window.timerFocusReady;if(!focus)return;
    const get=name=>root.querySelector(`[data-focus-${name}]`),form=get('form'),scope=get('scope'),picker=get('timer');
    const fields=Object.fromEntries(['enabled','work_minutes','break_minutes','behavior','sound_enabled'].map(name=>[name,form.elements.namedItem(name)]));
    let defaults=null,loadedKey=null,read=0,timerOptions='',retainedSignature='';const knownTitles=new Map();
    const selected=()=>control.snapshot().timers.find(t=>t.id===control.snapshot().selectedTimerId);
    const ownDraft=()=>scope.value==='defaults'?focus.hasDefaultsDraft():focus.hasTimerDraft(selected()?.id);
    function load(values){fields.enabled.checked=Boolean(values?.enabled);fields.work_minutes.value=values?.work_minutes??'';fields.break_minutes.value=values?.break_minutes??'';fields.behavior.value=values?.behavior||'notify_only';fields.sound_enabled.checked=Boolean(scope.value==='defaults'?(values?.sound_enabled??defaults?.sound_enabled):defaults?.sound_enabled);}
    function values(){return {enabled:fields.enabled.checked,work_minutes:Number(fields.work_minutes.value),break_minutes:Number(fields.break_minutes.value),behavior:fields.behavior.value,sound_enabled:fields.sound_enabled.checked};}
    function render(){const state=control.snapshot(),timer=selected(),global=scope.value==='defaults',saved=global?defaults:timer?.focus?.settings,key=global?'defaults':timer?.id;
        for(const t of state.timers)knownTitles.set(t.id,t.task_title||t.notes||'Unassigned timer');
        const options=JSON.stringify(state.timers.map(t=>[t.id,t.task_title]));if(options!==timerOptions){timerOptions=options;picker.replaceChildren();for(const t of state.timers){const option=settingsNode('option',t.task_title||'Unassigned');option.value=t.id;picker.append(option);}}picker.value=timer?.id||'';get('timer-label').hidden=global;
        const blocked=state.pending||Boolean(state.receipt)||!state.fresh;
        const hasDraft=ownDraft(),draft=global?focus.defaultsDraft():focus.draft(timer?.id);
        if(key!==loadedKey||!hasDraft){loadedKey=key;load(draft||saved);}
        fields.sound_enabled.disabled=!global;
        get('enabled').textContent=saved?(saved.enabled?'On':'Off'):'Unavailable';get('enabled').className='focus-enabled'+(saved?.enabled?' is-on':'');
        const periods=get('periods');periods.replaceChildren();for(const [minutes,label] of [[saved?.work_minutes,'Work'],[saved?.break_minutes,'Break']]){const col=settingsNode('div');col.append(settingsNode('strong',minutes==null?'—':`${minutes} min`),settingsNode('small',label));periods.append(col);}
        get('behavior').textContent=!saved?'Read saved settings before editing.':saved.behavior==='automatic_break'?'When time is up: pause this timer for a break.':'When time is up: notify me and keep recording.';
        get('draft').textContent=hasDraft?'Unsaved changes kept':focus.hasDraft()?'Other unsaved settings retained':'';get('edit').disabled=blocked||!saved;
        const retained=focus.timerDraftIds().filter(id=>global||id!==timer?.id).map(id=>({id,title:knownTitles.get(id)||'Unavailable timer',values:focus.draft(id),present:state.timers.some(t=>t.id===id)}));
        const defaultsElsewhere=!global&&focus.hasDefaultsDraft();get('retained').hidden=!retained.length&&!defaultsElsewhere;
        const signature=JSON.stringify([retained,defaultsElsewhere,blocked]);if(signature!==retainedSignature){retainedSignature=signature;const list=get('retained-list');list.replaceChildren();
            if(defaultsElsewhere){const row=settingsNode('div','Future defaults · unsaved changes'),button=settingsNode('button','Edit');button.type='button';button.disabled=blocked;button.addEventListener('click',()=>{scope.value='defaults';scope.dispatchEvent(new Event('change'));form.hidden=false;});row.append(button);list.append(row);}
            for(const item of retained){const row=settingsNode('div',`${item.title} · ${item.values.work_minutes} min work / ${item.values.break_minutes} min break · unsaved`),button=settingsNode('button',item.present?'Edit':'Discard draft');button.type='button';button.disabled=blocked;
                button.addEventListener('click',()=>{if(item.present){control.select(item.id);scope.value='timer';scope.dispatchEvent(new Event('change'));form.hidden=false;}else{focus.reset(item.id);render();}});row.append(button);list.append(row);}
        }
        form.querySelector('button[type="submit"]').disabled=blocked||!saved;get('reset').disabled=blocked;
        get('initialize').hidden=global||!timer||Boolean(timer.focus);get('initialize').disabled=blocked;
        const capability=focus.snapshot();get('capability').textContent=(capability.capability?.reason||'Reading notification capability…')+' '+capability.deliveryMessage;
    }
    function adopt(saved){if(!defaults||saved.revision>=defaults.revision)defaults=saved;}
    async function readDefaults(){const generation=++read;const saved=await api.get('/timer-focus/defaults').catch(()=>null);if(generation!==read)return;if(saved)adopt(saved);else get('message').textContent='Defaults unavailable. Retry reading settings; no write sent.';render();}
    scope.addEventListener('change',()=>{loadedKey=null;render();if(scope.value==='defaults')void readDefaults();});
    picker.addEventListener('change',()=>control.select(picker.value));get('edit').addEventListener('click',()=>{form.hidden=false;render();});get('close').addEventListener('click',()=>{form.hidden=true;});
    form.addEventListener('input',()=>{if(scope.value==='defaults'){if(defaults)focus.editDefaults(values(),defaults);}else {const t=selected();if(t?.focus)focus.edit(t.id,values());}render();});
    form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;
        const global=scope.value==='defaults',timer=selected(),key=global?'defaults':timer?.id;
        if(global&&!defaults||!global&&!timer?.focus)return;
        try{if(global)focus.editDefaults(values(),defaults);else focus.edit(timer.id,values());
            const promise=global?focus.saveDefaults(defaults,adopt):focus.saveTimer();render();const ok=await promise;
            if(ok){get('message').textContent=global?'Future defaults saved. Existing timers are unchanged.':`Focus settings saved for ${timer.task_title||'Unassigned'}. Current period timing is unchanged.`;
                if((scope.value==='defaults'?'defaults':selected()?.id)===key&&!ownDraft())form.hidden=true;
            }else get('message').textContent=control.snapshot().message||'Settings not confirmed. Keep the draft and recover the retained timer operation.';
        }catch(error){get('message').textContent=error.message||'Settings unavailable. Keep the draft and recover the retained operation.';}render();
    });
    get('reset').addEventListener('click',async()=>{const global=scope.value==='defaults',timer=selected(),key=global?'defaults':timer?.id,draft=global?focus.defaultsDraft():focus.draft(timer?.id);
        if(global){const generation=++read,saved=await api.get('/timer-focus/defaults').catch(()=>null);if(!saved||generation!==read||scope.value!=='defaults'||focus.defaultsDraft()!==draft)return;adopt(saved);focus.resetDefaults();}
        else if(timer&&scope.value==='timer'&&selected()?.id===key)focus.reset(timer.id);
        loadedKey=null;render();
    });
    get('initialize').addEventListener('click',async()=>{await control.initializeFocus();render();});
    get('permission').addEventListener('click',async()=>{await focus.requestPermission();get('message').textContent='Browser permission requested. Closed-page delivery still depends on the daemon desktop adapter.';render();});
    window.addEventListener('timetrace:timer-state',render);window.addEventListener('timetrace:focus-state',render);render();void readDefaults();
}

if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',()=>{
    const goalRoot=document.querySelector('[data-goal-settings]');if(!goalRoot)return;
    const context=mountReportingSettings(document.querySelector('[data-report-settings]'),api,sessionStorage);window.goalReportingContext=context;
    mountGoalSettings(goalRoot,api,sessionStorage,context);
    void (async()=>{await window.multipleTimersReady;await mountFocusSettings(document.querySelector('[data-focus-settings]'),window.multipleTimers,api);})();
    for(const button of document.querySelectorAll('[data-timer-tab]'))button.addEventListener('click',()=>{
        for(const tab of document.querySelectorAll('[data-timer-tab]'))tab.setAttribute('aria-pressed',String(tab===button));
        for(const panel of document.querySelectorAll('[data-timer-panel]'))panel.hidden=panel.dataset.timerPanel!==button.dataset.timerTab;
        const url=new URL(location.href);url.searchParams.set('tab',button.dataset.timerTab);history.replaceState(null,'',url);
    });
    if(new URLSearchParams(location.search).get('tab')==='focus')document.querySelector('[data-timer-tab="focus"]').click();
});
