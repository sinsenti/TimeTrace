/** Optional post-save assignment owns a journal separate from the acknowledged Stop. */
function createWorkAssignmentController({api,storage,onState,operationId=()=>crypto.randomUUID()}) {
    const key='timetrace_work_assignment_v1';
    let prompt=null,journal=null,queued=[],pending=false,message='',blocked=false,generation=0;
    try { const saved=JSON.parse(storage.getItem(key)||'null'); prompt=saved?.prompt||null;journal=saved?.journal||null;queued=saved?.queued||[]; }
    catch (_) {blocked=true;message='Assignment safety storage unavailable. Saved work remains taskless.';}
    const snapshot=()=>({prompt,journal,queued,pending,message,blocked});
    const publish=()=>onState(snapshot());
    function persist() {try {storage.setItem(key,JSON.stringify({prompt,journal,queued}));return true;}catch(_){blocked=true;message='Assignment safety storage unavailable; no new request sent.';return false;}}
    function offer(result) {
        if (!result?.operation_id || !Array.isArray(result.saved_taskless_work) || !result.saved_taskless_work.length) return false;
        if (prompt?.stop_id===result.operation_id || queued.some(p=>p.operation_id===result.operation_id)) return false;
        if(prompt&&(!prompt.hidden||journal?.outcome==='uncertain')){
            queued.push({operation_id:result.operation_id,saved_taskless_work:result.saved_taskless_work.map(w=>({...w}))});persist();message='Another Stop is saved. Its separate assignment choices are queued, not added to this manifest.';publish();return true;
        }
        prompt={stop_id:result.operation_id,works:result.saved_taskless_work.map(w=>({...w})),selected_ids:result.saved_taskless_work.map(w=>w.id),destination:{kind:'existing',task_id:''},hidden:false};
        journal=null;persist();publish();return true;
    }
    function acknowledge(result) {
        if(result?.operation_id!==journal?.payload?.operation_id) throw Error('Unrecognized assignment acknowledgement');
        journal.outcome='acknowledged';journal.result=result;
        prompt.hidden=true;message='Saved work assigned. Refresh reads cannot repeat this assignment.'+(queued.length?' Other saved Stop batches are queued; dismiss to show the next explicit batch.':'');
        persist();publish();
        if(typeof window!=='undefined') window.dispatchEvent(new CustomEvent('timetrace:timer-mutated',{detail:result}));
    }
    async function send() {
        pending=true;publish();
        try {acknowledge(await api.post('/recorded-work/assignment',journal.payload));return true;}
        catch(error){
            journal.rejected=[400,404,409,422].includes(error.status)&&!['reconciliation_required','operation_payload_mismatch'].includes(error.code);
            persist();message=error.message||'Assignment outcome uncertain. Check its saved operation before retrying.';return false;
        }
        finally {pending=false;publish();}
    }
    async function assign(ids) {
        if(blocked||pending||!prompt||journal?.outcome==='uncertain') return false;
        const selected=new Set(ids),works=prompt.works.filter(w=>selected.has(w.id)).map(w=>({id:w.id,expected_revision:w.revision}));
        if(!works.length||works.length!==selected.size) {message='Choose explicitly listed saved records.';publish();return false;}
        journal={outcome:'uncertain',payload:JSON.parse(JSON.stringify({operation_id:operationId(),works,destination:prompt.destination}))};
        generation++;if(!persist()){publish();return false;}return send();
    }
    async function retry() {
        if(pending||blocked||!journal||journal.outcome==='acknowledged') return false;
        const current=journal,own=++generation;pending=true;publish();
        try {const found=await api.get(`/operations/${encodeURIComponent(current.payload.operation_id)}`);
            if(own!==generation||journal!==current)return false;
            if(found.status==='finalized'){acknowledge(found.result);return true;}
            if(found.status!=='pending_reconciliation')throw Error('Unknown assignment receipt');
        } catch(error) {if(error.status===404) {
                if(current.rejected){journal=null;persist();message='Assignment refused. Saved work is safe; refresh the exact listed targets and edit your retained draft.';return false;}
            }else {message='Assignment lookup unavailable; retained exact request, no write retried.';return false;}}
        finally {pending=false;publish();}
        // A known missing receipt or accepted pending intent can only retry the stored exact request.
        if(own!==generation||journal!==current)return false;
        return send();
    }
    async function refetchTargets() {
        if(pending||journal?.outcome==='uncertain'||!prompt)return false;
        pending=true;publish();
        try {
            const rows=await Promise.all(prompt.works.map(w=>api.get(`/recorded-work/${encodeURIComponent(w.id)}`)));
            if(rows.some(w=>w.task_id!==null||w.scheduled_session_id!==null))throw Error('A listed target is no longer taskless. Leave it unchanged.');
            prompt.works=rows.map(w=>({id:w.id,revision:w.revision,start_time:w.start_time,end_time:w.end_time}));
            message='Exact listed IDs refreshed. Review their current intervals; no correction fragments were added.';
            persist();return true;
        }catch(error){message=error.message||'Target read failed; no assignment repeated.';return false;}
        finally{pending=false;publish();}
    }
    return {snapshot,offer,assign,retry,refetchTargets,
        select(ids){if(!prompt||pending||journal?.outcome==='uncertain')return false;const allowed=new Set(prompt.works.map(w=>w.id));if(ids.some(id=>!allowed.has(id)))return false;prompt.selected_ids=[...new Set(ids)];persist();publish();return true;},
        dismiss(){if(prompt){prompt.hidden=true;persist();if(queued.length&&journal?.outcome!=='uncertain'){const next=queued.shift();offer(next);}publish();}},
        reopen(){if(prompt){prompt.hidden=false;persist();publish();}},
        edit(destination){if(!prompt||pending||journal?.outcome==='uncertain')return false;prompt.destination=JSON.parse(JSON.stringify(destination));persist();publish();return true;}
    };
}
if(typeof module!=='undefined')module.exports={createWorkAssignmentController};
if(typeof document!=='undefined') document.addEventListener('DOMContentLoaded',()=>{
    const root=document.querySelector('[data-work-assignment]');if(!root)return;
    document.querySelector('main')?.before(root);
    let shown=null;const selected=new Set();
    const status=document.createElement('p');status.setAttribute('role','status');
    const body=document.createElement('div');root.append(status,body);
    function button(label,action){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',action);return b;}
    function render(state){
        status.textContent=state.message;root.hidden=!state.prompt;
        if(!state.prompt)return;
        body.hidden=state.prompt.hidden;
        if(shown!==JSON.stringify(state.prompt.works)){
            shown=JSON.stringify(state.prompt.works);selected.clear();body.replaceChildren();
            const heading=document.createElement('h3');heading.textContent='Saved taskless work — optional assignment';body.append(heading);
            const info=document.createElement('p');info.textContent='Stop is already saved. Assign only the explicitly listed records, or leave them taskless.';body.append(info);
            for(const w of state.prompt.works){
                const checked=(state.prompt.selected_ids||state.prompt.works.map(w=>w.id)).includes(w.id);
                if(checked)selected.add(w.id);const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=checked;
                check.addEventListener('change',()=>{check.checked?selected.add(w.id):selected.delete(w.id);controller.select([...selected]);});
                label.append(check,document.createTextNode(` ${w.id} · ${w.start_time||''} → ${w.end_time||''} `));body.append(label,document.createElement('br'));
            }
            const mode=document.createElement('select');mode.setAttribute('aria-label','Assignment destination type');
            for(const [value,text] of [['existing','Existing task'],['new','Create task and assign']]){const o=document.createElement('option');o.value=value;o.textContent=text;mode.append(o);}
            mode.value=state.prompt.destination.kind;
            const tasks=document.createElement('select');tasks.setAttribute('aria-label','Assignment existing task');
            const empty=document.createElement('option');empty.value='';empty.textContent='Choose a task';tasks.append(empty);
            const title=document.createElement('input');title.placeholder='New task title';title.setAttribute('aria-label','New assignment task title');title.value=state.prompt.destination.task_draft?.title||'';
            api.get('/api/tasks').then(rows=>{for(const task of rows){const o=document.createElement('option');o.value=task.id;o.textContent=task.title;tasks.append(o);}tasks.value=state.prompt.destination.task_id||'';}).catch(()=>{status.textContent='Task list unavailable. Saved work remains safe; retry by reopening.';});
            function edit(){tasks.hidden=mode.value!=='existing';title.hidden=mode.value!=='new';controller.edit(mode.value==='existing'?{kind:'existing',task_id:tasks.value}:{kind:'new',task_draft:{title:title.value}});}
            mode.addEventListener('change',edit);tasks.addEventListener('change',edit);title.addEventListener('input',edit);
            tasks.hidden=mode.value!=='existing';title.hidden=mode.value!=='new';body.append(mode,tasks,title,
                button('Assign selected saved work',()=>controller.assign([...selected])),
                button('Refresh exact targets',()=>controller.refetchTargets()),
                button('Leave taskless',()=>controller.dismiss()));
        }
        for(const control of body.querySelectorAll('button,input,select'))control.disabled=state.pending||state.blocked||state.journal?.outcome==='uncertain';
        let recovery=root.querySelector('[data-assignment-recovery]');
        if(!recovery){recovery=document.createElement('div');recovery.dataset.assignmentRecovery='';recovery.append(button('Check / retry exact assignment',()=>controller.retry()),button('Show saved assignment choices',()=>controller.reopen()),button('Dismiss assignment prompt',()=>controller.dismiss()));root.append(recovery);}
        recovery.hidden=!state.prompt.hidden&&state.journal?.outcome!=='uncertain';
        recovery.querySelector('button').disabled=state.pending||state.journal?.outcome!=='uncertain';
    }
    const controller=createWorkAssignmentController({api,storage:sessionStorage,onState:render});window.workAssignment=controller;render(controller.snapshot());
    window.addEventListener('timetrace:timer-mutated',event=>controller.offer(event.detail));
});
