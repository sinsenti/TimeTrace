/**
 * TimeTrace Habits Engine & Multi-Select Inspector
 */

let allHabits = [];
let habitCharts = {};
document.addEventListener('timetrace:appearance', () => applyChartAppearance(Object.values(habitCharts)));

let selectedInspectorHabitIds = new Set();

document.addEventListener('DOMContentLoaded', () => {
    loadHabitsData();
    setupHabitModalKeyboardShortcuts();
});

function setupHabitModalKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        const modal = document.getElementById('habit_modal');
        if (!modal || modal.classList.contains('hidden')) return;
        const confirmation = document.getElementById('custom_confirm_modal');
        if (confirmation && !confirmation.classList.contains('hidden')) return;
        if (e.key === 'Tab') {
            const fields = Array.from(modal.querySelectorAll('button, input, select, textarea'))
                .filter(field => !field.disabled && field.type !== 'hidden' && field.offsetParent !== null);
            const first = fields[0], last = fields.at(-1);
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
            return;
        }

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

async function loadHabitsData() {
    const generation = ++habitReadGeneration;
    const status = document.getElementById('habit_load_status');
    if (status) status.textContent = habitDataReady ? 'Refreshing habits…' : 'Loading habits…';
    try {
        const habits = await api.get('/habits') || [];
        if (generation !== habitReadGeneration) return;
        allHabits = habits;
        // Refresh clean initialized fields only; dirty or pending owners remain intact.
        for (const draft of habitEntryDrafts.values()) {
            const h = allHabits.find(h => h.id === draft.id);
            if (h && !draft.pending && draft.field.value === draft.saved) {
                draft.saved = habitEntryValue(habitRecord(h, draft.date), h.habit_type);
                draft.field.value = draft.saved;
                if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft(draft.root.id);
            }
        }
        habitDataReady = true;
        habitLoadError = '';
        if (selectedInspectorHabitIds.size === 0) allHabits.forEach(h => selectedInspectorHabitIds.add(h.id));
        renderHabitCards();
        renderRemindersList();
        renderHabitInspectorChips();
        const chartsTab = document.getElementById('habit_tab_charts');
        if (chartsTab && !chartsTab.classList.contains('hidden')) renderSelectedHabitCharts();
        if (status) status.textContent = 'Recent 365 days loaded.';
        document.getElementById('habit_retry_load')?.classList.add('hidden');
    } catch (e) {
        if (generation !== habitReadGeneration) return;
        habitLoadError = 'Could not refresh habits. Saved writes are not replayed; drafts are retained.';
        if (status) status.textContent = habitLoadError;
        document.getElementById('habit_retry_load')?.classList.remove('hidden');
    }
}

