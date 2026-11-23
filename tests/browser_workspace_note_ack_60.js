/* Isolated synthetic daemon/profile only: ACK + hung display GET + polling recovery. */
(async()=>{
    const wait=async check=>{for(let n=0;n<200;n++){if(check())return;await new Promise(r=>setTimeout(r,50));}throw Error('Recovery timeout');};
    const original=window.fetch;
    const results=[];
    try {
        for(const state of ['running','paused']) {
            document.querySelector('[data-timer-start]').click();
            await wait(()=>document.querySelector('#workspace-current-note textarea')&&!document.querySelector('[data-timer-start]').disabled);
            const card=document.getElementById('workspace-current-timer');
            const button=text=>[...card.querySelectorAll('button')].find(b=>b.textContent===text);
            if(state==='paused') {button('Pause').click();await wait(()=>card.textContent.includes('paused')&&!document.querySelector('[data-timer-start]').disabled);}
            let arm=false,held=false,release;
            window.fetch=async(...args)=>{
                const url=String(args[0]);
                if(arm&&url.endsWith('/timers')&&(!args[1]?.method||args[1].method==='GET')) {
                    arm=false;held=true;return new Promise(r=>{release=()=>original(...args).then(r);});
                }
                const response=await original(...args);
                if(url.endsWith('/note')&&args[1]?.method==='POST'&&response.ok)arm=true;
                return response;
            };
            const input=document.querySelector('#workspace-current-note textarea');
            input.value=state+' recovered ACK';input.dispatchEvent(new Event('input',{bubbles:true}));
            button('Save current work note').click();
            await wait(()=>held);
            await wait(()=>!document.querySelector('[data-timer-start]').disabled&&!button('Use current saved note').disabled);
            let stopped;
            const listener=e=>{if(e.detail?.timer?.state==='stopped')stopped=e.detail;};
            window.addEventListener('timetrace:timer-mutated',listener);
            button('Stop & record').click();await wait(()=>stopped);
            window.removeEventListener('timetrace:timer-mutated',listener);
            const rows=await Promise.all(stopped.recorded_work_ids.map(async id=>(await original('/recorded-work/'+id)).json()));
            if(!rows.some(row=>row.notes===state+' recovered ACK'))throw Error('Stop lost acknowledged note');
            results.push(state+' saved note -> hung GET -> independent status recovery -> immediate Stop records note');
            window.fetch=original;release();
            await wait(()=>!document.querySelector('#workspace-current-note textarea'));
        }
        return results;
    } finally {window.fetch=original;}
})()
