/**
 * TimeTrace Habits Engine & Multi-Select Inspector
 */

let allHabits = [];
let matrixDates = [];
let habitCharts = {};

let currentWeekOffset = 0;
let selectedInspectorHabitIds = new Set();

document.addEventListener('DOMContentLoaded', () => {
    generateMatrixDateHeaders();
    loadHabitsData();
    setupHabitModalKeyboardShortcuts();
});

function setupHabitModalKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        const modal = document.getElementById('habit_modal');
        if (!modal || modal.classList.contains('hidden')) return;

        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            saveHabit();
        } else if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            e.stopPropagation();
            closeHabitModal();
        }
    });
}

function prevWeek() {
    currentWeekOffset -= 1;
    generateMatrixDateHeaders();
    renderMatrixTable();
}

function nextWeek() {
    currentWeekOffset += 1;
    generateMatrixDateHeaders();
    renderMatrixTable();
}

function resetToCurrentWeek() {
    currentWeekOffset = 0;
    generateMatrixDateHeaders();
    renderMatrixTable();
}

function generateMatrixDateHeaders() {
    matrixDates = [];
    const today = new Date();
    
    const baseDate = new Date(today);
    baseDate.setDate(today.getDate() + (currentWeekOffset * 7));

    for (let i = 6; i >= 0; i--) {
        const d = new Date(baseDate);
        d.setDate(baseDate.getDate() - i);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
        
        const isToday = (yyyy === today.getFullYear() && (d.getMonth() === today.getMonth()) && d.getDate() === today.getDate());
        matrixDates.push({ date_str: `${yyyy}-${mm}-${dd}`, dayName: dayName, dayNum: d.getDate(), isToday: isToday });
    }

    const labelEl = document.getElementById('matrix_week_range_label');
    if (labelEl && matrixDates.length === 7) {
        labelEl.innerText = `${matrixDates[0].date_str} to ${matrixDates[6].date_str}`;
    }
}

async function loadHabitsData() {
    try {
        allHabits = await api.get('/habits') || [];

        if (selectedInspectorHabitIds.size === 0) {
            allHabits.forEach(h => selectedInspectorHabitIds.add(h.id));
        }

        renderMatrixTable();
        renderRemindersList();
        renderHabitInspectorChips();
    } catch (e) {
        console.error("Failed to load habits:", e);
    }
}

function switchHabitTab(tabName) {
    ['matrix', 'reminders', 'charts'].forEach(t => {
        document.getElementById(`habit_tab_${t}`).classList.add('hidden');
        document.getElementById(`tab_btn_${t}`).className = "px-3 py-1 rounded font-bold text-slate-400 hover:text-white";
    });

    document.getElementById(`habit_tab_${tabName}`).classList.remove('hidden');
    document.getElementById(`tab_btn_${tabName}`).className = "px-3 py-1 rounded font-bold bg-emerald-600 text-white";

    if (tabName === 'charts') {
        renderSelectedHabitCharts();
    }
}

function renderMatrixTable() {
    const headerRow = document.getElementById('matrix_table_header');
    const tbody = document.getElementById('matrix_table_body');
    if (!headerRow || !tbody) return;

    headerRow.innerHTML = '<th class="py-2.5 px-3 font-bold uppercase w-56">Habit Name</th>' +
        matrixDates.map(d => `
            <th class="py-2.5 px-2 text-center font-extrabold ${d.isToday ? 'text-emerald-400 bg-emerald-950/20 rounded' : 'text-slate-400'}">
                <div class="text-[10px] opacity-75">${d.dayName}</div>
                <div class="text-sm">${d.dayNum}</div>
            </th>
        `).join('');

    if (allHabits.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-500">No habits tracked yet. Click "+ New Habit" to create your first habit!</td></tr>`;
        return;
    }

    tbody.innerHTML = allHabits.map(h => {
        const logs = h.logs || {};
        return `
            <tr class="hover:bg-[#161824] transition">
                <td onclick="openEditHabitModal('${h.id}')" class="py-3 px-3 cursor-pointer group hover:bg-[#1f2234] transition rounded-l-lg">
                    <div class="flex items-center justify-between">
                        <div>
                            <span class="font-bold text-sm text-white group-hover:text-emerald-400 transition">${h.name}</span>
                            <span class="block text-[10px] text-slate-400">${h.habit_type === 'numeric' ? `Target: ${h.target_value} ${h.unit}` : h.frequency}</span>
                        </div>
                    </div>
                </td>
                ${matrixDates.map(d => {
                    const log = logs[d.date_str] || { status: 'pending', value: 0 };
                    return renderMatrixCell(h, d.date_str, log);
                }).join('')}
            </tr>
        `;
    }).join('');
}

