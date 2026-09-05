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

function aiSetupSettingsPage() {
    aiLoadProviders();
    aiLoadCatalog();
    aiLoadBehaviorSettings();

    const newBtn = document.getElementById('ai_provider_new_btn');
    if (newBtn) newBtn.addEventListener('click', () => aiOpenProviderForm(null));

    const cancelBtn = document.getElementById('ai_provider_cancel_btn');
    if (cancelBtn) cancelBtn.addEventListener('click', aiCloseProviderForm);

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

    const settingsSaveBtn = document.getElementById('ai_settings_save_btn');
    if (settingsSaveBtn) settingsSaveBtn.addEventListener('click', aiSaveBehaviorSettings);
}

document.addEventListener('DOMContentLoaded', aiSetupSettingsPage);

async function aiLoadCatalog() {
    try {
        aiCatalogCache = await api.get('/api/ai/providers/catalog');
        aiRefreshModelSelectOptions();
    } catch (err) {
        console.error('Failed to load AI provider catalog:', err);
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
    if (keyLabel) keyLabel.textContent = info && !info.keyRequired ? 'API Key (not needed for Ollama)' : 'API Key';
}

async function aiLoadProviders() {
    const list = document.getElementById('ai_providers_list');
    if (!list) return;
    list.textContent = '';
    try {
        const providers = await api.get('/api/ai/providers');
        if (providers.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ai-settings-hint';
            empty.textContent = 'No providers configured yet -- click "+ Add Provider" below to get started. '
                + 'Google AI Studio has a free tier; a local Ollama server needs no API key at all.';
            list.appendChild(empty);
            return;
        }
        providers.forEach((p) => list.appendChild(aiBuildProviderCard(p)));
    } catch (err) {
        console.error('Failed to load AI providers:', err);
        const errNode = document.createElement('div');
        errNode.className = 'ai-test-result ai-test-result-fail';
        errNode.textContent = 'Failed to load providers: ' + (err.message || err);
        list.appendChild(errNode);
    }
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
    actions.className = 'flex gap-1.5';

    if (!provider.is_active) {
        const activateBtn = document.createElement('button');
        activateBtn.type = 'button';
        activateBtn.className = 'ai-btn-item';
        activateBtn.textContent = 'Activate';
        activateBtn.addEventListener('click', async () => {
            try {
                await api.post(`/api/ai/providers/${encodeURIComponent(provider.id)}/activate`, {});
                aiLoadProviders();
                if (typeof refreshAiStatusBadge === 'function') refreshAiStatusBadge();
            } catch (err) {
                alert('Failed to activate provider: ' + (err.message || err));
            }
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
        if (!window.confirm(`Delete provider "${provider.name}"? This cannot be undone.`)) return;
        try {
            await api.delete(`/api/ai/providers/${encodeURIComponent(provider.id)}`);
            aiLoadProviders();
        } catch (err) {
            alert('Failed to delete provider: ' + (err.message || err));
        }
    });
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    return card;
}

function aiOpenProviderForm(provider) {
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

    document.getElementById('ai_provider_test_result').textContent = '';
    aiRefreshModelSelectOptions();
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function aiCloseProviderForm() {
    const section = document.getElementById('ai_provider_form_section');
    if (section) section.classList.add('hidden');
    aiEditingProviderId = null;
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
        use_native_openrouter: false
    };
}

async function aiSaveProviderForm() {
    const base = aiReadProviderFormBase();
    if (!base.name || !base.model) {
        alert('Name and model are required.');
        return;
    }
    const apiKeyTyped = document.getElementById('ai_provider_form_api_key').value;

    try {
        if (aiEditingProviderId) {
            const payload = { ...base };
            // Omit api_key entirely unless the user typed something -- an empty field must NOT
            // clear the stored key (spec S7/S9.4's exact "don't wipe the key" bug this guards
            // against). A dedicated "clear key" affordance isn't wired up in this first cut;
            // deleting and re-creating the provider is the current workaround.
            if (apiKeyTyped) payload.api_key = apiKeyTyped;
            await api.put(`/api/ai/providers/${encodeURIComponent(aiEditingProviderId)}`, payload);
        } else {
            const payload = { ...base };
            if (apiKeyTyped) payload.api_key = apiKeyTyped;
            await api.post('/api/ai/providers', payload);
        }
        aiCloseProviderForm();
        aiLoadProviders();
        if (typeof refreshAiStatusBadge === 'function') refreshAiStatusBadge();
    } catch (err) {
        alert('Failed to save provider: ' + (err.message || err));
    }
}

async function aiTestProviderForm() {
    const resultEl = document.getElementById('ai_provider_test_result');
    if (resultEl) {
        resultEl.className = 'ai-test-result';
        resultEl.textContent = 'Testing...';
    }
    const base = aiReadProviderFormBase();
    const apiKeyTyped = document.getElementById('ai_provider_form_api_key').value;

    try {
        let body;
        if (aiEditingProviderId && !apiKeyTyped) {
            // No new key typed while editing a saved provider -- test the saved config as-is
            // (the stored key), since an inline_config here has no key to send.
            body = { config_id: aiEditingProviderId };
        } else {
            body = {
                inline_config: {
                    provider: base.provider,
                    model: base.model,
                    base_url: base.base_url,
                    api_key: apiKeyTyped || null,
                    temperature: base.temperature,
                    max_output_tokens: base.max_output_tokens,
                    request_timeout_seconds: base.request_timeout_seconds,
                    use_native_openrouter: false
                }
            };
        }
        const result = await api.post('/api/ai/providers/test', body);
        if (resultEl) {
            if (result.success) {
                resultEl.className = 'ai-test-result ai-test-result-ok';
                resultEl.textContent = 'Connection OK.';
            } else {
                resultEl.className = 'ai-test-result ai-test-result-fail';
                resultEl.textContent = 'Failed: ' + (result.error || 'unknown error');
            }
        }
    } catch (err) {
        if (resultEl) {
            resultEl.className = 'ai-test-result ai-test-result-fail';
            resultEl.textContent = 'Failed: ' + (err.message || err);
        }
    }
}

async function aiLoadBehaviorSettings() {
    try {
        const s = await api.get('/api/ai/settings');
        document.getElementById('ai_setting_quickadd_fallback').checked = Boolean(s.quickadd_fallback_enabled);
        document.getElementById('ai_setting_redact_before_send').checked = Boolean(s.redact_before_send);
        document.getElementById('ai_setting_preview_on_calendar').checked = Boolean(s.preview_on_calendar);
        document.getElementById('ai_setting_scheduling_window_days').value = s.scheduling_window_days;
        document.getElementById('ai_setting_batch_undo_retention_days').value = s.batch_undo_retention_days;
    } catch (err) {
        console.error('Failed to load AI behavior settings:', err);
    }
}

async function aiSaveBehaviorSettings() {
    const statusEl = document.getElementById('ai_settings_save_status');
    const payload = {
        quickadd_fallback_enabled: document.getElementById('ai_setting_quickadd_fallback').checked,
        redact_before_send: document.getElementById('ai_setting_redact_before_send').checked,
        preview_on_calendar: document.getElementById('ai_setting_preview_on_calendar').checked,
        scheduling_window_days: parseInt(document.getElementById('ai_setting_scheduling_window_days').value, 10),
        batch_undo_retention_days: parseInt(document.getElementById('ai_setting_batch_undo_retention_days').value, 10)
    };
    try {
        await api.put('/api/ai/settings', payload);
        if (statusEl) {
            statusEl.className = 'ai-test-result ai-test-result-ok';
            statusEl.textContent = 'Saved.';
        }
    } catch (err) {
        if (statusEl) {
            statusEl.className = 'ai-test-result ai-test-result-fail';
            statusEl.textContent = 'Failed to save: ' + (err.message || err);
        }
    }
}
