/* Run in an isolated real browser on a synthetic daemon only; not a Node test. */
(async () => {
    const evidence = [];
    const assert = (ok, message) => { if (!ok) throw Error(message); evidence.push(message); };
    const wait = async check => {
        for (let n = 0; n < 100; n++) { if (check()) return; await new Promise(resolve=>setTimeout(resolve,50)); }
        throw Error('Browser condition timed out');
    };
    const buttons = root => [...root.querySelectorAll('button')];
    const find = (root,label) => buttons(root).find(button=>button.textContent === label);
    const discovery = document.getElementById('agenda-activities');
    await wait(()=>discovery.children.length >= 2);
    const first = discovery.children[0];
    const firstLabel = first.firstChild.textContent;
    find(first,'Pin').click();
    await wait(()=>document.getElementById('agenda-pins').children.length === 1);
    assert(document.getElementById('agenda-pins').textContent.includes(firstLabel),'pin resolves stable ID rather than same-title neighbor');
    find(document.getElementById('agenda-pins'),'Start').click();
    const card = document.getElementById('workspace-current-timer');
    await wait(()=>card.textContent.includes('Synthetic same title') && find(card,'Pause') && !find(card,'Pause').disabled);
    assert(document.activeElement === card,'Start visibly focuses current card');
    find(card,'Pause').click();
    await wait(()=>find(card,'Resume') && !find(card,'Resume').disabled);
    find(document.getElementById('agenda-pins'),'Start').click();
    await wait(()=>!document.querySelector('[data-timer-start]').disabled);
    assert(card.textContent.includes('paused'),'same-task Start selects paused timer without resuming');
    find(card,'Edit task').click();
    await wait(()=>!document.getElementById('task_modal').classList.contains('hidden'));
    assert(Boolean(document.getElementById('modal_input_desc') && document.getElementById('modal_input_priority') && document.getElementById('modal_input_due_date')),'normal full task editor is reused');
    closeTaskModal();
    const search = document.getElementById('agenda-search'); search.focus();
    search.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS',key:'S',altKey:true,shiftKey:true,bubbles:true,cancelable:true}));
    assert(card.textContent.includes('paused'),'timer shortcut ignores typing field');
    card.focus();
    card.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyP',key:'P',altKey:true,shiftKey:true,bubbles:true,cancelable:true}));
    await wait(()=>find(card,'Pause') && !find(card,'Pause').disabled);
    assert(card.textContent.includes('running'),'targeted pause/resume shortcut works outside editor');
    find(card,'Stop & record').click();
    await wait(()=>document.getElementById('agenda-ledger').querySelector('details'));
    const group = document.getElementById('agenda-ledger').querySelector('details');
    group.open = true;
    assert(group.textContent.includes('Recorded work') && group.textContent.includes('timer'),'group exposes recorded intervals and provenance');
    assert(Boolean(find(group,'Start again')),'history offers Start again');
    assert(!buttons(card).some(button=>/Adjust time|[+-]5/.test(button.textContent)),'unsupported correction actions are not enabled');
    assert(document.getElementById('agenda-progress').textContent.includes('Elapsed recorded time'),'union total labels remain visible');
    return evidence;
})()
