/**
 * TimeTrace AI Assistant -- /settings/ai page behavior: provider CRUD, test connection,
 * behavior toggles.
 *
 * Masked-API-key UX (spec S7/S9.4): a saved provider's card only ever shows `api_key_last4`
 * (never the real key). The edit form's API key field is ALWAYS left blank when opening the
 * form for an existing provider -- it never gets pre-filled with a masked placeholder, so the
 * "leave blank = keep existing key" contract on `PUT /providers/{id}` (`api_key` omitted from
 * the request body entirely, matching `AIProviderUpdateRequest`'s `exclude_unset` semantics) is
 * exact: we only include `api_key` in the PUT body if the user actually typed a non-empty value
 * in this session, and only include an explicit `""` if they use the dedicated "clear key"
 * control. Every id used here is a UUIDv7 string -- addEventListener + dataset only.
 */

let aiCatalogCache = {};
let aiEditingProviderId = null;
let aiProviderOwner = null;
let aiProviderGeneration = 0;
let aiListGeneration = 0;
let aiCatalogGeneration = 0;
let aiProbeGeneration = 0;
let aiProviderStatusGeneration = 0;

function aiReadRetry(root, message, retryAction, label = 'Retry refresh') {
    if (!root) return;
    root.textContent = message + ' ';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'ai-btn-item';
    retry.textContent = label;
    retry.addEventListener('click', retryAction);
    root.appendChild(retry);
}

function aiKeyIntent() {
    const key = document.getElementById('ai_provider_form_api_key');
    return key.value ? 'replace' : document.getElementById('ai_provider_form_key_intent').value;
}

function aiUpdateKeyIntent() {
    const intent = document.getElementById('ai_provider_form_key_intent');
    if (document.getElementById('ai_provider_form_api_key').value) intent.value = 'keep';
    const status = document.getElementById('ai_provider_key_status');
    if (status) status.textContent = aiKeyIntent() === 'clear' ? 'Saved key will be cleared on Save.'
        : aiKeyIntent() === 'replace' ? 'Typed key will replace the saved key on Save.' : 'Blank keeps the saved key.';
}

function aiSetupSettingsPage() {
    aiLoadProviders();
    aiLoadCatalog();
    aiLoadBehaviorSettings();

    const newBtn = document.getElementById('ai_provider_new_btn');
    if (newBtn) newBtn.addEventListener('click', () => aiOpenProviderForm(null));

    const cancelBtn = document.getElementById('ai_provider_cancel_btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => aiCloseProviderForm(true));

    const saveBtn = document.getElementById('ai_provider_save_btn');
    if (saveBtn) saveBtn.addEventListener('click', aiSaveProviderForm);

    const testBtn = document.getElementById('ai_provider_test_btn');
    if (testBtn) testBtn.addEventListener('click', aiTestProviderForm);

    const providerSelect = document.getElementById('ai_provider_form_provider');
    if (providerSelect) providerSelect.addEventListener('change', aiRefreshModelSelectOptions);

    const modelSelect = document.getElementById('ai_provider_form_model_select');
    if (modelSelect) {
        modelSelect.addEventListener('change', () => {
            const modelInput = document.getElementById('ai_provider_form_model');
            if (modelInput && modelSelect.value) modelInput.value = modelSelect.value;
        });
    }

    const clearBtn = document.getElementById('ai_provider_clear_key_btn');
    if (clearBtn) clearBtn.addEventListener('click', () => {
        document.getElementById('ai_provider_form_api_key').value = '';
        document.getElementById('ai_provider_form_key_intent').value = 'clear';
        aiUpdateKeyIntent();
    });
    const keyInput = document.getElementById('ai_provider_form_api_key');
    if (keyInput) keyInput.addEventListener('input', aiUpdateKeyIntent);
    const behaviorCancel = document.getElementById('ai_settings_cancel_btn');
    if (behaviorCancel) behaviorCancel.addEventListener('click', aiCancelBehaviorSettings);

    const settingsSaveBtn = document.getElementById('ai_settings_save_btn');
    if (settingsSaveBtn) settingsSaveBtn.addEventListener('click', aiSaveBehaviorSettings);

    // Keep this page's independent saves independent; never autosave on departure.
    let leaving = false;
    document.addEventListener('click', event => {
        const link = event.target.closest('a[href]');
        if (!link || event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === '_blank') return;
        const destination = new URL(link.href, window.location.href);
        if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.search === window.location.search) {
            if (!destination.hash) event.preventDefault();
            return;
        }
        if (hasSettingsDrafts() && !window.confirm('Leave this page and discard unsaved changes?')) event.preventDefault();
        else leaving = true;
    });
    window.addEventListener('beforeunload', event => {
        if (!leaving && hasSettingsDrafts()) {
            event.preventDefault();
            event.returnValue = '';
        }
        leaving = false;
    });
}

