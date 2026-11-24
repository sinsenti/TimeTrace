/** Focus is server-authoritative; this controller only edits drafts and claims delivery. */
function createFocusController({control,api,notifications=typeof Notification==='undefined'?null:Notification,operationId=()=>crypto.randomUUID()}) {
    const drafts=new Map(),defaultsKey=Symbol('focus defaults'); let notices=[],capability=null,busy=false,deliveryMessage='';
    const timer=id=>control.snapshot().timers.find(t=>t.id===id);
    const selected=()=>timer(control.snapshot().selectedTimerId);
    const draft=id=>drafts.get(id)?.values||timer(id)?.focus?.settings;
    function edit(id,values,baseline,revision){
        const current=drafts.get(id);
        drafts.set(id,{lineage:current?.lineage??{},revision:current?.revision??revision,values:{...(current?.values||baseline),...values}});
    }
    function acknowledgeDraft(id,submitted,revision){
        const current=drafts.get(id);
        if(!submitted||current?.lineage!==submitted.lineage||!Number.isInteger(revision))return;
        if(current===submitted)drafts.delete(id);
        else current.revision=revision; // Rebase newer typing only on this write's ACK, never a polling revision.
    }
    return {
        selected,draft,hasDraft:()=>drafts.size>0,
        reset:id=>drafts.delete(id),
        edit(id,values){const t=timer(id);edit(id,values,t?.focus?.settings,t?.revision);},
        saveTimer(){const t=selected(); if(!t)return false; const p=draft(t.id),submitted=drafts.get(t.id);
            return control.act(t.id,'focus-settings',{
                expected_revision:submitted?.revision??t.revision,enabled:p.enabled,work_minutes:p.work_minutes,break_minutes:p.break_minutes,behavior:p.behavior
            },result=>{if(result.timer?.id===t.id)acknowledgeDraft(t.id,submitted,result.timer.revision);});},
        defaultsDraft:()=>drafts.get(defaultsKey)?.values,
        resetDefaults:()=>drafts.delete(defaultsKey),
        editDefaults(values,baseline){edit(defaultsKey,values,baseline,baseline?.revision);},
        saveDefaults(baseline,onAcknowledged=()=>{}){const submitted=drafts.get(defaultsKey);
            return control.saveFocusDefaults({...baseline,...submitted?.values,expected_revision:submitted?.revision??baseline.revision},result=>{
                if(!result.focus_defaults)return;
                acknowledgeDraft(defaultsKey,submitted,result.focus_defaults.revision);
                onAcknowledged(result.focus_defaults);
            });},
        action(action){const t=selected(); if(!t?.focus)return false; return control.act(t.id,'focus-action',{
            expected_revision:t.revision,expected_generation:t.focus.generation,action});},
        async requestPermission(){if(!notifications){deliveryMessage='Browser notifications unavailable; in-app fallback.';return;}
            try {await notifications.requestPermission();}catch(_){deliveryMessage='Browser permission unavailable; in-app fallback.';}},
        snapshot:()=>({notices,capability,deliveryMessage}),
        async acknowledge(id){await api.post(`/timer-notifications/${encodeURIComponent(id)}/ack`,{});},
        async refreshNotices(){if(busy)return;busy=true;
            try {
                const [events,cap,defaults]=await Promise.all([api.get('/timer-notifications'),api.get('/timer-notifications/capability'),api.get('/timer-focus/defaults')]);
                notices=events.notices;capability=cap;
                if(defaults.sound_enabled&&cap.available&&!cap.sound_supported)deliveryMessage='This desktop server does not advertise sound support; visible notification only.';
                for(const n of notices.filter(n=>n.status==='pending'&&!n.acknowledged)){
                    if(cap.available)continue;
                    const browser=notifications?.permission==='granted';
                    if(defaults.sound_enabled&&!browser)deliveryMessage='Sound unavailable for in-app fallback; desktop/browser permission is required. Recording unchanged.';
                    let claim;
                    try {claim=await api.post(`/timer-notifications/${encodeURIComponent(n.id)}/claim`,{operation_id:operationId(),channel:browser?'browser':'in_app'});}catch(_){continue;}
                    if(!claim.send_authorized)continue;
                    let outcome='accepted';
                    if(browser){
                        try {new notifications(n.kind==='two_hour'?'Two-hour timer warning':n.kind==='break_due'?'Break complete — resume explicitly':'Focus period complete',{
                            body:`Timer ${n.timer_id.slice(-8)}. Review TimeTrace for actions.`,tag:n.id,silent:!defaults.sound_enabled});}
                        catch(_){outcome='failed';deliveryMessage='Browser delivery failed; durable in-app fallback. No automatic retry.';}
                    }
                    try {await api.post(`/timer-notifications/${encodeURIComponent(n.id)}/result`,{claim_token:claim.claim_token,outcome});}catch(_){deliveryMessage='Delivery uncertain; no automatic re-alert.';}
                }
            }catch(_){deliveryMessage='Notification status unavailable; recording is unchanged.';}finally{busy=false;}
        }
    };
}
if(typeof module!=='undefined')module.exports={createFocusController};

