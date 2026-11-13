/* Author-only Ticket20 native probe. Parent must review the route guard before executing.
 * Real private settings/provider CRUD; static catalog and Test/Activate HTTP are declared fakes.
 * Fake Activate proves UI dispatch only. ASGI fake-SDK tests prove actual activation/probe services.
 * Existing appearance/navigation probes remain separate compatibility checks.
 */
async (page, baseURL) => {
    const origin = new URL(baseURL);
    if (origin.hostname !== '127.0.0.1' || !origin.port || origin.port === '8002') {
        throw Error('Requires an explicitly isolated loopback daemon');
    }
    const context = await page.context().browser().newContext();
    const checks = [], writes = [], denied = [], pageErrors = [];
    let createdId = null, rejectSave = false, rejectList = false, primaryError = null;
    try {
        const p = await context.newPage();
        const check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
        const fakeKey = 'NONFUNCTIONAL-native-ticket20-1234';
        p.on('pageerror', () => pageErrors.push('pageerror'));
        p.on('dialog', dialog => dialog.accept());
        await context.addInitScript(({ expectedOrigin }) => {
            if (location.origin === expectedOrigin) {
                localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false }));
            }
        }, { expectedOrigin: origin.origin });
        // Install the deny-by-default browser guard before navigation or any provider action.
        await context.route('**/*', async route => {
            const request = route.request(), url = new URL(request.url()), method = request.method();
            const path = url.pathname;
            if (url.origin !== origin.origin) {
                // Preserve real utility CSS semantics. Only the template's exact Tailwind
                // asset delegates to the mandatory parent guard; never bypass that guard.
                if (url.href === 'https://cdn.tailwindcss.com/' && method === 'GET') {
                    return route.fallback();
                }
                denied.push('external request'); return route.abort();
            }
            if (path === '/api/ai/providers/test' && method === 'POST') {
                const body = request.postDataJSON();
                writes.push({ action: 'fake Test', saved: Boolean(body.config_id),
                    inlineClear: body.inline_config?.api_key === '', inlineTyped: body.inline_config?.api_key === fakeKey });
                return route.fulfill({ json: { success: true, error: null } });
            }
            if (/^\/api\/ai\/providers\/[^/]+\/activate$/.test(path) && method === 'POST') {
                writes.push({ action: 'fake Activate' });
                return route.fulfill({ json: { id: createdId, is_active: true } });
            }
            if (path === '/api/ai/providers/catalog' && method === 'GET') {
                return route.fulfill({ json: { openai: [{ id: 'synthetic/catalog', label: 'Synthetic catalog' }] } });
            }
            if (path === '/api/ai/providers' && method === 'GET' && rejectList) {
                rejectList = false;
                return route.fulfill({ status: 503, json: { detail: 'Synthetic list failure' } });
            }
            const configPath = /^\/api\/ai\/providers\/[^/]+$/.test(path);
            if (configPath && method === 'PUT' && rejectSave) {
                rejectSave = false;
                return route.fulfill({ status: 503, json: { detail: 'Synthetic rejected write' } });
            }
            if ((path === '/api/ai/providers' && method === 'POST') ||
                (configPath && ['PUT', 'DELETE'].includes(method)) ||
                (path === '/api/ai/settings' && method === 'PUT')) {
                writes.push({ action: method, path });
                return route.continue();
            }
            const allowedRead = method === 'GET' && (
                ['/settings', '/settings/ai', '/api/ai/settings', '/api/ai/providers', '/api/ai/status',
                    '/timer/status', '/sessions', '/health', '/favicon.ico'].includes(path)
                || path.startsWith('/static/')
            );
            if (allowedRead) return route.continue();
            denied.push(method + ' ' + path); return route.abort();
        });
        const getProviders = async () => {
            const response = await context.request.get(baseURL + '/api/ai/providers');
            check(response.status() === 200, 'private provider read succeeds');
            return response.json();
        };
        const healthResponse = await context.request.get(baseURL + '/health');
        const health = await healthResponse.json();
        check(healthResponse.status() === 200 && JSON.stringify(health).includes(origin.port)
            && JSON.stringify(health).includes('/tmp/'), 'health confirms isolated temporary daemon');
        const originalResponse = await context.request.get(baseURL + '/api/ai/settings');
        check(originalResponse.status() === 200, 'private original settings read succeeds');
        const originalSettings = await originalResponse.json();
        const card = () => p.locator(`[data-provider-id="${createdId}"]`);
        const edit = () => card().getByRole('button', { name: 'Edit', exact: true }).click();
        const testConnection = async () => {
            const response = p.waitForResponse(response => response.url() === baseURL + '/api/ai/providers/test'
                && response.request().method() === 'POST');
            await p.locator('#ai_provider_test_btn').click(); await response;
            await p.getByText('Connection OK.', { exact: true }).waitFor();
        };
        const save = async () => {
            const ack = p.waitForResponse(response => response.url().includes('/api/ai/providers') &&
                ['POST', 'PUT'].includes(response.request().method()));
            await p.locator('#ai_provider_save_btn').click();
            const response = await ack;
            check(response.status() < 300, 'real provider write acknowledged');
            return response.json();
        };
        await p.goto(baseURL + '/settings/ai');
        await p.waitForFunction(() => aiBehaviorReady && browserSettingsBaseline !== null);
        await p.locator('#ai_setting_preferred_tags').fill('synthetic-retained-draft');
        await p.locator('[data-category="browser"]').click();
        await p.locator('#setting_auto_scroll').uncheck();
        await p.locator('[data-category="providers"]').click();
        await p.locator('#ai_provider_new_btn').click();
        await p.locator('#ai_provider_form_name').fill('Synthetic <inert> Ticket20 provider');
        await p.locator('#ai_provider_form_provider').selectOption('openai');
        await p.locator('#ai_provider_form_model').fill('EXACT/synthetic-model');
        await p.locator('#ai_provider_form_api_key').fill(fakeKey);
        const created = await save(); createdId = created.id;
        await p.waitForFunction(() => document.getElementById('ai_provider_form_section').classList.contains('hidden'));
        let rows = await getProviders();
        check(rows.find(row => row.id === createdId)?.model === 'EXACT/synthetic-model', 'real create persists exact custom model');
        check(rows.find(row => row.id === createdId)?.api_key_set === true, 'real create persists synthetic credential');
        check(await p.evaluate(() => hasSettingsDrafts(['settings_modal']) && hasSettingsDrafts(['ai_behavior_settings'])),
            'provider ACK retains Browser and behavior drafts');
        await edit();
        check(await p.locator('#ai_provider_form_api_key').inputValue() === '', 'edit leaves password blank');
        await testConnection();
        check(writes.at(-1).saved === true, 'fake Test receives saved config ID when keeping key');
        await p.locator('#ai_provider_clear_key_btn').click();
        check(await p.evaluate(() => hasSettingsDrafts(['ai_provider_form_section'])), 'Clear alone is dirty');
        await testConnection();
        check(writes.at(-1).inlineClear === true, 'fake Clear Test receives inline empty key');
        await p.locator('#ai_provider_cancel_btn').click(); await edit();
        check(await p.evaluate(() => !hasSettingsDrafts(['ai_provider_form_section'])), 'Clear Cancel reopens clean');
        await p.locator('#ai_provider_form_api_key').fill(fakeKey);
        rejectSave = true;
        const rejected = p.waitForResponse(response => response.request().method() === 'PUT' && response.status() === 503);
        await p.locator('#ai_provider_save_btn').click(); await rejected;
        check(await p.locator('#ai_provider_form_api_key').inputValue() === fakeKey, 'failed Save retains replacement draft');
        await save();
        await p.waitForFunction(() => document.getElementById('ai_provider_form_section').classList.contains('hidden'));
        check(await p.locator('#ai_provider_form_api_key').inputValue() === '', 'clean ACK disposes password');
        await edit(); await p.locator('#ai_provider_clear_key_btn').click();
        rejectList = true; await save();
        await p.getByRole('button', { name: 'Retry refresh', exact: true }).waitFor();
        const beforeRetry = writes.length;
        await p.getByRole('button', { name: 'Retry refresh', exact: true }).click();
        await card().waitFor(); check(writes.length === beforeRetry, 'post-ACK Retry performs no mutation');
        rows = await getProviders();
        check(rows.find(row => row.id === createdId)?.api_key_set === false, 'real Clear persists cleared credential');
        const activated = p.waitForResponse(response => response.url().endsWith('/activate')
            && response.request().method() === 'POST');
        await card().getByRole('button', { name: 'Activate', exact: true }).click(); await activated;
        check(writes.at(-1).action === 'fake Activate', 'fake Activate receives deliberate action');
        rows = await getProviders();
        check(rows.find(row => row.id === createdId)?.is_active === false, 'fake Activate does not claim actual DB activation');
        await p.locator('[data-category="ai"]').click();
        await p.locator('#ai_settings_cancel_btn').click();
        check(await p.locator('#ai_setting_preferred_tags').inputValue() === originalSettings.preferred_tags.join(', '),
            'behavior own Cancel restores saved settings');
        check(await p.evaluate(() => hasSettingsDrafts(['settings_modal'])), 'behavior Cancel retains Browser draft');
        await p.locator('[data-category="providers"]').click();
        const deleted = p.waitForResponse(response => response.request().method() === 'DELETE');
        await card().getByRole('button', { name: 'Delete', exact: true }).click();
        const deletion = await deleted;
        check(deletion.status() === 204, 'real confirmed Delete returns 204');
        // The parent guard captures original APIResponse bytes and asserts an empty 204 body.
        // Do not ask CDP for a duplicate body: it may be unavailable after fulfillment.
        rows = await getProviders(); check(!rows.some(row => row.id === createdId), 'real Delete persisted');
        createdId = null;
        check(denied.length === 0, 'no unexpected browser requests');
        check(pageErrors.length === 0, 'no browser page errors');
        return { checks, writes, deniedCount: denied.length, pageErrorCount: pageErrors.length,
            fakes: ['static catalog', 'Test HTTP success', 'Activate HTTP success', 'one rejected provider PUT', 'one post-ACK list read'],
            limits: ['author-only until parent execution', 'fake Activate is UI dispatch only', 'race/layout/navigation suites remain separate'] };
    } catch (error) {
        primaryError = error;
        throw error;
    } finally {
        const cleanupErrors = [];
        try {
            if (createdId) {
                const response = await context.request.get(baseURL + '/api/ai/providers');
                if (response.status() !== 200) throw Error('Cleanup provider read failed');
                const rows = await response.json();
                if (rows.some(row => row.id === createdId)) {
                    const deletion = await context.request.delete(baseURL + '/api/ai/providers/'
                        + encodeURIComponent(createdId));
                    if (deletion.status() !== 204) throw Error('Cleanup provider Delete failed');
                }
            }
        } catch (error) {
            cleanupErrors.push(error);
        }
        // This workflow never submits behavior; no settings restoration write is needed.
        try {
            await context.close();
        } catch (error) {
            cleanupErrors.push(error);
        }
        if (cleanupErrors.length) {
            throw new AggregateError(primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors,
                'Native probe cleanup failed; original errors retained', { cause: primaryError });
        }
    }
};
