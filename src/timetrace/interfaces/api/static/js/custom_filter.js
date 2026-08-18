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

let activeCustomFilter = loadSavedCustomFilter();

function loadSavedCustomFilter() {
    try {
        const savedCustom = localStorage.getItem(getCustomFilterStorageKey());
        const savedStatus = localStorage.getItem(getStatusFilterStorageKey());
        
        let filterState = {
            status: savedStatus || 'all',
            category: 'all',
            estOp: '',
            estMins: 30,
            query: '',
            priority: 'all',
            isActive: Boolean(savedStatus && savedStatus !== 'all')
        };

        if (savedCustom) {
            const parsed = JSON.parse(savedCustom);
            filterState.status = parsed.status || savedStatus || 'all';
            filterState.category = parsed.category || 'all';
            filterState.estOp = parsed.estOp || '';
            filterState.estMins = parsed.estMins || 30;
            filterState.query = parsed.query || '';
            filterState.priority = parsed.priority || 'all';
            filterState.isActive = Boolean(
                filterState.query || 
                filterState.status !== 'all' || 
                filterState.category !== 'all' || 
                filterState.estOp || 
                filterState.priority !== 'all'
            );
        } else if (savedStatus) {
            filterState.status = savedStatus;
            filterState.isActive = savedStatus !== 'all';
        }

        return filterState;
    } catch (e) {
        console.error("Error loading saved custom filter:", e);
    }
    return {
        status: 'all',
        category: 'all',
        estOp: '',
        estMins: 30,
        query: '',
        priority: 'all',
        isActive: false
    };
}

function saveCustomFilterState() {
    try {
        localStorage.setItem(getCustomFilterStorageKey(), JSON.stringify(activeCustomFilter));
        localStorage.setItem(getStatusFilterStorageKey(), activeCustomFilter.status || 'all');
    } catch (e) {
        console.error("Error saving custom filter state:", e);
    }
}

window.addEventListener('keydown', function(e) {
    const modal = document.getElementById('custom_filter_modal');
    if (modal && !modal.classList.contains('hidden')) {
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            applyCustomFilterFromModal();
        } else if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            e.stopPropagation();
            closeCustomFilterModal();
        }
    }
}, true);

document.addEventListener('DOMContentLoaded', () => {
    updateFilterButtonIndicators();
});

function openCustomFilterModal() {
    const queryInput = document.getElementById('filter_input_query');
    if (queryInput) queryInput.value = activeCustomFilter.query || '';

    const statusSelect = document.getElementById('filter_input_status');
    if (statusSelect) {
        statusSelect.value = activeCustomFilter.status || 'all';
    }

    const catSelect = document.getElementById('filter_input_category');
    if (catSelect) {
        catSelect.value = activeCustomFilter.category || 'all';
    }

    const opSelect = document.getElementById('filter_input_est_op');
    if (opSelect) opSelect.value = activeCustomFilter.estOp || '';

    const minsSelect = document.getElementById('filter_input_est_mins');
    if (minsSelect) minsSelect.value = String(activeCustomFilter.estMins || 30);

    const prioSelect = document.getElementById('filter_input_priority');
    if (prioSelect) prioSelect.value = activeCustomFilter.priority || 'all';

    const modal = document.getElementById('custom_filter_modal');
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            if (queryInput) {
                queryInput.focus();
                queryInput.select();
            }
        }, 50);
    }
}

function closeCustomFilterModal() {
    const modal = document.getElementById('custom_filter_modal');
    if (modal) modal.classList.add('hidden');
}

function applyCustomFilterFromModal() {
    const query = document.getElementById('filter_input_query') ? document.getElementById('filter_input_query').value.trim().toLowerCase() : '';
    const status = document.getElementById('filter_input_status') ? document.getElementById('filter_input_status').value : 'all';
    const category = document.getElementById('filter_input_category') ? document.getElementById('filter_input_category').value : 'all';
    const estOp = document.getElementById('filter_input_est_op') ? document.getElementById('filter_input_est_op').value : '';
    const estMins = document.getElementById('filter_input_est_mins') ? parseInt(document.getElementById('filter_input_est_mins').value) || 30 : 30;
    const priority = document.getElementById('filter_input_priority') ? document.getElementById('filter_input_priority').value : 'all';

    activeCustomFilter = {
        query,
        status,
        category,
        estOp,
        estMins,
        priority,
        isActive: Boolean(query || status !== 'all' || category !== 'all' || estOp || priority !== 'all')
    };

    saveCustomFilterState();

    updateFilterButtonIndicators();
    closeCustomFilterModal();

    if (typeof renderDynamicStatusTabs === 'function') renderDynamicStatusTabs();
    if (typeof fetchTasks === 'function') fetchTasks();
    if (typeof loadKanbanBoard === 'function') loadKanbanBoard();
}

function clearCustomFilter() {
    activeCustomFilter = {
        status: 'all',
        category: 'all',
        estOp: '',
        estMins: 30,
        query: '',
        priority: 'all',
        isActive: false
    };

    saveCustomFilterState();

    updateFilterButtonIndicators();
    closeCustomFilterModal();

    if (typeof renderDynamicStatusTabs === 'function') renderDynamicStatusTabs();
    if (typeof fetchTasks === 'function') fetchTasks();
    if (typeof loadKanbanBoard === 'function') loadKanbanBoard();
}

function updateFilterButtonIndicators() {
    const btns = document.querySelectorAll('.custom-filter-trigger-btn');
    btns.forEach(btn => {
        if (activeCustomFilter.isActive) {
            btn.innerHTML = `Filter <span class="bg-purple-400 text-black px-1 rounded font-black text-[9px] ml-1">ON</span>`;
            btn.className = "custom-filter-trigger-btn h-8 bg-purple-900/80 hover:bg-purple-800 text-purple-200 border border-purple-600 px-3 rounded-lg font-bold transition text-xs flex items-center shrink-0 whitespace-nowrap";
        } else {
            btn.innerHTML = `Filter`;
            btn.className = "custom-filter-trigger-btn h-8 bg-[#181a28] hover:bg-[#222536] text-purple-300 border border-[var(--border-muted)] px-3 rounded-lg font-bold transition text-xs flex items-center shrink-0 whitespace-nowrap";
        }
    });
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
