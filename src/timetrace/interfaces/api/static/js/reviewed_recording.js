/** Editable explicit recording approval. No plan or task mutation is composed in the browser. */
function mountReviewedRecording({document, api, payload, operationId = () => crypto.randomUUID(), acknowledge = () => {}, returnFocus = () => null}) {
    const previousFocus = document.activeElement;
    const make = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
    const dialog = make('dialog'); dialog.className = 'app-dialog recording-review-dialog'; dialog.setAttribute('aria-label', 'Record actual work');
    const status = make('p', 'Loading recording preview…'); status.setAttribute('role', 'status');
    const evidence = make('section');
    const controls = make('div'); controls.className = 'app-dialog-fields';
    const local = value => {
        const d = new Date(value), pad = n => String(n).padStart(2,'0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const fields = {};
    for (const [key, label, type] of [['start_time','Recorded start','datetime-local'],['end_time','Recorded end','datetime-local'],['notes','Entry note','textarea'],['tags','Tags','text']]) {
        const wrapper = make('label', label), input = make(type === 'textarea' ? 'textarea' : 'input');
        if (type !== 'textarea') input.type = type;
        if (type === 'datetime-local') input.step = '1';
        input.setAttribute('aria-label', label);
        input.value = key.endsWith('_time') ? local(payload[key]) : payload[key] || '';
        wrapper.append(input); controls.append(wrapper); fields[key] = input;
    }
    const initialTimes = {start_time:fields.start_time.value,end_time:fields.end_time.value};
    const save = make('button', payload.scheduled_session_id ? 'Save linked recorded work' : 'Save recorded work');
    save.type = 'button'; save.className = 'app-dialog-primary'; save.disabled = true;
    const review = make('button', 'Review changed recording'); review.type = 'button';
    const cancel = make('button', 'Cancel'); cancel.type = 'button';
    const footer = make('footer'); footer.className = 'app-dialog-actions'; footer.append(cancel,review,save);
    dialog.append(make('h2', 'Record actual work'),make('p', payload.scheduled_session_id
        ? 'Explicitly link work to this plan and its assigned task. The original plan, current schedule and task status stay unchanged.'
        : 'Record actual work without a plan link. Scheduling is separate. Future ends are rejected, never clipped.'),controls,status,evidence,footer);
    let closed = false, pending = false, generation = 0, approval = null, approvedPayload = null, acknowledged = false;
    let finish;
    const completion = new Promise(resolve => { finish = resolve; });
    function close(result = null, authoritative = false) {
        if (closed || (pending && !authoritative)) return;
        const ownedFocus = dialog.contains(document.activeElement);
        closed = true; generation++; dialog.close(); dialog.remove();
        if (ownedFocus) (previousFocus?.isConnected ? previousFocus : returnFocus())?.focus();
        finish(result);
    }
    cancel.addEventListener('click', () => close());
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => close());
    dialog.addEventListener('keydown', event => event.stopPropagation());
    function changed() { generation++; approval = null; approvedPayload = null; save.disabled = true; status.textContent = 'Changed fields need a new preview before Save.'; }
    for (const input of Object.values(fields)) input.addEventListener('input', changed);
    function values() {
        return {...payload,
            start_time:fields.start_time.value === initialTimes.start_time ? payload.start_time : new Date(fields.start_time.value).toISOString(),
            end_time:fields.end_time.value === initialTimes.end_time ? payload.end_time : new Date(fields.end_time.value).toISOString(),
            notes:fields.notes.value,tags:fields.tags.value};
    }
    async function preview() {
        if (pending) return;
        const version = ++generation; save.disabled = true; review.disabled = true;
        approval = null; approvedPayload = null; acknowledged = false; evidence.replaceChildren();
        try {
            const proposed = values();
            const result = await api.post('/recorded-work/preview', proposed);
            if (closed || version !== generation) return;
            if (!result?.consent_token || !Array.isArray(result.existing_work)) throw Error('Invalid recording preview. Retry the read before approving.');
            approval = result; approvedPayload = proposed;
            const fmt = row => `${new Date(row.start_time).toLocaleString()} — ${new Date(row.end_time).toLocaleString()}`;
            evidence.append(make('p', `Approve recorded interval: ${fmt(proposed)}`));
            if (result.plan) evidence.append(make('p', `Original plan: ${fmt({start_time:result.plan.original_start,end_time:result.plan.original_end})}`),make('p', `Current schedule: ${fmt(result.plan)}`));
            for (const row of result.existing_work || []) evidence.append(make('p', `Existing linked/matching work ${row.id}: ${fmt(row)}`));
            if (result.duplicate_warning || result.existing_work?.length) {
                const label = make('label', 'Existing linked or overlapping work may duplicate this recording. I reviewed it and explicitly want to add this interval.');
                label.className = 'app-dialog-check';
                const check = make('input'); check.type = 'checkbox';
                check.addEventListener('change', () => { acknowledged = check.checked; save.disabled = !approval || !acknowledged; });
                label.append(check); evidence.append(label); save.disabled = true;
            } else save.disabled = false;
            status.textContent = 'Review exact endpoints before saving. No task status or schedule changes. Exact duplicates may be refused.';
        } catch (err) { if (!closed && version === generation) status.textContent = `Cannot record: ${err.message}. Edit the interval or cancel; no work was saved.`; }
        finally { if (!closed) review.disabled = false; }
    }
    review.addEventListener('click', preview);
    save.addEventListener('click', async () => {
        if (!approval || !approvedPayload || pending || save.disabled) return;
        if (JSON.stringify(values()) !== JSON.stringify(approvedPayload)) { changed(); return; }
        pending = true; cancel.disabled = true; save.disabled = true; review.disabled = true;
        status.textContent = 'Recording is being sent. Wait for its outcome; dismissal cannot undo a dispatched mutation.';
        for (const input of Object.values(fields)) input.disabled = true;
        try {
            const result = await api.saveRecordedWork({...approvedPayload,consent_token:approval.consent_token,acknowledge_existing_work:acknowledged,operation_id:operationId()});
            // ACK is final even if a display owner fails; never offer another write as recovery.
            try { acknowledge(result); } catch (error) { console.error('Recording acknowledged; display update failed.', error); }
            close(result, true);
        } catch (err) {
            if (closed) return;
            const uncertain = Boolean(api.recordedWorkAttempt());
            status.textContent = uncertain ? 'Recording not confirmed. Check the saved operation below or in recording recovery. No mutation will be replayed.' : `Not saved: ${err.message}. Review again before another approval.`;
            if (uncertain) {
                cancel.textContent = 'Close — inspect recording';
                const check = make('button','Check recording operation (read only)'); check.type = 'button';
                check.addEventListener('click', async () => {
                    try { const result = await api.recoverRecordedWork(); if (result) { try { acknowledge(result); } finally { close(result, true); } } else status.textContent = 'No finalized receipt. Keep the operation and check again.'; }
                    catch (error) { status.textContent = `Operation not confirmed: ${error.message}. Recovery remains read-only.`; }
                }); evidence.append(check);
            } else { approval = null; review.disabled = false; for (const input of Object.values(fields)) input.disabled = false; }
        } finally { pending = false; cancel.disabled = false; }
    });
    document.body.append(dialog); dialog.showModal(); cancel.focus(); void preview();
    return {dialog,completion};
}
if (typeof module !== 'undefined') module.exports = {mountReviewedRecording};
