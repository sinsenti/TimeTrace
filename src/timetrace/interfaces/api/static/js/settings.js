/**
 * TimeTrace User Settings & Theme Manager
 * Fully integrated with centralized ApiClient (api.post).
 */

const SETTINGS_KEY = 'timetrace_user_settings';

const THEME_PALETTES = {
    midnight: ['#7c3aed', '#2563eb', '#d97706', '#dc2626', '#059669', '#ec4899', '#0284c7', '#0d9488'],
    nord: ['#88c0d0', '#81a1c1', '#5e81ac', '#bf616a', '#d08770', '#ebcb8b', '#a3be8c', '#b48ead'],
    dracula: ['#bd93f9', '#ff79c6', '#8be9fd', '#50fa7b', '#ffb86c', '#ff5555', '#f1fa8c', '#6272a4'],
    cyberpunk: ['#00f0ff', '#ff0055', '#ffe600', '#00ff66', '#9d00ff', '#ff9900', '#ff00aa', '#00a8ff'],
    monokai: ['#ff6188', '#fc9867', '#ffd866', '#a9dc76', '#78dce8', '#ab9df2', '#78dce8', '#a9dc76']
};

const DEFAULT_SETTINGS = {
    theme: 'midnight',
    defaultView: 'auto',
    lastSelectedView: 'timeGridWeek',
    firstDayOfWeek: 1,
    slotDuration: 'auto',
    lastSelectedSlot: 15,
    idleDetectorEnabled: true,
    enableVimMotions: true,
    enableSessionReview: true,
    hideLeftSidebar: 'auto',
    lastHideLeftSidebar: false,
    hideRightSidebar: 'auto',
    lastHideRightSidebar: false,
    autoScrollNow: true,
    defaultTag: '#general'
};

function getUserSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (e) {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveUserSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function setupSettingsKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        const modal = document.getElementById('settings_modal');
        if (modal && !modal.classList.contains('hidden')) {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                saveSettingsFromModal();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeSettingsModal();
            }
        }
    });
}

function openSettingsModal() {
    const s = getUserSettings();
    
    const themeSelect = document.getElementById('setting_theme');
    if (themeSelect) themeSelect.value = s.theme || 'midnight';

    const vimCheck = document.getElementById('setting_enable_vim');
    if (vimCheck) vimCheck.checked = s.enableVimMotions !== false;
    
    const sessionReviewCheck = document.getElementById('setting_enable_session_review');
    if (sessionReviewCheck) sessionReviewCheck.checked = s.enableSessionReview !== false;

    const viewSelect = document.getElementById('setting_default_view');
    if (viewSelect) viewSelect.value = s.defaultView || 'auto';

    const daySelect = document.getElementById('setting_first_day');
    if (daySelect) daySelect.value = String(s.firstDayOfWeek);

    const slotSelect = document.getElementById('setting_slot_duration');
    if (slotSelect) slotSelect.value = String(s.slotDuration || 'auto');

    const idleCheck = document.getElementById('setting_idle_detector');
    if (idleCheck) idleCheck.checked = s.idleDetectorEnabled;

    const leftSelect = document.getElementById('setting_hide_left_sidebar');
    if (leftSelect) leftSelect.value = String(s.hideLeftSidebar);

    const rightSelect = document.getElementById('setting_hide_right_sidebar');
    if (rightSelect) rightSelect.value = String(s.hideRightSidebar);

    const scrollCheck = document.getElementById('setting_auto_scroll');
    if (scrollCheck) scrollCheck.checked = s.autoScrollNow;

    const tagInput = document.getElementById('setting_default_tag');
    if (tagInput) tagInput.value = s.defaultTag || '#general';

    const modal = document.getElementById('settings_modal');
    if (modal) {
        modal.classList.remove('hidden');
        const firstFocus = document.getElementById('setting_theme');
        if (firstFocus) firstFocus.focus();
    }
}

function closeSettingsModal() {
    const modal = document.getElementById('settings_modal');
    if (modal) modal.classList.add('hidden');
}

