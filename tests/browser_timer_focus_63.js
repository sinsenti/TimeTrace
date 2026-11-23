/* Run only in the isolated #63 fake-clock/fake-delivery daemon via Orca eval.
 * No permission prompt, OS notification or sound is authorized by this probe.
 */
async function browserTimerFocus63() {
    const check=(value,message)=>{if(!value)throw Error(message);};
    const wait=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('DOM/ACK wait exceeded');};
    if(typeof Notification!=='undefined')Object.defineProperty(Notification,'permission',{configurable:true,get:()=> 'denied'});
    const control=window.multipleTimers;
    check(Boolean(control),'shared controller ready');
    const defaults=await api.get('/timer-focus/defaults');
    check(!defaults.enabled&&defaults.work_minutes===25&&defaults.break_minutes===5&&defaults.behavior==='notify_only'&&!defaults.sound_enabled,'fresh defaults');
    check(await control.start({notes:'Synthetic focus A'}),'start A');await control.refresh();const a=control.snapshot().selectedTimerId;
    check(await control.start({notes:'Synthetic focus B'}),'start B');await control.refresh();const b=control.snapshot().selectedTimerId;
    control.select(a);
    const panel=document.querySelector('.timer-focus-panel'),form=panel.querySelector('form');panel.querySelector('details').open=true;
    const set=(name,value)=>{const field=form.elements[name];if(field.type==='checkbox')field.checked=value;else field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));};
    set('enabled',true);set('work_minutes',1);set('break_minutes',1);form.requestSubmit();
    await wait(()=>control.snapshot().timers.find(t=>t.id===a)?.focus?.period.work_minutes===1&&!control.snapshot().pending);
    await control.refresh();
    await api.post('/__test/advance?seconds=60',{});await control.refresh();
    check(control.snapshot().timers.find(t=>t.id===a).focus.phase==='work_due','notify boundary');
    check(control.snapshot().timers.find(t=>t.id===a).state==='running','notify does not pause');
    const button=label=>[...panel.querySelectorAll('button')].find(b=>b.textContent===label);
    check(Boolean(button('Take break')),'actual Take break control');button('Take break').click();
    await wait(()=>control.snapshot().timers.find(t=>t.id===a)?.focus.phase==='break');await control.refresh();
    check(control.snapshot().timers.find(t=>t.id===a).state==='paused','target paused');
    check(control.snapshot().timers.find(t=>t.id===b).state==='running','other timer untouched');
    await api.post('/__test/advance?seconds=60',{});await control.refresh();
    check(control.snapshot().timers.find(t=>t.id===a).focus.phase==='break_due','break due waits');
    button('Resume work').click();await wait(()=>control.snapshot().timers.find(t=>t.id===a)?.focus.phase==='work');await control.refresh();
    // Dirty note is preserved by focus polling and a targeted focus-settings mutation.
    const note=document.querySelector('#workspace-current-note textarea');
    if(note){note.value='Unsent synthetic note draft';note.dispatchEvent(new Event('input',{bubbles:true}));}
    set('work_minutes',2);await control.refresh();check(form.elements.work_minutes.value==='2','focus draft survives polling');
    set('work_minutes',1);set('behavior','automatic_break');form.requestSubmit();
    await wait(()=>!control.snapshot().pending&&control.snapshot().timers.find(t=>t.id===a)?.focus.settings.behavior==='automatic_break');await control.refresh();
    let t=control.snapshot().timers.find(t=>t.id===a);
    check(await control.act(a,'focus-action',{expected_revision:t.revision,expected_generation:t.focus.generation,action:'keep_working'}),'new automatic period');await control.refresh();
    await api.post('/__test/advance?seconds=0',{});await api.post('/__test/advance?seconds=59',{});await api.post('/__test/advance?seconds=1',{});await control.refresh();
    check(control.snapshot().timers.find(t=>t.id===a).state==='paused','on-time automatic break');
    check(control.snapshot().timers.find(t=>t.id===b).state==='running','independent automatic mode');
    if(note)check(document.querySelector('#workspace-current-note textarea')?.value==='Unsent synthetic note draft','existing note draft retained');
    const notices=await api.get('/timer-notifications');
    check(notices.notices.filter(n=>n.kind==='work_due'&&n.timer_id===a).length===2,'one event per actual work generation');
    check(panel.textContent.includes('FAKE unavailable'),'fake unavailable capability visible');
    window.focus63Proof={a,b,notify:true,automatic:true,breakWait:true,drafts:true,notices:notices.notices.length};
    return window.focus63Proof;
}