if(typeof window!=='undefined')document.addEventListener('DOMContentLoaded',async()=>{
    await window.multipleTimersReady;
    const control=window.multipleTimers;if(!control)return;
    const region=document.createElement('section');region.className='timer-focus-panel';region.setAttribute('aria-label','Focus and notifications');
    const host=document.getElementById('workspace-current-timer')||document.getElementById('multiple_timers');if(!host)return;
    host.append(region);
    const heading=document.createElement('h3');heading.textContent='Focus and breaks';region.append(heading);
    const clock=document.createElement('p'),warning=document.createElement('p'),actions=document.createElement('div');actions.className='focus-actions';
    const notices=document.createElement('div');notices.setAttribute('aria-live','polite');
    region.append(clock,warning,actions);
    const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Focus settings';detail.append(summary);region.append(detail);
    const form=document.createElement('form');form.className='focus-settings';detail.append(form);
    function input(label,type,name){const wrapper=document.createElement('label');wrapper.textContent=label;const field=document.createElement('input');field.type=type;field.name=name;
        if(type==='number'){field.min='1';field.max='1440';field.step='1';field.required=true;}wrapper.append(field);form.append(wrapper);return field;}
    const enabled=input('Enable focus','checkbox','enabled'),work=input('Work minutes','number','work_minutes'),pause=input('Break minutes','number','break_minutes');
    const behavior=document.createElement('select');behavior.setAttribute('aria-label','Focus behavior');behavior.name='behavior';
    for(const [value,text]of[['notify_only','Notify only (keep recording)'],['automatic_break','Automatically pause at a live boundary']]){const o=document.createElement('option');o.value=value;o.textContent=text;behavior.append(o);}form.append(behavior);
    const scope=document.createElement('select');scope.setAttribute('aria-label','Settings scope');for(const [v,t]of[['timer','Selected timer overrides'],['defaults','Saved defaults for future timers']]){const o=document.createElement('option');o.value=v;o.textContent=t;scope.append(o);}form.append(scope);
    const sound=input('Sound (saved global preference; OS may silence it)','checkbox','sound_enabled');
    const explanation=document.createElement('p');explanation.textContent='Edits apply to subsequent periods; disabling cancels focus/break without resuming. Defaults affect future timers only. Sound is global.';form.append(explanation);
    const save=document.createElement('button');save.type='submit';save.textContent='Save focus settings';form.append(save);
    const message=document.createElement('p');region.append(message);
    function button(label,handler){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',handler);return b;}
    const focus=createFocusController({control,api});let loaded=null,defaults=null,scopeRead=0;
    const previousDraft=control.hasFocusDraft;control.hasFocusDraft=()=>focus.hasDraft()||Boolean(previousDraft?.());
    window.addEventListener('beforeunload',event=>{if(control.hasFocusDraft()){event.preventDefault();event.returnValue='';}});
    function values(){return {enabled:enabled.checked,work_minutes:Number(work.value),break_minutes:Number(pause.value),behavior:behavior.value,sound_enabled:sound.checked};}
    function load(p){enabled.checked=Boolean(p?.enabled);work.value=p?.work_minutes??25;pause.value=p?.break_minutes??5;behavior.value=p?.behavior||'notify_only';sound.checked=Boolean(scope.value==='defaults'?(p?.sound_enabled??defaults?.sound_enabled):defaults?.sound_enabled);sound.disabled=scope.value!=='defaults';}
    function adoptDefaults(saved){if(!defaults||saved.revision>=defaults.revision)defaults=saved;}
    function loadScope(){loaded=focus.selected()?.id;load(scope.value==='defaults'?(focus.defaultsDraft()||defaults):focus.draft(loaded));}
    form.addEventListener('input',event=>{
        if(event.target===scope)return;
        if(scope.value==='timer'){const t=focus.selected();if(t)focus.edit(t.id,values());}
        else focus.editDefaults(values(),defaults);
    });
    scope.addEventListener('change',async()=>{
        const own=++scopeRead;loadScope();render();
        if(scope.value!=='defaults')return;
        const saved=await api.get('/timer-focus/defaults').catch(()=>null);
        if(!saved||own!==scopeRead)return;
        adoptDefaults(saved);if(!focus.defaultsDraft())loadScope();render();
    });
    form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;try{
        if(scope.value==='defaults'){
            if(!defaults)return;
            focus.editDefaults(values(),defaults);
            if(!await focus.saveDefaults(defaults,adoptDefaults))return;
        }else{
            const t=focus.selected();if(!t)return;focus.edit(t.id,values());
            if(!await focus.saveTimer())return;
        }
        message.textContent='Settings acknowledged. Existing period timing is unchanged.';
    }catch(_){message.textContent='Settings status unavailable. Recover the shared saved operation; do not submit a new request blindly.';}render();});
    form.append(button('Use current saved focus settings',async()=>{
        const t=focus.selected();
        if(scope.value==='timer'){if(t){focus.reset(t.id);load(t.focus?.settings);}return;}
        const own=++scopeRead,draft=focus.defaultsDraft();
        const saved=await api.get('/timer-focus/defaults').catch(()=>null);
        if(!saved||scope.value!=='defaults'||scopeRead!==own||focus.defaultsDraft()!==draft)return;
        adoptDefaults(saved);focus.resetDefaults();loadScope();
    }));
    region.append(button('Allow browser notifications (open page only)',async()=>{await focus.requestPermission();message.textContent='Browser permission: '+(typeof Notification==='undefined'?'unavailable':Notification.permission)+'. Closed-page delivery requires the daemon desktop adapter.';}));
    region.append(notices);
    function render(){const state=control.snapshot(),t=focus.selected(),f=t?.focus;const blocked=state.pending||Boolean(state.receipt)||!state.fresh;
        if(loaded!==t?.id&&scope.value==='timer'){loaded=t?.id;load(focus.draft(t?.id));}
        save.disabled=blocked||(scope.value==='timer'?!t:!defaults);actions.replaceChildren();
        clock.textContent=f?`${f.phase.replaceAll('_',' ')} · ${f.remaining_seconds==null?'off':Math.ceil(f.remaining_seconds/60)+'m '+Math.ceil(f.remaining_seconds%60)+'s remaining'} (server focus clock)`:'Focus not initialized.';
        warning.textContent=t?.identity_started_at_provenance==='prospective_unknown_history'?'Historical creation time unknown: two-hour warning uses the explicitly initialized prospective anchor.':'Two-hour warning includes pauses, once per unfinished timer; it never stops recording.';
        if(t&&!f)actions.append(button('Initialize retained focus state',()=>control.initializeFocus()));
        if(f?.phase==='work_due')for(const [a,label]of[['take_break','Take break'],['keep_working','Keep working']]){const b=button(label,()=>focus.action(a));b.disabled=blocked||t.state==='frozen';actions.append(b);}
        if(['break','break_due'].includes(f?.phase)){const b=button('Resume work',()=>focus.action('resume_work'));b.disabled=blocked||t.state==='frozen';actions.append(b);}
        const status=focus.snapshot();notices.replaceChildren();
        const diagnostic=document.createElement('p');diagnostic.textContent=(status.capability?.reason||'Checking delivery capability…')+' '+status.deliveryMessage;notices.append(diagnostic);
        for(const n of status.notices.filter(n=>!n.acknowledged&&n.status!=='cancelled')){const card=document.createElement('p');card.textContent=`${n.kind.replaceAll('_',' ')} · timer ${n.timer_id.slice(-8)} · ${n.channel||'in-app fallback'}: ${n.status}${n.status==='unknown'?' (delivery uncertain; no retry alert)':''} `;
            card.append(button('Dismiss notice',async()=>{await focus.acknowledge(n.id);await update();}));notices.append(card);}
    }
    window.addEventListener('timetrace:timer-state',render);
    async function update(){await focus.refreshNotices();if(!defaults){const saved=await api.get('/timer-focus/defaults').catch(()=>null);if(saved){adoptDefaults(saved);if(!focus.hasDraft())loadScope();}}render();}
    await update();const interval=setInterval(()=>void update(),3000);window.addEventListener('pagehide',()=>clearInterval(interval),{once:true});
});
