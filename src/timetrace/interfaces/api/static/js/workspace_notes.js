function createWorkNoteEditor({api,row,refresh,onState = () => {},isDirty=()=>false}) {
    let pending = false, saved = row, blocked = false, message = '', refreshFailed=false;
    let readGeneration=0,ackRevision=null;
    const state = () => ({pending,saved,blocked,message,refreshFailed,ackRevision});
    const publish = () => onState(state());
    async function retry() {
        try { await refresh(); refreshFailed=false; message = blocked ? 'Read saved work before explicitly reopening this editor.' : 'Saved note refreshed.'; }
        catch { refreshFailed=true; message = 'Note saved or unconfirmed; display refresh failed. Retry reads only.'; }
        publish();
    }
    async function readSaved(){
        if(pending||blocked||isDirty())return;const generation=++readGeneration,before=saved;
        try{const latest=await api.get(`/recorded-work/${encodeURIComponent(saved.id)}`);
            if(generation!==readGeneration||pending||blocked||isDirty()||saved!==before)return;
            if(latest?.id!==saved.id||!Number.isInteger(latest.revision)||latest.revision<saved.revision)throw Error('Saved entry unavailable');
            saved=latest;if(refreshFailed)message='';refreshFailed=false;publish();
        }catch(_){if(generation===readGeneration&&!pending&&!blocked&&!isDirty()&&saved===before){refreshFailed=true;message='Saved note could not refresh. Your changes are kept.';publish();}}
    }
    return {state,retry,readSaved,invalidate(reason) { blocked=true;message=reason;publish(); },async save(notes) {
        if (pending || blocked) return false;
        pending = true; publish();
        try {
            saved = await api.request(`/recorded-work/${encodeURIComponent(saved.id)}/note`,{method:'PATCH',body:JSON.stringify({notes,expected_revision:saved.revision})});
            ackRevision=saved.revision;
            message = 'Entry note saved; timestamps unchanged.'; pending = false; publish();
        } catch (error) {
            blocked = true; message = `Note not confirmed: ${error.message}. Refresh reads only; review saved work before reopening.`;
            pending = false; publish(); return false;
        }
        await retry(); return true;
    }};
}
function createWorkEntryRemoval({api,row,onState=()=>{}}) {
    let pending=false,blocked=false,deleted=false,message='';
    const state=()=>({pending,blocked,deleted,message}),publish=()=>onState(state());
    async function read(){
        try{await api.get(`/recorded-work/${encodeURIComponent(row.id)}`);message='Entry still exists. Reopen it before confirming a new deletion.';}
        catch(error){if(error.status===404){deleted=true;message='Entry deleted permanently.';}else message='Deletion not confirmed. Retry checking the saved entry; deletion will not be repeated.';}
        publish();return deleted;
    }
    return {state,read,async remove(){
        if(pending||blocked||deleted)return false;pending=true;publish();
        try{await api.request(`/recorded-work/${encodeURIComponent(row.id)}?${new URLSearchParams({expected_revision:row.revision})}`,{method:'DELETE'});deleted=true;message='Entry deleted permanently.';}
        catch(_){blocked=true;await read();}
        finally{pending=false;publish();}
        return deleted;
    }};
}
if (typeof module !== 'undefined') module.exports = {createWorkNoteEditor,createWorkEntryRemoval};
