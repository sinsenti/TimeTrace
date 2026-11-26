/** Device-local ordered task identities; never writes tasks or recorded work. */
function createWorkspacePins(storage) {
    const key = 'timetrace.workspace.pins.v1';
    const saved = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(saved) || saved.some(id => typeof id !== 'string')) throw Error('Saved pins are invalid; persistence unavailable.');
    let ids = [...new Set(saved)];
    const save = next => { storage.setItem(key, JSON.stringify(next)); ids = next; };
    return {ids:()=>[...ids], pin:id=> { if (!ids.includes(id)) save([...ids,id]); }, unpin:id=>save(ids.filter(value=>value !== id))};
}
if (typeof module !== 'undefined') module.exports = {createWorkspacePins};
if(typeof window!=='undefined'){
    const notify=()=>window.dispatchEvent(new CustomEvent('timetrace:pins-changed'));
    window.refreshTaskPinDetail=taskId=>{
        const button=document.getElementById('task_workspace_pin');if(!button)return;
        button.hidden=!taskId;button.onclick=null;if(!taskId)return;
        try{const pinned=createWorkspacePins(localStorage).ids().includes(taskId);button.disabled=false;button.textContent=pinned?'Unpin activity':'Pin activity on this browser';}
        catch(_){button.disabled=true;button.textContent='Pins unavailable on this browser';return;}
        button.onclick=()=>{
            if(document.getElementById('edit_task_id')?.value!==taskId)return;
            try{const pins=createWorkspacePins(localStorage);pins.ids().includes(taskId)?pins.unpin(taskId):pins.pin(taskId);notify();window.refreshTaskPinDetail(taskId);}
            catch(_){button.textContent='Pin change could not be saved';}
        };
    };
    let dialog=null,read=0,page=0;
    window.openWorkspacePins=async()=>{
        if(!dialog){
            dialog=document.createElement('dialog');dialog.className='workspace-help app-dialog workspace-pins-dialog';
            dialog.setAttribute('aria-label','Manage pinned activities');dialog.setAttribute('aria-labelledby','workspace-pins-title');dialog.setAttribute('aria-describedby','workspace-pins-description');
            dialog.addEventListener('cancel',()=>{read++;});document.body.append(dialog);
        }
        const generation=++read;dialog.replaceChildren();
        const heading=document.createElement('h2');heading.id='workspace-pins-title';heading.textContent='Manage pinned activities';
        const explanation=document.createElement('p');explanation.id='workspace-pins-description';explanation.textContent='Shortcuts on this browser. Unpinning never deletes a task.';
        const label=document.createElement('label');label.className='workspace-pins-search';label.textContent='Find an activity to pin';
        const search=document.createElement('input');search.type='search';search.placeholder='Search activities…';label.append(search);
        const found=document.createElement('div');found.className='workspace-pin-results';found.setAttribute('aria-live','polite');
        const saved=document.createElement('section');saved.className='workspace-pins-saved';
        const savedTitle=document.createElement('h3');savedTitle.textContent='Pinned on this browser';savedTitle.id='workspace-pins-saved-title';saved.setAttribute('aria-labelledby',savedTitle.id);
        const list=document.createElement('div');list.className='workspace-pin-list';list.textContent='Loading pinned activities…';saved.append(savedTitle,list);
        const footer=document.createElement('footer');footer.className='app-dialog-actions';
        const pager=document.createElement('nav');pager.className='workspace-pins-pagination';pager.hidden=true;pager.setAttribute('aria-label','Pinned activity pages');
        const close=document.createElement('button');close.textContent='Close';close.type='button';close.className='app-dialog-primary';close.addEventListener('click',()=>{read++;dialog.close();});footer.append(pager,close);
        dialog.append(heading,explanation,label,found,saved,footer);
        if(!dialog.open)dialog.showModal();search.focus();let searchRead=0;
        search.addEventListener('input',async()=>{const current=++searchRead;const q=search.value;found.replaceChildren();if(!q.trim())return;
            try{const result=await api.get(`/api/tasks/launcher?${new URLSearchParams({q,limit:'20'})}`);if(current!==searchRead||generation!==read||!dialog.open)return;
                for(const task of result.suggestions){const row=document.createElement('div');row.className='workspace-pin-row';const title=document.createElement('strong');title.textContent=task.title;const toggle=document.createElement('button');toggle.type='button';toggle.textContent=createWorkspacePins(localStorage).ids().includes(task.id)?'Unpin':'Pin';toggle.addEventListener('click',()=>{try{const pins=createWorkspacePins(localStorage);pins.ids().includes(task.id)?pins.unpin(task.id):pins.pin(task.id);notify();void window.openWorkspacePins();}catch(_){explanation.textContent='The pin change could not be saved.';}});row.append(title,toggle);found.append(row);}
            }catch(_){if(current===searchRead&&generation===read)found.textContent='Activity search unavailable; existing pins are unchanged.';}
        });
        let ids;try{ids=createWorkspacePins(localStorage).ids();}catch(_){explanation.textContent='Saved pins are unavailable; existing storage is unchanged.';list.textContent='Pins unavailable on this browser.';return;}
        page=Math.min(page,Math.max(0,Math.ceil(ids.length/20)-1));const shown=ids.slice(page*20,(page+1)*20);
        const names=await Promise.all(shown.map(id=>api.get(`/api/tasks/${encodeURIComponent(id)}`).then(task=>({id,title:task.title}),()=>({id,title:'Task unavailable'}))));
        if(generation!==read||!dialog.open)return;
        list.replaceChildren();savedTitle.textContent=`Pinned on this browser (${ids.length})`;
        if(!ids.length){const empty=document.createElement('p');empty.className='workspace-pins-empty';empty.textContent='No pinned activities yet. Search above and choose Pin to add a shortcut.';list.append(empty);}
        for(const task of names){const row=document.createElement('div');row.className='workspace-pin-row';const title=document.createElement('strong');title.textContent=task.title;
            const remove=document.createElement('button');remove.type='button';remove.textContent='Unpin';remove.addEventListener('click',()=>{try{createWorkspacePins(localStorage).unpin(task.id);notify();void window.openWorkspacePins();}catch(_){explanation.textContent='The pin change could not be saved.';}});row.append(title,remove);list.append(row);
        }
        if(ids.length>20){pager.hidden=false;const counter=document.createElement('span');counter.textContent=`${page*20+1}–${Math.min(ids.length,(page+1)*20)} of ${ids.length}`;pager.append(counter);for(const [label,step] of [['Previous',-1],['Next',1]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=page+step<0||(page+step)*20>=ids.length;b.addEventListener('click',()=>{page+=step;void window.openWorkspacePins();});pager.append(b);}}
    };
    window.addEventListener('timetrace:pins-changed',()=>window.refreshTaskPinDetail(document.getElementById('edit_task_id')?.value||null));
    window.addEventListener('storage',event=>{if(event.key==='timetrace.workspace.pins.v1')notify();});
}
