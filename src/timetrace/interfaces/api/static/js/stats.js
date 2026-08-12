let charts = {};
let widgetConfig = JSON.parse(localStorage.getItem('timetrace_widget_config') || JSON.stringify({
    daily_trend: true,
    hourly_heatmap: true,
    tags_pie: true,
    habits: true,
    obstacles: true
}));

document.addEventListener('DOMContentLoaded', () => {
    applyWidgetVisibility();
    loadAnalyticsData();
});

function toggleWidgetModal() {
    const modal = document.getElementById('widget_config_modal');
    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) {
        renderWidgetToggleControls();
    }
}

function renderWidgetToggleControls() {
    const container = document.getElementById('widget_toggle_list');
    const widgets = [
        { id: 'daily_trend', label: 'Daily Focus Trend (Bar Chart)' },
        { id: 'hourly_heatmap', label: 'Peak Focus Hours (24h Distribution)' },
        { id: 'tags_pie', label: 'Activity Breakdown (#tags Doughnut)' },
        { id: 'habits', label: 'Habit Frequency & Streaks' },
        { id: 'obstacles', label: 'Recent Obstacles & Distractions Log' }
    ];

    container.innerHTML = widgets.map(w => `
        <label class="flex items-center justify-between p-2.5 bg-[#0f1016] rounded-lg border border-[#262938] cursor-pointer hover:border-purple-500">
            <span class="font-medium">${w.label}</span>
            <input type="checkbox" ${widgetConfig[w.id] ? 'checked' : ''} onchange="toggleWidget('${w.id}', this.checked)" class="w-4 h-4 accent-purple-600 rounded">
        </label>
    `).join('');
}

function toggleWidget(widgetId, isVisible) {
    widgetConfig[widgetId] = isVisible;
    localStorage.setItem('timetrace_widget_config', JSON.stringify(widgetConfig));
    applyWidgetVisibility();
}

function applyWidgetVisibility() {
    Object.keys(widgetConfig).forEach(id => {
        const el = document.getElementById(`widget_${id}`);
        if (el) {
            if (widgetConfig[id]) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        }
    });
}

async function loadAnalyticsData() {
    try {
        const res = await fetch('/api/v1/analytics/detailed');
        const data = await res.json();

        document.getElementById('kpi_total_hours').innerText = `${data.summary.total_hours}h`;
        document.getElementById('kpi_total_sessions').innerText = data.summary.total_sessions;
        document.getElementById('kpi_total_tasks').innerText = data.summary.tasks_count;

        renderDailyChart(data.daily_trend);
        renderHourlyChart(data.hourly_distribution);
        renderTagsPieChart(data.tags_summary);

    } catch (err) {
        console.error("Failed to load detailed analytics:", err);
    }
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
            }
        }
    });
}
