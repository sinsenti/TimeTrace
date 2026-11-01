/**
 * TimeTrace User Settings & Theme Manager
 */

const SETTINGS_KEY = 'timetrace_user_settings';
const SUPPORTED_CALENDAR_VIEWS = Object.freeze(['timeGridDay', 'timeGridThreeDay', 'timeGridWeek', 'dayGridMonth']);

const THEME_PALETTES = {
    midnight: [
        '#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626', '#ec4899', '#0284c7', '#0d9488',
        '#4f46e5', '#9333ea', '#16a34a', '#ea580c', '#e11d48', '#c026d3', '#0891b2', '#b45309'
    ],
    nord: [
        '#88c0d0', '#81a1c1', '#5e81ac', '#bf616a', '#d08770', '#ebcb8b', '#a3be8c', '#b48ead',
        '#8fbcbb', '#d88195', '#a9a1e1', '#689d6a', '#d79921', '#7dc1c5', '#988bc7', '#cc241d'
    ],
    dracula: [
        '#bd93f9', '#ff79c6', '#8be9fd', '#50fa7b', '#ffb86c', '#ff5555', '#f1fa8c', '#6272a4',
        '#d6acff', '#ff6eaf', '#69ff94', '#ff9e3b', '#ff757f', '#70a5ff', '#79dae8', '#c586c0'
    ],
    cyberpunk: [
        '#00f0ff', '#ff0055', '#ffe600', '#00ff66', '#9d00ff', '#ff9900', '#ff00aa', '#00a8ff',
        '#39ff14', '#7b00ff', '#ff3366', '#ffaa00', '#00ffd5', '#5200ff', '#ff007f', '#f0ff00'
    ],
    monokai: [
        '#ff6188', '#fc9867', '#ffd866', '#a9dc76', '#78dce8', '#ab9df2', '#ff8579', '#b7eb46',
        '#5ec4ff', '#f16dae', '#e6b450', '#f25287', '#c397d8', '#52e0a2', '#ff9e42', '#36d1c4'
    ]
};

const DEFAULT_SETTINGS = {
    theme: 'midnight',
    appearance: 'light',
    lightTheme: 'refined',
    calendarDensity: 88,
    totalsVisible: false,
    taskView: 'kanban',
    colorSeed: 0,
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
    autoScrollNow: true
};

function getQueryContext() {
    const s = getUserSettings();
    return {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        first_day_of_week: s.firstDayOfWeek
    };
}

function getUserSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const saved = JSON.parse(raw);
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...DEFAULT_SETTINGS };
        const s = { ...DEFAULT_SETTINGS, ...saved };
        const validPalette = Object.hasOwn(THEME_PALETTES, saved.theme);
        if (!['light', 'dark'].includes(s.appearance)) s.appearance = validPalette ? 'dark' : 'light';
        if (!Object.hasOwn(saved, 'appearance') && validPalette) s.appearance = 'dark';
        if (!validPalette) s.theme = DEFAULT_SETTINGS.theme;
        const choices = {
            lightTheme: ['refined', 'stone', 'porcelain'],
            calendarDensity: [56, 72, 88],
            taskView: ['kanban', 'grouped', 'outline'],
            defaultView: ['auto', ...SUPPORTED_CALENDAR_VIEWS],
            lastSelectedView: SUPPORTED_CALENDAR_VIEWS,
            firstDayOfWeek: [0, 1],
            slotDuration: ['auto', 15, 30, 45, 60],
            lastSelectedSlot: [15, 30, 45, 60],
            hideLeftSidebar: ['auto', 'true', 'false', true, false],
            hideRightSidebar: ['auto', 'true', 'false', true, false]
        };
        for (const [key, values] of Object.entries(choices)) {
            if (!values.includes(s[key])) s[key] = DEFAULT_SETTINGS[key];
        }
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            if (typeof value === 'boolean' && typeof s[key] !== 'boolean') s[key] = value;
        }
        if (!Number.isInteger(s.colorSeed) || s.colorSeed < 0) s.colorSeed = 0;
        if (!Object.hasOwn(saved, 'totalsVisible')) {
            const legacy = saved.hideRightSidebar;
            if ([true, false, 'true', 'false'].includes(legacy)) {
                s.totalsVisible = legacy === false || legacy === 'false';
            } else if (legacy === 'auto' && typeof saved.lastHideRightSidebar === 'boolean') {
                s.totalsVisible = !saved.lastHideRightSidebar;
            }
        }
        return s;
    } catch (e) {
        return { ...DEFAULT_SETTINGS };
    }
}