document.addEventListener('DOMContentLoaded', aiSetupSettingsPage);

async function aiLoadCatalog() {
    const generation = ++aiCatalogGeneration;
    const status = document.getElementById('ai_catalog_status');
    try {
        const catalog = await api.get('/api/ai/providers/catalog');
        if (generation !== aiCatalogGeneration) return;
        aiCatalogCache = catalog;
        if (status) status.textContent = '';
        aiRefreshModelSelectOptions();
    } catch {
        if (generation !== aiCatalogGeneration) return;
        aiReadRetry(status, 'Could not load model catalog. Custom model IDs still work.', aiLoadCatalog, 'Retry catalog');
    }
}

function aiRefreshModelSelectOptions() {
    const providerSelect = document.getElementById('ai_provider_form_provider');
    const modelSelect = document.getElementById('ai_provider_form_model_select');
    if (!providerSelect || !modelSelect) return;
    const models = aiCatalogCache[providerSelect.value] || [];
    modelSelect.textContent = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = models.length ? '-- pick a known model --' : '(no catalog entries -- type below)';
    modelSelect.appendChild(placeholder);
    models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label || m.id;
        modelSelect.appendChild(opt);
    });
    aiRefreshProviderHelp();
}

// One-line setup guidance per provider -- where to get a key (or that none is needed), shown
// under the Provider select so a new provider isn't just a blank form with no hint where to
// start. `keyRequired: false` also relaxes the API key field's label for Ollama.
const AI_PROVIDER_HELP = {
    anthropic: {
        text: 'Claude models. Get an API key at',
        url: 'https://console.anthropic.com/settings/keys',
        label: 'console.anthropic.com',
        keyRequired: true,
    },
    openai: {
        text: 'GPT models. Get an API key at',
        url: 'https://platform.openai.com/api-keys',
        label: 'platform.openai.com',
        keyRequired: true,
    },
    google: {
        text: 'Gemini models, direct from Google AI Studio (not routed through OpenRouter). Get a free API key at',
        url: 'https://aistudio.google.com/apikey',
        label: 'aistudio.google.com',
        keyRequired: true,
    },
    groq: {
        text: 'Very fast inference for open models (Llama, GPT-OSS, ...) via Groq\'s free-tier-friendly, '
            + 'OpenAI-compatible API. Get an API key at',
        url: 'https://console.groq.com/keys',
        label: 'console.groq.com',
        keyRequired: true,
    },
    openrouter: {
        text: 'Routes to many providers (Claude, GPT, Gemini, Llama, ...) under one key. Get an API key at',
        url: 'https://openrouter.ai/keys',
        label: 'openrouter.ai',
        keyRequired: true,
    },
    ollama: {
        text: 'A local Ollama server -- no API key, nothing leaves this machine. Set Base URL to your server '
            + '(default http://localhost:11434) and make sure the model is already pulled (ollama pull <model>).',
        url: null,
        label: null,
        keyRequired: false,
    },
    pi: {
        text: 'Uses your installed Pi coding agent and its existing login (for example '
            + 'openai-codex/gpt-5.1-codex). Configure credentials with Pi, then enter the exact '
            + 'provider/model ID. TimeTrace does not receive or store the Pi API key.',
        url: 'https://pi.dev',
        label: 'pi.dev',
        keyRequired: false,
    },
};