async function browserTimerFocus63More(){
 const c=window.multipleTimers,check=(v,m)=>{if(!v)throw Error(m);};
 if(typeof Notification!=='undefined')Object.defineProperty(Notification,'permission',{configurable:true,get:()=> 'denied'});
 await c.refresh();const a=c.snapshot().timers.find(t=>t.notes==='Synthetic focus A').id,b=c.snapshot().timers.find(t=>t.notes==='Synthetic focus B').id;
 c.select(a);check(await c.initializeCorrections(),'initialize signed correction');await c.refresh();
 let t=c.snapshot().timers.find(t=>t.id===a);const before=t.focus.remaining_seconds,anchor=t.identity_started_at;
 const preview=await c.previewCorrection('/timers/'+a,{target:{kind:'buffered',segment_id:t.segments[0].id},change:{kind:'step_start',credited_delta_seconds:300}});
 check(await c.commitCorrection('/timers/'+a,preview),'signed correction commit');await c.refresh();
 t=c.snapshot().timers.find(t=>t.id===a);check(t.focus.remaining_seconds===before&&t.identity_started_at===anchor,'correction-independent clocks');
 await api.post('/__test/advance?seconds=7200',{});await c.refresh();
 const first=(await api.get('/timer-notifications')).notices.filter(n=>n.kind==='two_hour').map(n=>n.id).sort();
 check(first.length===2,'both paused/running identities warn');
 await api.post('/__test/advance?seconds=0',{});
 check(JSON.stringify((await api.get('/timer-notifications')).notices.filter(n=>n.kind==='two_hour').map(n=>n.id).sort())===JSON.stringify(first),'wall warning once');
 check(c.snapshot().timers.find(t=>t.id===a).state==='paused','no automatic break resume');
 const panel=document.querySelector('.timer-focus-panel');panel.querySelector('details').open=true;
 const scope=panel.querySelector('[aria-label="Settings scope"]');scope.value='defaults';scope.dispatchEvent(new Event('change'));
 for(let i=0;i<100&&panel.querySelector('[name=enabled]').checked;i++)await new Promise(r=>setTimeout(r,20));
 const form=panel.querySelector('form');form.elements.work_minutes.value='3';form.elements.work_minutes.dispatchEvent(new Event('input',{bubbles:true}));
 form.requestSubmit();for(let i=0;i<100;i++){if((await api.get('/timer-focus/defaults')).work_minutes===3)break;await new Promise(r=>setTimeout(r,20));}
 check((await api.get('/timer-focus/defaults')).work_minutes===3,'saved defaults acknowledged');
 c.select(b);check(c.snapshot().selectedTimerId===b,'selected B');
 return {a,b,correctionIndependent:true,wallWarningIds:first,defaultsSaved:true,dirty:c.hasFocusDraft()};
}

async function browserTimerFocus63Faults(){
 const c=window.multipleTimers,check=(v,m)=>{if(!v)throw Error(m);};await c.refresh();
 const originalPost=api.post.bind(api),originalGet=api.get.bind(api);let posts=0;
 const t=c.snapshot().timers.find(t=>t.id===c.snapshot().selectedTimerId);
 api.post=async(url,payload)=>{posts++;const result=await originalPost(url,payload);if(url.endsWith('/focus-settings'))throw Error('Synthetic lost ACK');return result;};
 try {
  const ok=await c.act(t.id,'focus-settings',{expected_revision:t.revision,enabled:true,work_minutes:2,break_minutes:1,behavior:'notify_only'});
  check(!ok&&c.snapshot().receipt?.outcome==='uncertain','lost ACK retains fixed journal');
  await c.recover();await c.refresh();check(posts===1,'lost ACK recovery is read-only');
 }finally{api.post=originalPost;}
 const d=await api.get('/timer-focus/defaults');posts=0;
 api.post=async(...args)=>{posts++;return originalPost(...args);};api.get=url=>url==='/timers'?new Promise(()=>{}):originalGet(url);
 try {
  const ok=await c.saveFocusDefaults({...d,work_minutes:4,expected_revision:d.revision});
  check(ok&&!c.snapshot().pending&&c.snapshot().receipt?.outcome==='acknowledged','ACK independent of hung display');
  void c.retry();await Promise.resolve();check(posts===1,'hung display retry is read-only');
 }finally{api.post=originalPost;api.get=originalGet;}
 await c.refresh();return {lostAckPosts:1,hungDisplayPosts:posts,recovered:c.snapshot().fresh};
}