// Appearance updates are token-only: never reload data or replace an open editor.
function applyAppearance(s = getUserSettings()) {
    document.documentElement.setAttribute('data-appearance', s.appearance);
    document.documentElement.setAttribute('data-light-theme', s.lightTheme);
    document.documentElement.setAttribute('data-theme', s.appearance === 'light' ? 'light' : s.theme);
    const select = document.getElementById('appearance_light_theme');
    if (select) select.value = s.lightTheme;
    const button = document.getElementById('appearance_toggle');
    if (button) {
        button.textContent = s.appearance === 'light' ? 'Dark' : 'Light';
        button.setAttribute('aria-label', `Switch to ${s.appearance === 'light' ? 'dark' : 'light'} appearance`);
    }
    document.dispatchEvent(new Event('timetrace:appearance'));
}

function chartAppearanceColors() {
    if (getUserSettings().appearance === 'dark') return { legend: '#94a3b8', ticks: '#64748b', grid: '#1a1c26' };
    const style = getComputedStyle(document.documentElement);
    const text = style.getPropertyValue('--text-muted').trim();
    return { legend: text, ticks: text, grid: style.getPropertyValue('--border-color').trim() };
}

function applyChartAppearance(charts) {
    const colors = chartAppearanceColors();
    for (const chart of charts) {
        // Chart.js clears canvas/ctx on destroy; absence is a normal chart lifecycle state.
        if (!chart || chart.canvas === null || chart.ctx === null) continue;
        if (chart.options.plugins?.legend?.labels) chart.options.plugins.legend.labels.color = colors.legend;
        for (const axis of Object.values(chart.options.scales || {})) {
            if (axis.ticks) axis.ticks.color = colors.ticks;
            if (axis.grid) axis.grid.color = colors.grid;
        }
        chart.update('none');
    }
}

function setAppearancePreference(key, value) {
    if (key === 'appearance' && !['light', 'dark'].includes(value)) return;
    if (key === 'lightTheme' && !['refined', 'stone', 'porcelain'].includes(value)) return;
    if (!['appearance', 'lightTheme'].includes(key)) return;
    const s = getUserSettings();
    s[key] = value;
    saveUserSettings(s);
    applyAppearance(s);
}

function saveUserSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function reshuffleAutoColors() {
    const s = getUserSettings();
    s.colorSeed = (s.colorSeed || 0) + 1;
    saveUserSettings(s);

    applyUserSettings(s, false);

    const msg = document.getElementById('reshuffle_status_msg');
    if (msg) {
        msg.innerText = 'Reshuffled!';
        setTimeout(() => { msg.innerText = ''; }, 1800);
    }
}

function setupSettingsKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        const modal = document.getElementById('settings_modal');
        if (modal && !modal.classList.contains('hidden')) {
            if (e.key === 'Tab') {
                const focusable = modal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
                const first = focusable[0], last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                }
            } else if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                saveSettingsFromModal();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeSettingsModal();
            }
        }
    });
}

// Only the new Settings departure needs this guard; existing routing stays owned by each page.
const settingsDrafts = new Map();

function settingsDraftFieldSnapshot(el) {
    return JSON.stringify([el.type === 'checkbox' ? el.checked : el.value,
        el.classList?.contains('custom-rating-input') ? el.disabled : null]);
}

// Capture the submitted values before a write; checkpoint only those fields after success.
function settingsDraftCheckpoint(id, selector = 'input, select, textarea') {
    const root = typeof id === 'string' ? document.getElementById(id) : id;
    if (typeof id !== 'string') id = root?.id;
    if (!root?.querySelectorAll) return () => {};
    const fields = Array.from(root.querySelectorAll(selector));
    const saved = fields.map(el => [el.id || el, settingsDraftFieldSnapshot(el)]);
    const tags = root.id === 'session_modal' && typeof currentTagChips !== 'undefined' ? JSON.stringify(currentTagChips) : null;
    return () => {
        const owner = settingsDrafts.get(id) || { fields: new Map(), tags: null };
        saved.forEach(([key, value]) => owner.fields.set(key, value));
        if (tags !== null) owner.tags = tags;
        settingsDrafts.set(id, owner);
    };
}