function switchHabitTab(tabName) {
    ++habitGoalReadGeneration;
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

// Each local date owns a retained input, including dates hidden by card navigation.
const habitEntryDrafts = new Map();
const habitLogReceipts = new Map();
let habitReadGeneration = 0;
let habitDataReady = false;
let habitLoadError = '';
let habitClearFocusGeneration = 0;

function habitRecord(habit, date) {
    const key = habitEntryKey(habit.id, date);
    return !habitDateCovered(date) && habitLogReceipts.has(key) ? habitLogReceipts.get(key) : habit.logs?.[date];
}
function habitEntryKey(id, date) { return `${id}/${date}`; }
function habitEntryValue(log, type) {
    return JSON.stringify(log ? (type === 'numeric' ? { exists: true, value: log.value } : { exists: true, status: log.status, value: log.value }) : { exists: false });
}
function habitEntryDraft(id, date) {
    const key = habitEntryKey(id, date);
    if (!habitEntryDrafts.has(key)) {
        const habit = allHabits.find(h => h.id === id);
        if (!habit) return null;
        const log = habitRecord(habit, date);
        const root = document.createElement('div');
        root.id = `habit_entry_${id}_${date}`;
        root.classList.add('hidden');
        root.dataset.settingsDraftRetained = 'true';
        const field = document.createElement('input');
        field.type = 'hidden';
        field.id = `${root.id}_value`;
        field.value = habitEntryValue(log, habit.habit_type);
        root.appendChild(field);
        document.getElementById('habit_entry_owners')?.appendChild(root);
        const draft = { id, date, root, field, saved: field.value, pending: false, message: '' };
        habitEntryDrafts.set(key, draft);
        if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft(root.id);
    }
    return habitEntryDrafts.get(key);
}
function stageHabitStatus(id, date, status) {
    if (!['completed', 'failed', 'skipped'].includes(status)) return;
    const draft = habitEntryDraft(id, date);
    if (!draft) return;
    draft.field.value = JSON.stringify({ exists: true, status, value: JSON.parse(draft.field.value).value || 0 });
    draft.message = '';
    renderHabitCards();
}
function setHabitDirectValue(id, date, rawVal) {
    const draft = habitEntryDraft(id, date);
    if (!draft) return;
    const val = Number(rawVal);
    draft.field.value = JSON.stringify({ exists: true, value: rawVal.trim() === '' || !Number.isFinite(val) ? null : Math.max(0, val) });
    draft.message = val < 0 ? 'Negative amounts are clamped to zero.' : '';
    // Do not rebuild a live number input: intermediate decimal/minus keystrokes
    // are meaningful browser editing state even when input.value is temporarily empty.
    const input = document.getElementById(`habit_amount_${id}`);
    if (input && val < 0 && habitCardView(id).date === date) input.value = '0';
    if (habitCardView(id).date === date) {
        const message = document.getElementById(`habit_message_${id}`);
        if (message) message.textContent = draft.message;
        const result = document.getElementById(`habit_result_${id}`);
        const habit = allHabits.find(h => h.id === id);
        if (result) result.textContent = `${habitResult(habit ? habitRecord(habit, date) : null, date)}${draft.field.value !== draft.saved ? ' · Unsaved' : ''}`;
    }
}
function cancelHabitEntry(id, date) {
    const draft = habitEntryDraft(id, date);
    if (!draft || draft.pending) return;
    draft.field.value = draft.saved;
    draft.message = '';
    renderHabitCards();
}
async function saveHabitEntry(id, date) {
    const draft = habitEntryDraft(id, date);
    const habit = allHabits.find(h => h.id === id);
    if (!draft || !habit || draft.pending) return;
    const value = JSON.parse(draft.field.value);
    if (!value.exists || (habit.habit_type === 'numeric' ? !Number.isFinite(value.value) : !['completed', 'failed', 'skipped'].includes(value.status))) {
        draft.message = 'Choose a result or enter a finite amount first.';
        renderHabitCards();
        return;
    }
    const submitted = draft.field.value;
    const checkpoint = typeof settingsDraftCheckpoint === 'function' ? settingsDraftCheckpoint(draft.root.id) : () => {};
    draft.pending = true;
    draft.message = 'Saving…';
    renderHabitCards();
    ++habitReadGeneration;
    try {
        const row = await api.post(`/habits/${id}/log`, habit.habit_type === 'numeric'
            ? { date_str: date, set_value: value.value } : { date_str: date, status: value.status });
        ++habitReadGeneration;
        habitLogReceipts.set(habitEntryKey(id, date), row);
        const currentHabit = allHabits.find(h => h.id === id);
        if (currentHabit && (habitDateCovered(date) || currentHabit.logs?.[date])) { currentHabit.logs ||= {}; currentHabit.logs[date] = row; }
        draft.saved = habitEntryValue(row, habit.habit_type);
        checkpoint();
        if (draft.field.value === submitted) {
            draft.field.value = draft.saved;
            if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft(draft.root.id);
        }
        draft.message = 'Saved.';
        await loadHabitsData();
    } catch (error) {
        draft.message = 'Save was not acknowledged. Draft retained; check the record before retrying.';
    } finally {
        draft.pending = false;
        renderHabitCards();
    }
}
async function clearHabitEntry(id, date) {
    const draft = habitEntryDraft(id, date);
    const habit = allHabits.find(h => h.id === id);
    const view = habitCardView(id), version = view.version;
    if (!draft || draft.pending || !habit || !habitRecord(habit, date)) return;
    const captured = draft.field.value;
    const clearAction = `clearHabitEntry('${id}','${date}')`;
    const definitionOwner = habitDefinitionOwner;
    const focusGeneration = ++habitClearFocusGeneration;
    const confirmation = document.getElementById('custom_confirm_modal');
    const cancel = document.getElementById('confirm_modal_cancel_btn');
    const proceed = document.getElementById('confirm_modal_proceed_btn');
    let restoreFocus = document.activeElement?.getAttribute?.('onclick') === clearAction;
    let waitingForConfirmation = true;
    const sameOwner = () => focusGeneration === habitClearFocusGeneration && view.version === version &&
        view.date === date && habitDefinitionOwner === definitionOwner;
    const onFocus = event => {
        if (confirmation?.contains(event.target)) return;
        restoreFocus = false;
        window.removeEventListener('keydown', onConfirmKey, true);
        document.removeEventListener('focusin', onFocus);
        if (waitingForConfirmation && confirmation && !confirmation.classList.contains('hidden')) cancel?.click();
    };
    const onConfirmKey = event => {
        if (!sameOwner() || !confirmation || confirmation.classList.contains('hidden')) return;
        if (event.key === 'Tab' || event.key === 'Enter') {
            // The shared helper captures every Enter as Proceed, even on Cancel.
            // Clear alone handles it at window capture, before that document listener.
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.key === 'Enter') (document.activeElement === proceed ? proceed : cancel)?.click();
            else (document.activeElement === cancel ? proceed : cancel)?.focus();
        }
    };
    draft.pending = true;
    renderHabitCards();
    try {
        window.addEventListener('keydown', onConfirmKey, true);
        document.addEventListener('focusin', onFocus);
        const confirming = showCustomConfirm('Clear habit record', `Delete only the record for ${date}?`);
        cancel?.focus();
        const confirmed = await confirming;
        waitingForConfirmation = false;
        window.removeEventListener('keydown', onConfirmKey, true);
        if (!confirmed || !sameOwner() || draft.field.value !== captured) return;
        ++habitReadGeneration;
        await api.post(`/habits/${id}/log`, {date_str:date, status:'erase'});
        ++habitReadGeneration;
        habitLogReceipts.set(habitEntryKey(id,date), null);
        const currentHabit = allHabits.find(h => h.id === id);
        if (currentHabit?.logs) delete currentHabit.logs[date];
        draft.saved = habitEntryValue(null, habit.habit_type);
        if (draft.field.value === captured) draft.field.value = draft.saved;
        // Capture the empty persisted baseline without checkpointing concurrent input.
        const live = draft.field.value;
        draft.field.value = draft.saved;
        if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft(draft.root.id);
        draft.field.value = live;
        draft.message = 'Cleared.';
        await loadHabitsData();
    } catch (error) {
        draft.message = 'Clear was not acknowledged. Check the record before retrying.';
    } finally {
        window.removeEventListener('keydown', onConfirmKey, true);
        document.removeEventListener('focusin', onFocus);
        const focus = document.activeElement;
        const canRestore = restoreFocus && sameOwner() && (focus === document.body || confirmation?.contains(focus));
        draft.pending = false;
        renderHabitCards();
        if (canRestore) {
            const card = Array.from(document.querySelectorAll('[data-habit-id]')).find(card => card.dataset.habitId === id);
            const clear = Array.from(card?.querySelectorAll('button') || []).find(button => button.getAttribute('onclick') === clearAction);
            const fallback = card?.querySelector('input') || card?.querySelector('button:not(:disabled)');
            (clear && !clear.disabled ? clear : fallback)?.focus();
        }
    }
}

