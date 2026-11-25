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
        hasTimerDraft:id=>drafts.has(id),hasDefaultsDraft:()=>drafts.has(defaultsKey),
        timerDraftIds:()=>[...drafts.keys()].filter(key=>key!==defaultsKey),
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
        action(action,id=selected()?.id){const t=timer(id); if(!t?.focus)return false; return control.act(t.id,'focus-action',{
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
function renderFocusAlerts(root,focus,control) {
    const document=root.ownerDocument,state=control.snapshot(),status=focus.snapshot();root.replaceChildren();
    const node=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element;};
    const button=(text,handler,disabled=false)=>{const element=node('button',text);element.type='button';element.disabled=disabled;element.addEventListener('click',handler);return element;};
    const blocked=state.pending||Boolean(state.receipt)||!state.fresh;
    for(const timer of state.timers){
        if(timer.identity_started_at_provenance==='prospective_unknown_history'){
            const details=node('details','');details.append(node('summary',`${timer.task_title||'Unassigned timer'} · Legacy warning history`),node('p','The two-hour warning uses a prospective anchor established when focus state was initialized. Earlier creation history is unknown; this is not a known two-hour lifetime total. Pauses after that anchor are included.'));root.append(details);
        }
        const phase=timer.focus?.phase;if(!['work_due','break_due','break'].includes(phase))continue;
        const card=node('div',`${timer.task_title||'Unassigned timer'} · ${phase==='work_due'?'Focus period complete':phase==='break_due'?'Break complete':'On a break'}`);
        if(phase==='work_due')for(const [action,label] of [['take_break','Take break'],['keep_working','Keep working']])card.append(button(label,()=>focus.action(action,timer.id),blocked||timer.state==='frozen'));
        else card.append(button('Resume work',()=>focus.action('resume_work',timer.id),blocked||timer.state==='frozen'));
        root.append(card);
    }
    for(const notice of status.notices.filter(n=>!n.acknowledged&&n.status!=='cancelled')){
        const timer=state.timers.find(t=>t.id===notice.timer_id),label=timer?.task_title||'Unassigned timer';
        const card=node('p',`${notice.kind==='two_hour'?'Two-hour timer warning':notice.kind==='break_due'?'Break complete':'Focus period complete'} · ${label} · ${notice.status}${notice.status==='unknown'?' (delivery uncertain; no automatic retry)':''}`);
        card.append(button('Dismiss notice',async()=>{await focus.acknowledge(notice.id);await focus.refreshNotices();renderFocusAlerts(root,focus,control);}));root.append(card);
    }
    if(status.deliveryMessage)root.append(node('p',status.deliveryMessage));root.hidden=root.children.length===0;
}
if(typeof module!=='undefined')module.exports={createFocusController,renderFocusAlerts};
if(typeof window!=='undefined'){
    let ready;window.timerFocusReady=new Promise(resolve=>{ready=resolve;});
    document.addEventListener('DOMContentLoaded',async()=>{
        await window.multipleTimersReady;const control=window.multipleTimers;if(!control){ready(null);return;}
        const focus=createFocusController({control,api});window.timerFocus=focus;
        const previousDraft=control.hasFocusDraft;control.hasFocusDraft=()=>focus.hasDraft()||Boolean(previousDraft?.());
        window.addEventListener('beforeunload',event=>{if(control.hasFocusDraft()){event.preventDefault();event.returnValue='';}});
        const root=document.querySelector('[data-focus-alerts]');
        const render=()=>{if(root)renderFocusAlerts(root,focus,control);window.dispatchEvent(new CustomEvent('timetrace:focus-state'));};
        window.addEventListener('timetrace:timer-state',render);ready(focus);
        async function update(){await focus.refreshNotices();render();}
        void update();const interval=setInterval(()=>void update(),3000);window.addEventListener('pagehide',()=>clearInterval(interval),{once:true});
    });
}
