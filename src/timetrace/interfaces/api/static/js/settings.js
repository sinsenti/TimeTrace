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

    // Color-only writes must not retry another owner's pending daemon preference.
    applyUserSettings(typeof idleDetectionEnabled === 'undefined' ? s
        : { ...s, idleDetectorEnabled: idleDetectionEnabled }, false);

    const msg = document.getElementById('reshuffle_status_msg');
    if (msg) {
        msg.innerText = 'Reshuffled!';
        setTimeout(() => { msg.innerText = ''; }, 1800);
    }
}

function setupSettingsKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        const modal = document.getElementById('settings_modal');
        if (modal && !modal.classList.contains('hidden') &&
            (modal.dataset?.settingsPageEditor !== 'true' || modal.contains(e.target))) {
            if (e.key === 'Tab' && modal.dataset?.settingsPageEditor !== 'true') {
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
        if (!root || !saved) return false;
        // Retained page tabs are not discarded dialogs when hidden.
        if (root.classList.contains('hidden') && root.dataset.settingsDraftRetained !== 'true') return false;
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
let browserSettingsBaseline = null;
let browserSettingsSaving = false;
let browserIdlePending = false;

// Only these published controls belong to the Browser owner; remembered/unknown keys stay intact.
const BROWSER_SETTING_FIELDS = {
    setting_appearance: ['appearance', 'string'], setting_light_theme: ['lightTheme', 'string'],
    setting_theme: ['theme', 'string'], setting_enable_vim: ['enableVimMotions', 'boolean'],
    setting_enable_session_review: ['enableSessionReview', 'boolean'],
    setting_default_view: ['defaultView', 'string'], setting_first_day: ['firstDayOfWeek', 'number'],
    setting_slot_duration: ['slotDuration', 'slot'], setting_idle_detector: ['idleDetectorEnabled', 'boolean'],
    setting_hide_left_sidebar: ['hideLeftSidebar', 'string'], setting_hide_right_sidebar: ['hideRightSidebar', 'string'],
    setting_auto_scroll: ['autoScrollNow', 'boolean'], setting_task_view: ['taskView', 'string'],
    setting_calendar_density: ['calendarDensity', 'number'], setting_totals_visible: ['totalsVisible', 'boolean']
};

function browserSettingsStatus(text) {
    let status = document.getElementById('browser_save_status');
    const root = document.getElementById('settings_modal');
    if (!status && root?.appendChild && document.createElement) {
        status = document.createElement('p');
        status.id = 'browser_save_status';
        status.setAttribute('role', 'status');
        root.appendChild(status);
    }
    if (status) status.textContent = text;
}

function browserSettingValue(el, type) {
    return type === 'boolean' ? el.checked : type === 'number' || (type === 'slot' && el.value !== 'auto')
        ? Number(el.value) : el.value;
}

function openSettingsModal(forceReload = false) {
    const modal = document.getElementById('settings_modal');
    if (!modal) return;
    if (browserSettingsSaving) return;
    if (modal.dataset?.settingsPageEditor === 'true' && browserSettingsBaseline && !forceReload) {
        if (typeof showSettingsCategory === 'function') showSettingsCategory('browser', true);
        return;
    }
    settingsReturnFocus = document.activeElement;
    try { localStorage.getItem(SETTINGS_KEY); }
    catch (_) {
        browserSettingsBaseline = null;
        browserSettingsStatus('Could not read browser storage. Preferences were not loaded; reopen to retry.');
        return;
    }
    const s = getUserSettings();
    browserSettingsBaseline = {};
    for (const [id, [key, type]] of Object.entries(BROWSER_SETTING_FIELDS)) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (type === 'boolean') el.checked = s[key];
        else el.value = String(s[key]);
        browserSettingsBaseline[id] = { value: browserSettingValue(el, type), stored: s[key] };
    }
    modal.classList.remove('hidden');
    let pending = document.getElementById('browser_idle_pending');
    if (!pending && modal.appendChild && document.createElement) {
        pending = document.createElement('input');
        pending.id = 'browser_idle_pending';
        pending.type = 'hidden';
        pending.disabled = true;
        modal.appendChild(pending);
    }
    if (pending) pending.value = '';
    rememberSettingsDraft('settings_modal');
    if (pending && browserIdlePending) pending.value = 'pending';
    if (browserIdlePending) browserSettingsStatus('Browser preferences are stored, but inactivity detection still needs an explicit retry with Save.');
    if (modal.dataset?.settingsPageEditor !== 'true') document.getElementById('setting_theme')?.focus();
}

function closeSettingsModal() {
    if (browserSettingsSaving) return;
    const modal = document.getElementById('settings_modal');
    if (modal?.dataset?.settingsPageEditor === 'true') {
        openSettingsModal(true);
        if (!browserIdlePending) browserSettingsStatus('Changes canceled. Saved browser preferences restored.');
    } else {
        if (modal) modal.classList.add('hidden');
        settingsReturnFocus?.focus();
    }
}

async function saveSettingsFromModal() {
    if (browserSettingsSaving || !browserSettingsBaseline) return;
    try { localStorage.getItem(SETTINGS_KEY); }
    catch (_) {
        browserSettingsStatus('Could not read browser storage. No preferences saved; your edits are retained.');
        return;
    }
    const current = getUserSettings();
    const right = document.getElementById('setting_hide_right_sidebar');
    const totals = document.getElementById('setting_totals_visible');
    if (right && totals && browserSettingsBaseline.setting_hide_right_sidebar && browserSettingsBaseline.setting_totals_visible) {
        if (right.value !== browserSettingsBaseline.setting_hide_right_sidebar.value && right.value !== 'auto') {
            totals.checked = right.value === 'false';
        } else if (totals.checked !== browserSettingsBaseline.setting_totals_visible.value) {
            right.value = 'auto';
        }
    }
    const patch = {};
    const submitted = [];
    for (const [id, baseline] of Object.entries(browserSettingsBaseline)) {
        const [key, type] = BROWSER_SETTING_FIELDS[id];
        const el = document.getElementById(id);
        const value = browserSettingValue(el, type);
        if (value === baseline.value) continue;
        // Do not overwrite a newer writer of the same field with an old editor snapshot.
        if (current[key] !== baseline.stored && current[key] !== value) {
            browserSettingsStatus('This preference changed elsewhere. Cancel changes to reload saved values before editing it again.');
            return;
        }
        patch[key] = value;
        submitted.push([id, value]);
    }
    if (Object.hasOwn(patch, 'hideRightSidebar') && patch.hideRightSidebar !== 'auto') {
        patch.totalsVisible = patch.hideRightSidebar === 'false';
    } else if (Object.hasOwn(patch, 'totalsVisible')) {
        patch.hideRightSidebar = 'auto';
        patch.lastHideRightSidebar = !patch.totalsVisible;
    }
    const saved = { ...current, ...patch };
    const checkpoints = submitted.map(([id]) => [id, settingsDraftCheckpoint('settings_modal', `#${id}`)]);
    const idleCheckpoint = settingsDraftCheckpoint('settings_modal', '#setting_idle_detector');
    browserSettingsSaving = true;
    let browserStored = false;
    const button = document.getElementById('browser_save');
    if (button) button.disabled = true;
    try {
        // A failed client write never reaches the daemon or acknowledges these fields.
        saveUserSettings(saved);
        browserStored = true;
        checkpoints.filter(([id]) => id !== 'setting_idle_detector').forEach(([, checkpoint]) => checkpoint());
        for (const [id, value] of submitted) {
            browserSettingsBaseline[id] = { value, stored: saved[BROWSER_SETTING_FIELDS[id][0]] };
        }
        const needsIdle = browserIdlePending || Object.hasOwn(patch, 'idleDetectorEnabled') ||
            (typeof idleDetectionEnabled !== 'undefined' && idleDetectionEnabled !== saved.idleDetectorEnabled);
        let idleFailed = false;
        if (needsIdle) {
            browserIdlePending = true;
            const pending = document.getElementById('browser_idle_pending');
            if (pending) pending.value = 'pending';
            browserSettingsStatus('Browser preferences stored. Updating daemon inactivity detection…');
            try {
                await api.post('/idle/toggle', { enabled: saved.idleDetectorEnabled });
                if (typeof idleDetectionEnabled !== 'undefined') idleDetectionEnabled = saved.idleDetectorEnabled;
                browserIdlePending = false;
                if (pending) pending.value = '';
                idleCheckpoint();
                if (browserSettingsBaseline.setting_idle_detector) browserSettingsBaseline.setting_idle_detector = {
                    value: saved.idleDetectorEnabled, stored: saved.idleDetectorEnabled
                };
            } catch (_) {
                idleFailed = true;
                browserSettingsStatus('Browser preferences stored, but daemon inactivity detection was not confirmed. Save retries it explicitly; no automatic retry.');
            }
        }
        // Apply presentation without replaying a failed idle request through the legacy reconciler.
        if (!idleFailed && needsIdle && typeof updateIdleSwitchUI === 'function') updateIdleSwitchUI();
        const latest = getUserSettings();
        await applyUserSettings(typeof idleDetectionEnabled === 'undefined' ? latest
            : { ...latest, idleDetectorEnabled: idleDetectionEnabled }, false);
        if (idleFailed) return;
        const root = document.getElementById('settings_modal');
        if (!hasSettingsDrafts(['settings_modal']) && root?.dataset?.settingsPageEditor !== 'true') closeSettingsModalAfterSave();
        browserSettingsStatus(hasSettingsDrafts(['settings_modal']) ? 'Captured preferences saved. New edits remain unsaved.' : 'Browser preferences saved.');
    } catch (_) {
        browserSettingsStatus(browserStored
            ? 'Browser preferences stored, but updating the display failed. Reload to refresh; saved writes are not replayed.'
            : 'Could not save browser preferences. Check browser storage access; your edits are retained.');
    } finally {
        browserSettingsSaving = false;
        if (button) button.disabled = false;
    }
}

function closeSettingsModalAfterSave() {
    document.getElementById('settings_modal')?.classList.add('hidden');
    settingsReturnFocus?.focus();
}

// The navbar is an independent appearance writer. Adopt it only into clean Browser fields.
document.addEventListener('timetrace:appearance', () => {
    if (!browserSettingsBaseline) return;
    const saved = getUserSettings();
    for (const id of ['setting_appearance', 'setting_light_theme']) {
        const baseline = browserSettingsBaseline[id];
        const el = document.getElementById(id);
        if (!baseline || !el || el.value !== baseline.value) continue;
        const value = saved[BROWSER_SETTING_FIELDS[id][0]];
        el.value = value;
        browserSettingsBaseline[id] = { value, stored: value };
        rememberSettingsDraft('settings_modal', `#${id}`);
    }
});

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

    // Opening/navigating/applying presentation never changes the daemon's current idle state.
    // Only explicit Browser Save or the idle control owns that side effect.
    if (typeof updateIdleSwitchUI === 'function') updateIdleSwitchUI();

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
