/**
 * TimeTrace User Settings Manager
 * Persists preferences in localStorage and syncs daemon state.
 */

const SETTINGS_KEY = 'timetrace_user_settings';

const DEFAULT_SETTINGS = {
    defaultView: 'timeGridWeek',        // 'timeGridWeek' | 'timeGridDay' | 'dayGridMonth'
    firstDayOfWeek: 1,                 // 1 = Monday, 0 = Sunday
    slotDuration: 15,                  // 15, 30, 45, 60 minutes
    idleDetectorEnabled: true,         // true / false
    hideLeftSidebar: false,            // true / false
    hideRightSidebar: false,           // true / false
    autoScrollNow: true,               // true / false
    defaultTag: '#general'             // default tag string
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
    
    document.getElementById('setting_default_view').value = s.defaultView;
    document.getElementById('setting_first_day').value = String(s.firstDayOfWeek);
    document.getElementById('setting_slot_duration').value = String(s.slotDuration);
    document.getElementById('setting_idle_detector').checked = s.idleDetectorEnabled;
    document.getElementById('setting_hide_left_sidebar').checked = s.hideLeftSidebar;
    document.getElementById('setting_hide_right_sidebar').checked = s.hideRightSidebar;
    document.getElementById('setting_auto_scroll').checked = s.autoScrollNow;
    document.getElementById('setting_default_tag').value = s.defaultTag || '#general';

    document.getElementById('settings_modal').classList.remove('hidden');
}

function closeSettingsModal() {
    const modal = document.getElementById('settings_modal');
    if (modal) modal.classList.add('hidden');
}

async function saveSettingsFromModal() {
    const s = getUserSettings();
    
    const newSettings = {
        defaultView: document.getElementById('setting_default_view').value,
        firstDayOfWeek: parseInt(document.getElementById('setting_first_day').value),
        slotDuration: parseInt(document.getElementById('setting_slot_duration').value),
        idleDetectorEnabled: document.getElementById('setting_idle_detector').checked,
        hideLeftSidebar: document.getElementById('setting_hide_left_sidebar').checked,
        hideRightSidebar: document.getElementById('setting_hide_right_sidebar').checked,
        autoScrollNow: document.getElementById('setting_auto_scroll').checked,
        defaultTag: document.getElementById('setting_default_tag').value.trim() || '#general'
    };

    saveUserSettings(newSettings);
    closeSettingsModal();
    
    await applyUserSettings(newSettings, false);
}

async function applyUserSettings(s = null, isInitialBoot = false) {
    if (!s) s = getUserSettings();

    // 1. Sync Idle Detector toggle with Backend API if state changed
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

    // 2. Set Slot Duration
    if (typeof setSlotDuration === 'function') {
        setSlotDuration(s.slotDuration);
        const durationSelect = document.getElementById('config_slot_duration');
        if (durationSelect) durationSelect.value = s.slotDuration;
    }

    // 3. Configure FullCalendar if initialized
    if (typeof calendar !== 'undefined' && calendar) {
        calendar.setOption('firstDay', s.firstDayOfWeek);
        if (!isInitialBoot) {
            calendar.changeView(s.defaultView);
        }
    }

    // 4. Set Sidebars Visibilities
    setSidebarVisibility('left_sidebar', !s.hideLeftSidebar);
    setSidebarVisibility('right_sidebar', !s.hideRightSidebar);

    // 5. Set default tag in session creation inputs
    const tagInput = document.getElementById('session_modal_tags_input');
    if (tagInput && !tagInput.value) {
        tagInput.placeholder = `Type tag (Default: ${s.defaultTag})...`;
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
        btn.className = isHidden 
            ? 'h-7 bg-[#181a28] hover:bg-[#222536] text-slate-500 border border-slate-800 px-2 rounded-lg whitespace-nowrap text-[11px] transition'
            : 'h-7 bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 border border-purple-700/50 px-2 rounded-lg font-semibold whitespace-nowrap text-[11px] transition';
    }

    if (typeof calendar !== 'undefined' && calendar) {
        setTimeout(() => calendar.updateSize(), 50);
    }
}
