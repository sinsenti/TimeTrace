/* A displayed manifest owns one approval; refresh/recovery never replays a write. */
(function (root) {
    class PlanRemovalController {
        constructor(api, id) { this.api = api; this.id = id; this.preview = null; this.attempt = null; }
        async load() {
            this.preview = await this.api.get(`/scheduled-sessions/${encodeURIComponent(this.id)}/removal-preview`);
            return this.preview;
        }
        async apply(action) {
            if (!this.preview || this.attempt) throw Error('Review a fresh manifest before confirming.');
            const payload = {action, consent_token:this.preview.consent_token, operation_id:root.crypto.randomUUID()};
            this.attempt = payload;
            return this.api.post(`/scheduled-sessions/${encodeURIComponent(this.id)}/removal`, payload);
        }
        recover() {
            if (!this.attempt) throw Error('No unconfirmed operation.');
            return this.api.get(`/operations/${encodeURIComponent(`plan-removal:${this.attempt.operation_id}`)}`);
        }
    }
    function mount(container, row, hooks) {
        if (row.is_virtual) return; // Existing occurrence delete/series policy is not bypassed here.
        const make = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
        const open = make('button', 'Delete / Squeeze');
        open.type = 'button';
        container.appendChild(open);
        open.addEventListener('click', async () => {
            if (!await hooks.available()) return;
            hooks.lock(true);
            open.disabled = true;
            const panel = make('section', 'Loading exact affected records…');
            panel.setAttribute('aria-label', 'Delete or squeeze confirmation');
            container.appendChild(panel);
            const controller = new PlanRemovalController(hooks.api, row.id);
            try {
                const preview = await controller.load();
                panel.textContent = '';
                panel.appendChild(make('p', 'Original plan and current schedule are shown below. Delete everything removes each whole associated work record, including portions outside this plan. Squeeze changes only the current schedule to their outer bounds, retaining gaps and original plan.'));
                panel.appendChild(make('pre', JSON.stringify(preview.manifest, null, 2)));
                const status = make('p', 'Choose an action to confirm this exact whole manifest, or cancel.');
                status.setAttribute('role', 'status');
                panel.appendChild(status);
                const buttons = [];
                for (const [action, label] of [['delete_everything', 'Delete everything'], ['squeeze', 'Squeeze']]) {
                    const button = make('button', label);
                    button.type = 'button';
                    const reasons = preview.blocked[action];
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
                cancel.addEventListener('click', () => { panel.remove(); open.disabled = false; hooks.lock(false); });
                panel.appendChild(cancel);
            } catch (err) {
                panel.textContent = `Could not preview: ${err.message}`;
                open.disabled = false;
                hooks.lock(false);
            }
        });
    }
    root.planRemoval = {mount, PlanRemovalController};
    if (typeof module !== 'undefined') module.exports = {PlanRemovalController};
})(typeof window !== 'undefined' ? window : globalThis);
