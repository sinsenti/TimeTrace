/** Settings category navigation retains each existing editor and its save owner. */
function showSettingsCategory(category, push = false) {
    if (!['browser', 'ai', 'providers'].includes(category)) category = 'browser';
    for (const name of ['browser', 'ai', 'providers']) {
        document.getElementById(`settings_${name}_category`).classList.toggle('hidden', name !== category);
    }
    document.getElementById('settings_modal').classList.toggle('hidden', category !== 'browser');
    document.querySelectorAll('#settings_categories button').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.category === category));
    });
    if (push) {
        const path = category === 'ai' ? '/settings/ai' : category === 'providers' ? '/settings?category=providers' : '/settings';
        window.history.pushState(null, '', path);
    }
}

function settingsCategoryFromLocation() {
    return window.location.pathname === '/settings/ai' ? 'ai'
        : new URLSearchParams(window.location.search).get('category') || 'browser';
}

document.addEventListener('DOMContentLoaded', () => {
    // A hidden category is retained, not a canceled provider/behavior editor.
    document.getElementById('ai_behavior_settings').dataset.settingsDraftRetained = 'true';
    openSettingsModal();
    showSettingsCategory(settingsCategoryFromLocation());
    document.querySelectorAll('#settings_categories button').forEach(button => {
        button.addEventListener('click', () => showSettingsCategory(button.dataset.category, true));
    });
    window.addEventListener('popstate', () => showSettingsCategory(settingsCategoryFromLocation()));
    const right = document.getElementById('setting_hide_right_sidebar');
    const totals = document.getElementById('setting_totals_visible');
    right.addEventListener('change', () => {
        if (right.value !== 'auto') totals.checked = right.value === 'false';
    });
    totals.addEventListener('change', () => { right.value = 'auto'; });
    document.getElementById('browser_save').addEventListener('click', saveSettingsFromModal);
    document.getElementById('browser_cancel').addEventListener('click', closeSettingsModal);
    document.getElementById('browser_reshuffle').addEventListener('click', () => {
        try { reshuffleAutoColors(); }
        catch (_) { document.getElementById('browser_save_status').textContent = 'Could not save the color seed in browser storage. No reshuffle was saved.'; }
    });
});