function aiRefreshProviderHelp() {
    const providerSelect = document.getElementById('ai_provider_form_provider');
    const helpBox = document.getElementById('ai_provider_form_help');
    const keyLabel = document.getElementById('ai_provider_form_api_key_label');
    if (!providerSelect || !helpBox) return;

    const info = AI_PROVIDER_HELP[providerSelect.value];
    helpBox.textContent = '';
    if (info) {
        helpBox.appendChild(document.createTextNode(info.text + ' '));
        if (info.url) {
            const link = document.createElement('a');
            link.href = info.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = info.label;
            helpBox.appendChild(link);
        }
    }
    if (keyLabel) {
        keyLabel.textContent = info && !info.keyRequired
            ? `API Key (not needed for ${providerSelect.value === 'pi' ? 'Pi' : 'Ollama'})`
            : 'API Key';
    }
}

async function aiLoadProviders() {
    const list = document.getElementById('ai_providers_list');
    if (!list) return;
    const generation = ++aiListGeneration;
    list.textContent = 'Loading providers…';
    try {
        const providers = await api.get('/api/ai/providers');
        if (generation !== aiListGeneration) return;
        const cards = providers.map(aiBuildProviderCard);
        list.textContent = '';
        aiUpdateDataScopeWarning(providers);
        if (!cards.length) list.textContent = 'No providers configured yet. Add a provider to get started.';
        cards.forEach(card => list.appendChild(card));
    } catch {
        if (generation !== aiListGeneration) return;
        aiReadRetry(list, 'Failed to load providers. Any acknowledged changes remain saved.', aiLoadProviders);
    }
}

async function aiRefreshProviderStatus(statusOnly = false) {
    const generation = ++aiProviderStatusGeneration;
    if (!statusOnly) await aiLoadProviders();
    if (generation !== aiProviderStatusGeneration) return;
    const notice = document.getElementById('ai_provider_status');
    if (notice) notice.textContent = 'Refreshing provider status…';
    if (typeof refreshAiStatusBadge === 'function') {
        const success = await refreshAiStatusBadge();
        if (generation !== aiProviderStatusGeneration) return;
        if (success === false) {
            aiReadRetry(notice, 'Status refresh failed. Any acknowledged changes remain saved.',
                () => aiRefreshProviderStatus(true), 'Retry status');
        } else if (success === true && notice) notice.textContent = '';
    } else if (notice) notice.textContent = '';
}

function aiBuildProviderCard(provider) {
    const card = document.createElement('div');
    card.className = 'ai-provider-card' + (provider.is_active ? ' ai-provider-card-active' : '');
    card.dataset.providerId = provider.id;

    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'ai-provider-card-name';
    name.textContent = provider.name + (provider.is_active ? ' (active)' : '');
    info.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'ai-provider-card-meta';
    const keyLabel = provider.api_key_set ? `key ending ${provider.api_key_last4 || '????'}` : 'no key set';
    meta.textContent = `${provider.provider} / ${provider.model} -- ${keyLabel}`;
    info.appendChild(meta);
    card.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'ai-provider-actions';

    if (!provider.is_active) {
        const activateBtn = document.createElement('button');
        activateBtn.type = 'button';
        activateBtn.className = 'ai-btn-item';
        activateBtn.textContent = 'Activate';
        activateBtn.addEventListener('click', async () => {
            if (activateBtn.disabled) return;
            activateBtn.disabled = true;
            try {
                await api.post(`/api/ai/providers/${encodeURIComponent(provider.id)}/activate`, {});
                await aiRefreshProviderStatus();
            } catch {
                if (card.parentNode) alert('Failed to activate provider. Retry explicitly.');
            } finally { activateBtn.disabled = false; }
        });
        actions.appendChild(activateBtn);
    }

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'ai-btn-item';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => aiOpenProviderForm(provider));
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'ai-btn-item';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
        if (deleteBtn.disabled || !window.confirm(`Delete provider "${provider.name}"? This cannot be undone.`)) return;
        deleteBtn.disabled = true;
        try {
            await api.delete(`/api/ai/providers/${encodeURIComponent(provider.id)}`);
            await aiLoadProviders();
        } catch {
            if (card.parentNode) alert('Failed to delete provider. Retry explicitly.');
        } finally { deleteBtn.disabled = false; }
    });
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    return card;
}

