let charts = {};
let rawAnalyticsData = null;

document.addEventListener('DOMContentLoaded', () => {
    loadAnalyticsData();
});

async function loadAnalyticsData() {
    try {
        rawAnalyticsData = await api.get('/analytics/detailed');
        const data = rawAnalyticsData;
        if (!data) return;

        document.getElementById('kpi_total_hours').innerText = `${data.summary.total_hours}h`;
        document.getElementById('kpi_total_sessions').innerText = data.summary.total_sessions;
        document.getElementById('kpi_total_tasks').innerText = data.summary.tasks_count;

        if (data.estimation) {
            document.getElementById('kpi_estimation_accuracy').innerText = `${data.estimation.accuracy_score_pct}%`;
            document.getElementById('estimation_accuracy_ratio').innerText = `Tracked: ${data.estimation.total_actual_hours}h / Est: ${data.estimation.total_estimated_hours}h`;
            renderEstimationAccuracyChart(data.estimation);
        }

        renderDailyChart(data.daily_trend);
        renderHourlyChart(data.hourly_distribution);
        renderTagsPieChart(data.tags_summary);

    } catch (err) {
        console.error("Failed to load detailed analytics:", err);
    }
}

function renderEstimationAccuracyChart(est) {
    const ctx = document.getElementById('chart_estimation_accuracy').getContext('2d');
    if (charts.estimation) charts.estimation.destroy();

    charts.estimation = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Accurate (±15%)', 'Underestimated (>115%)', 'Overestimated (<85%)'],
            datasets: [{
                data: [est.accurate_count, est.underestimated_count, est.overestimated_count],
                backgroundColor: ['#10b981', '#ef4444', '#f59e0b'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 12 } }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    inspectEstimationCategory(idx);
                }
            }
        }
    });
}

function renderDailyChart(dailyData) {
    const ctx = document.getElementById('chart_daily_trend').getContext('2d');
    if (charts.daily) charts.daily.destroy();

    charts.daily = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(dailyData),
            datasets: [{
                label: 'Focus Hours',
                data: Object.values(dailyData),
                backgroundColor: '#8b5cf6',
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#64748b' }, grid: { color: '#1a1c26' } },
                y: { ticks: { color: '#64748b' }, grid: { color: '#1a1c26' } }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const dateStr = Object.keys(dailyData)[elements[0].index];
                    inspectDaySessions(dateStr);
                }
            }
        }
    });
}

function renderHourlyChart(hourlyData) {
    const ctx = document.getElementById('chart_hourly_heatmap').getContext('2d');
    if (charts.hourly) charts.hourly.destroy();

    charts.hourly = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(hourlyData),
            datasets: [{
                label: 'Hours Spent',
                data: Object.values(hourlyData),
                backgroundColor: '#10b981',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#64748b', fontSize: 10 }, grid: { color: '#1a1c26' } },
                y: { ticks: { color: '#64748b' }, grid: { color: '#1a1c26' } }
            }
        }
    });
}

function renderTagsPieChart(tagsData) {
    const ctx = document.getElementById('chart_tags_pie').getContext('2d');
    if (charts.tags) charts.tags.destroy();

    const palette = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

    charts.tags = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: tagsData.map(t => t.tag),
            datasets: [{
                data: tagsData.map(t => t.total_hours),
                backgroundColor: palette,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#94a3b8', boxWidth: 12 } }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const tag = tagsData[elements[0].index].tag;
                    inspectTagSessions(tag);
                }
            }
        }
    });
}

async function inspectTagSessions(tag) {
    try {
        const sessions = await api.get('/sessions') || [];
        const filtered = sessions.filter(s => (s.tags || '').includes(tag));

        showDrilldownInspector(
            `Tag Inspection: ${tag}`,
            `Displaying ${filtered.length} session logs tagged with ${tag}`,
            filtered.map(s => renderSessionDrilldownRow(s)).join('')
        );
    } catch(e) {}
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
    } catch(e) {}
}

async function inspectEstimationCategory(bucketIdx) {
    const labels = ['Accurate Tasks (±15%)', 'Underestimated Tasks (>115%)', 'Overestimated Tasks (<85%)'];
    try {
        const tasks = await api.get('/tasks?status=all') || [];
        const sessions = await api.get('/sessions') || [];

        const taskSecs = {};
        sessions.forEach(s => {
            if (s.task_id) taskSecs[s.task_id] = (taskSecs[s.task_id] || 0) + (s.duration_seconds || 0);
        });

        const filteredTasks = tasks.filter(t => {
            const actualSecs = taskSecs[t.id] || 0;
            if (actualSecs === 0) return false;
            const estSecs = (t.estimated_minutes || 15) * 60;
            const ratio = actualSecs / estSecs;

            if (bucketIdx === 0) return ratio >= 0.85 && ratio <= 1.15;
            if (bucketIdx === 1) return ratio > 1.15;
            if (bucketIdx === 2) return ratio < 0.85;
            return false;
        });

        showDrilldownInspector(
            labels[bucketIdx],
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
    } catch(e) {}
}

function renderSessionDrilldownRow(s) {
    const st = s.start_time ? new Date(s.start_time).toLocaleString() : '';
    const durMins = roundVal((s.duration_seconds || 0) / 60, 1);
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
