/** A draft owns its captured revision/segment until explicit reload or its own ACK. */
function createCurrentNoteDraft(timer, control) {
    let baseline = timer, value = timer.notes || '', pending = false;
    const state = () => ({value,pending,dirty:value !== (baseline.notes || ''),baseline});
    return {state,
        input: next => { value = next; },
        adopt: next => { if (!state().dirty && !pending) { baseline = next; value = next.notes || ''; } },
        reload: next => { baseline = next; value = next.notes || ''; },
        async save() {
            if (pending || !state().dirty) return false;
            const submitted = value, captured = baseline;
            pending = true;
            let acknowledged = false;
            try {
                return await control.act(captured.id,'note',{
                    expected_revision:captured.revision,
                    expected_note_segment_id:captured.state === 'paused' ? captured.manual_pause_note_segment_id || null : null,
                    new_notes:submitted
                }, result => {
                    baseline = result.timer;
                    // Release mutation ownership at ACK, not after the display read.
                    acknowledged = true; pending = false;
                });
            } finally { if (!acknowledged) pending = false; }
        }
    };
}
function createCurrentNoteView(root, control) {
    const drafts = new Map();
    let visible = null, latest = null;
    const node = (tag,text) => { const el = document.createElement(tag); el.textContent = text; return el; };
    const render = state => {
        latest = state;
        const timer = state.timers.find(timer=>timer.id === state.selectedTimerId);
        if (!timer) { root.replaceChildren(); visible = null; return; }
        if (!drafts.has(timer.id)) drafts.set(timer.id,createCurrentNoteDraft(timer,control));
        const draft = drafts.get(timer.id); draft.adopt(timer);
        if (visible !== timer.id) {
            const label = node('label','Current work-entry note (not task description)');
            const input = node('textarea',''); input.value = draft.state().value; label.append(input);
            const save = node('button','Save current work note'); save.type = 'button';
            const reload = node('button','Use current saved note'); reload.type = 'button';
            const status = node('p',''); status.setAttribute('role','status');
            input.addEventListener('input',()=> { draft.input(input.value); render(latest); });
            save.addEventListener('click',async()=> { await draft.save(); render(control.snapshot()); });
            reload.addEventListener('click',()=> { const current = control.snapshot().timers.find(t=>t.id === timer.id); if (current) { draft.reload(current); input.value = draft.state().value; render(latest); } });
            root.replaceChildren(label,save,reload,status); visible = timer.id;
        }
        const input = root.querySelector('textarea');
        if (document.activeElement !== input) input.value = draft.state().value;
        const eligible = timer.state === 'running' || (timer.state === 'paused' && Boolean(timer.manual_pause_note_segment_id));
        root.querySelector('button').disabled = !eligible || !state.fresh || state.pending || Boolean(state.receipt) || draft.state().pending || !draft.state().dirty;
        root.querySelectorAll('button')[1].disabled = !state.fresh || state.pending || Boolean(state.receipt) || draft.state().pending;
        root.querySelector('p').textContent = !eligible ? 'No eligible current interval. Resolve idle review or resume explicitly before editing a current note; no interval will be guessed.' : state.message;
    };
    return {render,hasDraft:id=> (id ? [drafts.get(id)].filter(Boolean) : [...drafts.values()]).some(draft=>draft.state().dirty || draft.state().pending)};
}
if (typeof module !== 'undefined') module.exports = {createCurrentNoteDraft, createCurrentNoteView};
