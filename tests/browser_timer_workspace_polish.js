/** Manual public-UI regressions. Run via Orca eval only on the isolated real app.
 * No fixture overlays, storage resets, provider calls, permission requests or OS alerts.
 * Seed ordinary tasks/goals/timers through HTTP first; do not use the personal daemon.
 */
async function runTimerWorkspacePolishCase(name) {
    const assert=(value,message)=>{if(!value)throw Error(`${name}: ${message}`);};
    assert(location.origin==='http://127.0.0.1:18128','owned synthetic origin required');
    const health=await api.get('/health');
    assert(health.db_file.startsWith('/tmp/timetrace-polish-browser-'),'external synthetic database required');
    const button=(root,text)=>[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
    const input=(node,value)=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));};
    const wait=predicate=>new Promise((resolve,reject)=>{
        if(predicate()){resolve();return;}
        const observer=new MutationObserver(()=>{if(predicate()){observer.disconnect();clearTimeout(timeout);resolve();}});
        const timeout=setTimeout(()=>{observer.disconnect();reject(Error(`${name}: UI condition timed out`));},10000);
        observer.observe(document.body,{subtree:true,attributes:true,childList:true,characterData:true});
    });
    function holdAcknowledgement(match) {
        const original=window.fetch.bind(window);let release,received;
        const responseReceived=new Promise(resolve=>{received=resolve;});
        window.fetch=async(...args)=>{
            const response=await original(...args);
            if(match(String(args[0]),args[1])){window.fetch=original;return new Promise(resolve=>{release=()=>resolve(response);received();});}
            return response;
        };
        return {responseReceived,release:()=>release(),restore:()=>{window.fetch=original;release?.();}};
    }
    if(name==='note_ack') {
        const root=document.querySelector('#workspace-current-note'),panel=document.querySelector('[data-current-note]');
        assert(root&&panel&&!multipleTimers.hasNoteDraft(),'clean current-note editor required');panel.open=true;
        const field=root.querySelector('textarea'),original=field.value,submitted=`${original} · submitted`,expander=document.querySelector('[data-timer-expander]');expander.open=false;
        const held=holdAcknowledgement((url,options)=>url.endsWith('/note')&&options?.method==='POST');
        try {
            input(field,submitted);button(root,'Save').click();await held.responseReceived;
            assert(button(root,'Saving…')?.disabled,'non-colour saving feedback');input(field,'Later typing');held.release();
            await wait(()=>!multipleTimers.snapshot().pending&&field.value==='Later typing'&&button(root,'Save')&&!button(root,'Save').disabled);
            assert(root.textContent.includes('Unsaved changes'),'new typing remains unsaved');
            assert(!expander.open,'ordinary note ACK must not leave the recovery menu open');
            root.querySelector('details').open=true;button(root,'Discard my changes').click();assert(field.value===submitted,'discard restores only acknowledged note');
            input(field,original);button(root,'Save').click();await wait(()=>!multipleTimers.snapshot().pending&&!multipleTimers.hasNoteDraft());
        } finally {held.restore();}
    } else if(name==='date_precision') {
        const timer=multipleTimers.snapshot().timers.find(t=>t.id===multipleTimers.snapshot().selectedTimerId);
        assert(timer&&!multipleTimers.hasNoteDraft(),'clean selected timer required');
        button(document.querySelector('#workspace-current-timer'),'Adjust time').click();
        const dialog=document.querySelector('#timer-correction-dialog');await wait(()=>dialog.open&&dialog.querySelector('fieldset input'));
        const raw=[...dialog.querySelectorAll('details label')].find(l=>l.textContent.startsWith('Exact start value')).querySelector('input');
        const display=dialog.querySelector('input[type="datetime-local"]'),before=raw.value;
        display.dispatchEvent(new Event('input',{bubbles:true}));assert(raw.value===before,'unchanged date retains exact fraction');
        input(raw,`${before.slice(0,10)}T08:00:00.000133`);display.dispatchEvent(new Event('input',{bubbles:true}));
        assert(raw.value.endsWith('00.000133'),'native zero-second normalization retains microseconds');
        button(dialog,'Discard draft').click();
        const after=await api.get(`/timers/${timer.id}`);assert(after.running_start===timer.running_start,'precision check sends no correction write');
    } else if(name==='task_names') {
        const goal=personalGoals.snapshot().goals.find(g=>g.task_title==='Work'&&g.cadence==='day');
        const timer=multipleTimers.snapshot().timers.find(t=>t.id===multipleTimers.snapshot().selectedTimerId);
        assert(goal&&timer?.task_id&&!personalGoals.snapshot().draft,'clean goal editor and synthetic Work group required');
        const task=await api.get(`/api/tasks/${timer.task_id}`),renamed=`${task.title} · metadata check`;
        button(document.querySelector('[data-goal-settings]'),'Add goal').click();const form=document.querySelector('[data-goal-form]');
        input(form.elements.owner,task.id);input(form.elements.hours,'1.75');document.querySelector('[data-timer-task]').value=goal.task_id;
        try {
            await api.put(`/api/tasks/${task.id}`,{title:renamed});
            await wait(()=>form.elements.owner.selectedOptions[0]?.textContent===renamed&&[...document.querySelectorAll('[data-timer-task] option')].some(o=>o.value===task.id&&o.textContent===renamed));
            assert(form.elements.hours.value==='1.75'&&personalGoals.snapshot().draft.target_seconds===6300,'metadata cannot replace owned target typing');
            assert(document.querySelector('[data-timer-task]').value===goal.task_id,'metadata cannot retarget another launcher selection');
        } finally {await api.put(`/api/tasks/${task.id}`,{title:task.title});button(form,'Cancel').click();}
    } else if(name==='calendar_live') {
        await wait(()=>document.querySelector('.calendar-live-work'));
        const text=document.querySelector('.calendar-live-work').innerText;
        assert(text.includes('LIVE')&&!text.includes('Uncertain legacy history'),'exact live source has a distinct readable live label');
        assert(document.querySelectorAll('.task-card').length>0,'actual task-card renderer retained');
        assert(!document.querySelector('header #multiple_timers'),'timer strip outside header');
    } else throw Error(`Unknown case: ${name}`);
    return {case:name,passed:true};
}
