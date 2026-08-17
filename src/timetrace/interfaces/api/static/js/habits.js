let allHabits = [];
let matrixDates = [];
let habitCharts = {};

document.addEventListener('DOMContentLoaded', () => {
    generateMatrixDateHeaders();
    loadHabitsData();
});

function generateMatrixDateHeaders() {
    matrixDates = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
        matrixDates.push({ date_str: `${yyyy}-${mm}-${dd}`, dayName: dayName, dayNum: d.getDate(), isToday: i === 0 });
    }
}

async function loadHabitsData() {
    try {
        const res = await fetch('/habits');
        allHabits = await res.json();
        renderMatrixTable();
        renderRemindersList();
        populateChartHabitSelect();
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
                <td class="py-3 px-3">
                    <div class="flex items-center justify-between">
                        <div>
                            <span onclick="openEditHabitModal(${h.id})" class="font-bold text-sm text-white hover:text-emerald-400 cursor-pointer">${h.name}</span>
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
        else if (log.status === 'failed') { badgeContent = '✗'; bgClass = 'cell-failed'; }
        else if (log.status === 'skipped') { badgeContent = '↷'; bgClass = 'cell-skipped'; }

        return `
            <td class="py-2 px-1 text-center">
                <button onclick="toggleBooleanHabitLog(${habit.id}, '${dateStr}', '${log.status}')" class="w-8 h-8 rounded-lg ${bgClass} font-bold text-sm hover:scale-110 transition flex items-center justify-center mx-auto">
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
                    <div class="px-2 py-1 rounded-lg ${bgClass} text-[11px] font-black w-14 text-center">
                        ${log.value} ${habit.unit ? habit.unit.slice(0,3) : ''}
                    </div>
                    <div class="flex space-x-1">
                        <button onclick="incrementHabitVal(${habit.id}, '${dateStr}', -1)" class="w-4 h-4 bg-[#222536] hover:bg-red-900 text-slate-300 rounded text-[10px] flex items-center justify-center">-</button>
                        <button onclick="incrementHabitVal(${habit.id}, '${dateStr}', 1)" class="w-4 h-4 bg-[#222536] hover:bg-emerald-900 text-slate-300 rounded text-[10px] flex items-center justify-center">+</button>
                        <button onclick="incrementHabitVal(${habit.id}, '${dateStr}', 5)" class="w-5 h-4 bg-emerald-900/60 hover:bg-emerald-700 text-emerald-200 font-bold rounded text-[9px] flex items-center justify-center">+5</button>
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

    await fetch(`/habits/${habitId}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_str: dateStr, status: nextStatus })
    });
    loadHabitsData();
}

async function incrementHabitVal(habitId, dateStr, delta) {
    await fetch(`/habits/${habitId}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_str: dateStr, delta_value: delta })
    });
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
        <div class="habit-card p-4 flex items-center justify-between hover:border-emerald-500 transition">
            <div class="flex items-center space-x-3">
                <span class="w-3 h-3 rounded-full inline-block shrink-0" style="background-color: ${h.color || '#10b981'}"></span>
                <div>
                    <span class="font-bold text-sm text-white block">${h.name}</span>
                    <span class="text-xs text-slate-400">${h.frequency}</span>
                </div>
            </div>
            <div class="flex items-center space-x-3">
                <span class="bg-[#181a28] border border-[#262938] px-3 py-1 rounded-lg text-xs font-bold text-slate-300">
                    ⏰ ${h.reminder_time || '09:00 AM'}
                </span>
                <button onclick="openEditHabitModal(${h.id})" class="text-xs text-slate-400 hover:text-white underline">Edit</button>
            </div>
        </div>
    `).join('');
}

function populateChartHabitSelect() {
    const select = document.getElementById('chart_habit_select');
    if (!select) return;

    select.innerHTML = allHabits.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
    if (allHabits.length > 0 && !select.value) {
        select.value = allHabits[0].id;
    }
}

async function renderSelectedHabitCharts() {
    const select = document.getElementById('chart_habit_select');
    if (!select || !select.value) return;

    const habitId = select.value;
    const res = await fetch(`/habits/${habitId}/stats`);
    const data = await res.json();

    const kpiContainer = document.getElementById('chart_habit_kpis');
    if (kpiContainer) {
        kpiContainer.innerHTML = `
            <div>
                <span class="text-[10px] text-slate-400 uppercase font-semibold block">Completed</span>
                <span class="text-xl font-black text-emerald-400">${data.summary.completed} days</span>
            </div>
            <div>
                <span class="text-[10px] text-slate-400 uppercase font-semibold block">Failed</span>
                <span class="text-xl font-black text-red-400">${data.summary.failed} days</span>
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
                data: [data.summary.completed, data.summary.failed, data.summary.skipped],
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

    const ctxBar = document.getElementById('chart_habit_bar').getContext('2d');
    if (habitCharts.bar) habitCharts.bar.destroy();

    habitCharts.bar = new Chart(ctxBar, {
        type: 'bar',
        data: {
            labels: data.history.map(h => h.date.slice(5)),
            datasets: [{
                label: 'Progress Value',
                data: data.history.map(h => h.value || (h.status === 'completed' ? 1 : 0)),
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
                y: { ticks: { color: '#64748b' }, grid: { color: '#1a1c26' } }
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
        await fetch(`/habits/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } else {
        await fetch('/habits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    closeHabitModal();
    loadHabitsData();
}

async function deleteHabit() {
    const id = document.getElementById('edit_habit_id').value;
    if (!id) return;

    const confirmed = await showCustomConfirm("Delete Habit", "Are you sure you want to delete this habit and all its history?");
    if (confirmed) {
        await fetch(`/habits/${id}`, { method: 'DELETE' });
        closeHabitModal();
        loadHabitsData();
    }
}
