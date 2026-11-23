/* Real browser saved work-note ACK/draft test; synthetic data only. */
(async()=>{
    const evidence=[];const assert=(ok,text)=>{if(!ok)throw Error(text);evidence.push(text);};
    const wait=async check=>{for(let n=0;n<150;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,40));}throw Error('Saved note condition timed out');};
    const row=document.querySelector('#agenda-ledger [data-agenda-row]');
    const id=row.dataset.agendaRow;
    const before=await (await fetch('/recorded-work/'+encodeURIComponent(id))).json();
    row.click();
    const root=document.getElementById('agenda-detail'),input=root.querySelector('textarea');
    const save=[...root.querySelectorAll('button')].find(button=>button.textContent==='Save work note');
    const nativeFetch=window.fetch;let held=false,release;
    window.fetch=async(url,options)=>{const response=await nativeFetch(url,options);if(String(url).endsWith('/note')&&options?.method==='PATCH'){held=true;await new Promise(resolve=>{release=resolve;});}return response;};
    try{
        input.value='Saved independent note';input.dispatchEvent(new Event('input',{bubbles:true}));save.click();
        await wait(()=>held);input.focus();input.value='Later independent typing';input.dispatchEvent(new Event('input',{bubbles:true}));release();
        await wait(()=>root.textContent.includes('Saved note refreshed.'));
        assert(input.value==='Later independent typing','saved-note ACK and refresh retain later typing');
        assert(document.activeElement===input,'saved-note refresh does not take editor focus');
        const after=await(await nativeFetch('/recorded-work/'+encodeURIComponent(id))).json();
        assert(after.notes==='Saved independent note','only submitted saved-note text is persisted');
        assert(after.start_time===before.start_time&&after.end_time===before.end_time&&after.task_id===before.task_id&&after.provenance===before.provenance,'saved note leaves timestamps, task and provenance unchanged');
        input.value='Saved independent note';input.dispatchEvent(new Event('input',{bubbles:true}));
        return evidence;
    }finally{release?.();window.fetch=nativeFetch;}
})()
