/* Actual browser-only network-boundary failure/late-response probe. Synthetic daemon/profile required. */
(async () => {
    const evidence = [];
    const assert = (ok,text)=>{if (!ok) throw Error(text); evidence.push(text);};
    const wait = async check=> { for(let n=0;n<150;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,40));} throw Error('Browser safety condition timed out'); };
    const nativeFetch = window.fetch;
    const search = document.getElementById('agenda-search');
    const date = document.getElementById('agenda-date');
    const pins = document.getElementById('agenda-pins');
    const activities = document.getElementById('agenda-activities');
    const input = (el,value)=> {el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
    const find = (root,text)=>[...root.querySelectorAll('button')].find(button=>button.textContent===text);
    let releaseSearch, releaseStart, heldSearch = false, heldStart = false, failMetadata = false, failStatus = false, starts = 0;
    window.fetch = async (url,config={})=> {
        const path = String(url);
        if (failMetadata && path === '/api/tasks?status=all') throw Error('Synthetic metadata outage');
        if (failStatus && path === '/timers' && (!config.method || config.method === 'GET')) throw Error('Synthetic status outage');
        const result = await nativeFetch(url,config);
        if(path.includes('title_contains=synthetic') && !heldSearch) {heldSearch=true;await new Promise(resolve=>{releaseSearch=resolve;});}
        if(path==='/timers' && config.method==='POST') {starts++;heldStart=true;await new Promise(resolve=>{releaseStart=resolve;});}
        return result;
    };
    try {
        input(search,'Synthetic'); await wait(()=>heldSearch);
        input(search,'No such synthetic task'); await wait(()=>activities.children.length === 0);
        releaseSearch(); await new Promise(resolve=>setTimeout(resolve,100));
        assert(activities.children.length === 0,'late search response cannot restore an obsolete query');
        input(search,'');
        failMetadata=true; date.dispatchEvent(new Event('change',{bubbles:true}));
        await wait(()=>find(pins,'Start')?.disabled);
        assert(find(pins,'Start').disabled,'failed metadata read makes saved pins unavailable rather than silently startable');
        failMetadata=false; date.dispatchEvent(new Event('change',{bubbles:true}));
        await wait(()=>find(pins,'Start') && !find(pins,'Start').disabled);
        find(pins,'Start').click(); await wait(()=>heldStart);
        document.getElementById('agenda-new').click();
        const note=document.getElementById('agenda-notes');note.focus();input(note,'Keep this unsaved plan draft');
        failStatus=true;releaseStart();
        await wait(()=>find(document.getElementById('multiple_timers'),'Retry status refresh'));
        assert(document.activeElement===note && note.value==='Keep this unsaved plan draft','late Start ACK retains dirty schedule draft and does not steal typing focus');
        failStatus=false;
        find(document.getElementById('multiple_timers'),'Retry status refresh').click();
        await wait(()=>!document.querySelector('[data-timer-start]').disabled);
        assert(starts===1,'ACK recovery after failed display reads never repeats Start');
        assert(note.value==='Keep this unsaved plan draft','read-only recovery keeps independent editor draft');
        return evidence;
    } finally {releaseSearch?.();releaseStart?.();window.fetch=nativeFetch;}
})()
