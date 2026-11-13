/**
 * Shared Custom Filter Engine with Route-Specific Storage Isolation
 */

function getStoragePrefix() {
    const path = window.location.pathname;
    if (path.includes('/kanban') || path.includes('/tasks')) {
        return 'timetrace_tasks';
    }
    return 'timetrace_dashboard';
}

function getCustomFilterStorageKey() {
    return `${getStoragePrefix()}_custom_filter`;
}

function getStatusFilterStorageKey() {
    return `${getStoragePrefix()}_status_filter`;
}

let filterPersistenceWarning = '';
let filterModalVersion = 0;
let filterLauncher = null;
let activeCustomFilter = loadSavedCustomFilter();

function normalizeCustomFilter(value, legacyStatus = 'all') {
    const saved = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const string = (key, fallback) => typeof saved[key] === 'string' ? saved[key] : fallback;
    const state = {
        status: string('status', legacyStatus) || 'all',
        category: string('category', 'all') || 'all',
        query: string('query', '').trim().toLowerCase(),
        estOp: ['', 'lt', 'lte', 'eq', 'gte'].includes(saved.estOp) ? saved.estOp : '',
        estMins: typeof saved.estMins === 'number' && Number.isFinite(saved.estMins) && saved.estMins > 0 ? saved.estMins : 30,
        priority: ['all', 'high', 'medium', 'low', '-'].includes(saved.priority) ? saved.priority : 'all'
    };
    state.isActive = Boolean(state.query || state.status !== 'all' || state.category !== 'all' || state.estOp || state.priority !== 'all');
    return state;
}

function loadSavedCustomFilter() {
    let status = 'all';
    let saved = null;
    try { status = localStorage.getItem(getStatusFilterStorageKey()) || 'all'; }
    catch { filterPersistenceWarning = 'Browser storage is unavailable. Filters work for this visit.'; }
    try { saved = JSON.parse(localStorage.getItem(getCustomFilterStorageKey())); }
    catch { /* A damaged custom payload must not discard the independently saved status. */ }
    return normalizeCustomFilter(saved, status);
}

function saveCustomFilterState() {
    try {
        localStorage.setItem(getCustomFilterStorageKey(), JSON.stringify(activeCustomFilter));
        localStorage.setItem(getStatusFilterStorageKey(), activeCustomFilter.status);
        filterPersistenceWarning = '';
    } catch {
        filterPersistenceWarning = 'Could not save in this browser. Filters apply for this visit only.';
    }
    updateFilterPersistenceFeedback();
}

function updateFilterPersistenceFeedback() {
    const feedback = document.getElementById('filter_persistence_feedback');
    if (feedback) feedback.textContent = filterPersistenceWarning;
    document.querySelectorAll('.custom-filter-trigger-btn').forEach(button => {
        button.title = filterPersistenceWarning || 'Advanced task filters';
    });
}

function customFilterOwnsKeyboard() {
    const modal = document.getElementById('custom_filter_modal');
    if (!modal || modal.classList.contains('hidden')) return false;
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(dialog =>
        dialog !== modal && !dialog.classList.contains('hidden') && dialog.getAttribute?.('aria-hidden') !== 'true');
    return !dialogs.some(dialog => dialog.contains(document.activeElement));
}

window.addEventListener('keydown', function(event) {
    if (!customFilterOwnsKeyboard()) return;
    if (event.key === 'Tab') {
        const modal = document.getElementById('custom_filter_modal');
        const controls = Array.from(modal.querySelectorAll?.('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]') || [])
            .filter(control => !control.classList.contains('hidden'));
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (first && event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last.focus();
        } else if (last && !event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus();
        }
    }
    if ((event.ctrlKey && event.key === 'Enter') || event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        event.stopPropagation();
        if (event.ctrlKey && event.key === 'Enter') applyCustomFilterFromModal();
        else closeCustomFilterModal();
    }
}, true);

document.addEventListener('DOMContentLoaded', updateFilterButtonIndicators);

function ensureFilterOption(select, value, label = value) {
    if (!select) return;
    if (!Array.from(select.options).some(option => option.value === String(value))) {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = label;
        select.appendChild(option);
    }
    select.value = String(value);
}

function filterStatusFeedback(message, retry = false) {
    const feedback = document.getElementById('filter_status_feedback');
    if (feedback) feedback.textContent = message;
    document.getElementById('filter_status_retry')?.classList.toggle('hidden', !retry);
}

async function refreshCustomFilterStatuses(version = filterModalVersion) {
    const modal = document.getElementById('custom_filter_modal');
    const select = document.getElementById('filter_input_status');
    if (!modal || !select || modal.classList.contains('hidden')) return;
    const request = ++refreshCustomFilterStatuses.request;
    filterStatusFeedback('Loading statuses…');
    try {
        const statuses = await api.get('/api/tasks/statuses');
        if (version !== filterModalVersion || request !== refreshCustomFilterStatuses.request || modal.classList.contains('hidden')) return;
        if (!Array.isArray(statuses)) throw new Error('Status list unavailable');
        const chosen = select.value;
        select.replaceChildren();
        ensureFilterOption(select, 'all', 'All Statuses');
        ensureFilterOption(select, 'hide_completed', 'Active (Hide Completed)');
        for (const status of statuses) {
            if (status && typeof status.name === 'string') ensureFilterOption(select, status.name);
        }
        ensureFilterOption(select, chosen, `${chosen} (unavailable)`);
        filterStatusFeedback('');
    } catch {
        if (version !== filterModalVersion || request !== refreshCustomFilterStatuses.request || modal.classList.contains('hidden')) return;
        filterStatusFeedback('Could not load current statuses. Saved choices remain available.', true);
    }
}
refreshCustomFilterStatuses.request = 0;