function aiOpenProviderForm(provider) {
    if (aiProviderOwner && hasSettingsDrafts(['ai_provider_form_section'])
        && !window.confirm('Discard unsaved provider changes?')) return;
    aiCloseProviderForm();
    aiProviderOwner = { generation: ++aiProviderGeneration, pending: false,
        native: provider ? provider.use_native_openrouter : false };
    aiEditingProviderId = provider ? provider.id : null;
    const section = document.getElementById('ai_provider_form_section');
    const title = document.getElementById('ai_provider_form_title');
    if (title) title.textContent = provider ? `Edit provider: ${provider.name}` : 'Add Provider';
    if (section) section.classList.remove('hidden');

    document.getElementById('ai_provider_form_id').value = provider ? provider.id : '';
    document.getElementById('ai_provider_form_name').value = provider ? provider.name : '';
    document.getElementById('ai_provider_form_provider').value = provider ? provider.provider : 'anthropic';
    document.getElementById('ai_provider_form_model').value = provider ? provider.model : '';
    document.getElementById('ai_provider_form_base_url').value = provider && provider.base_url ? provider.base_url : '';
    // Deliberately NEVER pre-filled -- see file header. Blank means "keep existing key" on save.
    document.getElementById('ai_provider_form_api_key').value = '';
    document.getElementById('ai_provider_form_api_key').placeholder = provider && provider.api_key_set
        ? `leave blank to keep key ending ${provider.api_key_last4 || '????'}`
        : 'leave blank for no key (e.g. local Ollama)';
    document.getElementById('ai_provider_form_temperature').value = provider ? provider.temperature : 0;
    document.getElementById('ai_provider_form_max_tokens').value = provider ? provider.max_output_tokens : 4096;
    document.getElementById('ai_provider_form_timeout').value = provider ? provider.request_timeout_seconds : 120;
    document.getElementById('ai_provider_form_sanitization').value = provider ? provider.sanitization_level : 'standard';

    document.getElementById('ai_provider_form_key_intent').value = 'keep';
    aiUpdateKeyIntent();
    document.getElementById('ai_provider_save_btn').disabled = false;
    document.getElementById('ai_provider_test_btn').disabled = false;
    document.getElementById('ai_provider_test_result').textContent = '';
    aiRefreshModelSelectOptions();
    rememberSettingsDraft('ai_provider_form_section');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('ai_provider_form_name').focus();
}

function aiCloseProviderForm(restoreFocus = false) {
    const section = document.getElementById('ai_provider_form_section');
    if (section) section.classList.add('hidden');
    document.getElementById('ai_provider_form_api_key').value = '';
    document.getElementById('ai_provider_form_key_intent').value = 'keep';
    settingsDrafts.delete('ai_provider_form_section');
    aiProviderOwner = null;
    ++aiProbeGeneration;
    aiEditingProviderId = null;
    if (restoreFocus) document.getElementById('ai_provider_new_btn').focus();
}

function aiReadProviderFormBase() {
    return {
        name: document.getElementById('ai_provider_form_name').value.trim(),
        provider: document.getElementById('ai_provider_form_provider').value,
        model: document.getElementById('ai_provider_form_model').value.trim(),
        base_url: document.getElementById('ai_provider_form_base_url').value.trim() || null,
        temperature: parseFloat(document.getElementById('ai_provider_form_temperature').value) || 0,
        max_output_tokens: parseInt(document.getElementById('ai_provider_form_max_tokens').value, 10) || 4096,
        request_timeout_seconds: parseInt(document.getElementById('ai_provider_form_timeout').value, 10) || 120,
        sanitization_level: document.getElementById('ai_provider_form_sanitization').value,
        use_native_openrouter: aiProviderOwner?.native || false
    };
}

