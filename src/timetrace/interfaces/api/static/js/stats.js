/**
 * Drill-down inspectors for the /stats "Overview" dashboard.
 *
 * Widget rendering itself lives in dashboards.js -- this file only answers "the user clicked a
 * bar/slice, show me the underlying sessions or tasks", reusing the same endpoints the old
 * hardcoded charts used.
 */

async function inspectTagSessions(tag) {
    try {
        const sessions = await api.get('/sessions') || [];
        const filtered = sessions.filter(s => (s.tags || '').includes(tag));

        showDrilldownInspector(
            `Tag Inspection: ${tag}`,
            `Displaying ${filtered.length} session logs tagged with ${tag}`,
            filtered.map(s => renderSessionDrilldownRow(s)).join('')
        );
    } catch (e) {}
}

async function inspectDaySessions(dateStr) {
    try {
        const summary = await api.get(`/revision/day-summary?date_str=${dateStr}`);
        const sessions = summary ? summary.sessions : [];

        showDrilldownInspector(
            `Daily Inspection: ${dateStr}`,
            `Logged ${sessions.length} sessions totaling ${summary ? summary.total_hours : 0} hours`,
            sessions.map(s => renderSessionDrilldownRow(s)).join('')
        );
    } catch (e) {}
}

const ESTIMATION_BUCKET_LABELS = {
    accurate: 'Accurate Tasks (+/-15%)',
    underestimated: 'Underestimated Tasks (>115%)',
    overestimated: 'Overestimated Tasks (<85%)'
};

async function inspectEstimationCategory(bucket) {
    try {
        const tasks = await api.get('/api/tasks?status=all') || [];
        const sessions = await api.get('/sessions') || [];

        const taskSecs = {};
        sessions.forEach(s => {
            if (s.task_id) taskSecs[s.task_id] = (taskSecs[s.task_id] || 0) + (s.duration_seconds || 0);
        });

        const filteredTasks = tasks.filter(t => {
            if ((t.status || '').toLowerCase() === 'ongoing') return false;
            const actualSecs = taskSecs[t.id] || 0;
            if (actualSecs === 0) return false;
            const estSecs = (t.estimated_minutes || 15) * 60;
            const ratio = actualSecs / estSecs;

            if (bucket === 'accurate') return ratio >= 0.85 && ratio <= 1.15;
            if (bucket === 'underestimated') return ratio > 1.15;
            if (bucket === 'overestimated') return ratio < 0.85;
            return false;
        });

        showDrilldownInspector(
            ESTIMATION_BUCKET_LABELS[bucket] || bucket,
            `Displaying ${filteredTasks.length} tasks matching this estimation bucket`,
            filteredTasks.map(t => `
                <div onclick="window.location.href='/task-inspector/${t.id}'" class="bg-[#0f1016] border border-[var(--border-muted)] hover:border-purple-500 p-3 rounded-lg flex justify-between items-center text-xs cursor-pointer transition">
                    <div>
                        <span class="font-bold text-white block text-sm">${t.title}</span>
                        <span class="text-slate-400">Est: ${t.estimated_minutes || 15}m | Tracked: ${((taskSecs[t.id] || 0) / 3600).toFixed(1)}h</span>
                    </div>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-purple-950 text-purple-300 border border-purple-800">${t.status}</span>
                </div>
            `).join('')
        );
    } catch (e) {}
}

function renderSessionDrilldownRow(s) {
    const st = s.start_time ? new Date(s.start_time).toLocaleString() : '';
    const durMins = Math.round(((s.duration_seconds || 0) / 60) * 10) / 10;
    const taskTitle = s.task ? s.task.title : (s.notes || s.tags || 'Session Log');

    return `
        <div class="bg-[#0f1016] border border-[var(--border-muted)] p-3 rounded-lg text-xs space-y-1">
            <div class="flex justify-between items-center font-mono">
                <span class="text-purple-300 font-bold">${st}</span>
                <span class="text-slate-400 font-bold">${durMins} mins</span>
            </div>
            <div class="text-white font-bold text-sm">${taskTitle}</div>
            ${s.notes ? `<div class="text-slate-300">${s.notes}</div>` : ''}
        </div>
    `;
}

function showDrilldownInspector(title, subtitle, contentHTML) {
    const container = document.getElementById('stats_drilldown_inspector');
    const titleEl = document.getElementById('drilldown_title');
    const subEl = document.getElementById('drilldown_subtitle');
    const listEl = document.getElementById('drilldown_item_list');

    if (!container || !listEl) return;

    if (titleEl) titleEl.innerText = title;
    if (subEl) subEl.innerText = subtitle;
    listEl.innerHTML = contentHTML || '<div class="text-xs text-slate-500 py-4 text-center">No matching items found.</div>';

    container.classList.remove('hidden');
    container.scrollIntoView({ behavior: 'smooth' });
}

function closeDrilldownInspector() {
    const container = document.getElementById('stats_drilldown_inspector');
    if (container) container.classList.add('hidden');
}
