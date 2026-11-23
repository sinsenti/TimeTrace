/** Run in the owned synthetic Orca page via `orca eval`; no browser/provider substitution. */
async function runTimeCorrectionBrowserCase(name) {
    const assert=(condition,message)=>{if(!condition)throw Error(`${name}: ${message}`);};
    assert(location.origin==='http://127.0.0.1:18461','owned non-default synthetic origin required');
    const health=await api.get('/health');assert(health.db_file.startsWith('/tmp/timetrace-61-browser-final.'),'external synthetic database required before browser writes');
    const fixture=JSON.parse(sessionStorage.getItem('timetrace_61_browser_fixture')||'null');
    if(fixture){window.__correctionPlanFixture ||= fixture.plan;window.__correctionActiveTimer ||= fixture.active;window.__correctionLostAck ||= fixture.lost;}
    const dialog=()=>document.getElementById('timer-correction-dialog');
    const button=(root,text)=>[...root.querySelectorAll('button')].find(node=>node.textContent===text);
    const wait=condition=>new Promise((resolve,reject)=>{
        if(condition()){resolve();return;}
        const observer=new MutationObserver(()=>{if(condition()){observer.disconnect();clearTimeout(timer);resolve();}});
        const timer=setTimeout(()=>{observer.disconnect();reject(Error(`${name}: DOM condition timed out`));},10000);
        observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
    });
    const micros=iso=>BigInt(Date.parse(iso))*1000n+BigInt((iso.match(/\.(\d+)/)?.[1]||'').padEnd(6,'0').slice(3));
    const current=()=>window.multipleTimers.snapshot().timers.find(t=>t.id===window.multipleTimers.snapshot().selectedTimerId);
    const cardAction=label=>button(document.querySelector('#workspace-current-timer'),label);
    const set=(label,value)=>{const wrap=[...dialog().querySelectorAll('.correction-fields label')].find(node=>node.textContent.startsWith(label));const input=wrap.querySelector('input,select');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
    const applyPreview=async()=>{button(dialog(),'Preview (no write)').click();await wait(()=>!button(dialog(),'Apply this signed preview').disabled);button(dialog(),'Apply this signed preview').click();await wait(()=>/acknowledged/.test(dialog().querySelector('[role=status]').textContent));return window.multipleTimers.snapshot().lastResult;};
    if(name==='begin_second_interval') {
        cardAction('Pause').click();await wait(()=>current()?.state==='paused');
        const first=structuredClone(current().segments[0]);
        cardAction('Resume').click();await wait(()=>current()?.state==='running');
        window.__firstBrowserInterval=first;
        return {case:name,passed:true,first,secondStart:current().running_start};
    }
    if(name==='paused_multi') {
        cardAction('Pause').click();await wait(()=>current()?.state==='paused');
        const before=structuredClone(current()), [first,second]=before.segments;
        assert(before.segments.length===2,'two explicit intervals, not a scalar total');
        assert(before.manual_pause_note_segment_id===second.id,'manual-pause target is second identity');
        // A short newest interval cannot borrow from the much longer earlier interval.
        const minus=[...document.querySelectorAll('#workspace-current-timer .correction-step')].find(b=>b.textContent==='−');
        minus.click();await wait(()=>dialog()?.open && !button(dialog(),'Preview (no write)').disabled);
        button(dialog(),'Preview (no write)').click();
        await wait(()=>/Preview refused/.test(dialog().querySelector('[role=status]').textContent));
        assert(button(dialog(),'Apply this signed preview').disabled,'no clamp or spill into first interval');
        button(dialog(),'Discard adjustment draft').click();
        cardAction('Adjust time').click();await wait(()=>dialog()?.open && !button(dialog(),'Preview (no write)').disabled);
        const boxes=[...dialog().querySelectorAll('fieldset input')];
        boxes.forEach(box=>{box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));});
        set('Adjustment','exclude');set('IANA timezone','UTC');
        const start=new Date(Date.parse(first.end_time)-500).toISOString();
        const end=new Date(Date.parse(second.start_time)+1).toISOString();
        assert(Date.parse(end)<Date.parse(second.end_time),'second interval retains positive work');
        set('Local start',start.slice(0,-1));set('Start UTC offset','+00:00');
        set('Local exclusion end',end.slice(0,-1));set('End UTC offset','+00:00');
        button(dialog(),'Preview (no write)').click();await wait(()=>!button(dialog(),'Apply this signed preview').disabled);
        assert(/already uncredited pause\/gap:/.test(dialog().querySelector('pre').textContent),'real pause coverage disclosed');
        button(dialog(),'Apply this signed preview').click();await wait(()=>/acknowledged/.test(dialog().querySelector('[role=status]').textContent));
        const after=current();
        assert(after.state==='paused','exclusion never resumes');
        assert(after.manual_pause_note_segment_id===second.id,'single-identity trim retains note pointer');
        assert(Date.parse(after.segments[0].end_time)===Date.parse(start),'first timestamps trimmed, not shifted');
        assert(Date.parse(after.segments[1].start_time)===Date.parse(end),'second starts at exact exclusion end');
        assert(after.segments[0].start_time===first.start_time && after.segments[1].end_time===second.end_time,'untouched endpoints preserved');
        button(dialog(),'Discard adjustment draft').click();
        return {case:name,passed:true,before,after:structuredClone(after)};
    }
    if(name==='older_split_notes') {
        await window.multipleTimers.refresh();
        const before=structuredClone(current()),first=before.segments[0],pointer=before.manual_pause_note_segment_id;
        const untouched=before.segments.find(s=>s.id===pointer);
        const note=document.querySelector('#workspace-current-note textarea'),saved=note.value;
        note.focus();note.value=saved+' retained unsaved draft';note.dispatchEvent(new Event('input',{bubbles:true}));
        assert(window.multipleTimers.hasNoteDraft(before.id),'current draft captured');
        cardAction('Adjust time').click();await wait(()=>dialog()?.open && !button(dialog(),'Preview (no write)').disabled);
        [...dialog().querySelectorAll('fieldset input')].forEach((box,index)=>{box.checked=index===0;box.dispatchEvent(new Event('change',{bubbles:true}));});
        set('Adjustment','exclude');set('IANA timezone','UTC');
        const start=new Date(Date.parse(first.start_time)+600000).toISOString(),end=new Date(Date.parse(first.start_time)+900000).toISOString();
        assert(Date.parse(end)<Date.parse(first.end_time),'older target retains both sides');
        set('Local start',start.slice(0,-1));set('Start UTC offset','+00:00');set('Local exclusion end',end.slice(0,-1));set('End UTC offset','+00:00');
        button(dialog(),'Preview (no write)').click();await wait(()=>!button(dialog(),'Apply this signed preview').disabled);
        const old=window.multipleTimers.snapshot().lastResult.operation_id;
        button(dialog(),'Apply this signed preview').click();
        assert(/Conflicting.*draft/.test(dialog().querySelector('[role=status]').textContent),'explicit save/discard/review guard');
        assert(window.multipleTimers.snapshot().lastResult.operation_id===old,'dirty draft causes no write');
        await window.multipleTimers.refresh();assert(note.value===saved+' retained unsaved draft','poll/preview do not wipe current typing');
        button(dialog(),'Close (keep adjustment draft)').click();
        cardAction('Use current saved note').click();
        assert(document.querySelector('#workspace-current-note textarea').value===saved,'explicit discard of note only');
        cardAction('Adjust time').click();await wait(()=>dialog()?.open && !button(dialog(),'Preview (no write)').disabled);
        button(dialog(),'Apply this signed preview').click();await wait(()=>/Correction acknowledged/.test(dialog().querySelector('[role=status]').textContent));
        const after=current();
        assert(after.state==='paused' && after.segments.length===3,'older middle split remains paused');
        assert(after.manual_pause_note_segment_id===pointer,'older correction does not retarget note pointer');
        assert(JSON.stringify(after.segments.find(s=>s.id===pointer))===JSON.stringify(untouched),'unselected current interval byte-equivalent');
        button(dialog(),'Discard adjustment draft').click();
        await window.multipleTimers.refresh();
        const next=document.querySelector('#workspace-current-note textarea');next.value='Only newest paused interval note';next.dispatchEvent(new Event('input',{bubbles:true}));
        cardAction('Save current work note').click();await wait(()=>!window.multipleTimers.hasNoteDraft(before.id));
        await window.multipleTimers.refresh();
        assert(current().segments.find(s=>s.id===pointer).notes==='Only newest paused interval note','note save stays on explicit pointer');
        assert(current().segments.filter(s=>s.id!==pointer).every(s=>s.notes===first.notes),'other fragment notes unchanged');
        return {case:name,passed:true,pointer,segments:structuredClone(current().segments)};
    }
    if(name==='current_split_stop') {
        await window.multipleTimers.refresh();
        const before=structuredClone(current()),pointer=before.manual_pause_note_segment_id;
        const target=before.segments.find(s=>s.id===pointer),duration=Date.parse(target.end_time)-Date.parse(target.start_time);
        assert(duration>5,'positive current paused interval');
        cardAction('Adjust time').click();await wait(()=>dialog()?.open && !button(dialog(),'Preview (no write)').disabled);
        set('Adjustment','exclude');set('IANA timezone','UTC');
        const start=new Date(Date.parse(target.start_time)+Math.floor(duration/3)).toISOString(),end=new Date(Date.parse(target.end_time)-Math.floor(duration/3)).toISOString();
        set('Local start',start.slice(0,-1));set('Start UTC offset','+00:00');set('Local exclusion end',end.slice(0,-1));set('End UTC offset','+00:00');
        const corrected=await applyPreview();
        assert(current().state==='paused' && current().manual_pause_note_segment_id===null,'own split clears pointer without resume');
        button(dialog(),'Discard adjustment draft').click();await window.multipleTimers.refresh();
        assert(cardAction('Save current work note').disabled,'no array-tail fallback note save');
        const retained=structuredClone(current().segments),old=window.multipleTimers.snapshot().lastResult.operation_id;
        cardAction('Stop & record').click();await wait(()=>window.multipleTimers.snapshot().lastResult?.operation_id!==old);
        const stopped=window.multipleTimers.snapshot().lastResult;
        assert(stopped.recorded_work_ids.length===retained.length,'only retained positive buffers saved once');
        const saved=await Promise.all(stopped.recorded_work_ids.map(id=>api.get('/recorded-work/'+id)));
        assert(new Set(saved.map(r=>r.id)).size===retained.length,'fresh unique actual IDs');
        for(const segment of retained)assert(saved.some(row=>row.timer_segment_id===segment.id && micros(row.start_time)===micros(segment.start_time) && micros(row.end_time)===micros(segment.end_time)),'exact retained geometry/identity recorded');
        const retry=await api.post(`/timers/${before.id}/stop`,{operation_id:stopped.operation_id,expected_revision:before.revision+1});
        assert(JSON.stringify(retry)===JSON.stringify(stopped),'exact Stop receipt retry, no duplicate');
        window.__savedCorrectionBrowserRows=saved;
        return {case:name,passed:true,correction:corrected.correction,stopped,rows:saved};
    }
    if(name==='modal_shortcuts') {
        await window.multipleTimers.refresh();
        const rows=window.__savedCorrectionBrowserRows || await api.get('/sessions');
        assert(rows.length>0,'owned synthetic saved work exists');
        await window.openTimeCorrection({row:rows[0]});
        assert(dialog().open,'saved adjustment dialog mounted');
        const original=window.multipleTimers.start;let starts=0;
        window.multipleTimers.start=()=>{starts++;return Promise.resolve(false);};
        try {
            const target=button(dialog(),'Preview (no write)');target.focus();
            target.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,altKey:true,shiftKey:true,key:'Enter',code:'Enter',cancelable:true}));
            assert(starts===0,'native correction dialog must guard workspace Start chord');
            return {case:name,passed:true,starts};
        }finally{window.multipleTimers.start=original;button(dialog(),'Discard adjustment draft').click();}
    }
    if(name==='saved_export') {
        const raw=await api.get('/sessions');raw.sort((a,b)=>Date.parse(a.start_time)-Date.parse(b.start_time));
        let source=await api.get('/recorded-work/'+raw[0].id);
        source=await api.request('/recorded-work/'+source.id+'/note',{method:'PATCH',body:JSON.stringify({notes:'Synthetic café Ω report note',expected_revision:source.revision})});
        await agendaPage.refresh();
        const entry=document.querySelector(`[data-agenda-row="${source.id}"]`);assert(entry,'saved history row is real');
        const group=entry.closest('details');if(!group.open)group.querySelector('summary').click();
        let adjust=entry.nextElementSibling;
        while(adjust && adjust.textContent!=='Adjust saved actual time')adjust=adjust.nextElementSibling;
        assert(adjust,'saved history correction entrypoint');adjust.click();await wait(()=>dialog()?.open && !button(dialog(),'Preview (no write)').disabled);
        set('Adjustment','exclude');set('IANA timezone','UTC');
        const start=new Date(Date.parse(source.start_time)+120000).toISOString(),end=new Date(Date.parse(source.start_time)+180000).toISOString();
        set('Local start',start.slice(0,-1));set('Start UTC offset','+00:00');set('Local exclusion end',end.slice(0,-1));set('End UTC offset','+00:00');
        const original=api.post.bind(api);let approved,report,send;
        api.post=async(url,body)=>{
            if(url.endsWith('/correction')) {
                const journal=JSON.parse(sessionStorage.getItem('timetrace_timer_v2_operation'));
                assert(JSON.stringify(journal.payload)===JSON.stringify(body),'signed saved commit journal exact before transport');
                return new Promise((resolve,reject)=>{send=async()=>{try{resolve(await original(url,body));}catch(error){reject(error);}};});
            }
            const value=await original(url,body);
            if(url.endsWith('/correction-preview'))approved=value;
            if(url==='/api/agenda/history-export/preview')report=value;
            return value;
        };
        try {
            button(dialog(),'Preview (no write)').click();await wait(()=>!button(dialog(),'Apply this signed preview').disabled);
            assert(approved.schema_version===3,'strict saved envelope');
            button(dialog(),'Apply this signed preview').click();assert(send,'delayed real correction transport reached');
            button(dialog(),'Close (keep adjustment draft)').click();
            document.getElementById('history-export-open').click();
            const exportDialog=document.getElementById('history-export-title').closest('dialog');
            button(exportDialog,'Load eligible rows').click();
            await wait(()=>exportDialog.querySelector(`[aria-label="Select ${source.id}"]`));
            const box=exportDialog.querySelector(`[aria-label="Select ${source.id}"]`);box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));
            const format=exportDialog.querySelector('select');format.value='csv';format.dispatchEvent(new Event('change',{bubbles:true}));
            button(exportDialog,'Preview checkbox selection').click();await wait(()=>!button(exportDialog,'Download preview').disabled);
            const before=report,bytes=exportDialog.querySelector('textarea').value;
            assert(before.work_count===1 && before.rows[0].id===source.id,'old exact single-source cohort accepted');
            await send();await wait(()=>button(exportDialog,'Download preview').disabled && exportDialog.querySelector('textarea').value==='');
            assert(bytes.length>0 && window.multipleTimers.snapshot().lastResult.correction.created_work_ids.length===1,'real ACK split invalidates old bytes');
            button(exportDialog,'Preview checkbox selection').click();await wait(()=>!button(exportDialog,'Download preview').disabled);
            const result=window.multipleTimers.snapshot().lastResult, ids=[source.id,...result.correction.created_work_ids];
            assert(report.work_count===2 && report.rows.every(row=>ids.includes(row.id)),'selected source expands only to exact retained IDs');
            assert(report.summed_recorded_work_seconds===before.summed_recorded_work_seconds-60,'shared SUM reflects exact exclusion, no original-plus-fragments double count');
            assert(report.elapsed_recorded_time_seconds===report.summed_recorded_work_seconds,'actual disjoint selected union');
            const saved=await Promise.all(ids.map(id=>api.get('/recorded-work/'+id)));
            assert(saved[0].timer_operation_id===source.timer_operation_id && saved[0].timer_segment_id===source.timer_segment_id,'original timer tuple retained');
            assert(saved.every(row=>row.notes==='Synthetic café Ω report note'),'descriptive metadata retained');
            assert(saved[1].correction_lineage.rating_source_work_id===source.correction_lineage.rating_source_work_id,'original rating lineage preserved');
            await agendaPage.refresh();
            assert(document.querySelector('#agenda-ledger').textContent.includes('Part of corrected original'),'additional fragment explicitly labeled');
            window.__correctionExportReport=report;
            return {case:name,passed:true,ids,operationId:result.operation_id,summed:report.summed_recorded_work_seconds,union:report.elapsed_recorded_time_seconds,csv:report.csv};
        } finally {api.post=original;}
    }
    if(name==='overnight_task_draft') {
        const exported=document.getElementById('history-export-title')?.closest('dialog');if(exported?.open)button(exported,'Close').click();
        const now=new Date(),today=now.toISOString().slice(0,10),yesterday=new Date(now.getTime()-86400000).toISOString().slice(0,10);
        const task=await api.post('/api/tasks',{title:'Final synthetic plan task',description:'Original full task description'});
        const plan=await api.post('/scheduled-sessions',{task_id:task.id,start_time:yesterday+'T23:00:00Z',end_time:today+'T01:00:00Z'});
        const row=await api.post('/recorded-work',{task_id:task.id,scheduled_session_id:plan.id,expected_plan_revision:plan.revision,start_time:yesterday+'T23:55:00Z',end_time:today+'T00:10:00Z',notes:'Overnight synthetic work'});
        const snapshot=await api.get('/scheduled-sessions/'+plan.id);
        await openEditTaskModal(task.id);
        const title=document.getElementById('modal_input_title'),description=document.getElementById('modal_input_desc');
        title.value='Unsaved full title';title.dispatchEvent(new Event('input',{bubbles:true}));
        description.value='Unsaved full description with independent typing';description.dispatchEvent(new Event('input',{bubbles:true}));description.focus();description.setSelectionRange(7,7);
        await window.multipleTimers.refresh();await agendaPage.refresh();
        assert(document.activeElement===description && description.selectionStart===7,'poll/ledger reads preserve task-editor focus and caret');
        await window.openTimeCorrection({row});
        set('Adjustment','set_start');set('IANA timezone','UTC');set('Local start',yesterday+'T23:50:00');set('Start UTC offset','+00:00');
        const corrected=await applyPreview();
        assert(corrected.correction.changed_work_ids[0]===row.id,'overnight edit preserves actual ID');
        button(dialog(),'Discard adjustment draft').click();
        assert(title.value==='Unsaved full title' && description.value==='Unsaved full description with independent typing','correction/refresh never save or discard full task draft');
        assert(document.activeElement===description,'explicit dialog close restores the existing editor, not a timer launcher');
        const saved=await api.get('/recorded-work/'+row.id), unchanged=await api.get('/scheduled-sessions/'+plan.id), storedTask=await api.get('/api/tasks/'+task.id);
        assert(Date.parse(saved.start_time)===Date.parse(yesterday+'T23:50:00Z') && Date.parse(saved.end_time)===Date.parse(today+'T00:10:00Z'),'dates survive overnight, not same-day inference');
        assert(JSON.stringify(unchanged)===JSON.stringify(snapshot),'original/current schedule and revision unchanged');
        assert(storedTask.title===task.title && storedTask.description===task.description,'task draft never implicitly written');
        const confirm=window.confirm;window.confirm=()=>true;try{closeTaskModal();}finally{window.confirm=confirm;}
        window.__correctionPlanFixture={task,plan:snapshot,row:saved};
        return {case:name,passed:true,row:saved,plan:unchanged,independentTaskDraftRetained:true};
    }
    if(name==='stale_saved_refresh') {
        const source=await api.get('/recorded-work/'+window.__correctionPlanFixture.row.id);
        await window.openTimeCorrection({row:source});
        set('Adjustment','set_start');set('IANA timezone','UTC');
        const proposed=new Date(Date.parse(source.start_time)+1000).toISOString();set('Local start',proposed.slice(0,-1));set('Start UTC offset','+00:00');
        button(dialog(),'Preview (no write)').click();await wait(()=>!button(dialog(),'Apply this signed preview').disabled);
        const updated=await api.request('/recorded-work/'+source.id+'/note',{method:'PATCH',body:JSON.stringify({notes:'Independent newer saved note',expected_revision:source.revision})});
        button(dialog(),'Apply this signed preview').click();
        await wait(()=>/stale|changed|revision/i.test(dialog().querySelector('[role=status]').textContent) && !window.multipleTimers.snapshot().pending);
        assert(button(dialog(),'Apply this signed preview').disabled,'stale approval consumed, not recomputed/replayed');
        assert(!window.multipleTimers.snapshot().receipt,'serialized definite-not-found clears only rejected journal');
        const unchanged=await api.get('/recorded-work/'+source.id);assert(micros(unchanged.start_time)===micros(source.start_time),'refusal has no partial geometry write');
        const input=[...dialog().querySelectorAll('.correction-fields label')].find(node=>node.textContent.startsWith('Local start')).querySelector('input');
        assert(input.value===proposed.slice(0,-1),'typed dates retained');
        button(dialog(),'Refresh target metadata (keep dates)').click();
        await wait(()=>/Target identities\/revisions reloaded/.test(dialog().querySelector('[role=status]').textContent));
        assert(input.value===proposed.slice(0,-1) && button(dialog(),'Apply this signed preview').disabled,'metadata refresh is GET-only, never new approval');
        assert(dialog().querySelector('fieldset').textContent.includes(`\"expected_revision\":${updated.revision}`),'new revision explicitly displayed');
        await applyPreview();
        const saved=await api.get('/recorded-work/'+source.id);
        assert(micros(saved.start_time)===micros(proposed) && saved.notes==='Independent newer saved note','new explicit approval preserves legal note edit');
        button(dialog(),'Discard adjustment draft').click();
        return {case:name,passed:true,beforeRevision:source.revision,noteRevision:updated.revision,afterRevision:saved.revision};
    }
    if(name==='independent_saved_current_notes') {
        const id=window.__correctionPlanFixture.row.id,task=window.__correctionPlanFixture.task;
        await window.multipleTimers.start({task_id:task.id,notes:'Independent active note'});await window.multipleTimers.refresh();
        const timer=structuredClone(current()),currentInput=document.querySelector('#workspace-current-note textarea');
        currentInput.value='Independent current-note typing';currentInput.dispatchEvent(new Event('input',{bubbles:true}));
        await agendaPage.refresh();
        let entry=document.querySelector(`[data-agenda-row="${id}"]`);entry.closest('details').open=true;entry.click();
        const note=document.querySelector('#agenda-detail textarea'),saved=note.value;
        note.value=saved+' saved-entry typing';note.dispatchEvent(new Event('input',{bubbles:true}));note.focus();note.setSelectionRange(4,4);
        await window.multipleTimers.refresh();await agendaPage.refresh();
        assert(note.value===saved+' saved-entry typing' && document.activeElement===note && note.selectionStart===4,'saved draft/focus survives both read owners');
        assert(currentInput.value==='Independent current-note typing','independent current draft also retained');
        const date=document.getElementById('agenda-date'),day=date.value,confirm=window.confirm;let prompts=0;
        window.confirm=()=>{prompts++;return false;};try{date.value='2026-11-24';date.dispatchEvent(new Event('change',{bubbles:true}));}finally{window.confirm=confirm;}
        assert(prompts===1 && date.value===day && note.value===saved+' saved-entry typing','date navigation explicitly guarded, not silent discard');
        const source=await api.get('/recorded-work/'+id);await window.openTimeCorrection({row:source});
        set('Adjustment','set_start');set('IANA timezone','UTC');const proposed=new Date(Date.parse(source.start_time)+1000).toISOString();set('Local start',proposed.slice(0,-1));set('Start UTC offset','+00:00');
        button(dialog(),'Preview (no write)').click();await wait(()=>!button(dialog(),'Apply this signed preview').disabled);
        const old=window.multipleTimers.snapshot().lastResult.operation_id;button(dialog(),'Apply this signed preview').click();
        assert(/Conflicting.*draft/.test(dialog().querySelector('[role=status]').textContent) && window.multipleTimers.snapshot().lastResult.operation_id===old,'saved-entry draft conflict does not write');
        button(dialog(),'Close (keep adjustment draft)').click();
        button(document.getElementById('agenda-detail'),'Save work note').click();await wait(()=>!agendaPage.hasDraft());
        await window.openTimeCorrection({row:source});button(dialog(),'Refresh target metadata (keep dates)').click();await wait(()=>/Target identities\/revisions reloaded/.test(dialog().querySelector('[role=status]').textContent));
        await applyPreview();
        assert(document.querySelector('#workspace-current-note textarea').value==='Independent current-note typing' && window.multipleTimers.hasNoteDraft(timer.id),'unrelated current draft does not block or get discarded by saved correction');
        assert(current().id===timer.id && current().running_start===timer.running_start,'saved correction cannot retarget or edit current running timer');
        button(dialog(),'Discard adjustment draft').click();
        note.value+=' later unsaved';note.dispatchEvent(new Event('input',{bubbles:true}));
        assert(button(document.getElementById('agenda-detail'),'Save work note').disabled,'known time ACK blocks stale saved-note ownership while retaining later typing');
        assert(note.value.endsWith(' later unsaved'),'late saved-note input retained');
        await agendaPage.refresh();entry=document.querySelector(`[data-agenda-row="${id}"]`);
        window.confirm=()=>true;try{entry.click();}finally{window.confirm=confirm;}
        await window.multipleTimers.refresh();cardAction('Save current work note').click();await wait(()=>!window.multipleTimers.hasNoteDraft(timer.id));
        assert((await api.get('/timers/'+timer.id)).notes==='Independent current-note typing','explicit current-note save stays independent');
        window.__correctionActiveTimer=structuredClone(current());
        return {case:name,passed:true,timerId:timer.id,savedWorkId:id,explicitNavigationPrompts:prompts};
    }
    if(name==='lost_ack_recovery') {
        const bId=window.__correctionActiveTimer.id;
        await window.multipleTimers.start({notes:'Other parallel synthetic timer'});await window.multipleTimers.refresh();
        const other=structuredClone(current());window.multipleTimers.select(bId);
        const before=structuredClone(current());await window.openTimeCorrection({timer:before});
        set('Adjustment','set_start');set('IANA timezone','UTC');const proposed=new Date(Date.parse(before.running_start)+1000).toISOString();set('Local start',proposed.slice(0,-1));set('Start UTC offset','+00:00');
        const original=api.post.bind(api),events=[];let correctionPosts=0;
        const listen=event=>{if(event.detail.correction)events.push(event.detail);};window.addEventListener('timetrace:timer-mutated',listen);
        api.post=async(url,body)=>{const value=await original(url,body);if(url.endsWith('/correction') && ++correctionPosts===1)throw Error('Synthetic lost ACK after actual durable response');return value;};
        try {
            button(dialog(),'Preview (no write)').click();await wait(()=>!button(dialog(),'Apply this signed preview').disabled);
            button(dialog(),'Apply this signed preview').click();await wait(()=>window.multipleTimers.snapshot().receipt?.outcome==='uncertain' && !window.multipleTimers.snapshot().pending);
            const journal=structuredClone(window.multipleTimers.snapshot().receipt);
            assert(events.length===0,'no correction invalidation before ACK despite server completion');
            const changed=await api.get('/timers/'+before.id);assert(micros(changed.running_start)===micros(proposed),'real backend committed before response loss');
            button(dialog(),'Close (keep adjustment draft)').click();window.multipleTimers.select(other.id);
            const input=document.querySelector('#workspace-current-note textarea');input.value='Newer other-timer note typing';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(2,2);
            await window.multipleTimers.recover();await window.multipleTimers.refresh();
            assert(events.length===1 && events[0].operation_id===journal.payload.operation_id,'authoritative recovered ACK publishes exactly matching invalidation');
            assert(window.multipleTimers.snapshot().selectedTimerId===other.id,'late correction ACK cannot select old timer');
            assert(input.value==='Newer other-timer note typing' && document.activeElement===input && input.selectionStart===2,'newer owner typing/focus survives recovered ACK');
            assert(/acknowledged/.test(dialog().querySelector('[role=status]').textContent),'owned preview visibly settles after recovery');
            assert((await api.get('/timers/'+other.id)).running_start===other.running_start,'other actual interval unchanged');
            cardAction('Save current work note').click();await wait(()=>!window.multipleTimers.hasNoteDraft(other.id));
            assert(correctionPosts===1,'operation recovery sends no correction POST');
            window.__correctionLostAck={bId,otherId:other.id,journal};
            sessionStorage.setItem('timetrace_61_browser_fixture',JSON.stringify({plan:window.__correctionPlanFixture,active:before,lost:window.__correctionLostAck}));
            return {case:name,passed:true,operationId:journal.payload.operation_id,selected:other.id,correctionPosts,events:events.length};
        }finally{api.post=original;window.removeEventListener('timetrace:timer-mutated',listen);}
    }
    if(name==='prepare_reload_recovery') {
        const known=window.__correctionLostAck;await window.multipleTimers.refresh();window.multipleTimers.select(known.bId);
        const before=structuredClone(current());await window.openTimeCorrection({timer:before});
        set('Adjustment','set_start');set('IANA timezone','UTC');const proposed=new Date(Date.parse(before.running_start)+1000).toISOString();set('Local start',proposed.slice(0,-1));set('Start UTC offset','+00:00');
        const original=api.post.bind(api);let posts=0;
        api.post=async(url,body)=>{const value=await original(url,body);if(url.endsWith('/correction')){posts++;throw Error('Synthetic lost ACK before explicit reload');}return value;};
        try {
            button(dialog(),'Preview (no write)').click();await wait(()=>!button(dialog(),'Apply this signed preview').disabled);
            button(dialog(),'Apply this signed preview').click();await wait(()=>window.multipleTimers.snapshot().receipt?.outcome==='uncertain' && !window.multipleTimers.snapshot().pending);
            const exact=sessionStorage.getItem('timetrace_timer_v2_operation'),journal=JSON.parse(exact);
            button(dialog(),'Close (keep adjustment draft)').click();window.multipleTimers.select(known.otherId);
            history.replaceState(null,'','/agenda-view?'+new URLSearchParams({timer:known.otherId}));
            const data=JSON.parse(sessionStorage.getItem('timetrace_61_browser_fixture'));data.reload={exact,operationId:journal.payload.operation_id,bId:before.id,selectedId:known.otherId,proposed};sessionStorage.setItem('timetrace_61_browser_fixture',JSON.stringify(data));
            return {case:name,passed:true,operationId:journal.payload.operation_id,posts,selectedId:known.otherId};
        }finally{api.post=original;}
    }
    if(name==='verify_reload_recovery') {
        await window.multipleTimersReady;await window.multipleTimers.recover();await window.multipleTimers.refresh();
        const expected=fixture.reload,state=window.multipleTimers.snapshot();
        assert(state.lastResult?.operation_id===expected.operationId,'reload recovers original operation, not a new ID/preview');
        assert(state.selectedTimerId===expected.selectedId,'URL/newer selection remains authoritative');
        assert(!state.receipt && !sessionStorage.getItem('timetrace_timer_v2_operation'),'finalized journal cleared only after successful authoritative read');
        const stored=await api.get('/operations/'+expected.operationId),timer=await api.get('/timers/'+expected.bId);
        assert(stored.status==='finalized' && micros(timer.running_start)===micros(expected.proposed),'exact accepted geometry after reload');
        return {case:name,passed:true,operationId:expected.operationId,selectedId:state.selectedTimerId};
    }
    if(name==='hung_display_stop') {
        const bId=fixture.lost.bId;await window.multipleTimers.refresh();window.multipleTimers.select(bId);
        const before=structuredClone(current());await window.openTimeCorrection({timer:before});
        set('Adjustment','set_start');set('IANA timezone','UTC');const proposed=new Date(Date.parse(before.running_start)+1000).toISOString();set('Local start',proposed.slice(0,-1));set('Start UTC offset','+00:00');
        button(dialog(),'Preview (no write)').click();await wait(()=>!button(dialog(),'Apply this signed preview').disabled);
        const get=api.get.bind(api),post=api.post.bind(api),reads=[];let stopSent=false,correctionPosts=0,stopPosts=0;
        api.get=url=>url==='/timers'?new Promise((resolve,reject)=>reads.push(async()=>{try{resolve(await get(url));}catch(error){reject(error);}})):get(url);
        api.post=(url,body)=>{
            if(url.endsWith('/correction'))correctionPosts++;
            if(url.endsWith('/stop')){stopPosts++;return new Promise((resolve,reject)=>{window.__browserReleaseStop=async()=>{if(stopSent)return;stopSent=true;try{resolve(await post(url,body));}catch(error){reject(error);}};});}
            return post(url,body);
        };
        try {
            button(dialog(),'Apply this signed preview').click();await wait(()=>/acknowledged/.test(dialog().querySelector('[role=status]').textContent));
            assert(reads.length>0 && !window.multipleTimers.snapshot().pending,'ACK releases mutation phase before hung display GET');
            assert(/awaiting authoritative read/.test(document.querySelector('.workspace-clock').textContent),'no fabricated zero/live total after ACK');
            button(dialog(),'Discard adjustment draft').click();
            assert(!cardAction('Stop & record').disabled,'valid Stop remains available from authoritative target ACK');
            const old=window.multipleTimers.snapshot().lastResult.operation_id;
            cardAction('Stop & record').click();assert(window.__browserReleaseStop && window.multipleTimers.snapshot().pending,'new Stop owns writer phase');
            await reads[0]();await Promise.resolve();
            assert(window.multipleTimers.snapshot().pending,'older display read/finally cannot release new Stop');
            await window.__browserReleaseStop();await wait(()=>window.multipleTimers.snapshot().lastResult.operation_id!==old);
            const result=window.multipleTimers.snapshot().lastResult;assert(result.timer.state==='stopped' && result.recorded_work_ids.length===1,'real corrected running work persisted once');
            api.get=get;
            for(const read of reads.slice(1))await read();await window.multipleTimers.refresh();
            const saved=await api.get('/recorded-work/'+result.recorded_work_ids[0]);assert(micros(saved.start_time)===micros(proposed),'late GET cannot restore old actual start');
            assert(correctionPosts===1 && stopPosts===1,'display recovery sends GET only, never repeats either write');
            return {case:name,passed:true,correctionPosts,stopPosts,workId:saved.id};
        }finally{api.get=get;api.post=post;if(window.__browserReleaseStop && !stopSent)await window.__browserReleaseStop();for(const read of reads)void read();}
    }
    if(name==='dst_gap_fold') {
        const spring=await api.post('/recorded-work',{start_time:'2026-03-08T06:30:00Z',end_time:'2026-03-08T08:30:00Z',notes:'Synthetic DST spring'});
        await window.openTimeCorrection({row:spring});
        set('Adjustment','set_start');set('IANA timezone','America/New_York');set('Local start','2026-03-08T02:30:00');set('Start UTC offset','-05:00');
        button(dialog(),'Preview (no write)').click();await wait(()=>/Preview refused/.test(dialog().querySelector('[role=status]').textContent));
        assert(button(dialog(),'Apply this signed preview').disabled,'nonexistent spring hour cannot be approved');
        assert((await api.get('/recorded-work/'+spring.id)).revision===spring.revision,'gap refusal never writes');
        button(dialog(),'Discard adjustment draft').click();
        const fall=await api.post('/recorded-work',{start_time:'2026-11-01T04:30:00Z',end_time:'2026-11-01T08:30:00Z',notes:'Synthetic DST fold'});
        await window.openTimeCorrection({row:fall});
        set('Adjustment','set_start');set('IANA timezone','America/New_York');set('Local start','2026-11-01T01:30:00');set('Start UTC offset','');
        button(dialog(),'Preview (no write)').click();await wait(()=>/explicit UTC offset/.test(dialog().querySelector('[role=status]').textContent));
        assert(button(dialog(),'Apply this signed preview').disabled,'fold is not guessed without offset');
        const original=api.post.bind(api);let preview;
        api.post=async(url,body)=>{const value=await original(url,body);if(url.endsWith('/correction-preview'))preview=value;return value;};
        try {
            set('Start UTC offset','-04:00');button(dialog(),'Preview (no write)').click();await wait(()=>!button(dialog(),'Apply this signed preview').disabled);const first=structuredClone(preview.plan);
            set('Start UTC offset','-05:00');assert(button(dialog(),'Apply this signed preview').disabled,'changed offset requires new signed preview');
            button(dialog(),'Preview (no write)').click();await wait(()=>!button(dialog(),'Apply this signed preview').disabled);const second=structuredClone(preview.plan);
            assert(Date.parse(second.after.start_utc)-Date.parse(first.after.start_utc)===3600000,'fold choices are distinct exact instants');
            assert(first.duration_seconds-second.duration_seconds===3600,'signed durations reflect elapsed UTC, not wall-clock ambiguity');
            button(dialog(),'Apply this signed preview').click();await wait(()=>/acknowledged/.test(dialog().querySelector('[role=status]').textContent));
            const saved=await api.get('/recorded-work/'+fall.id);assert(Date.parse(saved.start_time)===Date.parse('2026-11-01T06:30:00Z'),'explicit second-fold choice committed');
            button(dialog(),'Discard adjustment draft').click();
            return {case:name,passed:true,gapRefused:true,first:first.after,second:second.after};
        }finally{api.post=original;}
    }
    if(name==='start_day_rebucket') {
        const row=await api.post('/recorded-work',{start_time:'2026-11-22T21:30:00Z',end_time:'2026-11-22T23:15:00Z',notes:'Synthetic local-day movement'});
        const date=document.getElementById('agenda-date');date.value='2026-11-23';date.dispatchEvent(new Event('change',{bubbles:true}));await agendaPage.refresh();
        const entry=()=>document.querySelector(`[data-agenda-row="${row.id}"]`);
        assert(entry()?.closest('details').querySelector('summary').textContent.includes('2026-11-22'),'carry-in grouped by its original local start day');
        const before=await api.get('/recorded-work-progress?start_date=2026-11-23&end_date=2026-11-23');
        await window.openTimeCorrection({row});set('Adjustment','set_start');set('IANA timezone','Europe/Warsaw');set('Local start','2026-11-23T00:00:00');set('Start UTC offset','+01:00');
        const result=await applyPreview();button(dialog(),'Discard adjustment draft').click();await agendaPage.refresh();
        assert(result.correction.timezone==='Europe/Warsaw' && result.correction.affected_local_dates.join(',')==='2026-11-22,2026-11-23','ACK exposes authoritative actual read-cohort timezone and both local days');
        assert(entry()?.closest('details').querySelector('summary').textContent.includes('2026-11-23'),'known correction moves retained row out of wrong cohort');
        const after=await api.get('/recorded-work-progress?start_date=2026-11-23&end_date=2026-11-23');
        assert(Math.abs(after.unassigned_recorded_time.total-before.unassigned_recorded_time.total-0.25)<1e-6,'authoritative unassigned read includes newly rebucketed fifteen minutes');
        const report=await api.post('/api/agenda/history-export/preview',{start_date:'2026-11-23',end_date:'2026-11-23',timezone:'Europe/Warsaw',mode:'selected',selected_ids:[row.id]});
        assert(report.work_count===1 && report.summed_recorded_work_seconds===900,'existing exact export cohort follows local start date');
        assert((await api.get('/recorded-work/'+row.id)).timezone==='UTC','stored descriptive timezone metadata remains unchanged');
        return {case:name,passed:true,workId:row.id,before:before.unassigned_recorded_time.total,after:after.unassigned_recorded_time.total};
    }
    if(name==='exact_uncertain_retry') {
        await window.multipleTimers.refresh();const before=structuredClone(current());await window.openTimeCorrection({timer:before});
        set('Adjustment','set_start');set('IANA timezone','UTC');const proposed=new Date(Date.parse(before.running_start)+1000).toISOString();set('Local start',proposed.slice(0,-1));set('Start UTC offset','+00:00');
        const original=api.post.bind(api),wire=[];
        api.post=async(url,body)=>{if(url.endsWith('/correction')){wire.push({url,body:structuredClone(body)});if(wire.length===1)throw Error('Synthetic request not delivered; outcome unknown');}return original(url,body);};
        try {
            button(dialog(),'Preview (no write)').click();await wait(()=>!button(dialog(),'Apply this signed preview').disabled);
            button(dialog(),'Apply this signed preview').click();await wait(()=>window.multipleTimers.snapshot().receipt?.outcome==='uncertain' && !window.multipleTimers.snapshot().pending);
            const journal=structuredClone(window.multipleTimers.snapshot().receipt);
            await window.multipleTimers.recover();assert(window.multipleTimers.snapshot().receipt.outcome==='uncertain','not-found lookup never silently regenerates approval or new key');
            button(dialog(),'Close (keep adjustment draft)').click();
            const retry=[...document.querySelectorAll('#multiple_timers button')].find(b=>b.textContent==='Retry same operation');assert(retry && !retry.disabled,'explicit exact retry offered');retry.click();
            await wait(()=>window.multipleTimers.snapshot().lastResult?.operation_id===journal.payload.operation_id);
            assert(wire.length===2 && JSON.stringify(wire[0])===JSON.stringify(wire[1]),'identical URL/key/signed payload retry, no defaults or recomputation');
            assert(micros((await api.get('/timers/'+before.id)).running_start)===micros(proposed),'retried exact geometry committed once');
            assert(/acknowledged/.test(dialog().querySelector('[role=status]').textContent),'retained preview settled by matching retry ACK');
            return {case:name,passed:true,operationId:journal.payload.operation_id,identicalPosts:wire.length};
        }finally{api.post=original;}
    }
    if(name==='mixed_members') {
        await window.multipleTimers.refresh();let timer=structuredClone(current());
        await window.multipleTimers.act(timer.id,'split',{expected_revision:timer.revision,new_notes:'Unfinished new context'});await window.multipleTimers.refresh();
        const split=window.multipleTimers.snapshot().lastResult,savedId=split.recorded_work_ids[0];assert(savedId,'existing Split persisted real older work');
        cardAction('Pause').click();await wait(()=>current()?.state==='paused');timer=structuredClone(current());
        const saved=await api.get('/recorded-work/'+savedId),buffer=timer.segments.find(s=>s.id===timer.manual_pause_note_segment_id);
        await window.openTimeCorrection({timer});
        const labels=dialog().querySelector('fieldset').textContent;assert(labels.includes('"kind":"saved"') && labels.includes('"kind":"buffered"'),'actual DB-bound and buffer choices, not guessed ownership');
        [...dialog().querySelectorAll('fieldset input')].forEach(box=>{box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));});
        set('Adjustment','exclude');set('IANA timezone','UTC');const start=new Date(Date.parse(saved.end_time)-1).toISOString(),end=new Date(Date.parse(buffer.start_time)+1).toISOString();
        assert(Date.parse(end)<Date.parse(buffer.end_time),'buffer remains positive');
        set('Local start',start.slice(0,-1));set('Start UTC offset','+00:00');set('Local exclusion end',end.slice(0,-1));set('End UTC offset','+00:00');
        const corrected=await applyPreview();assert(current().state==='paused','mixed saved/buffer operation never resumes');
        const updated=await api.get('/recorded-work/'+savedId);
        assert(micros(updated.end_time)===micros(start),'saved row authoritative geometry updated');
        assert(micros(current().segments.find(s=>s.recorded_work_id===savedId).end_time)===micros(start),'file summary cannot later resurrect saved time');
        assert(micros(current().segments.find(s=>s.id===buffer.id).start_time)===micros(end),'buffer trimmed atomically in same operation');
        button(dialog(),'Discard adjustment draft').click();cardAction('Resume').click();await wait(()=>current()?.state==='running');
        const data=JSON.parse(sessionStorage.getItem('timetrace_61_browser_fixture'));data.freeze={timerId:timer.id,savedId};sessionStorage.setItem('timetrace_61_browser_fixture',JSON.stringify(data));
        return {case:name,passed:true,changed:corrected.correction.changed_work_ids,timerId:timer.id,savedId};
    }
    if(name==='frozen_review') {
        const known=fixture.freeze;await window.multipleTimers.refresh();window.multipleTimers.select(known.timerId);
        const before=structuredClone(current());assert(before.state==='frozen','real public-service idle capture, not mocked DOM state');
        assert(window.multipleTimers.snapshot().fresh,'authoritative frozen state loaded');
        const controls=[...document.querySelectorAll('#workspace-current-timer button')].filter(b=>['−','+','Adjust time','Resume','Stop & record'].includes(b.textContent));
        assert(controls.every(b=>b.disabled),'all clock correction/write controls visibly disabled for frozen timer');
        assert(document.querySelector('#workspace-current-timer a[href="#multiple_timers"]'),'shared recovery link visible by clock');
        const saved=await api.get('/recorded-work/'+known.savedId);await window.openTimeCorrection({row:saved});
        set('Adjustment','set_start');set('IANA timezone','UTC');set('Local start',new Date(Date.parse(saved.start_time)+1000).toISOString().slice(0,-1));set('Start UTC offset','+00:00');
        button(dialog(),'Preview (no write)').click();await wait(()=>/Preview refused/.test(dialog().querySelector('[role=status]').textContent));
        assert(button(dialog(),'Apply this signed preview').disabled,'saved route cannot bypass unfinished-owner idle refusal');
        assert(JSON.stringify((await api.get('/timers/'+known.timerId)).idle_gaps)===JSON.stringify(before.idle_gaps),'refused preview leaves gaps byte-equivalent');
        dialog().querySelector('a[href="#multiple_timers"]').click();
        const decision=document.querySelector('[data-idle-review-list] select');assert(decision,'existing shared review, not new resolution flow');decision.value='discard';decision.dispatchEvent(new Event('change',{bubbles:true}));
        const apply=document.querySelector('[data-idle-apply]');assert(!apply.disabled,'explicit absence decision selected');apply.click();await wait(()=>current()?.state==='paused');
        assert(current().idle_gaps.at(-1).decision==='discard' && current().running_start===null,'explicit review never implicitly resumes');
        button(dialog(),'Discard adjustment draft').click();
        return {case:name,passed:true,gapId:before.idle_gaps.at(-1).id,afterState:current().state};
    }
    if(name==='prepare_layout') {
        await window.multipleTimers.start({task_id:fixture.plan.task.id,notes:'Desktop and narrow correction layout'});await window.multipleTimers.refresh();
        const data=JSON.parse(sessionStorage.getItem('timetrace_61_browser_fixture'));data.layoutTimerId=current().id;sessionStorage.setItem('timetrace_61_browser_fixture',JSON.stringify(data));
        return {case:name,passed:true,timerId:current().id};
    }
    if(name==='layout') {
        await window.multipleTimers.refresh();window.multipleTimers.select(fixture.layoutTimerId);
        const root=document.getElementById('workspace-current-timer'),row=root.querySelector('[data-timer-correction-actions]'),steps=[...root.querySelectorAll('.correction-step')];
        assert(row && row.parentElement===root.querySelector('[data-current-display]'),'one current-card action row');
        assert([...row.querySelectorAll('button')].map(b=>b.textContent).join('|')==='Edit task|Adjust time|Pause|Stop & record','full editor and independent timer actions stay in wrapping row');
        const circles=steps.map(step=>{const rect=step.getBoundingClientRect(),style=getComputedStyle(step);assert(Math.abs(rect.width-32)<1 && Math.abs(rect.height-32)<1 && style.borderRadius==='50%','subtle B circle geometry, not inherited square padding');assert(step.getAttribute('aria-label').includes('five credited minutes') && step.title.includes(current().running_start),'accessible credited effect and exact actual interval');return {width:rect.width,height:rect.height,radius:style.borderRadius};});
        const bounds=root.getBoundingClientRect(),buttons=[...row.querySelectorAll('button')].map(b=>b.getBoundingClientRect());
        assert(buttons.every(r=>r.left>=bounds.left && r.right<=bounds.right),'action controls do not overflow current card');
        const lines=new Set(buttons.map(r=>Math.round(r.top)));
        if(innerWidth<500)assert(lines.size>1,'narrow action row actually wraps');
        cardAction('Adjust time').click();await wait(()=>dialog()?.open && !button(dialog(),'Preview (no write)').disabled);
        const panel=dialog().getBoundingClientRect();assert(panel.left>=0 && panel.right<=innerWidth,'dated picker fits viewport');
        button(dialog(),'Discard adjustment draft').click();
        return {case:name,passed:true,viewport:{width:innerWidth,height:innerHeight},circles,actionLines:lines.size,panel:{left:panel.left,right:panel.right,width:panel.width}};
    }
    if(name==='calendar_reads') {
        assert(typeof calendar==='object' && calendar,'existing Calendar loaded');
        const events=calendar.getEvents(),actual=events.filter(e=>e.extendedProps.kind==='recorded_work'),plans=events.filter(e=>e.extendedProps.kind==='scheduled_session');
        assert(actual.length>4 && plans.length>0 && document.querySelector('.fc-event'),'real existing Calendar DOM, not API-only substitute');
        for(const event of actual){const row=await api.get('/recorded-work/'+event.id);assert(Date.parse(event.startStr)===Date.parse(row.start_time) && Date.parse(event.endStr)===Date.parse(row.end_time),'Calendar actual source matches retained DB geometry at renderer millisecond precision');assert(event.extendedProps.revision===row.revision,'actual revision current');}
        for(const event of plans){const plan=await api.get('/scheduled-sessions/'+event.id);assert(Date.parse(event.startStr)===Date.parse(plan.start_time) && Date.parse(event.endStr)===Date.parse(plan.end_time),'current schedule unchanged');assert(Date.parse(event.extendedProps.originalStart)===Date.parse(plan.original_start) && Date.parse(event.extendedProps.originalEnd)===Date.parse(plan.original_end),'original schedule preserved');}
        const unicode=actual.filter(e=>e.extendedProps.notes==='Synthetic café Ω report note').sort((a,b)=>a.start-b.start);assert(unicode.length===2 && unicode[1].start-unicode[0].end===60000,'existing Calendar shows exact real minute exclusion, not shifted timestamps');
        const source=await api.get('/recorded-work/'+unicode[1].id),resource='/recorded-work/'+source.id,proposed=new Date(Date.parse(source.start_time)+1000).toISOString();
        const refetch=calendar.refetchEvents.bind(calendar);let reads=0;calendar.refetchEvents=()=>{reads++;return refetch();};
        try {
            const approved=await window.multipleTimers.previewCorrection(resource,{target:{kind:'saved',work_id:source.id,expected_revision:source.revision},change:{kind:'set_start',start_utc:proposed,timezone:'UTC',local_datetime:proposed.slice(0,-1),offset_seconds:0}});
            assert(reads===0,'preview emits no mutation or Calendar invalidation');
            assert(await window.multipleTimers.commitCorrection(resource,approved),'actual signed controller commit');
            await wait(()=>calendar.getEventById(source.id)?.extendedProps.revision===source.revision+1);
            assert(reads>0 && Date.parse(calendar.getEventById(source.id).startStr)===Date.parse(proposed),'ACK refetches existing actual-work source, not a browser-only counter');
            assert(calendar.getEventById(unicode[0].id).end-unicode[0].end===0,'other retained fragment unchanged');
            return {case:name,passed:true,actualCount:actual.length,planCount:plans.length,ackRefetches:reads,changedId:source.id};
        }finally{calendar.refetchEvents=refetch;}
    }
    if(name==='running_plus') {
        await window.multipleTimers.refresh();
        const state=window.multipleTimers.snapshot();
        const before=structuredClone(state.timers.find(t=>t.id===state.selectedTimerId));
        assert(before?.state==='running','explicit selected running timer');
        const original=api.post.bind(api), wire=[];let approved;
        api.post=async(url,body)=>{
            if(url.endsWith('/correction')) {
                const journal=JSON.parse(sessionStorage.getItem('timetrace_timer_v2_operation'));
                assert(journal.url===url && JSON.stringify(journal.payload)===JSON.stringify(body),'exact signed request journaled before write');
                assert(Object.keys(body).sort().join(',')==='operation_id,preview','no legacy mutation defaults');
                wire.push({url,body:structuredClone(body)});
            }
            const result=await original(url,body);
            if(url.endsWith('/correction-preview'))approved=result;
            return result;
        };
        try {
            [...document.querySelectorAll('#workspace-current-timer .correction-step')].find(b=>b.textContent==='+').click();
            await wait(()=>dialog()?.open && !button(dialog(),'Preview (no write)').disabled);
            button(dialog(),'Preview (no write)').click();
            await wait(()=>!button(dialog(),'Apply this signed preview').disabled);
            assert(wire.length===0,'preview never journals/sends a mutation');
            const plan=approved.plan||approved;
            assert(Date.parse(plan.before.start_utc)-Date.parse(plan.after.start_utc)===300000,'signed effect is exactly five credited minutes');
            const old=window.multipleTimers.snapshot().lastResult?.operation_id;
            button(dialog(),'Apply this signed preview').click();
            await wait(()=>window.multipleTimers.snapshot().lastResult?.operation_id!==old && /acknowledged/.test(dialog().querySelector('[role=status]').textContent));
            const result=window.multipleTimers.snapshot().lastResult;
            assert(result.timer.state==='running','no implicit pause/resume');
            assert(result.timer.running_start===plan.after.start_utc,'ACK preserves signed actual start');
            assert(result.correction.before.end_utc===result.correction.after.end_utc,'same accepted cutoff, not shifted timestamps');
            assert(wire.length===1,'exactly one commit');
            assert(window.multipleTimers.snapshot().selectedTimerId===before.id,'selection retained');
            assert(result.timer.task_id===before.task_id && result.timer.scheduled_session_id===before.scheduled_session_id,'association unchanged');
            button(dialog(),'Discard adjustment draft').click();
            return {case:name,passed:true,operationId:result.operation_id,before:result.correction.before,after:result.correction.after};
        } finally {api.post=original;}
    }
    if(name==='discard') {
        const current=document.querySelector('#workspace-current-note textarea');
        const note=current?.value;
        assert(dialog()?.open,'an explicit adjustment draft is open');
        const discard=button(dialog(),'Discard adjustment draft');
        assert(discard,'explicit discard must exist independently of close/keep');
        discard.click();
        assert(!dialog().open,'discard closes only the adjustment');
        assert(current?.value===note,'independent current-note input is unchanged');
        assert(!window.multipleTimers.snapshot().pending,'no timer mutation was sent');
        return {case:name,passed:true,noteRetained:true};
    }
    throw Error(`Unknown explicit browser case: ${name}`);
}
