function createWorkNoteEditor({api,row,refresh,onState = () => {}}) {
    let pending = false, saved = row, blocked = false, message = '';
    const state = () => ({pending,saved,blocked,message});
    const publish = () => onState(state());
    async function retry() {
        try { await refresh(); message = blocked ? 'Read saved work before explicitly reopening this editor.' : 'Saved note refreshed.'; }
        catch { message = 'Note saved or unconfirmed; display refresh failed. Retry reads only.'; }
        publish();
    }
    return {state,retry,async save(notes) {
        if (pending || blocked) return false;
        pending = true; publish();
        try {
            saved = await api.request(`/recorded-work/${encodeURIComponent(saved.id)}/note`,{method:'PATCH',body:JSON.stringify({notes,expected_revision:saved.revision})});
            message = 'Work note saved; timestamps unchanged.'; pending = false; publish();
        } catch (error) {
            blocked = true; message = `Note not confirmed: ${error.message}. Refresh reads only; review saved work before reopening.`;
            pending = false; publish(); return false;
        }
        await retry(); return true;
    }};
}
if (typeof module !== 'undefined') module.exports = {createWorkNoteEditor};
