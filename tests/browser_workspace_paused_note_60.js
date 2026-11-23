/* Real browser immediate paused-note -> Stop proof. Select a synthetic manually paused timer first. */
(async()=>{
    const id=new URL(location.href).searchParams.get('timer');
    const before=await(await fetch('/timers/'+encodeURIComponent(id))).json();
    const segment=before.segments.find(segment=>segment.id===before.manual_pause_note_segment_id);
    if(before.state!=='paused'||!segment)throw Error('Select an eligible synthetic manual-pause timer first');
    const wait=async check=>{for(let n=0;n<150;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,40));}throw Error('Paused note condition timed out');};
    const card=document.getElementById('workspace-current-timer');
    const find=text=>[...card.querySelectorAll('button')].find(button=>button.textContent===text);
    const input=document.querySelector('#workspace-current-note textarea');
    input.value='Immediate paused Stop note';input.dispatchEvent(new Event('input',{bubbles:true}));
    find('Save current work note').click();
    await wait(()=>!document.querySelector('[data-timer-start]').disabled&&find('Save current work note').disabled);
    if(!card.textContent.includes('paused'))throw Error('Note edit resumed timer');
    let stopped;const listener=event=>{if(event.detail?.timer?.id===id&&event.detail.timer.state==='stopped')stopped=event.detail;};
    window.addEventListener('timetrace:timer-mutated',listener);
    try{
        find('Stop & record').click();await wait(()=>stopped);
        const rows=await Promise.all(stopped.recorded_work_ids.map(async workId=>(await fetch('/recorded-work/'+workId)).json()));
        const target=rows.find(row=>row.timer_segment_id===segment.id);
        if(!target||target.notes!=='Immediate paused Stop note')throw Error('Paused Stop lost current description');
        if(Date.parse(target.start_time)!==Date.parse(segment.start_time)||Date.parse(target.end_time)!==Date.parse(segment.end_time))throw Error('Note changed interval coverage');
        return ['paused note edit does not resume','immediate paused Stop records edited current description once','current interval timestamps and segment identity are unchanged'];
    }finally{window.removeEventListener('timetrace:timer-mutated',listener);}
})()
