/**
 * TimeTrace User Settings & Theme Manager
 * Persists preferences in localStorage and syncs daemon state.
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
    defaultView: 'timeGridWeek',
    firstDayOfWeek: 1,
    slotDuration: 15,
    idleDetectorEnabled: true,
    hideLeftSidebar: false,
    hideRightSidebar: false,
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

function openSettingsModal() {
    const s = getUserSettings();
    
    const themeSelect = document.getElementById('setting_theme');
    if (themeSelect) themeSelect.value = s.theme || 'midnight';
    
    const viewSelect = document.getElementById('setting_default_view');
    if (viewSelect) viewSelect.value = s.defaultView;

    const daySelect = document.getElementById('setting_first_day');
    if (daySelect) daySelect.value = String(s.firstDayOfWeek);

    const slotSelect = document.getElementById('setting_slot_duration');
    if (slotSelect) slotSelect.value = String(s.slotDuration);

    const idleCheck = document.getElementById('setting_idle_detector');
    if (idleCheck) idleCheck.checked = s.idleDetectorEnabled;

    const leftCheck = document.getElementById('setting_hide_left_sidebar');
    if (leftCheck) leftCheck.checked = s.hideLeftSidebar;

    const rightCheck = document.getElementById('setting_hide_right_sidebar');
    if (rightCheck) rightCheck.checked = s.hideRightSidebar;

    const scrollCheck = document.getElementById('setting_auto_scroll');
    if (scrollCheck) scrollCheck.checked = s.autoScrollNow;

    const tagInput = document.getElementById('setting_default_tag');
    if (tagInput) tagInput.value = s.defaultTag || '#general';

    const modal = document.getElementById('settings_modal');
    if (modal) modal.classList.remove('hidden');
}

function closeSettingsModal() {
    const modal = document.getElementById('settings_modal');
    if (modal) modal.classList.add('hidden');
}

async function saveSettingsFromModal() {
    const newSettings = {
        theme: document.getElementById('setting_theme') ? document.getElementById('setting_theme').value : 'midnight',
        defaultView: document.getElementById('setting_default_view') ? document.getElementById('setting_default_view').value : 'timeGridWeek',
        firstDayOfWeek: document.getElementById('setting_first_day') ? parseInt(document.getElementById('setting_first_day').value) : 1,
        slotDuration: document.getElementById('setting_slot_duration') ? parseInt(document.getElementById('setting_slot_duration').value) : 15,
        idleDetectorEnabled: document.getElementById('setting_idle_detector') ? document.getElementById('setting_idle_detector').checked : true,
        hideLeftSidebar: document.getElementById('setting_hide_left_sidebar') ? document.getElementById('setting_hide_left_sidebar').checked : false,
        hideRightSidebar: document.getElementById('setting_hide_right_sidebar') ? document.getElementById('setting_hide_right_sidebar').checked : false,
        autoScrollNow: document.getElementById('setting_auto_scroll') ? document.getElementById('setting_auto_scroll').checked : true,
        defaultTag: document.getElementById('setting_default_tag') ? document.getElementById('setting_default_tag').value.trim() || '#general' : '#general'
    };

    saveUserSettings(newSettings);
    closeSettingsModal();
    
    await applyUserSettings(newSettings, false);
}

async function applyUserSettings(s = null, isInitialBoot = false) {
    if (!s) s = getUserSettings();

    // 1. Apply Theme & Dynamic Palette
    const themeName = s.theme || 'midnight';
    document.documentElement.setAttribute('data-theme', themeName);
    
    if (typeof defaultPalette !== 'undefined') {
        defaultPalette = THEME_PALETTES[themeName] || THEME_PALETTES.midnight;
    }

    // 2. Sync Idle Detector toggle with Backend API if state changed
    if (typeof idleDetectionEnabled !== 'undefined' && idleDetectionEnabled !== s.idleDetectorEnabled) {
        try {
            await fetch('/api/v1/idle/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: s.idleDetectorEnabled })
            });
            idleDetectionEnabled = s.idleDetectorEnabled;
            if (typeof updateIdleSwitchUI === 'function') updateIdleSwitchUI();
        } catch(e) {}
    }

    // 3. Set Slot Duration
    if (typeof setSlotDuration === 'function') {
        setSlotDuration(s.slotDuration);
    }

    // 4. Configure FullCalendar if initialized
    if (typeof calendar !== 'undefined' && calendar) {
        calendar.setOption('firstDay', s.firstDayOfWeek);
        if (!isInitialBoot) {
            calendar.changeView(s.defaultView);
        }
        calendar.refetchEvents();
    }

    // 5. Set Sidebars Visibilities
    setSidebarVisibility('left_sidebar', !s.hideLeftSidebar);
    setSidebarVisibility('right_sidebar', !s.hideRightSidebar);

    // 6. Refresh task card lists & colors
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
    applyUserSettings(getUserSettings(), true);
});