function renderMatrixCell(habit, dateStr, log) {
    if (habit.habit_type === 'boolean') {
        let badgeContent = '·';
        let bgClass = 'bg-[#181a28] text-slate-600';

        if (log.status === 'completed') { badgeContent = '✓'; bgClass = 'cell-completed'; }
        else if (log.status === 'failed') { badgeContent = '✕'; bgClass = 'cell-failed'; }
        else if (log.status === 'skipped') { badgeContent = '↷'; bgClass = 'cell-skipped'; }

        return `
            <td class="py-2 px-1 text-center">
                <button onclick="toggleBooleanHabitLog('${habit.id}', '${dateStr}', '${log.status}')" class="w-8 h-8 rounded-lg ${bgClass} font-bold text-sm hover:scale-110 transition flex items-center justify-center mx-auto">
                    ${badgeContent}
                </button>
            </td>
        `;
    } else {
        const isTargetReached = log.value >= habit.target_value;
        const bgClass = isTargetReached ? 'cell-completed' : (log.value > 0 ? 'cell-in-progress' : 'bg-[#181a28] text-slate-400');

        return `
            <td class="py-2 px-1 text-center">
                <div class="flex flex-col items-center space-y-1">
                    <div class="flex items-center space-x-1">
                        <input type="number" step="any" min="0" value="${log.value}" onchange="setHabitDirectValue('${habit.id}', '${dateStr}', this.value)" class="w-12 py-0.5 px-1 rounded-lg ${bgClass} text-[11px] font-black text-center focus:outline-none focus:ring-1 focus:ring-emerald-400">
                        <span class="text-[9px] text-slate-500 font-bold">${habit.unit ? habit.unit.slice(0,3) : ''}</span>
                    </div>
                    <div class="flex space-x-1">
                        <button onclick="incrementHabitVal('${habit.id}', '${dateStr}', -1)" class="w-4 h-4 bg-[#222536] hover:bg-red-900 text-slate-300 rounded text-[10px] flex items-center justify-center">-</button>
                        <button onclick="incrementHabitVal('${habit.id}', '${dateStr}', 1)" class="w-4 h-4 bg-[#222536] hover:bg-emerald-900 text-slate-300 rounded text-[10px] flex items-center justify-center">+</button>
                        <button onclick="incrementHabitVal('${habit.id}', '${dateStr}', 5)" class="w-5 h-4 bg-emerald-900/60 hover:bg-emerald-700 text-emerald-200 font-bold rounded text-[9px] flex items-center justify-center">+5</button>
                    </div>
                </div>
            </td>
        `;
    }
}

async function toggleBooleanHabitLog(habitId, dateStr, currentStatus) {
    let nextStatus = 'completed';
    if (currentStatus === 'completed') nextStatus = 'failed';
    else if (currentStatus === 'failed') nextStatus = 'skipped';
    else if (currentStatus === 'skipped') nextStatus = 'erase';

    await api.post(`/habits/${habitId}/log`, { date_str: dateStr, status: nextStatus });
    loadHabitsData();
}

async function incrementHabitVal(habitId, dateStr, delta) {
    await api.post(`/habits/${habitId}/log`, { date_str: dateStr, delta_value: delta });
    loadHabitsData();
}