async function saveSettingsFromModal() {
    const current = getUserSettings();
    const rawSlot = document.getElementById('setting_slot_duration') ? document.getElementById('setting_slot_duration').value : 'auto';
    const parsedSlot = rawSlot === 'auto' ? 'auto' : parseInt(rawSlot);

    const newSettings = {
        ...current,
        theme: document.getElementById('setting_theme') ? document.getElementById('setting_theme').value : 'midnight',
        enableVimMotions: document.getElementById('setting_enable_vim') ? document.getElementById('setting_enable_vim').checked : true,
        enableSessionReview: document.getElementById('setting_enable_session_review') ? document.getElementById('setting_enable_session_review').checked : true,
        defaultView: document.getElementById('setting_default_view') ? document.getElementById('setting_default_view').value : 'auto',
        firstDayOfWeek: document.getElementById('setting_first_day') ? parseInt(document.getElementById('setting_first_day').value) : 1,
        slotDuration: parsedSlot,
        idleDetectorEnabled: document.getElementById('setting_idle_detector') ? document.getElementById('setting_idle_detector').checked : true,
        hideLeftSidebar: document.getElementById('setting_hide_left_sidebar') ? document.getElementById('setting_hide_left_sidebar').value : 'auto',
        hideRightSidebar: document.getElementById('setting_hide_right_sidebar') ? document.getElementById('setting_hide_right_sidebar').value : 'auto',
        autoScrollNow: document.getElementById('setting_auto_scroll') ? document.getElementById('setting_auto_scroll').checked : true,
        defaultTag: document.getElementById('setting_default_tag') ? document.getElementById('setting_default_tag').value.trim() || '#general' : '#general'
    };

    saveUserSettings(newSettings);
    closeSettingsModal();
    
    await applyUserSettings(newSettings, false);
}

async function applyUserSettings(s = null, isInitialBoot = false) {
    if (!s) s = getUserSettings();

    const themeName = s.theme || 'midnight';
    document.documentElement.setAttribute('data-theme', themeName);
    
    if (typeof defaultPalette !== 'undefined') {
        defaultPalette = THEME_PALETTES[themeName] || THEME_PALETTES.midnight;
    }

    if (typeof updateVimModeIndicator === 'function') {
        updateVimModeIndicator();
    }

    if (typeof idleDetectionEnabled !== 'undefined' && idleDetectionEnabled !== s.idleDetectorEnabled) {
        try {
            await api.post('/api/v1/idle/toggle', { enabled: s.idleDetectorEnabled });
            idleDetectionEnabled = s.idleDetectorEnabled;
            if (typeof updateIdleSwitchUI === 'function') updateIdleSwitchUI();
        } catch(e) {}
    }

    const effectiveSlot = (s.slotDuration === 'auto' || !s.slotDuration) ? (s.lastSelectedSlot || 15) : parseInt(s.slotDuration);
    if (typeof setSlotDuration === 'function') {
        setSlotDuration(effectiveSlot, false);
    }

    if (typeof calendar !== 'undefined' && calendar) {
        calendar.setOption('firstDay', s.firstDayOfWeek);
        if (!isInitialBoot) {
            const effectiveView = (s.defaultView === 'auto' || !s.defaultView) ? (s.lastSelectedView || 'timeGridWeek') : s.defaultView;
            calendar.changeView(effectiveView);
        }
        calendar.refetchEvents();
    }

    const hideLeft = (s.hideLeftSidebar === 'auto' || s.hideLeftSidebar === undefined) ? (s.lastHideLeftSidebar || false) : (s.hideLeftSidebar === 'true' || s.hideLeftSidebar === true);
    const hideRight = (s.hideRightSidebar === 'auto' || s.hideRightSidebar === undefined) ? (s.lastHideRightSidebar || false) : (s.hideRightSidebar === 'true' || s.hideRightSidebar === true);

    setSidebarVisibility('left_sidebar', !hideLeft);
    setSidebarVisibility('right_sidebar', !hideRight);

    if (typeof updateSessionReviewTabVisibility === 'function') {
        updateSessionReviewTabVisibility();
    }

    if (typeof fetchTasks === 'function') {
        fetchTasks();
    }
}

function setSidebarVisibility(id, visible) {
    const el = document.getElementById(id);
    if (!el) return;

    if (visible) {
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }

    const btnId = id === 'left_sidebar' ? 'btn_toggle_left_sidebar' : 'btn_toggle_right_sidebar';
    const btn = document.getElementById(btnId);
    if (btn) {
        const isHidden = el.classList.contains('hidden');
        btn.innerText = (id === 'left_sidebar') ? (isHidden ? 'Show Tasks' : 'Hide Tasks') : (isHidden ? 'Show Totals' : 'Hide Totals');
    }

    if (typeof calendar !== 'undefined' && calendar) {
        setTimeout(() => calendar.updateSize(), 50);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupSettingsKeyboardShortcuts();
    applyUserSettings(getUserSettings(), true);
});
