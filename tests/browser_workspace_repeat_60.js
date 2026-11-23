/* Real browser Start-again gap/association proof, synthetic HTTP seed only. */
(async()=>{
    const request=async(path,body)=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error(await response.text());return response.json();};
    const task=await request('/api/tasks',{title:'Synthetic repeat proof'});
    const end=new Date(Date.now()-30*60000).toISOString(),start=new Date(Date.now()-60*60000).toISOString();
    const plan=await request('/scheduled-sessions',{task_id:task.id,start_time:start,end_time:end});
    const old=await request('/recorded-work',{task_id:task.id,start_time:start,end_time:end,notes:'Old associated note',scheduled_session_id:plan.id,expected_plan_revision:plan.revision});
    document.getElementById('agenda-date').dispatchEvent(new Event('change',{bubbles:true}));
    const wait=async check=>{for(let n=0;n<150;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,40));}throw Error('Repeat condition timed out');};
    await wait(()=>[...document.querySelectorAll('[data-agenda-row]')].some(row=>row.dataset.agendaRow===old.id));
    const row=[...document.querySelectorAll('[data-agenda-row]')].find(row=>row.dataset.agendaRow===old.id);
    row.parentElement.open=true;
    const again=row.nextElementSibling.nextElementSibling;
    if(again.textContent!=='Start again')throw Error('Missing repeat action');
    let result;const acknowledged=event=>{if(event.detail?.timer?.task_id===task.id)result=event.detail;};
    window.addEventListener('timetrace:timer-mutated',acknowledged);
    const requested=Date.now();
    try{
        again.click();await wait(()=>result);
        const current=result.timer;
        if(current.scheduled_session_id!==null||current.notes!==''||Date.parse(current.running_start)<requested)throw Error('Repeat inherited context or gap');
        const previous=await(await fetch('/recorded-work/'+old.id)).json();
        if(previous.start_time!==old.start_time||previous.end_time!==old.end_time||previous.notes!==old.notes)throw Error('Repeat changed old work');
        await wait(()=>document.getElementById('workspace-current-timer').textContent.includes('Synthetic repeat proof'));
        return ['Start again records from now without gap, old note or scheduled association','old interval remains unchanged','repeated activity visibly selects current card'];
    }finally{window.removeEventListener('timetrace:timer-mutated',acknowledged);}
})()
