/** Stop approvals use only server preview policies and the shared durable timer journal. */
async function mountStopReview({document, control, id, launcher = document.activeElement, returnFocus = () => null}) {
    const timer = control.snapshot().timers.find(t => t.id === id);
    if (!timer?.stop_review) return null;
    const previousFocus = launcher;
    const make = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
    const dialog = make('dialog'); dialog.className = 'app-dialog app-dialog-wide stop-review-dialog';
    dialog.setAttribute('aria-label', 'Review Stop');
    const heading = make('h2', 'Review Stop');
    const status = make('p', 'Reading actual work and eligible plans…'); status.setAttribute('role', 'status');
    const body = make('section');
    const cancel = make('button', 'Cancel — leave paused'); cancel.type = 'button';
    let closed = false, pending = false, generation = 0, request = null;
    function close(authoritative = false) {
        if (closed || (pending && !authoritative)) return;
        const ownedFocus = dialog.contains(document.activeElement);
        closed = true; generation++; dialog.close(); dialog.remove();
        if (ownedFocus) (previousFocus?.isConnected ? previousFocus : returnFocus())?.focus();
    }
    cancel.addEventListener('click', () => close());
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => close());
    dialog.addEventListener('keydown', event => event.stopPropagation());
    const explanation = make('p', 'This timer is paused. Decision time is excluded. Cancel or Escape leaves it paused; nothing is discarded. Other timers are unchanged.');
    dialog.append(heading, explanation, status, body, cancel);
    document.body.append(dialog); dialog.showModal(); cancel.focus();
    // Manifest work is naive DB UTC; typed plans/actual segments already carry an offset.
    const date = value => new Date(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}Z`).toLocaleString();
    const interval = part => `${date(part.start_time)} — ${date(part.end_time)}`;
    async function preview(selection = null) {
        const version = ++generation;
        body.replaceChildren(); status.textContent = 'Reading review…';
        const current = control.snapshot().timers.find(t => t.id === id);
        request = {review_id:timer.stop_review.id, expected_revision:current?.revision,
            scheduled_session_id:selection?.id || null, expected_plan_revision:selection?.revision ?? null};
        try {
            const approval = await control.previewStop(id, request);
            if (closed || version !== generation) return;
            if (timer.stop_review.cutoff) body.append(make('p', `Stop cutoff: ${date(timer.stop_review.cutoff)}`));
            body.append(make('h3', `${approval.actual_parts.length} actual work parts (pauses excluded)`));
            if (approval.actual_parts.length > 1) body.append(make('p','Separated work parts: consider the explicit split option, not a continuous interval that counts pauses.'));
            for (const part of approval.actual_parts) body.append(make('p', interval(part)));
            for (const segment of approval.unsaved_segments || []) body.append(make('p', `Unsaved actual segment: ${interval(segment)} · Entry note: ${segment.notes || 'None'} · Tags: ${segment.tags || 'None'}`));
            for (const work of approval.manifest?.matching_work || []) body.append(make('p', `Already recorded / matching work ${work.id}: ${interval(work)}. Matching is not ownership.`));
            body.append(make('p', 'Save actual time preserves each Entry note/tag and the existing association. It does not edit the schedule or recreate saved history.'));
            const label = make('label', 'Optional schedule action — explicitly choose a plan');
            const select = make('select'); select.setAttribute('aria-label', 'Plan for optional Stop action');
            const none = make('option', 'No schedule action'); none.value = ''; select.append(none);
            for (const plan of approval.candidates) {
                const option = make('option', `${plan.id.slice(-8)} · ${interval(plan)}`); option.value = plan.id; select.append(option);
            }
            select.value = approval.selected_plan_id || ''; label.append(select); body.append(label);
            select.addEventListener('change', () => void preview(approval.candidates.find(p => p.id === select.value)));
            if (!approval.candidates.length) body.append(make('p', 'No eligible same-task plan. Taskless work can still be saved; overlap never assigns a task or a link.'));
            if (timer.scheduled_session_id) body.append(make('p', 'The existing linked plan is retained. This review cannot reassign it.'));
            const selected = approval.candidates.find(p => p.id === approval.selected_plan_id);
            if (selected) {
                body.append(make('p', `Original plan: ${interval({start_time:selected.original_start,end_time:selected.original_end})}`),
                    make('p', `Current schedule: ${interval(selected)}`),
                    make('p', `Fit/split changes the current schedule to the actual parts above. The source original remains unchanged; split parts have their own originals, not an additive group original.`),
                    make('p', `Record as scheduled replaces only the approved unsaved work with exact current endpoints: ${interval(approval.effects.scheduled.interval)}. It does not append work or change the schedule.`));
            }
            const actions = make('footer'); actions.className = 'app-dialog-actions';
            const buttons = [];
            for (const [policy, text] of [['actual','Save actual time'],['continue','Continue timing'],['fit','Save work and fit schedule'],['split','Save work and split schedule'],['scheduled','Record as scheduled']]) {
                const reasons = approval.blocked[policy] || [];
                const button = make('button', text); button.type = 'button'; button.disabled = reasons.length > 0;
                if (policy === 'actual') button.className = 'app-dialog-primary';
                if (reasons.length) body.append(make('p', `${text}: ${reasons.join(' ')}`));
                button.addEventListener('click', async () => {
                    if (pending || closed) return;
                    if (control.hasNoteDraft?.(id)) { status.textContent = 'Save or discard the Entry note draft before approving Stop.'; return; }
                    pending = true; cancel.disabled = true;
                    explanation.textContent = 'Stop approval is being sent. Wait for its outcome; dismissal cannot undo a dispatched mutation.';
                    buttons.forEach(b => { b.disabled = true; }); select.disabled = true;
                    try {
                        const ok = await control.commitStop(id, {...request, consent_token:approval.consent_token, policy});
                        if (closed) return;
                        if (ok) close(true);
                        else {
                            status.textContent = control.snapshot().message || 'Not confirmed. Inspect the saved operation; never repeat an uncertain write.';
                            const read = make('button', 'Check operation (read only)'); read.type = 'button';
                            read.addEventListener('click', async () => { await control.recover(); status.textContent = control.snapshot().message || 'Status read. Close and reopen Stop to review the current timer.'; });
                            body.append(read);
                        }
                    } catch (err) { if (!closed) status.textContent = `Not confirmed: ${err.message}. Use timer operation recovery; no automatic retry.`; }
                    finally {
                        pending = false; cancel.disabled = false;
                        cancel.textContent = 'Close — inspect operation';
                        explanation.textContent = 'Approval was dispatched. Closing does not cancel or undo it. Keep the saved operation and inspect its outcome; do not repeat the write.';
                    }
                });
                buttons.push(button); actions.append(button);
            }
            body.append(actions); status.textContent = 'Review exact actual parts and optional effects before saving. Existing saved or matching work may block replacements; use correction tools instead.';
        } catch (err) {
            if (closed || version !== generation) return;
            status.textContent = `Could not preview: ${err.message}. Timer remains paused. Refresh status, then reopen Stop.`;
        }
    }
    await preview(); return dialog;
}
if (typeof module !== 'undefined') module.exports = {mountStopReview};
