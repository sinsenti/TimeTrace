/**
 * Revision Engine Navigation & Hash Router
 */

let currentActiveRevTab = 'overview';
let dayReviewHasExisting = false;
let currentDayHistoryFilter = 'all';
let currentSessionReviewFilter = 'all';

const TAB_HASH_MAP = {
    'day': '#day',
    'overview': '#overview',
    'sessions': '#sessions',
    'task_inspector': '#tasks',
    'ratings_config': '#ratings'
};

const HASH_TAB_MAP = {
    '#day': 'day',
    '#overview': 'overview',
    '#sessions': 'sessions',
    '#tasks': 'task_inspector',
    '#ratings': 'ratings_config'
};

document.addEventListener('DOMContentLoaded', () => {
    setupRevisionKeyboardShortcuts();
    setupTaskInspectorSearchListeners();

    window.addEventListener('hashchange', handleHashChange);
    
    const dateInput = document.getElementById('day_review_date_input');
    if (dateInput && !dateInput.value) {
        dateInput.value = typeof getLocalTodayStr === 'function' ? getLocalTodayStr() : new Date().toISOString().slice(0, 10);
    }

    const initialHash = window.location.hash || '#overview';
    const initialTab = HASH_TAB_MAP[initialHash] || 'overview';
    switchRevisionTab(initialTab, false);
});

function updateSessionReviewTabVisibility() {
    switchRevisionTab(currentActiveRevTab, false);
}

function handleHashChange() {
    const currentHash = window.location.hash || '#overview';
    let targetTab = HASH_TAB_MAP[currentHash] || 'overview';
    
    const s = typeof getUserSettings === 'function' ? getUserSettings() : { enableSessionReview: true };
    if (targetTab === 'sessions' && s.enableSessionReview === false) {
        targetTab = 'overview';
    }

    if (targetTab !== currentActiveRevTab) {
        switchRevisionTab(targetTab, false);
    }
}

function setupRevisionKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const sessionRevModal = document.getElementById('session_review_modal');
        if (sessionRevModal && !sessionRevModal.classList.contains('hidden')) {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                saveSessionReviewModal();
                return;
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeSessionReviewModal();
                return;
            }
        }

        const ratingDefModal = document.getElementById('rating_def_modal');
        if (ratingDefModal && !ratingDefModal.classList.contains('hidden')) {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                saveRatingDefinition();
                return;
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeRatingDefModal();
                return;
            }
        }
    });
}

function switchRevisionTab(tabName, updateHash = true) {
    const s = typeof getUserSettings === 'function' ? getUserSettings() : { enableSessionReview: true };
    const isSessionReviewEnabled = s.enableSessionReview !== false;

    if (tabName === 'sessions' && !isSessionReviewEnabled) {
        tabName = 'overview';
    }

    currentActiveRevTab = tabName;

    if (updateHash && TAB_HASH_MAP[tabName]) {
        window.history.pushState(null, '', TAB_HASH_MAP[tabName]);
    }

    ['day', 'overview', 'sessions', 'task_inspector', 'ratings_config'].forEach(t => {
        const el = document.getElementById(`rev_tab_${t}`);
        const btn = document.getElementById(`rev_tab_btn_${t}`);
        if (el) el.classList.add('hidden');

        if (btn) {
            const isCurrent = (t === tabName);
            const shouldHideBtn = (t === 'sessions' && !isSessionReviewEnabled);

            btn.className = `h-6 px-3 rounded font-bold text-[11px] ${
                isCurrent 
                    ? "bg-purple-600 text-white" 
                    : "text-slate-400 hover:text-white"
            } ${shouldHideBtn ? "hidden" : ""}`.trim();
        }
    });

    const activeEl = document.getElementById(`rev_tab_${tabName}`);
    if (activeEl) activeEl.classList.remove('hidden');

    loadCurrentRevisionView();
}

function loadCurrentRevisionView() {
    if (currentActiveRevTab === 'day') {
        loadDayReviewData();
    } else if (currentActiveRevTab === 'overview') {
        loadDayHistoryOverview();
    } else if (currentActiveRevTab === 'sessions') {
        loadAllSessionsReview();
    } else if (currentActiveRevTab === 'task_inspector') {
        loadTaskInspectorRegistry();
    } else {
        loadRatingDefinitionsList();
    }
}