async function aiSaveProviderForm() {
    const owner = aiProviderOwner;
    if (!owner || owner.pending) return;
    const base = aiReadProviderFormBase();
    if (!base.name || !base.model) {
        alert('Name and model are required.');
        return;
    }
    const key = document.getElementById('ai_provider_form_api_key');
    const intent = aiKeyIntent();
    const payload = { ...base };
    if (intent === 'replace') payload.api_key = key.value;
    if (intent === 'clear') payload.api_key = '';
    // Passwords must never be retained in the shared submitted-field checkpoint.
    const markSaved = settingsDraftCheckpoint('ai_provider_form_section',
        'input:not(#ai_provider_form_api_key), select, textarea');
    const submittedKey = key.value;
    owner.pending = true;
    document.getElementById('ai_provider_save_btn').disabled = true;
    try {
        const saved = aiEditingProviderId
            ? await api.put(`/api/ai/providers/${encodeURIComponent(aiEditingProviderId)}`, payload)
            : await api.post('/api/ai/providers', payload);
        if (aiProviderOwner === owner) {
            markSaved();
            // Normalize a consumed credential intent only if it has not been edited since submission.
            if (key.value === submittedKey && aiKeyIntent() === intent) {
                key.value = '';
                document.getElementById('ai_provider_form_key_intent').value = 'keep';
                rememberSettingsDraft('ai_provider_form_section', '#ai_provider_form_key_intent');
            }
            if (saved?.id) {
                aiEditingProviderId = saved.id;
                document.getElementById('ai_provider_form_id').value = saved.id;
                rememberSettingsDraft('ai_provider_form_section', '#ai_provider_form_id');
            }
            aiUpdateKeyIntent();
            if (!hasSettingsDrafts(['ai_provider_form_section'])) aiCloseProviderForm();
        }
        await aiRefreshProviderStatus();
    } catch {
        if (aiProviderOwner === owner) alert('Failed to save provider. Your edits are retained; retry Save explicitly.');
    } finally {
        delete payload.api_key;
        owner.pending = false;
        if (aiProviderOwner === owner) document.getElementById('ai_provider_save_btn').disabled = false;
    }
}

async function aiTestProviderForm() {
    const owner = aiProviderOwner;
    if (!owner) return;
    const generation = ++aiProbeGeneration;
    const resultEl = document.getElementById('ai_provider_test_result');
    resultEl.className = 'ai-test-result';
    resultEl.textContent = 'Testing…';
    const base = aiReadProviderFormBase();
    const intent = aiKeyIntent();
    const fields = Array.from(document.getElementById('ai_provider_form_section').querySelectorAll('input, select, textarea'));
    const submitted = fields.map(settingsDraftFieldSnapshot);
    const isCurrent = () => aiProviderOwner === owner && generation === aiProbeGeneration;
    const unchanged = () => fields.every((field, index) => settingsDraftFieldSnapshot(field) === submitted[index]);
    const body = aiEditingProviderId && intent === 'keep'
        ? { config_id: aiEditingProviderId }
        : { inline_config: { ...base, api_key: intent === 'clear' ? ''
            : document.getElementById('ai_provider_form_api_key').value || null } };
    delete body.inline_config?.name;
    delete body.inline_config?.sanitization_level;
    try {
        const result = await api.post('/api/ai/providers/test', body);
        if (!isCurrent()) return;
        if (!unchanged()) { resultEl.textContent = 'Configuration changed. Test again.'; return; }
        resultEl.className = 'ai-test-result ' + (result.success ? 'ai-test-result-ok' : 'ai-test-result-fail');
        resultEl.textContent = result.success ? 'Connection OK.'
            : 'Connection failed. Check the provider, model, credentials and URL, then retry Test connection.';
    } catch {
        if (!isCurrent()) return;
        if (!unchanged()) { resultEl.textContent = 'Configuration changed. Test again.'; return; }
        resultEl.className = 'ai-test-result ai-test-result-fail';
        resultEl.textContent = 'Connection failed. Check the provider, model, credentials and URL, then retry Test connection.';
    } finally {
        if (body.inline_config) delete body.inline_config.api_key;
    }
}

function aiUpdateDataScopeWarning(providers) {
    const warning = document.getElementById('ai_data_scope_provider_warning');
    if (!warning) return;
    const active = (providers || []).find((provider) => provider.is_active);
    warning.textContent = active && active.provider !== 'ollama' && active.provider !== 'pi'
        ? 'Cloud provider active: review, habit, rating, and timer text may leave this machine when enabled.'
        : active && active.provider === 'pi'
            ? 'Pi uses its configured model runtime; review sensitive domains before enabling them.'
            : 'Sensitive domains are sent only to the active provider when enabled.';
}

