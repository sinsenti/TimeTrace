/* Real browser probe after a public-service synthetic idle observation freezes a timer. */
(async()=>{
    const wait=async check=>{for(let n=0;n<150;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,40));}throw Error('Frozen condition timed out');};
    await wait(()=>[...document.querySelectorAll('.multiple-timer-row')].some(row=>row.textContent.includes('frozen')));
    const row=[...document.querySelectorAll('.multiple-timer-row')].find(row=>row.textContent.includes('frozen'));
    [...row.querySelectorAll('button')].find(button=>button.textContent==='Select timer').click();
    const card=document.getElementById('workspace-current-timer');
    if(!card.textContent.includes('frozen'))throw Error('Frozen selection changed state');
    const actions=[...card.querySelectorAll('.workspace-actions button')].filter(button=>button.textContent!=='Edit task');
    if(actions.some(button=>!button.disabled))throw Error('Frozen work controls enabled');
    if(!document.querySelector('#workspace-current-note button').disabled)throw Error('Frozen note mutation enabled');
    if(!document.querySelector('[data-idle-review]')||document.querySelector('[data-idle-review]').hidden)throw Error('Idle review unavailable');
    return ['frozen timer selection preserves state','frozen controls and current-note save unavailable','shared unresolved idle review remains accessible'];
})()