function rememberSettingsDraft(id, selector) {
    settingsDraftCheckpoint(id, selector)();
}

function hasSettingsDrafts(ids = [...settingsDrafts.keys()], selector = 'input, select, textarea') {
    return ids.some(id => {
        const root = document.getElementById(id);
        const saved = settingsDrafts.get(id);
        if (!root || !saved || root.classList.contains('hidden')) return false;
        const fields = Array.from(root.querySelectorAll(selector));
        return fields.some(el => {
            const baseline = saved.fields.get(el.id || el);
            return baseline !== undefined && settingsDraftFieldSnapshot(el) !== baseline;
        }) || (saved.tags !== null && JSON.stringify(currentTagChips) !== saved.tags);
    });
}

function followSettingsLink(event) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return true;
    const path = new URL(window.location.href).pathname;
    if (path === '/settings/ai' || path === '/settings') return false;
    return !hasSettingsDrafts() || window.confirm('Leave this page and discard unsaved changes?');
}

let settingsReturnFocus = null;

function openSettingsModal() {
    settingsReturnFocus = document.activeElement;
    const s = getUserSettings();
    const appearanceSelect = document.getElementById('setting_appearance');
    if (appearanceSelect) appearanceSelect.value = s.appearance;
    const lightSelect = document.getElementById('setting_light_theme');
    if (lightSelect) lightSelect.value = s.lightTheme;
    
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

    const modal = document.getElementById('settings_modal');
    if (modal) {
        modal.classList.remove('hidden');
        const firstFocus = document.getElementById('setting_theme');
        rememberSettingsDraft('settings_modal');
        if (firstFocus) firstFocus.focus();
    }
}

function closeSettingsModal() {
    const modal = document.getElementById('settings_modal');
    if (modal) modal.classList.add('hidden');
    settingsReturnFocus?.focus();
}

async function saveSettingsFromModal() {
    const current = getUserSettings();
    const rawSlot = document.getElementById('setting_slot_duration') ? document.getElementById('setting_slot_duration').value : 'auto';
    const parsedSlot = rawSlot === 'auto' ? 'auto' : parseInt(rawSlot);

    const newSettings = {
        ...current,
        appearance: document.getElementById('setting_appearance')?.value || current.appearance,
        lightTheme: document.getElementById('setting_light_theme')?.value || current.lightTheme,
        theme: document.getElementById('setting_theme') ? document.getElementById('setting_theme').value : 'midnight',
        enableVimMotions: document.getElementById('setting_enable_vim') ? document.getElementById('setting_enable_vim').checked : true,
        enableSessionReview: document.getElementById('setting_enable_session_review') ? document.getElementById('setting_enable_session_review').checked : true,
        defaultView: document.getElementById('setting_default_view') ? document.getElementById('setting_default_view').value : 'auto',
        firstDayOfWeek: document.getElementById('setting_first_day') ? parseInt(document.getElementById('setting_first_day').value) : 1,
        slotDuration: parsedSlot,
        idleDetectorEnabled: document.getElementById('setting_idle_detector') ? document.getElementById('setting_idle_detector').checked : true,
        hideLeftSidebar: document.getElementById('setting_hide_left_sidebar') ? document.getElementById('setting_hide_left_sidebar').value : 'auto',
        hideRightSidebar: document.getElementById('setting_hide_right_sidebar') ? document.getElementById('setting_hide_right_sidebar').value : current.hideRightSidebar,
        autoScrollNow: document.getElementById('setting_auto_scroll') ? document.getElementById('setting_auto_scroll').checked : true
    };

    const rightChoice = newSettings.hideRightSidebar;
    if (rightChoice !== 'auto') newSettings.totalsVisible = rightChoice === 'false' || rightChoice === false;
    saveUserSettings(newSettings);
    closeSettingsModal();
    
    await applyUserSettings(newSettings, false);
}