let aiBehaviorReady = false;
let aiBehaviorLoading = false;
let aiBehaviorInitialFields = null;
let aiBehaviorSaving = false;
let aiBehaviorRevision = 0;

function aiCancelBehaviorSettings() {
    if (!aiBehaviorReady || aiBehaviorLoading) return;
    ++aiBehaviorRevision;
    const baseline = settingsDrafts.get('ai_behavior_settings');
    document.getElementById('ai_behavior_settings').querySelectorAll('input, select, textarea').forEach(el => {
        const snapshot = baseline?.fields.get(el.id || el);
        if (snapshot === undefined) return;
        const [value, disabled] = JSON.parse(snapshot);
        if (el.type === 'checkbox') el.checked = value;
        else el.value = value;
        if (disabled !== null) el.disabled = disabled;
    });
    document.getElementById('ai_settings_save_status').textContent = aiBehaviorSaving
        ? 'Changes discarded locally. The submitted Save is still pending.' : 'Changes discarded.';
}

async function aiLoadBehaviorSettings() {
    if (aiBehaviorLoading) return;
    const root = document.getElementById('ai_behavior_settings');
    const fields = Array.from(root.querySelectorAll('input, select, textarea'));
    const valueOf = el => el.type === 'checkbox' ? el.checked : el.value;
    if (!aiBehaviorInitialFields) {
        aiBehaviorInitialFields = new Map(fields.map(el => [el.id, valueOf(el)]));
        rememberSettingsDraft('ai_behavior_settings');
    }
    aiBehaviorLoading = true;
    const readBaselines = new Map(fields.map(el => [el.id, settingsDrafts.get('ai_behavior_settings')?.fields.get(el.id)]));
    const status = document.getElementById('ai_settings_save_status');
    if (status) status.textContent = 'Loading behavior settings…';
    try {
        const s = await api.get('/api/ai/settings');
        const newerBaselines = fields.map(el => [el.id, settingsDrafts.get('ai_behavior_settings')?.fields.get(el.id)])
            .filter(([id, baseline]) => baseline !== readBaselines.get(id));
        const drafts = fields.filter(el => aiBehaviorReady
            ? hasSettingsDrafts(['ai_behavior_settings'], `#${el.id}`)
            : valueOf(el) !== aiBehaviorInitialFields.get(el.id)).map(el => [el, valueOf(el)]);
        newerBaselines.forEach(([id]) => {
            const el = document.getElementById(id);
            if (!drafts.some(([field]) => field === el)) drafts.push([el, valueOf(el)]);
        });
        document.getElementById('ai_setting_quickadd_fallback').checked = Boolean(s.quickadd_fallback_enabled);
        document.getElementById('ai_setting_redact_before_send').checked = Boolean(s.redact_before_send);
        document.getElementById('ai_setting_preview_on_calendar').checked = Boolean(s.preview_on_calendar);
        const scope = s.data_scope || {};
        ['tasks', 'sessions', 'habits', 'reviews', 'ratings', 'timer'].forEach((domain) => {
            const checkbox = document.getElementById(`ai_scope_${domain}`);
            if (checkbox) checkbox.checked = Boolean(scope[domain]);
        });
        document.getElementById('ai_setting_scheduling_window_days').value = s.scheduling_window_days;
        document.getElementById('ai_setting_batch_undo_retention_days').value = s.batch_undo_retention_days;
        document.getElementById('ai_setting_scheduling_day_start').value = s.scheduling_day_start || '09:00';
        document.getElementById('ai_setting_scheduling_day_end').value = s.scheduling_day_end || '17:00';
        document.getElementById('ai_setting_minimum_break_minutes').value = s.minimum_break_minutes ?? 0;
        document.getElementById('ai_setting_maximum_daily_minutes').value = s.maximum_daily_minutes ?? '';
        document.getElementById('ai_setting_scheduling_days').value = (s.scheduling_days || []).join(', ');
        document.getElementById('ai_setting_preferred_tags').value = (s.preferred_tags || []).join(', ');
        document.getElementById('ai_setting_custom_instructions').value = s.custom_instructions || '';
        rememberSettingsDraft('ai_behavior_settings');
        newerBaselines.forEach(([id, baseline]) => settingsDrafts.get('ai_behavior_settings').fields.set(id, baseline));
        drafts.forEach(([el, value]) => { if (el.type === 'checkbox') el.checked = value; else el.value = value; });
        aiBehaviorReady = true;
        if (status) status.textContent = '';
    } catch (err) {
        if (status) {
            status.textContent = 'Could not load behavior settings. Your edits are retained. ';
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.textContent = 'Retry load';
            retry.addEventListener('click', aiLoadBehaviorSettings);
            status.appendChild(retry);
        }

    } finally {
        aiBehaviorLoading = false;
    }
}

