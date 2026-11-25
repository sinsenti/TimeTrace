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
    let visible = null, latest = null, fields = null;
    const node = (tag,text) => { const el = document.createElement(tag); el.textContent = text; return el; };
    const render = state => {
        latest = state;
        const timer = state.timers.find(timer=>timer.id === state.selectedTimerId);
        if (!timer) { root.replaceChildren(); visible = null; return; }
        if (!drafts.has(timer.id)) drafts.set(timer.id,createCurrentNoteDraft(timer,control));
        const draft = drafts.get(timer.id); draft.adopt(timer);
        if (visible !== timer.id) {
            const label = node('label','Work note');
            const input = node('textarea',''); input.value = draft.state().value; label.append(input);
            const save = node('button','Save'); save.type = 'button';
            const reload = node('button','Discard my changes'); reload.type = 'button';
            reload.title = 'Discard unsaved typing and restore the latest saved note.';
            const toolbar = node('div',''); toolbar.className = 'current-note-actions';
            const indicator = node('span',''); indicator.setAttribute('aria-live','polite');
            const more = node('details',''); more.className = 'current-note-more';
            more.append(node('summary','More'),reload); toolbar.append(save,indicator,more);
            const status = node('p',''); status.setAttribute('role','status');
            fields = {input,save,reload,indicator,more,status};
            input.addEventListener('input',()=> { draft.input(input.value); render(latest); });
            save.addEventListener('click',async()=> { await draft.save(); render(control.snapshot()); });
            reload.addEventListener('click',()=> { const current = control.snapshot().timers.find(t=>t.id === timer.id); if (current) { draft.reload(current); input.value = draft.state().value; more.open=false; render(latest); } });
            root.replaceChildren(label,toolbar,status); visible = timer.id;
        }
        const {input,save,reload,indicator,more,status} = fields;
        const current = draft.state();
        if (document.activeElement !== input) input.value = current.value;
        const eligible = timer.state === 'running' || (timer.state === 'paused' && Boolean(timer.manual_pause_note_segment_id));
        save.disabled = !eligible || !state.fresh || state.pending || Boolean(state.receipt) || current.pending || !current.dirty;
        save.textContent = current.pending ? 'Saving…' : 'Save';
        save.className = 'current-note-save' + (current.dirty ? ' is-dirty' : '');
        indicator.textContent = current.pending ? 'Saving…' : current.dirty ? 'Unsaved changes' : state.fresh ? 'Saved' : 'Last saved state';
        more.hidden = !current.dirty;
        reload.disabled = !state.fresh || state.pending || Boolean(state.receipt) || current.pending;
        status.textContent = !eligible ? 'No eligible current interval. Resolve idle review or resume explicitly before editing a current note; no interval will be guessed.' : state.message;
    };
    return {render,hasDraft:id=> (id ? [drafts.get(id)].filter(Boolean) : [...drafts.values()]).some(draft=>draft.state().dirty || draft.state().pending)};
}
if (typeof module !== 'undefined') module.exports = {createCurrentNoteDraft, createCurrentNoteView};
