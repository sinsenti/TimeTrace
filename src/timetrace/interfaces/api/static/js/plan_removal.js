/* A displayed manifest owns one approval; refresh/recovery never replays a write. */
(function (root) {
    class PlanRemovalController {
        constructor(api, id, storage = root.sessionStorage) {
            this.api = api; this.id = id; this.preview = null; this.storage = storage;
            this.attempt = storage ? JSON.parse(storage.getItem('timetrace_plan_removal_attempt') || 'null') : null;
        }
        journal(attempt) {
            if (this.storage) {
                if (attempt) this.storage.setItem('timetrace_plan_removal_attempt', JSON.stringify(attempt));
                else this.storage.removeItem('timetrace_plan_removal_attempt');
            }
            if (typeof root.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') root.dispatchEvent(new CustomEvent('timetrace:plan-removal-journal'));
        }
        async load() {
            this.preview = await this.api.get(`/scheduled-sessions/${encodeURIComponent(this.id)}/removal-preview`);
            return this.preview;
        }
        async apply(action) {
            if (!this.preview || this.attempt) throw Error('Review a fresh manifest before confirming.');
            const payload = {action, consent_token:this.preview.consent_token, operation_id:root.crypto.randomUUID()};
            this.journal(payload); // Fail closed before dispatch if safety storage is unavailable.
            this.attempt = payload;
            try {
                const result = await this.api.post(`/scheduled-sessions/${encodeURIComponent(this.id)}/removal`, payload);
                if (result?.operation_id !== `plan-removal:${payload.operation_id}` || result.action !== action || result.plan_id !== this.id) throw Error('Unrecognized plan-action acknowledgement. Check the saved operation.');
                try { this.journal(null); } catch (_) { /* Keep the receipt hold if cleanup fails. */ }
                return result;
            } catch (err) {
                if (err.status && err.status < 500 && !['operation_payload_mismatch','reconciliation_required'].includes(err.code)) this.journal(null);
                throw err;
            }
        }
        async recover() {
            if (!this.attempt) throw Error('No unconfirmed operation.');
            const receipt = await this.api.get(`/operations/${encodeURIComponent(`plan-removal:${this.attempt.operation_id}`)}`);
            if (receipt.status === 'finalized' && receipt.result) {
                if (receipt.result.operation_id !== `plan-removal:${this.attempt.operation_id}` || receipt.result.action !== this.attempt.action || !receipt.result.plan_id) throw Error('Unrecognized plan-action acknowledgement. Keep the saved operation.');
                this.journal(null);
            }
            return receipt;
        }
    }
    function mount(container, row, hooks) {
        const make = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
        const open = make('button', 'Remove schedule / Delete / Fit schedule to recorded work');
        open.type = 'button';
        container.appendChild(open);
        open.addEventListener('click', async () => {
            if (!await hooks.available()) return;
            hooks.lock(true);
            open.disabled = true;
            const panel = make('section', 'Loading exact affected records…');
            panel.setAttribute('aria-label', 'Remove, delete or fit schedule confirmation');
            container.appendChild(panel);
            try {
                const controller = new PlanRemovalController(hooks.api, row.id);
                if (controller.attempt) {
                    panel.textContent = 'An earlier plan action is unconfirmed. Only inspect its operation; no new action is allowed.';
                    const read = make('button', 'Check operation (read only)'); read.type = 'button';
                    read.addEventListener('click', async () => {
                        try {
                            const receipt = await controller.recover();
                            if (receipt.status === 'finalized' && receipt.result) { hooks.lock(false); await hooks.ack(receipt.result); }
                            else panel.appendChild(make('p','No finalized receipt; keep the saved operation and check again.'));
                        } catch (err) { panel.appendChild(make('p', `Not confirmed: ${err.message}. Recovery remains read-only.`)); }
                    });
                    panel.appendChild(read); return;
                }
                const preview = await controller.load();
                panel.textContent = '';
                panel.appendChild(make('p', 'Remove schedule only preserves all saved work and task status, detaching linked records. For a projection, only this exact occurrence is skipped; no series or history is removed. Manifest timestamps below are UTC. Original plan and current schedule are shown below. Delete everything removes each whole associated work record, including portions outside this plan. Fit schedule to recorded work changes only the current schedule to the earliest start and latest end of all explicitly linked recorded work, including gaps between intervals. The original plan and recorded work stay unchanged.'));
                const manifest = make('pre', JSON.stringify(preview.manifest, null, 2));
                manifest.className = 'plan-removal-manifest'; panel.appendChild(manifest);
                const status = make('p', 'Choose an action to confirm this exact whole manifest, or cancel.');
                status.setAttribute('role', 'status');
                panel.appendChild(status);
                const buttons = [];
                for (const [action, label] of [['remove_schedule', 'Remove schedule only — keep recorded work'], ['delete_everything', 'Delete everything'], ['squeeze', 'Fit schedule to recorded work']]) {
                    const button = make('button', label);
                    button.type = 'button';
                    const reasons = preview.blocked[action] || ['Action unavailable in this preview.'];
                    button.disabled = reasons.length > 0;
                    if (reasons.length) panel.appendChild(make('p', `${label}: ${reasons.join(' ')}`));
                    buttons.push(button);
                    button.addEventListener('click', async () => {
                        for (const node of buttons) node.disabled = true;
                        cancel.disabled = true;
                        try {
                            const result = await controller.apply(action);
                            hooks.lock(false);
                            await hooks.ack(result);
                        } catch (err) {
                            status.textContent = `Action not confirmed: ${err.message}. Check operation reads only; no automatic retry.`;
                            const check = make('button', 'Check operation (read only)');
                            check.type = 'button';
                            check.addEventListener('click', async () => {
                                try {
                                    const receipt = await controller.recover();
                                    if (receipt.status === 'finalized' && receipt.result) {
                                        hooks.lock(false);
                                        await hooks.ack(receipt.result);
                                    } else status.textContent = 'No finalized receipt. Keep this approval; do not repeat the write.';
                                } catch (readError) { status.textContent = `No confirmed receipt: ${readError.message}. Refresh reads only; open a new preview before any new approval.`; }
                            });
                            panel.appendChild(check);
                            // A definitive rejection did not mutate. A fresh preview is a new approval.
                            if (err.status && err.status < 500) cancel.disabled = false;
                        }
                    });
                    panel.appendChild(button);
                }
                const cancel = make('button', 'Cancel');
                cancel.type = 'button';
                cancel.addEventListener('click', () => { panel.remove(); open.disabled = false; hooks.lock(false); open.focus?.(); });
                panel.appendChild(cancel);
            } catch (err) {
                panel.textContent = `Could not preview: ${err.message}`;
                open.disabled = false;
                hooks.lock(false);
            }
        });
    }
    function mountRecovery(container, {api, storage = root.sessionStorage, ack}) {
        const make = (tag,text) => { const node = document.createElement(tag); node.textContent = text; return node; };
        container.textContent = '';
        let controller;
        try { controller = new PlanRemovalController(api,null,storage); }
        catch (_) { container.hidden = false; container.textContent = 'Plan-action safety storage unavailable. No new removal is allowed.'; return; }
        container.hidden = !controller.attempt;
        if (!controller.attempt) return;
        const status = make('p','A plan action is unconfirmed. Its source plan may already be gone. Check only its saved operation; no mutation will be replayed.');
        const read = make('button','Check plan action (read only)'); read.type = 'button';
        read.addEventListener('click', async () => {
            read.disabled = true;
            try {
                const receipt = await controller.recover();
                if (receipt.status === 'finalized' && receipt.result) {
                    container.hidden = false;
                    container.textContent = 'Plan action confirmed. Display refresh does not repeat it.';
                    if (document.activeElement === document.body || document.activeElement === read) {
                        container.setAttribute('tabindex','-1'); container.focus?.();
                    }
                    try { await ack(receipt.result); }
                    catch (_) { container.textContent = 'Plan action confirmed; display refresh failed. Retry display reads only.'; }
                } else status.textContent = 'No finalized receipt. Keep the operation and check again; no new removal is allowed.';
            } catch (err) { status.textContent = `Not confirmed: ${err.message}. Recovery remains read-only.`; }
            finally { read.disabled = false; }
        });
        container.appendChild(status); container.appendChild(read);
    }
    root.planRemoval = {mount, mountRecovery, PlanRemovalController};
    if (typeof document !== 'undefined' && typeof root.addEventListener === 'function') {
        const renderRecovery = () => {
            const container = document.getElementById('plan_removal_recovery');
            if (container) mountRecovery(container,{api,ack:result => root.dispatchEvent(new CustomEvent('timetrace:plan-removal-acknowledged',{detail:result}))});
        };
        document.addEventListener('DOMContentLoaded',renderRecovery);
        root.addEventListener('timetrace:plan-removal-journal',renderRecovery);
    }
    if (typeof module !== 'undefined') module.exports = {PlanRemovalController};
})(typeof window !== 'undefined' ? window : globalThis);