async function setHabitDirectValue(habitId, dateStr, rawVal) {
    const val = parseFloat(rawVal);
    if (isNaN(val)) return;

    await api.post(`/habits/${habitId}/log`, { date_str: dateStr, set_value: Math.max(0, val) });
    loadHabitsData();
}

function renderRemindersList() {
    const container = document.getElementById('reminders_card_list');
    if (!container) return;

    if (allHabits.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-slate-500">No habit reminders active.</div>`;
        return;
    }

    container.innerHTML = allHabits.map(h => `
        <div onclick="openEditHabitModal('${h.id}')" class="habit-card p-4 flex items-center justify-between hover:border-emerald-500 cursor-pointer transition">
            <div class="flex items-center space-x-3">
                <span class="w-3 h-3 rounded-full inline-block shrink-0" style="background-color: ${h.color || '#10b981'}"></span>
                <div>
                    <span class="font-bold text-sm text-white block">${h.name}</span>
                    <span class="text-xs text-slate-400">${h.frequency}</span>
                </div>
            </div>
            <div class="flex items-center space-x-3">
                <span class="bg-[#181a28] border border-[#262938] px-3 py-1 rounded-lg text-xs font-bold text-slate-300">
                    Time: ${h.reminder_time || '09:00 AM'}
                </span>
                <button type="button" onclick="event.stopPropagation(); openEditHabitModal('${h.id}')" class="text-xs text-slate-400 hover:text-white underline">Edit</button>
            </div>
        </div>
    `).join('');
}

function renderHabitInspectorChips() {
    const container = document.getElementById('habit_inspector_chips');
    if (!container) return;

    if (allHabits.length === 0) {
        container.innerHTML = '<span class="text-xs text-slate-500">No habits available.</span>';
        return;
    }

    container.innerHTML = allHabits.map(h => {
        const isSelected = selectedInspectorHabitIds.has(h.id);
        const activeClass = "bg-emerald-900/80 text-emerald-200 border-emerald-600 font-bold";
        const inactiveClass = "bg-[#181a28] text-slate-500 border-[var(--border-muted)] hover:text-slate-300";

        return `
            <button onclick="toggleHabitInspectorSelection('${h.id}')" class="px-2.5 py-1 rounded-lg text-xs border transition flex items-center space-x-1.5 ${isSelected ? activeClass : inactiveClass}">
                <span class="w-2 h-2 rounded-full inline-block" style="background-color: ${h.color || '#10b981'}"></span>
                <span>${h.name}</span>
            </button>
        `;
    }).join('');
}

function toggleHabitInspectorSelection(habitId) {
    if (selectedInspectorHabitIds.has(habitId)) {
        selectedInspectorHabitIds.delete(habitId);
    } else {
        selectedInspectorHabitIds.add(habitId);
    }
    renderHabitInspectorChips();
    renderSelectedHabitCharts();
}

function selectAllHabits() {
    allHabits.forEach(h => selectedInspectorHabitIds.add(h.id));
    renderHabitInspectorChips();
    renderSelectedHabitCharts();
}

function deselectAllHabits() {
    selectedInspectorHabitIds.clear();
    renderHabitInspectorChips();
    renderSelectedHabitCharts();
}