function openCustomFilterModal() {
    const modal = document.getElementById('custom_filter_modal');
    if (!modal) return;
    const version = ++filterModalVersion;
    filterLauncher = document.activeElement;
    const fields = {query: 'query', status: 'status', category: 'category', est_op: 'estOp', est_mins: 'estMins', priority: 'priority'};
    for (const [id, key] of Object.entries(fields)) {
        const input = document.getElementById(`filter_input_${id}`);
        if (!input) continue;
        if (['status', 'category', 'est_mins'].includes(id)) {
            ensureFilterOption(input, activeCustomFilter[key], id === 'status' ? `${activeCustomFilter[key]} (unavailable)` : String(activeCustomFilter[key]));
        } else input.value = activeCustomFilter[key];
    }
    modal.classList.remove('hidden');
    updateFilterPersistenceFeedback();
    document.getElementById('filter_input_query')?.focus();
    refreshCustomFilterStatuses(version);
}

function closeCustomFilterModal() {
    const modal = document.getElementById('custom_filter_modal');
    const ownedFocus = modal?.contains(document.activeElement);
    ++filterModalVersion;
    modal?.classList.add('hidden');
    if (ownedFocus) {
        const target = filterLauncher?.isConnected ? filterLauncher : Array.from(document.querySelectorAll('.custom-filter-trigger-btn')).find(button => button.isConnected);
        target?.focus();
    }
}

function refreshCustomFilterViews() {
    updateFilterButtonIndicators();
    closeCustomFilterModal();
    if (typeof renderDynamicStatusTabs === 'function') renderDynamicStatusTabs();
    if (typeof fetchTasks === 'function') fetchTasks();
    if (typeof loadKanbanBoard === 'function') loadKanbanBoard();
}

function applyCustomFilterFromModal() {
    const value = id => document.getElementById(`filter_input_${id}`)?.value;
    activeCustomFilter = normalizeCustomFilter({
        query: value('query'), status: value('status'), category: value('category'),
        estOp: value('est_op'), estMins: Number(value('est_mins')), priority: value('priority')
    });
    saveCustomFilterState();
    refreshCustomFilterViews();
}

function clearCustomFilter() {
    activeCustomFilter = normalizeCustomFilter(null);
    saveCustomFilterState();
    refreshCustomFilterViews();
}

function updateFilterButtonIndicators() {
    document.querySelectorAll('.custom-filter-trigger-btn').forEach(button => {
        button.textContent = activeCustomFilter.isActive ? 'Filter · ON' : 'Filter';
        button.classList.toggle('task-filter-active', activeCustomFilter.isActive);
        button.setAttribute('aria-label', activeCustomFilter.isActive ? 'Advanced task filters, active' : 'Advanced task filters');
    });
    updateFilterPersistenceFeedback();
}

function matchesCustomFilter(task) {
    if (!activeCustomFilter.isActive) return true;

    if (activeCustomFilter.status !== 'all') {
        if (activeCustomFilter.status === 'hide_completed') {
            if (['done', 'completed'].includes((task.status || '').toLowerCase())) return false;
        } else if ((task.status || '').toLowerCase() !== activeCustomFilter.status.toLowerCase()) {
            return false;
        }
    }

    if (activeCustomFilter.category !== 'all') {
        if ((task.category || 'work').toLowerCase() !== activeCustomFilter.category.toLowerCase()) return false;
    }

    if (activeCustomFilter.priority !== 'all') {
        if ((task.priority || '-').toLowerCase() !== activeCustomFilter.priority.toLowerCase()) return false;
    }

    if (activeCustomFilter.estOp) {
        const est = task.estimated_minutes || 15;
        const target = activeCustomFilter.estMins;
        if (activeCustomFilter.estOp === 'lt' && !(est < target)) return false;
        if (activeCustomFilter.estOp === 'lte' && !(est <= target)) return false;
        if (activeCustomFilter.estOp === 'eq' && !(est === target)) return false;
        if (activeCustomFilter.estOp === 'gte' && !(est >= target)) return false;
    }

    if (activeCustomFilter.query) {
        const titleMatch = (task.title || '').toLowerCase().includes(activeCustomFilter.query);
        const descMatch = (task.description || '').toLowerCase().includes(activeCustomFilter.query);
        const tagMatch = (task.tags || '').toLowerCase().includes(activeCustomFilter.query);
        if (!titleMatch && !descMatch && !tagMatch) return false;
    }

    return true;
}
