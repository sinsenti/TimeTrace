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
        if(!dialog){dialog=document.createElement('dialog');dialog.className='workspace-help';dialog.setAttribute('aria-label','Manage pinned activities');document.body.append(dialog);}
        const generation=++read;dialog.replaceChildren();
        const heading=document.createElement('h2');heading.textContent='Pinned activities';const explanation=document.createElement('p');explanation.textContent='Shortcuts on this browser. Unpinning never deletes a task.';
        const close=document.createElement('button');close.textContent='Close';close.type='button';close.addEventListener('click',()=>{read++;dialog.close();});dialog.append(heading,explanation,close);
        if(!dialog.open)dialog.showModal();
        const label=document.createElement('label');label.textContent='Find an activity to pin';const search=document.createElement('input');search.type='search';label.append(search);const found=document.createElement('div');dialog.append(label,found);let searchRead=0;
        search.addEventListener('input',async()=>{const current=++searchRead;const q=search.value;found.replaceChildren();if(!q.trim())return;
            try{const result=await api.get(`/api/tasks/launcher?${new URLSearchParams({q,limit:'20'})}`);if(current!==searchRead||generation!==read||!dialog.open)return;
                for(const task of result.suggestions){const row=document.createElement('div');row.className='workspace-pin-row';const title=document.createElement('strong');title.textContent=task.title;const toggle=document.createElement('button');toggle.type='button';toggle.textContent=createWorkspacePins(localStorage).ids().includes(task.id)?'Unpin':'Pin';toggle.addEventListener('click',()=>{try{const pins=createWorkspacePins(localStorage);pins.ids().includes(task.id)?pins.unpin(task.id):pins.pin(task.id);notify();void window.openWorkspacePins();}catch(_){explanation.textContent='The pin change could not be saved.';}});row.append(title,toggle);found.append(row);}
            }catch(_){if(current===searchRead&&generation===read)found.textContent='Activity search unavailable; existing pins are unchanged.';}
        });
        let ids;try{ids=createWorkspacePins(localStorage).ids();}catch(_){explanation.textContent='Saved pins are unavailable; existing storage is unchanged.';return;}
        page=Math.min(page,Math.max(0,Math.ceil(ids.length/20)-1));const shown=ids.slice(page*20,(page+1)*20);
        const names=await Promise.all(shown.map(id=>api.get(`/api/tasks/${encodeURIComponent(id)}`).then(task=>({id,title:task.title}),()=>({id,title:'Task unavailable'}))));
        if(generation!==read||!dialog.open)return;
        if(!ids.length){const empty=document.createElement('p');empty.textContent='No pinned activities. Open Task details to pin one.';dialog.append(empty);}
        for(const task of names){const row=document.createElement('div');row.className='workspace-pin-row';const title=document.createElement('strong');title.textContent=task.title;
            const remove=document.createElement('button');remove.type='button';remove.textContent='Unpin';remove.addEventListener('click',()=>{try{createWorkspacePins(localStorage).unpin(task.id);notify();void window.openWorkspacePins();}catch(_){explanation.textContent='The pin change could not be saved.';}});row.append(title,remove);dialog.append(row);
        }
        if(ids.length>20){const counter=document.createElement('p');counter.textContent=`${page*20+1}–${Math.min(ids.length,(page+1)*20)} of ${ids.length}`;dialog.append(counter);for(const [label,step] of [['Previous',-1],['Next',1]]){const b=document.createElement('button');b.textContent=label;b.disabled=page+step<0||(page+step)*20>=ids.length;b.addEventListener('click',()=>{page+=step;void window.openWorkspacePins();});dialog.append(b);}}
    };
    window.addEventListener('timetrace:pins-changed',()=>window.refreshTaskPinDetail(document.getElementById('edit_task_id')?.value||null));
    window.addEventListener('storage',event=>{if(event.key==='timetrace.workspace.pins.v1')notify();});
}