async function renderSelectedHabitCharts() {
    const tbody = document.getElementById('completeness_table_body');
    const kpiSummary = document.getElementById('inspector_kpi_summary');
    if (!tbody) return;

    const activeHabits = allHabits.filter(h => selectedInspectorHabitIds.has(h.id));

    if (activeHabits.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-500">No habits selected. Click chips above to select habits to inspect.</td></tr>`;
        if (kpiSummary) kpiSummary.innerHTML = '';
        if (habitCharts.doughnut) habitCharts.doughnut.destroy();
        if (habitCharts.bar) habitCharts.bar.destroy();
        return;
    }

    let grandCompleted = 0;
    let grandFailed = 0;
    let grandSkipped = 0;
    let grandLogsCount = 0;

    const dateAggregates = {};

    const rowsHTML = activeHabits.map(h => {
        const logsMap = h.logs || {};
        const logEntries = Object.values(logsMap);

        const compCount = logEntries.filter(l => l.status === 'completed').length;
        const failCount = logEntries.filter(l => l.status === 'failed').length;
        const skipCount = logEntries.filter(l => l.status === 'skipped').length;
        const totalLogs = logEntries.length;

        grandCompleted += compCount;
        grandFailed += failCount;
        grandSkipped += skipCount;
        grandLogsCount += totalLogs;

        Object.entries(logsMap).forEach(([dStr, l]) => {
            if (!dateAggregates[dStr]) dateAggregates[dStr] = 0;
            if (l.status === 'completed') dateAggregates[dStr] += 1;
        });

        const rate = totalLogs > 0 ? Math.round((compCount / totalLogs) * 100) : 0;
        const rateColor = rate >= 80 ? 'text-emerald-400' : (rate >= 50 ? 'text-amber-400' : 'text-red-400');

        return `
            <tr onclick="openEditHabitModal('${h.id}')" class="hover:bg-[#161824] cursor-pointer transition">
                <td class="py-2.5 px-3 font-bold text-white flex items-center space-x-2">
                    <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${h.color || '#10b981'}"></span>
                    <span>${h.name}</span>
                </td>
                <td class="py-2.5 px-3 text-slate-400">${h.habit_type === 'numeric' ? `${h.target_value} ${h.unit}` : 'Checkmark'}</td>
                <td class="py-2.5 px-3 font-mono font-bold text-slate-300">${totalLogs}</td>
                <td class="py-2.5 px-3 font-mono font-bold text-emerald-400">${compCount}</td>
                <td class="py-2.5 px-3 font-mono font-bold text-red-400">${failCount}</td>
                <td class="py-2.5 px-3 font-mono font-bold text-slate-400">${skipCount}</td>
                <td class="py-2.5 px-3 font-mono font-black ${rateColor}">${rate}%</td>
                <td class="py-2.5 px-3 text-right">
                    <span class="px-2 py-0.5 rounded text-[9px] font-extrabold uppercase ${rate >= 70 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-amber-950 text-amber-400 border border-amber-800'}">
                        ${rate >= 70 ? 'Optimal' : 'Needs Focus'}
                    </span>
                </td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rowsHTML;

    const overallRate = grandLogsCount > 0 ? Math.round((grandCompleted / grandLogsCount) * 100) : 0;
    if (kpiSummary) {
        kpiSummary.innerHTML = `
            <div>
                <span class="text-[10px] text-slate-400 uppercase font-semibold block">Selected Habits</span>
                <span class="text-base font-black text-purple-400">${activeHabits.length}</span>
            </div>
            <div>
                <span class="text-[10px] text-slate-400 uppercase font-semibold block">Completed Days</span>
                <span class="text-base font-black text-emerald-400">${grandCompleted}</span>
            </div>
            <div>
                <span class="text-[10px] text-slate-400 uppercase font-semibold block">Compliance Score</span>
                <span class="text-base font-black text-blue-400">${overallRate}%</span>
            </div>
        `;
    }

    const ctxDoughnut = document.getElementById('chart_habit_doughnut').getContext('2d');
    if (habitCharts.doughnut) habitCharts.doughnut.destroy();

    habitCharts.doughnut = new Chart(ctxDoughnut, {
        type: 'doughnut',
        data: {
            labels: ['Completed', 'Failed', 'Skipped'],
            datasets: [{
                data: [grandCompleted, grandFailed, grandSkipped],
                backgroundColor: ['#10b981', '#ef4444', '#475569'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 12 } } }
        }
    });

    const sortedDates = Object.keys(dateAggregates).sort().slice(-30);
    const ctxBar = document.getElementById('chart_habit_bar').getContext('2d');
    if (habitCharts.bar) habitCharts.bar.destroy();

    habitCharts.bar = new Chart(ctxBar, {
        type: 'bar',
        data: {
            labels: sortedDates.map(d => d.slice(5)),
            datasets: [{
                label: 'Completed Habits Count',
                data: sortedDates.map(d => dateAggregates[d] || 0),
                backgroundColor: '#10b981',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#64748b' }, grid: { color: '#1a1c26' } },
                y: { ticks: { color: '#64748b', precision: 0 }, grid: { color: '#1a1c26' } }
            }
        }
    });
}

function toggleHabitTypeFields() {
    const type = document.getElementById('modal_habit_type').value;
    const group = document.getElementById('numeric_fields_group');
    if (type === 'numeric') group.classList.remove('hidden');
    else group.classList.add('hidden');
}

function openNewHabitModal() {
    document.getElementById('edit_habit_id').value = '';
    document.getElementById('modal_habit_title').innerText = 'Create Habit';
    document.getElementById('modal_habit_name').value = '';
    document.getElementById('modal_habit_type').value = 'boolean';
    document.getElementById('modal_habit_target').value = '1';
    document.getElementById('modal_habit_unit').value = '';
    document.getElementById('modal_habit_frequency').value = 'Every day';
    document.getElementById('modal_habit_reminder').value = '09:00';
    document.getElementById('modal_habit_delete_btn').classList.add('hidden');
    toggleHabitTypeFields();
    document.getElementById('habit_modal').classList.remove('hidden');

    setTimeout(() => {
        const nameInput = document.getElementById('modal_habit_name');
        if (nameInput) nameInput.focus();
    }, 50);
}

function openEditHabitModal(id) {
    const h = allHabits.find(item => item.id === id);
    if (!h) return;

    document.getElementById('edit_habit_id').value = h.id;
    document.getElementById('modal_habit_title').innerText = 'Edit Habit';
    document.getElementById('modal_habit_name').value = h.name;
    document.getElementById('modal_habit_type').value = h.habit_type || 'boolean';
    document.getElementById('modal_habit_target').value = h.target_value || 1;
    document.getElementById('modal_habit_unit').value = h.unit || '';
    document.getElementById('modal_habit_frequency').value = h.frequency || 'Every day';
    document.getElementById('modal_habit_reminder').value = h.reminder_time || '09:00';
    document.getElementById('modal_habit_color').value = h.color || '#10b981';
    document.getElementById('modal_habit_delete_btn').classList.remove('hidden');
    toggleHabitTypeFields();
    document.getElementById('habit_modal').classList.remove('hidden');

    setTimeout(() => {
        const nameInput = document.getElementById('modal_habit_name');
        if (nameInput) nameInput.focus();
    }, 50);
}

function closeHabitModal() {
    document.getElementById('habit_modal').classList.add('hidden');
}

async function saveHabit() {
    const id = document.getElementById('edit_habit_id').value;
    const payload = {
        name: document.getElementById('modal_habit_name').value,
        habit_type: document.getElementById('modal_habit_type').value,
        target_value: parseFloat(document.getElementById('modal_habit_target').value) || 1.0,
        unit: document.getElementById('modal_habit_unit').value,
        frequency: document.getElementById('modal_habit_frequency').value,
        reminder_time: document.getElementById('modal_habit_reminder').value,
        color: document.getElementById('modal_habit_color').value
    };

    if (!payload.name) return;

    if (id) {
        await api.put(`/habits/${id}`, payload);
    } else {
        await api.post('/habits', payload);
    }

    closeHabitModal();
    loadHabitsData();
}

async function deleteHabit() {
    const id = document.getElementById('edit_habit_id').value;
    if (!id) return;

    const confirmed = await showCustomConfirm("Delete Habit", "Are you sure you want to delete this habit and all its history?");
    if (confirmed) {
        await api.delete(`/habits/${id}`);
        closeHabitModal();
        loadHabitsData();
    }
}