const habitCardViews = new Map();
function habitLocalDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function habitText(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function habitColor(value) { return /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : '#10b981'; }
function habitCardView(id) {
    if (!habitCardViews.has(id)) habitCardViews.set(id, { offset: 0, date: habitLocalDate(), version: 0 });
    return habitCardViews.get(id);
}
function habitCardDates(view) {
    const end = new Date();
    end.setDate(end.getDate() + view.offset * 7);
    return Array.from({length:7}, (_, i) => {
        const date = new Date(end);
        date.setDate(end.getDate() - 6 + i);
        return { date: habitLocalDate(date), label: date.toLocaleDateString(undefined, {weekday:'short'}), day:date.getDate() };
    });
}
function navigateHabitWeek(id, delta) {
    const view = habitCardView(id);
    ++view.version;
    view.offset += delta;
    view.date = habitCardDates(view).at(-1).date;
    renderHabitCards();
}
function habitToday(id) {
    const view = habitCardView(id);
    ++view.version;
    view.offset = 0;
    view.date = habitLocalDate();
    renderHabitCards();
}
function selectHabitDay(id, date) {
    const view = habitCardView(id);
    ++view.version;
    view.date = date;
    renderHabitCards();
}
function habitDateCovered(date) {
    // The daemon supplies no coverage metadata. Leave a conservative timezone/day-boundary
    // margin rather than claiming an absent row at the 365-day cutoff is missing.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 363);
    return date >= habitLocalDate(cutoff);
}
function habitResult(log, date) {
    if (!log) return habitDateCovered(date) ? 'No record' : 'Unknown';
    return {completed:'Done',failed:'Failed',skipped:'Skipped',pending:'Pending',in_progress:'In progress'}[log.status] || log.status;
}
function habitDayMarker(log, date) {
    if (!log) return habitDateCovered(date) ? '—' : '?';
    return {completed:'Done',failed:'Fail',skipped:'Skip',pending:'Pending',in_progress:'Active'}[log.status] || 'Logged';
}
function habitDayState(log, date) {
    if (!log) return habitDateCovered(date) ? 'empty' : 'unknown';
    return {completed:'done',failed:'failed',skipped:'skipped',pending:'pending',in_progress:'active'}[log.status] || 'logged';
}
function renderHabitCards() {
    const container = document.getElementById('habit_cards');
    if (!container) return;
    const focusId = document.activeElement?.id;
    const focusAction = document.activeElement?.getAttribute?.('onclick');
    container.innerHTML = allHabits.length ? allHabits.map(h => {
        const view = habitCardView(h.id), dates = habitCardDates(view), date = view.date;
        const draft = habitEntryDraft(h.id, date), value = JSON.parse(draft.field.value), log = habitRecord(h, date);
        const dirty = draft.field.value !== draft.saved;
        const outside = !habitDateCovered(date) && !log;
        const statusChoices = h.habit_type === 'numeric' ? ''
            : `<div class="habit-result-segment" role="group" aria-label="Result">
                <span class="habit-segment-label">Result</span>
                <div class="habit-result-choices">
                    ${[['completed','Done'],['failed','Failed'],['skipped','Skipped']].map(([status,label]) =>
                        `<button type="button" aria-pressed="${value.status === status}" onclick="stageHabitStatus('${h.id}','${date}','${status}')">${label}</button>`).join('')}
                </div>
               </div>`;
        const editor = h.habit_type === 'numeric'
            ? `<label for="habit_amount_${h.id}">Amount <span>${habitText(h.unit)}</span></label>
                <input id="habit_amount_${h.id}" type="number" step="any" value="${value.value ?? ''}"
                    oninput="setHabitDirectValue('${h.id}','${date}',this.value)" aria-describedby="habit_message_${h.id}">`
            : '';
        return `<article class="habit-compact-card" aria-label="${habitText(h.name)}" data-habit-id="${h.id}">
            <div class="habit-card-heading"><div class="habit-card-title"><span class="habit-color" style="background:${habitColor(h.color)}"></span><h3>${habitText(h.name)}</h3></div>
                <button type="button" class="habit-definition-link" onclick="openEditHabitModal('${h.id}')">Edit</button></div>
            <p class="habit-card-meta">${h.habit_type === 'numeric' ? `Target ${habitText(h.target_value)} ${habitText(h.unit)} · ` : ''}${habitText(h.frequency)}</p>
            <div class="habit-week-nav"><button type="button" onclick="navigateHabitWeek('${h.id}',-1)" aria-label="Previous week">‹</button>
                <button type="button" class="habit-today-button" onclick="habitToday('${h.id}')">Today</button>
                <button type="button" onclick="navigateHabitWeek('${h.id}',1)" aria-label="Next week">›</button></div>
            <div class="habit-day-strip" role="group" aria-label="Choose a day for ${habitText(h.name)}">
                ${dates.map(d => {
                    const dayLog = habitRecord(h, d.date), result = habitResult(dayLog, d.date);
                    return `<button type="button" class="habit-day habit-day-${habitDayState(dayLog,d.date)}" aria-pressed="${d.date === date}" ${d.date === date ? 'aria-current="date"' : ''} aria-label="${habitText(d.label)} ${d.date}: ${habitText(result)}" title="${d.date}: ${habitText(result)}"
                        onclick="selectHabitDay('${h.id}','${d.date}')"><span>${habitText(d.label)}</span><strong>${d.day}</strong><small aria-hidden="true">${habitText(habitDayMarker(dayLog,d.date))}</small></button>`;
                }).join('')}
            </div>
            <p class="habit-selected-result"><span>Selected day</span><time datetime="${date}">${date}</time><span class="habit-result-value" id="habit_result_${h.id}">${habitText(habitResult(log,date))}${dirty ? ' · Unsaved' : ''}</span></p>
            ${outside ? '<p class="habit-history-warning">Outside loaded history; a record may exist. Save explicitly to update this date.</p>' : ''}
            <div class="habit-entry-editor" onkeydown="habitEntryKeydown(event,'${h.id}','${date}')">${editor}
                <div class="habit-entry-footer ${statusChoices ? 'habit-checkmark-footer' : ''}">${statusChoices}<div class="habit-entry-actions"><button type="button" class="habit-save-button" onclick="saveHabitEntry('${h.id}','${date}')" aria-disabled="${draft.pending}">${draft.pending ? 'Saving…' : 'Save'}</button>
                    <button type="button" class="habit-cancel-button" onclick="cancelHabitEntry('${h.id}','${date}')" ${draft.pending ? 'disabled' : ''}>Cancel</button></div>
                </div>
                <div class="habit-clear-row" role="group" aria-label="Clear selected day record"><button type="button" class="habit-clear-button" onclick="clearHabitEntry('${h.id}','${date}')" ${draft.pending || !log ? 'disabled' : ''}>Clear day</button></div>
                <p id="habit_message_${h.id}" role="status">${habitText(draft.message)}</p>
            </div></article>`;
    }).join('') : '<p>No habits yet. Choose + New Habit to start.</p>';
    if (focusId) document.getElementById(focusId)?.focus();
    else if (focusAction) Array.from(container.querySelectorAll('button')).find(button => button.getAttribute('onclick') === focusAction)?.focus();
}
function habitEntryKeydown(event, id, date) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelHabitEntry(id,date); }
    else if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); saveHabitEntry(id,date); }
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
                <span class="w-3 h-3 rounded-full inline-block shrink-0" style="background-color: ${habitColor(h.color)}"></span>
                <div>
                    <span class="font-bold text-sm text-white block">${habitText(h.name)}</span>
                    <span class="text-xs text-slate-400">${habitText(h.frequency)}</span>
                </div>
            </div>
            <div class="flex items-center space-x-3">
                <span class="bg-[#181a28] border border-[#262938] px-3 py-1 rounded-lg text-xs font-bold text-slate-300">
                    Time: ${habitText(h.reminder_time || '09:00 AM')}
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
                <span class="w-2 h-2 rounded-full inline-block" style="background-color: ${habitColor(h.color)}"></span>
                <span>${habitText(h.name)}</span>
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
        delete habitCharts.doughnut;
        delete habitCharts.bar;
        hideGoalProgressionChart();
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
                    <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${habitColor(h.color)}"></span>
                    <span>${habitText(h.name)}</span>
                </td>
                <td class="py-2.5 px-3 text-slate-400">${h.habit_type === 'numeric' ? `${habitText(h.target_value)} ${habitText(h.unit)}` : 'Checkmark'}</td>
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
            plugins: { legend: { position: 'bottom', labels: { color: chartAppearanceColors().legend, boxWidth: 12 } } }
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
                x: { ticks: { color: chartAppearanceColors().ticks }, grid: { color: chartAppearanceColors().grid } },
                y: { ticks: { color: chartAppearanceColors().ticks, precision: 0 }, grid: { color: chartAppearanceColors().grid } }
            }
        }
    });

    if (activeHabits.length === 1 && activeHabits[0].habit_type === 'numeric') {
        renderGoalProgressionChart(activeHabits[0]);
    } else {
        hideGoalProgressionChart();
    }
}

