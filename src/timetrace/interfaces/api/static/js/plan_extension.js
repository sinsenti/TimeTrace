/* Shared Agenda/Calendar action: fixed preview, one Apply, then read-only recovery. */
function createPlanExtensionAction({api, acknowledge, refresh, onState = () => {}, operationId = () => crypto.randomUUID()}) {
    let state = {phase: 'idle'}, pending = false;
    const publish = () => onState({...state, pending});
    const snapshot = () => ({...state, pending});
    function preview(plan, end) {
        if (pending || state.phase === 'uncertain') return false;
        const at = new Date(end);
        if (!Number.isFinite(at.getTime()) || at <= new Date(plan.end_time)) throw Error('Choose an end after the current scheduled end.');
        state = {phase:'preview', plan, end:at.toISOString(), operation:operationId()};
        publish();
        return true;
    }
    async function accepted(saved) {
        // Identity/revision checkpoint must precede every fallible read.
        state = {...state, phase:'acknowledged', saved};
        acknowledge(saved);
        publish();
        try { await refresh(); state.phase = 'complete'; }
        catch (_) { state.phase = 'refresh_failed'; }
    }
    async function apply() {
        if (pending || state.phase !== 'preview') return;
        pending = true; publish();
        const plan = state.plan;
        const payload = {end_time:state.end, operation_id:state.operation};
        if (plan.is_virtual) payload.expected_projection_revision = plan.projection_revision;
        else payload.expected_revision = plan.revision;
        try { await accepted(await api.post(`/scheduled-sessions/${encodeURIComponent(plan.id)}/extend`, payload)); }
        catch (err) { state.phase = err.status === 409 ? 'stale' : !err.status || err.status >= 500 ? 'uncertain' : 'invalid'; state.error = err.message; }
        finally { pending = false; publish(); }
    }
    async function recover() {
        if (pending) return;
        pending = true; publish();
        try {
            if (state.phase === 'uncertain') {
                const receipt = await api.get(`/operations/${encodeURIComponent(state.operation)}`);
                if (receipt.status === 'finalized') await accepted(receipt.result);
            } else if (['acknowledged', 'refresh_failed', 'complete'].includes(state.phase)) {
                await refresh(); state.phase = 'complete';
            }
        } catch (_) { /* Preserve draft/ACK: no implicit write replay. */ }
        finally { pending = false; publish(); }
    }
    return {preview, apply, recover, snapshot};
}
if (typeof module !== 'undefined') module.exports = {createPlanExtensionAction};
