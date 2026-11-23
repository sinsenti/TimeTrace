/** Explicit correction vocabulary. The server owns eligibility, geometry and DST validation. */
function correctionInstant(local, offset) {
    const match = /^([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(offset);
    if (!match || +match[2] > 23 || +match[3] > 59 || +(match[4] || 0) > 59) throw Error('Choose an explicit UTC offset, such as -04:00 or -05:00 for a repeated hour.');
    const seconds = (match[1] === '-' ? -1 : 1) * (+match[2]*3600 + +match[3]*60 + +(match[4] || 0));
    const date = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(\.\d{1,6})?$/.exec(local);
    if (!date) throw Error('Enter a complete date and local time, not a time-only adjustment.');
    const instant = new Date(Date.parse(date[1] + 'Z') - seconds*1000);
    if (!Number.isFinite(instant.getTime())) throw Error('Invalid local date/time.');
    return {utc:instant.toISOString().slice(0,19) + (date[2] || '') + 'Z',seconds};
}
function correctionChange(values) {
    new Intl.DateTimeFormat('en', {timeZone:values.timezone});
    const start = correctionInstant(values.start, values.startOffset);
    if (values.kind === 'set_start') return {kind:'set_start',start_utc:start.utc,timezone:values.timezone,local_datetime:values.start,offset_seconds:start.seconds};
    const end = correctionInstant(values.end, values.endOffset);
    return {kind:'exclude',start_utc:start.utc,end_utc:end.utc,timezone:values.timezone,start_local_datetime:values.start,end_local_datetime:values.end,start_offset_seconds:start.seconds,end_offset_seconds:end.seconds};
}
function correctionTargets(timer, saved = []) {
    const result = [];
    if (timer.running_start && timer.running_segment_id) result.push({target:{kind:'running',segment_id:timer.running_segment_id},start:timer.running_start,end:null,context:timer});
    for (const segment of timer.segments || []) {
        if (segment.recorded_work_id) {
            const row = saved.find(row=>row.id === segment.recorded_work_id);
            if (row) result.push({target:{kind:'saved',work_id:row.id,expected_revision:row.revision},start:row.start_time,end:row.end_time,context:row});
        } else result.push({target:{kind:'buffered',segment_id:segment.id},start:segment.start_time,end:segment.end_time,context:segment});
    }
    return result;
}
function correctionPresentation(envelope) {
    const plan = envelope.plan || envelope;
    const intervals = value => (Array.isArray(value) ? value : [value]).map(row=>`${row.source_segment_id || 'actual interval'} → ${row.segment_id || 'same identity'}: ${row.start_utc} — ${row.end_utc}`).join('\n');
    const change=envelope.request?.change;
    const local=change?.timezone ? `Signed local context: ${change.timezone}; ${change.local_datetime || change.start_local_datetime} (UTC offset ${change.offset_seconds ?? change.start_offset_seconds}s)${change.end_local_datetime ? ` — ${change.end_local_datetime} (UTC offset ${change.end_offset_seconds}s)` : ''}.\n` : '';
    return local + `Accepted cutoff: ${envelope.cutoff}\nBefore:\n${intervals(plan.before)}\nRetained after:\n${intervals(plan.after)}\n` +
        (plan.action === 'exclude' ? `Removed selected work: ${plan.removed_seconds}s; already uncredited pause/gap: ${plan.already_uncredited_seconds}s; unselected coverage unchanged: ${plan.unselected_covered_seconds}s.\n` : `Retained credited duration at cutoff: ${plan.duration_seconds}s.\n`) +
        [...new Set([...(envelope.warnings || []),...(plan.warnings || [])])].join('\n') + '\nIf recording continues after this cutoff, that later work is not included in this preview. Paused/frozen states are not resumed; schedules are not changed.';
}
function mountTimeCorrections({document,control,api,conflicts = () => false}) {
    const dialog=document.createElement('dialog'); dialog.id='timer-correction-dialog'; dialog.setAttribute('role','dialog');
    const heading=document.createElement('h2'); heading.id='timer-correction-title'; heading.textContent='Adjust actual credited work'; dialog.setAttribute('aria-labelledby',heading.id);
    const context=document.createElement('p'), choices=document.createElement('fieldset');
    const legend=document.createElement('legend'); legend.textContent='Explicit actual interval selection (not schedules)'; choices.append(legend);
    const fields=document.createElement('div'); fields.className='correction-fields';
    const inputs={};
    for (const [key,label,type] of [['kind','Adjustment','select'],['timezone','IANA timezone','text'],['start','Local start date and time','text'],['startOffset','Start UTC offset (e.g. -04:00)','text'],['end','Local exclusion end date and time','text'],['endOffset','End UTC offset (e.g. -05:00)','text']]) {
        const wrap=document.createElement('label'); wrap.textContent=label;
        const input=document.createElement(type==='select'?'select':'input'); if(type!=='select')input.type=type;
        if(type==='select') for(const [value,text] of [['set_start','Move the selected actual start'],['exclude','Exclude an exact interval from selected work']]) {const option=document.createElement('option');option.value=value;option.textContent=text;input.append(option);}
        inputs[key]=input; wrap.append(input); fields.append(wrap);
    }
    const message=document.createElement('p'); message.setAttribute('role','status');
    const preview=document.createElement('pre'); preview.className='correction-preview';
    const actions=document.createElement('div'); actions.className='workspace-actions';
    function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',fn);actions.append(b);return b;}
    let owner=null, generation=0;
    function update(){const state=control.snapshot();dialog.setAttribute('aria-busy',String(Boolean(owner?.busy || state.pending)));for(const input of [...Object.values(inputs),...choices.querySelectorAll('input')])input.disabled=!owner;const blocked=state.pending || Boolean(state.receipt && state.receipt.outcome!=='acknowledged'); apply.disabled=!owner?.approved || owner.busy || blocked; request.disabled=!owner || Boolean(owner.busy)||blocked; initialize.disabled=blocked;discard.disabled=!owner || blocked;reload.disabled=!owner || blocked || Boolean(owner.busy);}
    function invalidate(){if(owner){owner.approved=null;owner.dirty=true;owner.inputVersion=(owner.inputVersion||0)+1;if(owner.phase==='preview'){owner.busy=false;owner.phase=null;}generation++;message.textContent='Input changed. Request and review a new signed preview; prior preview is not approved.';update();}}
    for(const input of Object.values(inputs))input.addEventListener('input',invalidate);
    const reload=button('Refresh target metadata (keep dates)',async()=>{
        const captured=owner,read=++generation;
        if(!captured)return;
        const selected=new Set([...choices.querySelectorAll('input:checked')].map(input=>targetKey(captured.candidates[+input.value].target)));
        captured.phaseId=(captured.phaseId||0)+1;captured.approved=null;captured.busy=true;captured.phase='preview';update();
        try {
            const loaded=await loadCandidates(captured.resource);
            if(owner!==captured || read!==generation)return;
            captured.candidates=loaded.candidates;captured.timerId=loaded.timerId;
            renderChoices(captured,selected);
            showContext(captured,loaded.subject);
            message.textContent='Target identities/revisions reloaded. Your dates and offsets are unchanged; select current actual intervals and request a new preview for explicit approval.';
        }catch(error){if(owner===captured && read===generation)message.textContent=`Target refresh failed: ${error.message}. Draft and old display retained; no approval.`;}
        finally{if(owner===captured && read===generation){captured.busy=false;captured.phase=null;update();}}
    });
    const initialize=button('Initialize correction safety explicitly',async()=>{try{const ok=await control.initializeCorrections();message.textContent=ok?'Initialization acknowledged. Refresh target metadata, select actual intervals, then request a preview explicitly.':control.snapshot().message;}catch(error){message.textContent=error.message;}update();});
    const request=button('Preview (no write)',async()=>{
        const captured=owner, read=++generation; captured.phaseId=(captured.phaseId||0)+1;captured.busy=true;captured.phase='preview';captured.approved=null;update();
        try {
            const selected=[...choices.querySelectorAll('input:checked')].map(input=>captured.candidates[+input.value].target);
            const change=captured.change || correctionChange(Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value])));
            if(!selected.length || (change.kind!=='exclude' && selected.length!==1))throw Error('Choose exactly one actual interval for a start edit, or explicit intervals for exclusion.');
            const target=selected.length===1?selected[0]:{kind:'selection',targets:selected};
            const approved=await control.previewCorrection(captured.resource,{target,change});
            if(owner!==captured || read!==generation)return;
            const description=correctionPresentation(approved); captured.approved=approved; preview.textContent=description;message.textContent='Review exact signed intervals and warnings, then explicitly apply. Every selected interval must retain positive work; complete removal is unsupported. No clamping or spill.';
        }catch(error){if(owner===captured && read===generation)message.textContent=`Preview refused: ${error.message}. No mutation sent. Draft and previous display retained. Initialize explicitly if requested; review idle time in the shared timer region if frozen.`;}
        finally{if(owner===captured && read===generation){captured.busy=false;captured.phase=null;update();}}
    });
    const apply=button('Apply this signed preview',async()=>{
        const captured=owner;
        if(!captured?.approved)return;
        if(conflicts(captured)){message.textContent='Conflicting note/work draft: explicitly save, discard or review it before applying. Your typing has not been changed.';return;}
        const inputVersion=captured.inputVersion||0,phase=captured.phaseId=(captured.phaseId||0)+1;
        captured.submittedVersion=inputVersion;
        captured.busy=true;captured.phase='commit';update();
        try {
            const promise=control.commitCorrection(captured.resource,captured.approved);
            captured.operationId=control.snapshot().receipt?.payload?.operation_id;
            const ok=await promise;
            if(owner!==captured || captured.phaseId!==phase)return;
            if(ok){captured.approved=null;captured.dirty=(captured.inputVersion||0)!==inputVersion;message.textContent=captured.dirty?'Prior signed correction acknowledged. Later input is retained, not applied; request and approve a new preview.':'Correction acknowledged. Authoritative reads are refreshing; failed display reads never repeat this write.';}
            else {message.textContent=control.snapshot().message+' Draft retained. Check the saved operation; stale approval requires a new preview and explicit approval.';if(!control.snapshot().receipt)captured.approved=null;}
        }catch(error){if(owner===captured && captured.phaseId===phase)message.textContent=error.message;}
        finally{if(owner===captured && captured.phaseId===phase){captured.busy=false;captured.phase=null;update();}}
    });
    const discard=button('Discard adjustment draft',()=>{
        const state=control.snapshot();
        if(state.pending || (state.receipt && state.receipt.outcome!=='acknowledged')){message.textContent='Finish the saved operation before discarding this adjustment draft.';return;}
        if(owner){owner.approved=null;owner.dirty=false;owner.busy=false;owner.phase=null;}generation++;
        dialog.close();
    });
    button('Close (keep adjustment draft)',()=>dialog.close());
    dialog.addEventListener('close',()=>{generation++;if(owner)owner.busy=false;update();});
    document.defaultView?.addEventListener('beforeunload',event=>{if(owner?.dirty){event.preventDefault();event.returnValue='';}});
    const review=document.createElement('a');review.href='#multiple_timers';review.textContent='Review idle time or saved operation in shared timer controls';review.addEventListener('click',()=>dialog.close());
    dialog.append(heading,context,choices,fields,message,preview,review,actions);document.body.append(dialog);
    const targetKey=target=>target.kind+':'+(target.work_id||target.segment_id);
    async function loadCandidates(resource,timer) {
        if(resource.startsWith('/recorded-work/')) {
            const row=await api.get(resource);
            return {candidates:[{target:{kind:'saved',work_id:row.id,expected_revision:row.revision},start:row.start_time,end:row.end_time,context:row}],subject:row,timerId:row.timer_id};
        }
        timer ||= await api.get(resource);
        const saved=await Promise.all((timer.segments||[]).filter(s=>s.recorded_work_id).map(s=>api.get(`/recorded-work/${encodeURIComponent(s.recorded_work_id)}`)));
        return {candidates:correctionTargets(timer,saved),subject:timer,timerId:timer.id};
    }
    function renderChoices(captured,selected) {
        for(const node of [...choices.children].slice(1))node.remove();
        let initial=null;
        captured.candidates.forEach((candidate,index)=>{
            const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=String(index);input.checked=selected.has(targetKey(candidate.target));
            if(input.checked)initial=candidate;
            input.addEventListener('change',invalidate);
            label.append(input,document.createTextNode(`${JSON.stringify(candidate.target)} · ${candidate.start} — ${candidate.end||'recording'} · source ${candidate.context.provenance||'timer buffer'} · task ${candidate.context.task_id||'taskless'} · plan ${candidate.context.scheduled_session_id||'none'} · ${candidate.context.notes||'no work note'}`));choices.append(label);
        });
        return initial;
    }
    function showContext(captured,subject) {
        context.textContent=`Pinned target ${captured.resource} · ${subject.task_id||'taskless'} · association ${subject.scheduled_session_id||'none'}. Saved and buffered intervals keep their own identities. Every selected interval must retain positive work; complete removal is unsupported. No implicit resume.`;
    }
    function local(iso,zone){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'}).formatToParts(new Date(iso)).map(p=>[p.type,p.value]));return {date:`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`+(iso.match(/\.\d+/)?.[0]||''),offset:parts.timeZoneName.replace('GMT','')||'+00:00'};}
    function mutation(result) {
        if(!owner){update();return;}
        if(result?.operation_id===owner.operationId){
            owner.approved=null;owner.busy=false;owner.phase=null;
            owner.dirty=(owner.inputVersion||0)!==(owner.submittedVersion||0);
            message.textContent=owner.dirty?'Prior signed correction acknowledged. Later typing is retained, not applied; request a new preview.':'Correction acknowledged from finalized operation. Display recovery is reads only; do not replay this write.';
            update();return;
        }
        const affected=result?.correction?.changed_work_ids || [];
        if(owner.approved && (result?.timer?.id===owner.timerId || owner.candidates.some(c=>affected.includes(c.target.work_id)))) {
            owner.approved=null;generation++;owner.busy=false;
            message.textContent='Known work/timer change invalidated this approval. Draft and prior display retained; request a new preview and approve explicitly.';update();
        }
        update();
    }
    document.defaultView?.addEventListener('timetrace:timer-mutated',event=>mutation(event.detail));
    return {async open({timer,row,change}) {
        const resource=row?`/recorded-work/${encodeURIComponent(row.id)}`:`/timers/${encodeURIComponent(timer.id)}`;
        const state=control.snapshot();
        if(state.pending || (state.receipt && state.receipt.outcome!=='acknowledged')) {
            message.textContent='Finish the saved operation or legacy recovery hold in shared timer controls before choosing another preview. Exact journal and draft retained.';
            update();if(!dialog.open)dialog.showModal();return;
        }
        if(owner?.resource===resource && JSON.stringify(owner.change)===JSON.stringify(change) && owner.dirty){if(!dialog.open)dialog.showModal();return;}
        if(owner?.dirty && !window.confirm('Discard the retained adjustment draft to choose another correction target?'))return;
        const read=++generation;
        owner=null;context.textContent=`Loading explicit target ${resource}; prior display is not an approval.`;update();if(!dialog.open)dialog.showModal();
        try {
            const loaded=await loadCandidates(resource,timer);
            if(read!==generation)return;
            const candidates=loaded.candidates;
            owner={resource,timerId:loaded.timerId,candidates,change,dirty:true,busy:false,approved:null};
            showContext(owner,loaded.subject);
            const selected=new Set(candidates.filter(c=>row || c.target.kind==='running' || c.target.segment_id===timer?.manual_pause_note_segment_id).map(c=>targetKey(c.target)));
            const initial=renderChoices(owner,selected);
            inputs.kind.value='set_start';inputs.timezone.value=Intl.DateTimeFormat().resolvedOptions().timeZone;
            if(initial){const start=local(initial.start,inputs.timezone.value),end=local(initial.end||new Date().toISOString(),inputs.timezone.value);inputs.start.value=start.date;inputs.startOffset.value=start.offset;inputs.end.value=end.date;inputs.endOffset.value=end.offset;}
            else for(const key of ['start','startOffset','end','endOffset'])inputs[key].value='';
            fields.hidden=Boolean(change); preview.textContent='';message.textContent=change?`${change.credited_delta_seconds>0?'Add':'Remove'} five credited minutes on the explicitly checked actual interval, by moving its start. Preview required.`:'Enter complete dates, IANA zone and explicit offsets. Repeated DST hours require your offset choice; gaps are refused by the server.';
            update();if(!dialog.open)dialog.showModal();
        }catch(error){if(read!==generation)return;message.textContent=`Cannot load explicit target ${resource}: ${error.message}. No approval; no action sent.`;update();if(!dialog.open)dialog.showModal();}
    },dialog};
}
if (typeof window !== 'undefined') {
    let panel;
    window.openTimeCorrection = context => {
        panel ||= mountTimeCorrections({document,control:window.multipleTimers,api,
            conflicts:owner=>Boolean(owner.timerId && window.multipleTimers.hasNoteDraft?.(owner.timerId)) || (typeof agendaPage!=='undefined' && agendaPage.correctionConflicts?.((owner.approved.request.target.targets || [owner.approved.request.target]).map(c=>c.work_id).filter(Boolean)))});
        return panel.open(context);
    };
}
if (typeof module !== 'undefined') module.exports = {correctionInstant,correctionChange,correctionTargets,correctionPresentation};