async function aiSaveBehaviorSettings() {
    if (aiBehaviorSaving) return;
    if (!aiBehaviorReady || aiBehaviorLoading) {
        if (!aiBehaviorLoading) await aiLoadBehaviorSettings();
        return;
    }
    const statusEl = document.getElementById('ai_settings_save_status');
    const payload = {
        quickadd_fallback_enabled: document.getElementById('ai_setting_quickadd_fallback').checked,
        redact_before_send: document.getElementById('ai_setting_redact_before_send').checked,
        preview_on_calendar: document.getElementById('ai_setting_preview_on_calendar').checked,
        data_scope: {
            tasks: document.getElementById('ai_scope_tasks').checked,
            sessions: document.getElementById('ai_scope_sessions').checked,
            habits: document.getElementById('ai_scope_habits').checked,
            reviews: document.getElementById('ai_scope_reviews').checked,
            ratings: document.getElementById('ai_scope_ratings').checked,
            timer: document.getElementById('ai_scope_timer').checked
        },
        scheduling_window_days: parseInt(document.getElementById('ai_setting_scheduling_window_days').value, 10),
        batch_undo_retention_days: parseInt(document.getElementById('ai_setting_batch_undo_retention_days').value, 10),
        scheduling_day_start: document.getElementById('ai_setting_scheduling_day_start').value,
        scheduling_day_end: document.getElementById('ai_setting_scheduling_day_end').value,
        minimum_break_minutes: parseInt(document.getElementById('ai_setting_minimum_break_minutes').value, 10),
        maximum_daily_minutes: document.getElementById('ai_setting_maximum_daily_minutes').value
            ? parseInt(document.getElementById('ai_setting_maximum_daily_minutes').value, 10)
            : null,
        scheduling_days: document.getElementById('ai_setting_scheduling_days').value
            .split(',').map(value => value.trim().toLowerCase()).filter(Boolean),
        preferred_tags: document.getElementById('ai_setting_preferred_tags').value
            .split(',').map(value => value.trim().toLowerCase()).filter(Boolean),
        custom_instructions: document.getElementById('ai_setting_custom_instructions').value
    };
    const submittedFields = Array.from(document.getElementById('ai_behavior_settings')
        .querySelectorAll('input, select, textarea')).map(el => ({
            id: el.id,
            baseline: settingsDrafts.get('ai_behavior_settings')?.fields.get(el.id),
            checkpoint: settingsDraftCheckpoint('ai_behavior_settings', `#${el.id}`)
        }));
    const revision = aiBehaviorRevision;
    aiBehaviorSaving = true;
    document.getElementById('ai_settings_save_btn').disabled = true;
    try {
        await api.put('/api/ai/settings', payload);
        submittedFields.forEach(field => {
            // Assistant acceptance/conflict reconciliation may have supplied a newer baseline.
            if (settingsDrafts.get('ai_behavior_settings')?.fields.get(field.id) === field.baseline) field.checkpoint();
        });
        if (statusEl && revision === aiBehaviorRevision) {
            statusEl.className = 'ai-test-result ai-test-result-ok';
            statusEl.textContent = 'Saved.';
        }
    } catch (err) {
        if (statusEl && revision === aiBehaviorRevision) {
            statusEl.className = 'ai-test-result ai-test-result-fail';
            statusEl.textContent = 'Failed to save: your edits are retained; retry Save explicitly.';
        }
    } finally {
        aiBehaviorSaving = false;
        document.getElementById('ai_settings_save_btn').disabled = false;
        if (statusEl && revision !== aiBehaviorRevision) statusEl.textContent =
            'Pending Save finished. Cancel restores the latest acknowledged settings.';
    }
}