let habitGoalReadGeneration = 0;
function hideGoalProgressionChart() {
    ++habitGoalReadGeneration;
    const card = document.getElementById('goal_progression_card');
    if (card) card.classList.add('hidden');
    if (habitCharts.goalProgression) {
        habitCharts.goalProgression.destroy();
        delete habitCharts.goalProgression;
    }
}

async function renderGoalProgressionChart(habit) {
    const generation = ++habitGoalReadGeneration;
    const card = document.getElementById('goal_progression_card');
    if (!card) return;

    let stats;
    try {
        stats = await api.get(`/habits/${habit.id}/stats`);
    } catch (e) {
        if (generation === habitGoalReadGeneration) hideGoalProgressionChart();
        return;
    }
    if (generation !== habitGoalReadGeneration) return;
    if (!stats || !stats.goal_history || stats.goal_history.length === 0) {
        hideGoalProgressionChart();
        return;
    }

    card.classList.remove('hidden');

    const sortedGoals = [...stats.goal_history].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    const historyEntries = stats.history || [];

    // Chart x-axis covers every date either logged or the goal changed, so a
    // goal bump shows up even on a day with no log, and vice versa.
    const allDates = Array.from(new Set([
        ...historyEntries.map(h => h.date),
        ...sortedGoals.map(g => g.effective_from)
    ])).sort();

    const valueByDate = {};
    historyEntries.forEach(h => { valueByDate[h.date] = h.value; });

    // Step function: the target in effect on a given date is the most recent
    // goal_history entry whose effective_from is on or before that date.
    const targetForDate = (dateStr) => {
        let active = sortedGoals[0].target_value;
        for (const g of sortedGoals) {
            if (g.effective_from <= dateStr) active = g.target_value;
            else break;
        }
        return active;
    };

    const unitLabel = habit.unit ? `Logged (${habit.unit})` : 'Logged';

    const ctx = document.getElementById('chart_habit_goal_progression').getContext('2d');
    if (habitCharts.goalProgression) habitCharts.goalProgression.destroy();

    habitCharts.goalProgression = new Chart(ctx, {
        type: 'line',
        data: {
            labels: allDates.map(d => d.slice(5)),
            datasets: [
                {
                    label: unitLabel,
                    data: allDates.map(d => (d in valueByDate ? valueByDate[d] : null)),
                    borderColor: habit.color || '#10b981',
                    backgroundColor: 'transparent',
                    spanGaps: true,
                    tension: 0.2
                },
                {
                    label: 'Target',
                    data: allDates.map(d => targetForDate(d)),
                    borderColor: '#f59e0b',
                    borderDash: [6, 4],
                    stepped: true,
                    pointRadius: 0,
                    backgroundColor: 'transparent'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: chartAppearanceColors().legend, boxWidth: 12 } } },
            scales: {
                x: { ticks: { color: chartAppearanceColors().ticks }, grid: { color: chartAppearanceColors().grid } },
                y: { ticks: { color: chartAppearanceColors().ticks }, grid: { color: chartAppearanceColors().grid } }
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

let habitDefinitionOwner = null;
let habitDefinitionReturnFocus = null;
function initializeHabitDefinition() {
    habitDefinitionReturnFocus = document.activeElement;
    habitDefinitionOwner = { pending: false };
    const status = document.getElementById('habit_definition_status');
    if (status) status.textContent = '';
}
function openNewHabitModal() {
    initializeHabitDefinition();
    document.getElementById('modal_habit_color').value = '#10b981';
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
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('habit_modal');

    document.getElementById('modal_habit_name')?.focus();
}

function openEditHabitModal(id) {
    const h = allHabits.find(item => item.id === id);
    if (!h) return;

    initializeHabitDefinition();
    document.getElementById('edit_habit_id').value = h.id;
    document.getElementById('modal_habit_title').innerText = 'Edit Habit';
    document.getElementById('modal_habit_name').value = h.name;
    document.getElementById('modal_habit_type').value = h.habit_type || 'boolean';
    document.getElementById('modal_habit_target').value = h.target_value ?? 1;
    document.getElementById('modal_habit_unit').value = h.unit || '';
    const frequency = document.getElementById('modal_habit_frequency');
    if (!Array.from(frequency.options || []).some(option => option.value === h.frequency)) {
        const option = document.createElement('option');
        option.value = h.frequency;
        option.textContent = h.frequency;
        if (frequency.add) frequency.add(option);
        else frequency.appendChild(option);
    }
    frequency.value = h.frequency;
    document.getElementById('modal_habit_reminder').value = h.reminder_time ?? '';
    document.getElementById('modal_habit_color').value = h.color || '#10b981';
    habitDefinitionOwner.metadata = {
        reminder_time: { stored: h.reminder_time, displayed: document.getElementById('modal_habit_reminder').value },
        color: { stored: h.color, displayed: document.getElementById('modal_habit_color').value }
    };
    document.getElementById('modal_habit_delete_btn').classList.remove('hidden');
    toggleHabitTypeFields();
    document.getElementById('habit_modal').classList.remove('hidden');
    if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('habit_modal');

    document.getElementById('modal_habit_name')?.focus();
}

function closeHabitModal() {
    habitDefinitionOwner = null;
    document.getElementById('habit_modal').classList.add('hidden');
    habitDefinitionReturnFocus?.focus();
}

async function saveHabit() {
    const owner = habitDefinitionOwner;
    if (!owner || owner.pending) return;
    const id = document.getElementById('edit_habit_id').value;
    const payload = {
        name: document.getElementById('modal_habit_name').value,
        habit_type: document.getElementById('modal_habit_type').value,
        target_value: Number(document.getElementById('modal_habit_target').value),
        unit: document.getElementById('modal_habit_unit').value,
        frequency: document.getElementById('modal_habit_frequency').value,
        reminder_time: document.getElementById('modal_habit_reminder').value,
        color: document.getElementById('modal_habit_color').value
    };

    const submittedMetadata = {};
    for (const key of ['reminder_time', 'color']) {
        submittedMetadata[key] = payload[key];
        if (owner.metadata?.[key] && payload[key] === owner.metadata[key].displayed) payload[key] = owner.metadata[key].stored;
    }
    if (!payload.name || !Number.isFinite(payload.target_value)) return;
    const modal = document.getElementById('habit_modal');
    const fields = Array.from(modal.querySelectorAll('input, select, textarea'));
    const captured = fields.map(field => field.value);
    const checkpoint = typeof settingsDraftCheckpoint === 'function' ? settingsDraftCheckpoint('habit_modal') : () => {};
    const status = document.getElementById('habit_definition_status');
    owner.pending = true;
    if (status) status.textContent = 'Saving…';
    ++habitReadGeneration;
    try {
        const saved = id ? await api.put(`/habits/${id}`, payload) : await api.post('/habits', payload);
        ++habitReadGeneration;
        if (habitDefinitionOwner === owner) {
            owner.metadata = Object.fromEntries(['reminder_time', 'color'].map(key => [key, {
                stored: Object.hasOwn(saved, key) ? saved[key] : payload[key], displayed: submittedMetadata[key]
            }]));
            checkpoint();
            if (fields.every((field, index) => field.value === captured[index])) closeHabitModal();
            else {
                document.getElementById('edit_habit_id').value = saved.id;
                if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('habit_modal', '#edit_habit_id');
                if (status) status.textContent = 'Saved submitted fields. New edits are still unsaved.';
            }
        }
        await loadHabitsData();
    } catch (error) {
        if (habitDefinitionOwner === owner && status) status.textContent = 'Save was not acknowledged. Draft retained; check before retrying.';
    } finally { owner.pending = false; }
}

async function deleteHabit() {
    const owner = habitDefinitionOwner;
    const launcher = habitDefinitionReturnFocus;
    const id = document.getElementById('edit_habit_id').value;
    if (!owner || owner.pending || !id) return;
    owner.pending = true;
    const fields = Array.from(document.getElementById('habit_modal').querySelectorAll('input, select, textarea'));
    const captured = fields.map(field => field.value);
    try {
        const confirmed = await showCustomConfirm('Delete Habit', 'Delete this habit and all its history?');
        if (!confirmed || habitDefinitionOwner !== owner || !fields.every((field,i) => field.value === captured[i])) return;
        ++habitReadGeneration;
        await api.delete(`/habits/${id}`);
        ++habitReadGeneration;
        if (habitDefinitionOwner === owner) closeHabitModal();
        for (const [key,draft] of habitEntryDrafts) {
            if (draft.id === id) { draft.root.remove(); habitEntryDrafts.delete(key); }
        }
        await loadHabitsData();
        if (!habitDefinitionOwner && !launcher?.isConnected && document.activeElement === document.body) {
            document.getElementById('new_habit_btn')?.focus();
        }
    } catch (error) {
        if (habitDefinitionOwner === owner) {
            const status = document.getElementById('habit_definition_status');
            if (status) status.textContent = 'Delete was not acknowledged. Check the record before retrying.';
        }
    } finally { owner.pending = false; }
}