async function applyUserSettings(s = null, isInitialBoot = false) {
    if (!s) s = getUserSettings();

    const themeName = s.theme || 'midnight';
    applyAppearance(s);
    
    if (typeof defaultPalette !== 'undefined') {
        defaultPalette = THEME_PALETTES[themeName] || THEME_PALETTES.midnight;
    }

    if (typeof updateVimModeIndicator === 'function') {
        updateVimModeIndicator();
    }

    if (typeof idleDetectionEnabled !== 'undefined' && idleDetectionEnabled !== s.idleDetectorEnabled) {
        try {
            await api.post('/idle/toggle', { enabled: s.idleDetectorEnabled });
            idleDetectionEnabled = s.idleDetectorEnabled;
            if (typeof updateIdleSwitchUI === 'function') updateIdleSwitchUI();
        } catch(e) {}
    }

    // An idle-toggle response can arrive after newer interactive browser preferences.
    s = getUserSettings();
    const effectiveSlot = (s.slotDuration === 'auto' || !s.slotDuration) ? (s.lastSelectedSlot || 15) : parseInt(s.slotDuration);
    if (typeof setSlotDuration === 'function') {
        setSlotDuration(effectiveSlot, false);
    }

    if (typeof calendar !== 'undefined' && calendar) {
        calendar.setOption('firstDay', s.firstDayOfWeek);
        calendar.refetchEvents();
    }

    const hideLeft = (s.hideLeftSidebar === 'auto' || s.hideLeftSidebar === undefined) ? (s.lastHideLeftSidebar || false) : (s.hideLeftSidebar === 'true' || s.hideLeftSidebar === true);
    const hideRight = !s.totalsVisible;

    setSidebarVisibility('left_sidebar', !hideLeft);
    setSidebarVisibility('right_sidebar', !hideRight);
    setCalendarDensity(s.calendarDensity, false);

    if (typeof updateSessionReviewTabVisibility === 'function') {
        updateSessionReviewTabVisibility();
    }

    if (typeof fetchTasks === 'function') {
        fetchTasks();
    }
}

function setCalendarDensity(height, persist = true) {
    if (![56, 72, 88].includes(Number(height))) return;
    const s = getUserSettings();
    s.calendarDensity = Number(height);
    if (persist) saveUserSettings(s);
    const minutes = s.slotDuration === 'auto' ? s.lastSelectedSlot : s.slotDuration;
    document.documentElement.style.setProperty('--calendar-slot-height', `${s.calendarDensity * minutes / 60}px`);
    const select = document.getElementById('calendar_density');
    if (select) select.value = String(s.calendarDensity);
    if (typeof calendar !== 'undefined' && calendar) calendar.updateSize();
}

function toggleCalendarPanel(side) {
    if (!['left', 'right'].includes(side)) return;
    const s = getUserSettings();
    const panel = document.getElementById(`${side}_sidebar`);
    if (!panel) return;
    // Read the effective preference, not responsive CSS visibility.
    const visible = side === 'right' ? !s.totalsVisible
        : (s.hideLeftSidebar === 'auto' ? s.lastHideLeftSidebar : [true, 'true'].includes(s.hideLeftSidebar));
    if (side === 'right') {
        s.totalsVisible = visible;
        s.lastHideRightSidebar = !visible;
        s.hideRightSidebar = 'auto';
    } else {
        s.lastHideLeftSidebar = !visible;
        s.hideLeftSidebar = 'auto';
    }
    saveUserSettings(s);
    setSidebarVisibility(`${side}_sidebar`, visible);
}

function setSidebarVisibility(id, visible) {
    const el = document.getElementById(id);
    if (!el) return;

    if (visible) {
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }

    const handle = document.getElementById(id === 'left_sidebar' ? 'left_resizer' : 'right_resizer');
    if (handle) handle.classList.toggle('hidden', !visible);
    if (id === 'left_sidebar') document.documentElement.setAttribute('data-tasks-open', String(visible));
    const btnId = id === 'left_sidebar' ? 'btn_toggle_left_sidebar' : 'btn_toggle_right_sidebar';
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.innerText = (id === 'left_sidebar') ? (visible ? 'Hide Tasks' : 'Show Tasks') : (visible ? 'Hide Totals' : 'Show Totals');
        btn.setAttribute('aria-expanded', String(visible));
    }

    if (typeof calendar !== 'undefined' && calendar) {
        setTimeout(() => calendar.updateSize(), 50);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupSettingsKeyboardShortcuts();
    applyUserSettings(getUserSettings(), true);
});
