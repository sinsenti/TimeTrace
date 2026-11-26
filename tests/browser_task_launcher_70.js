/** Guarded real-app probes, invoked with Orca eval on the synthetic launcher daemon.
 * No fixture overlays, provider calls, real notifications, database access or storage resets.
 */
async function runTaskLauncherCase(name) {
    const assert=(value,message)=>{if(!value)throw Error(`${name}: ${message}`);};
    assert(['late_ack','lost_ack'].includes(name),'choose an explicit verification case');
    assert(location.origin==='http://127.0.0.1:18131','owned synthetic origin required');
    const health=await api.get('/health');
    assert(health.db_file.startsWith('/tmp/timetrace-launcher-browser-'),'isolated synthetic data required');
    assert(!document.querySelector('dialog[open]'),'close dialogs first');
    assert(!multipleTimers.hasNoteDraft()&&!multipleTimers.hasFocusDraft?.(),'clean timer editors required');
    const launcher=window.agendaTaskLauncher||window.sharedTaskLauncher;
    assert(launcher&&launcher.model.snapshot().query==='','clean search required');
    await multipleTimers.refresh();
    await launcher.model.input('Reading');
    const state=launcher.model.snapshot();
    assert(state.rows[state.activeIndex]?.title==='Reading','ordinary synthetic Reading task required');
    const original=window.fetch.bind(window);let posts=0,reads=0,release,received;
    const responseReceived=new Promise(resolve=>{received=resolve;});
    window.fetch=async(...args)=>{
        const url=String(args[0]),options=args[1];
        if(url.includes('/operations/')&&(!options?.method||options.method==='GET'))reads++;
        const response=await original(...args);
        if(options?.method==='POST'&&url.endsWith('/timers')){
            posts++;const payload=JSON.parse(options.body);
            assert(payload.task_id===state.rows[state.activeIndex].id,'captured task ID only');
            assert(!('scheduled_session_id' in payload)&&!('notes' in payload),'no implicit plan/note reuse');
            if(name==='late_ack')return new Promise(resolve=>{release=()=>resolve(response);received();});
            if(name==='lost_ack')throw Error('Synthetic lost Start response');
        }
        return response;
    };
    const url=location.href;
    try{
        const starting=launcher.model.key({key:'Enter'});
        if(name==='late_ack'){
            await responseReceived;
            await launcher.model.input('Review');
            release();await starting;
            assert(launcher.model.snapshot().query==='Review','newer query retained');
            assert((window.agendaTaskLauncher?document.querySelector('#agenda-search'):document.querySelector('[data-launcher-input]')).value==='Review','actual field retains typing');
            assert(!launcher.model.snapshot().pending,'own ACK releases writer UI');
            assert(posts===1,'exactly one Start');
        }else if(name==='lost_ack'){
            assert(await starting===false,'unknown response retained');
            assert(multipleTimers.snapshot().receipt?.outcome==='uncertain','original safety journal retained');
            await launcher.model.key({key:'Enter'});
            assert(posts===1,'fresh Enter cannot replay an unknown Start');
            await multipleTimers.recover();
            assert(reads===1&&posts===1,'one read-only recovery, no repeat Start');
            assert(launcher.model.snapshot().query==='','confirmed original query clears');
            assert(!launcher.model.snapshot().message,'no stale query error after recovery');
            assert(/Reading: (paused|recording)/.test(launcher.model.snapshot().actionMessage),'named confirmed feedback');
        }else throw Error('Choose late_ack or lost_ack');
        assert(location.href===url,'Start does not navigate');
        return {case:name,posts,operationReads:reads,result:'passed'};
    }finally{
        window.fetch=original;release?.();
        await launcher.model.input('');launcher.model.close();
    }
}
