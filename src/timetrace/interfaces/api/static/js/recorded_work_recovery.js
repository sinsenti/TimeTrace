/* Shared manual-recording uncertainty journal. Reads never replay a recording. */
(() => {
    const render = () => {
        const root = document.getElementById('manual_work_recovery');
        if (!root) return;
        root.textContent = '';
        let attempt;
        try { attempt = api.recordedWorkAttempt(); }
        catch (_) { root.textContent = 'Manual recording safety storage unavailable. Recording is blocked.'; root.hidden = false; return; }
        root.hidden = !attempt;
        if (!attempt) return;
        const notice = document.createElement('p');
        notice.setAttribute('role', 'status');
        notice.textContent = `Manual recording not confirmed: ${attempt.payload.start_time} — ${attempt.payload.end_time}. Do not recreate work that already exists. Navigation and Refresh do not replay it.`;
        const read = document.createElement('button');
        read.type = 'button';
        read.textContent = 'Read recorded work before reviewing';
        read.addEventListener('click', async () => {
            read.disabled = true;
            try {
                const start = attempt.payload.start_time;
                const end = new Date(+new Date(start) + 60000).toISOString();
                const data = await api.get(`/agenda?${new URLSearchParams({start, end})}`);
                if (!Array.isArray(data.items)) throw Error('Invalid range response');
                const records = data.items.filter(row => row.kind === 'recorded_work');
                notice.textContent = `Attempted ${attempt.payload.start_time} — ${attempt.payload.end_time}. Recorded work starting in this minute: ${records.map(row => `${row.id}: ${row.start_time} — ${row.end_time}`).join('; ') || 'None visible'}. Absence is not proof of failure.`;
                const done = document.createElement('button');
                done.type = 'button';
                done.textContent = 'Reviewed — allow a new recording (does not retry)';
                done.addEventListener('click', () => {
                    if (!window.confirm('I reviewed saved work. Release this uncertain attempt without replaying it?')) return;
                    try { api.rememberRecordedWorkAttempt(null); render(); }
                    catch (_) { notice.textContent = 'Could not release safety journal. Recording remains blocked.'; }
                });
                root.appendChild(done);
            } catch (_) { notice.textContent += ' Read failed. Retry the read; recording remains blocked.'; }
            finally { read.disabled = false; }
        });
        root.appendChild(notice); root.appendChild(read);
    };
    window.addEventListener('timetrace:manual-work-journal', render);
    document.addEventListener('DOMContentLoaded', render);
})();
