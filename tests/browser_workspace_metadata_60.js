/* Real browser task-editor/metadata and narrow-layout probe; synthetic data only. */
(async()=>{
    const evidence=[]; const assert=(ok,text)=>{if(!ok)throw Error(text);evidence.push(text);};
    const wait=async check=>{for(let n=0;n<150;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,40));}throw Error('Metadata condition timed out');};
    const find=(root,text)=>[...root.querySelectorAll('button')].find(button=>button.textContent===text);
    const card=document.getElementById('workspace-current-timer'), pins=document.getElementById('agenda-pins');
    find(pins,'Start').click();
    await wait(()=>find(card,'Edit task') && !document.querySelector('[data-timer-start]').disabled);
    find(card,'Edit task').click();
    await wait(()=>!document.getElementById('task_modal').classList.contains('hidden'));
    const taskId=document.getElementById('edit_task_id').value;
    const title=document.getElementById('modal_input_title'); title.value='Synthetic renamed activity';title.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('task_save_btn').click();
    await wait(()=>pins.textContent.includes('Synthetic renamed activity') && card.textContent.includes('Synthetic renamed activity'));
    assert(pins.textContent.includes(taskId.slice(-8)),'full editor rename refreshes pin without changing identity');
    assert(document.getElementById('agenda-ledger').textContent.includes('Synthetic renamed activity'),'normal task rename refreshes history labels');
    const response=await fetch('/api/tasks/'+taskId,{method:'DELETE'});assert(response.ok,'synthetic pinned task deletion succeeds');
    document.getElementById('agenda-date').dispatchEvent(new Event('change',{bubbles:true}));
    await wait(()=>pins.textContent.includes('Unavailable task'));
    assert(find(pins,'Start').disabled,'deleted pinned task remains visibly unavailable and cannot start');
    assert(Boolean(find(pins,'Unpin')),'unavailable pin can be explicitly removed');
    const viewport=window.innerWidth;
    assert(document.documentElement.scrollWidth<=viewport,'workspace has no horizontal document overflow');
    const row=card.querySelector('.workspace-actions');
    if(row)assert(row.getBoundingClientRect().width<=card.getBoundingClientRect().width,'current action row stays within card and wraps');
    return evidence;
})()
