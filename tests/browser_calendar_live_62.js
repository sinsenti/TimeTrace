/** Load in the owned Orca page. Calls never intentionally cross navigation boundaries. */
async function calendarLive62(name) {
    const check=(ok,text)=>{if(!ok)throw Error(`${name}: ${text}`);};
    check(location.origin==='http://127.0.0.1:18622','owned synthetic origin');
    check((await api.get('/health')).db_file==='/tmp/tt62-browser.O8Kcff/db.sqlite','isolated fixture');
    await multipleTimersReady;
    const control=window.multipleTimers;
    const live=()=>calendar.getEvents().filter(e=>e.extendedProps.kind==='live_work');
    if(name==='pause-resume-stop') {
        await control.refresh();
        const timer=control.snapshot().timers[0];check(timer,'existing taskless timer');
        const act=async action=>{await control.refresh();const t=control.snapshot().timers.find(t=>t.id===timer.id);check(await control.act(t.id,action,{expected_revision:t.revision}),action);await control.refresh();};
        await act('pause');
        const paused=live().map(e=>({id:e.id,start:+e.start,end:+e.end}));
        check(paused.length>0,'paused live coverage retained');
        await control.refresh();check(JSON.stringify(paused)===JSON.stringify(live().map(e=>({id:e.id,start:+e.start,end:+e.end}))),'pause fixed');
        check(live().every(e=>e.startEditable===false||e.extendedProps.kind==='live_work'),'live is typed');
        await act('resume');await control.refresh();
        const t=control.snapshot().timers.find(t=>t.id===timer.id);
        check(t.running_segment_id!==t.segments[0].id,'independent continuation identity');
        check(live().length>=1,'buffer remains visible');
        await act('stop');
        check(!live().some(e=>e.extendedProps.timer_id===timer.id),'Stop removes live immediately');
        const result=control.snapshot().lastResult;
        check(result.recorded_work_ids.length>0,'saved identities ACK');
        await refreshSessionDisplay();
        const work=await Promise.all(result.recorded_work_ids.map(id=>api.get(`/recorded-work/${id}`)));
        check(work.every(w=>Date.parse(w.end_time)>Date.parse(w.start_time)),'positive exact saved intervals');
        return {passed:true,paused,work};
    }
    if(name==='correction-fixture') {
        const task=await api.post('/api/tasks',{title:'Calendar 62 synthetic task'});
        const start=new Date(Date.now()-3600000).toISOString(),end=new Date(Date.now()-1800000).toISOString();
        const plan=await api.post('/scheduled-sessions',{task_id:task.id,start_time:start,end_time:end});
        const legacy=await api.post('/sessions',{start_time:start,end_time:end,notes:'uncertain synthetic'});
        const result=await api.post('/timers',{task_id:task.id,notes:'current note',operation_id:crypto.randomUUID()});
        await control.refresh();await control.initializeCorrections();await control.refresh();
        const t=control.snapshot().timers.find(t=>t.id===result.timer.id);
        const resource=`/timers/${t.id}`;
        const preview=await control.previewCorrection(resource,{target:{kind:'running',segment_id:t.running_segment_id},change:{kind:'step_start',credited_delta_seconds:300}});
        check(await control.commitCorrection(resource,preview),'signed running start');await control.refresh();
        const corrected=control.snapshot().timers.find(item=>item.id===t.id);
        check(live().some(e=>e.extendedProps.timer_id===t.id),'corrected live source');
        await api.put(`/api/tasks/${task.id}`,{title:'Renamed Calendar synthetic task'});
        await control.refresh();check(live().some(e=>e.title.includes('Renamed Calendar synthetic task')),'task rename reflected');
        check((await api.get(`/scheduled-sessions/${plan.id}`)).start_time===plan.start_time,'plan unchanged');
        check((await api.get(`/sessions/${legacy.id}`)).notes==='uncertain synthetic','legacy unchanged');
        sessionStorage.setItem('calendar62fixture',JSON.stringify({task,plan,legacy,timer:t.id}));
        return {passed:true,timer:corrected.id,plan:plan.id,legacy:legacy.id};
    }
    if(name==='mixed-exclusion') {
        await control.refresh();
        const fixture=JSON.parse(sessionStorage.getItem('calendar62fixture'));
        let t=control.snapshot().timers.find(t=>t.id===fixture.timer);
        const path=`/timers/${t.id}`;
        const start=new Date(Date.parse(t.running_start)+60000).toISOString();
        const end=new Date(Date.parse(t.running_start)+120000).toISOString();
        const beforePieces=live().filter(e=>e.extendedProps.timer_id===t.id).length;
        const preview=await control.previewCorrection(path,{target:{kind:'running',segment_id:t.running_segment_id},change:{kind:'exclude',start_utc:start,end_utc:end,timezone:'UTC',start_local_datetime:start.slice(0,-1),end_local_datetime:end.slice(0,-1),start_offset_seconds:0,end_offset_seconds:0}});
        check(await control.commitCorrection(path,preview),'exact signed exclusion');await control.refresh();
        const pieces=live().filter(e=>e.extendedProps.timer_id===t.id);
        check(pieces.length===beforePieces+1,'exact retained live fragment increment');
        check(pieces.some(e=>Date.parse(e.endStr)===Date.parse(start))&&pieces.some(e=>Date.parse(e.startStr)===Date.parse(end)),'no projected break');
        t=control.snapshot().timers.find(t=>t.id===fixture.timer);
        check(await control.act(t.id,'split',{expected_revision:t.revision,new_notes:'new current note'}),'split saved context');await control.refresh();
        t=control.snapshot().timers.find(t=>t.id===fixture.timer);
        check(t.segments.some(s=>s.recorded_work_id),'committed fragments exist');
        const ids=live().map(e=>e.id);
        check(t.segments.filter(s=>s.recorded_work_id).every(s=>!ids.includes(`live:${t.id}:${s.id}`)),'no double-draw committed fragments');
        check(live().some(e=>e.title.includes('new current note')),'current note refresh');
        const saved=t.segments.find(s=>s.recorded_work_id);
        const row=await api.get(`/recorded-work/${saved.recorded_work_id}`);
        await api.request(`/recorded-work/${row.id}/note`,{method:'PATCH',body:JSON.stringify({notes:'saved separate note',expected_revision:row.revision})});
        await refreshSessionDisplay();
        check((await api.get(`/recorded-work/${row.id}`)).notes==='saved separate note','saved note independently refreshed');
        check((await api.get(`/scheduled-sessions/${fixture.plan.id}`)).start_time===fixture.plan.start_time,'plan start unchanged');
        return {passed:true,timer:t.id,committed:t.segments.filter(s=>s.recorded_work_id).length};
    }
    if(name==='lost-stop-ack') {
        await control.refresh();
        const id=sessionStorage.getItem('calendar62other');
        const timer=control.snapshot().timers.find(t=>t.id===id);check(timer,'parallel timer');
        const post=api.post.bind(api);
        api.post=async (url,payload)=>{const result=await post(url,payload);if(url===`/timers/${id}/stop`)throw Error('synthetic lost ACK');return result;};
        try {check(!await control.act(id,'stop',{expected_revision:timer.revision}),'lost ACK remains uncertain');}
        finally {api.post=post;}
        check(control.snapshot().receipt.outcome==='uncertain','journal retained');
        sessionStorage.setItem('calendar62stopped',id);
        return {passed:true,phase:'reload now',id};
    }
    if(name==='recovered-stop') {
        await control.recover();await control.refresh();
        const id=sessionStorage.getItem('calendar62stopped');check(id,'stopped fixture');
        check(!control.snapshot().timers.some(t=>t.id===id),'recovery never resurrects stopped timer');
        check(!live().some(e=>e.extendedProps.timer_id===id),'no recovered live double draw');
        let posts=0;const post=api.post.bind(api);api.post=(...args)=>{posts++;return post(...args);};
        try {await control.retry();await control.recover();await control.refresh();}finally{api.post=post;}
        check(posts===0,'acknowledged recovery retries read only');
        return {passed:true,posts};
    }
    if(name==='saved-split') {
        const fixture=JSON.parse(sessionStorage.getItem('calendar62fixture'));
        const agenda=await api.get(`/agenda?start=${fixture.plan.start_time}&end=${new Date().toISOString()}`);
        const row=agenda.items.find(r=>r.kind==='recorded_work'&&r.task_id===fixture.task.id&&Date.parse(r.end_time)-Date.parse(r.start_time)>30000);
        check(row,'saved fragment');
        const start=new Date(Date.parse(row.start_time)+10000).toISOString(),end=new Date(Date.parse(row.start_time)+20000).toISOString();
        const path=`/recorded-work/${row.id}`;
        const preview=await control.previewCorrection(path,{target:{kind:'saved',work_id:row.id,expected_revision:row.revision},change:{kind:'exclude',start_utc:start,end_utc:end,timezone:'UTC',start_local_datetime:start.slice(0,-1),end_local_datetime:end.slice(0,-1),start_offset_seconds:0,end_offset_seconds:0}});
        check(await control.commitCorrection(path,preview),'saved split ACK');await control.refresh();await refreshSessionDisplay();
        const mapping=control.snapshot().lastResult.correction.work_fragments.find(f=>f.source_work_id===row.id);
        check(mapping.work_ids.length===2&&mapping.work_ids[0]===row.id,'saved stable earliest identity');
        const rows=await Promise.all(mapping.work_ids.map(id=>api.get(`/recorded-work/${id}`)));
        check(Date.parse(rows[0].end_time)===Date.parse(start)&&Date.parse(rows[1].start_time)===Date.parse(end),'saved exact gap');
        check(rows.every(r=>r.notes===row.notes),'saved descriptions preserved');
        check(!live().some(e=>mapping.work_ids.some(id=>e.id.includes(id))),'saved never relabeled live');
        check((await api.get(`/scheduled-sessions/${fixture.plan.id}`)).start_time===fixture.plan.start_time,'saved correction plan unchanged');
        return {passed:true,ids:mapping.work_ids};
    }
    if(name==='full-task-editor') {
        const fixture=JSON.parse(sessionStorage.getItem('calendar62fixture'));
        await openEditTaskModal(fixture.task.id);
        const title=document.getElementById('modal_input_title'),desc=document.getElementById('modal_input_desc');
        title.value='Full editor Calendar task';title.dispatchEvent(new Event('input',{bubbles:true}));
        desc.value='Full task description remains separate';desc.dispatchEvent(new Event('input',{bubbles:true}));
        await control.refresh();
        check(title.value==='Full editor Calendar task'&&desc.value==='Full task description remains separate','background status keeps full editor draft');
        await saveTask();
        const saved=await api.get(`/api/tasks/${fixture.task.id}`);
        check(saved.title==='Full editor Calendar task'&&saved.description==='Full task description remains separate','normal full editor save');
        await control.refresh();
        const t=control.snapshot().timers.find(t=>t.id===fixture.timer);
        check(t.task_title===saved.title&&t.notes==='new current note','task metadata separate from work note');
        return {passed:true,title:saved.title};
    }
    if(name==='late-status-stop') {
        const created=await api.post('/timers',{operation_id:crypto.randomUUID(),notes:'late status fixture'});
        await control.refresh();
        const old=await api.get('/timers'),get=api.get.bind(api);
        let release,reads=0;
        const held=new Promise(resolve=>{release=resolve;});
        api.get=url=>url==='/timers'?(++reads===1?held:new Promise(()=>{})):get(url);
        try {
            const pending=control.refresh();
            check(await control.act(created.timer.id,'stop',{expected_revision:created.timer.revision}),'Stop ACK while status held');
            release(old);await pending;
            check(!control.snapshot().timers.some(t=>t.id===created.timer.id),'late status rejected');
            check(!live().some(e=>e.extendedProps.timer_id===created.timer.id),'late live rejected');
        } finally {api.get=get;}
        await control.refresh();
        return {passed:true,id:created.timer.id};
    }
    if(name==='late-range-stop') {
        await control.refresh();const t=control.snapshot().timers[0];check(t,'unfinished timer');
        const get=api.get.bind(api);let release,held=false;
        const blocked=new Promise(resolve=>{release=resolve;});
        api.get=async url=>{const data=await get(url);if(url.startsWith('/agenda?')&&!held){held=true;await blocked;}return data;};
        try {
            calendar.refetchEvents();
            for(let n=0;n<100&&!held;n++)await new Promise(resolve=>setTimeout(resolve,10));
            check(held,'old range is held');
            check(await control.act(t.id,'stop',{expected_revision:t.revision}),'paused Stop ACK');
            release();await control.refresh();await refreshSessionDisplay();
            check(!live().some(e=>e.extendedProps.timer_id===t.id),'late range cannot restore live');
            const ids=calendar.getEvents().map(e=>e.id);check(new Set(ids).size===ids.length,'stable distinct source identities');
            return {passed:true,stopped:t.id};
        } finally {release();api.get=get;}
    }
    if(name==='readiness')return {passed:!!calendar.getEventSourceById('unfinished-live-work'),url:location.href,state:control.snapshot()};
    throw Error('Unknown case');
}
