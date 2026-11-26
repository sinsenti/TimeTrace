// Ticket20 VM callers, not a browser/DOM-engine certificate. Only HTTP is faked;
// production handlers, shared client, draft helpers and source markup execute unchanged.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const apiRoot = path.resolve(__dirname, '../src/timetrace/interfaces/api');
const tick = () => new Promise(resolve => setImmediate(resolve)); // drain promise continuations, not a timing delay
function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

// Bounded markup fixture for this page only. Values coerce to strings; select
// selectedness, checkbox checkedness, descendant queries and click listeners are
// represented rather than treating every form control as a text-input dictionary.
function element(tag = 'div') {
    let text = '', value = '', classes = new Set();
    const listeners = new Map();
    const el = {
        tagName: tag.toUpperCase(), id: '', type: tag === 'input' ? 'text' : '',
        checked: false, disabled: false, selected: false, children: [], dataset: {}, style: {}, parentNode: null,
        appendChild(child) {
            child.parentNode = this;
            const hadSelection = this.tagName === 'SELECT' && this.options.some(o => o.selected);
            this.children.push(child);
            if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
                if (!hadSelection) child.selected = true;
                if (child.selected) this.options.forEach(o => { if (o !== child) o.selected = false; });
            }
            return child;
        },
        querySelectorAll(selector) {
            const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
            return descendants.filter(child => selector.split(',').some(part => {
                const s = part.trim();
                if (s === '*') return true;
                const not = s.match(/^(.+):not\(#([\w-]+)\)$/);
                if (not) return child.id !== not[2] && child.tagName.toLowerCase() === not[1];
                return s.startsWith('#') ? child.id === s.slice(1) : child.tagName.toLowerCase() === s;
            }));
        },
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
        addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
        async click() {
            if (this.disabled) return;
            if (this.type === 'checkbox') this.checked = !this.checked;
            await Promise.all((listeners.get('click') || []).map(fn => fn({ target: this, button: 0 })));
        },
        async change() { await Promise.all((listeners.get('change') || []).map(fn => fn({ target: this }))); },
        scrollIntoView() {}, focus() {}, setAttribute(name, v) { this[name] = String(v); },
        replaceWith(other) {
            if (!this.parentNode) return;
            const siblings = this.parentNode.children;
            siblings.splice(siblings.indexOf(this), 1, other);
            other.parentNode = this.parentNode;
        },
        classList: {
            add: (...xs) => xs.forEach(x => classes.add(x)),
            remove: (...xs) => xs.forEach(x => classes.delete(x)),
            contains: x => classes.has(x),
        },
    };
    Object.defineProperties(el, {
        className: { get: () => [...classes].join(' '), set: v => { classes = new Set(String(v).split(/\s+/).filter(Boolean)); } },
        textContent: { get: () => text + el.children.map(c => c.textContent).join(''), set: v => { text = String(v); el.children.length = 0; } },
        options: { get: () => el.querySelectorAll('option') },
        value: {
            get: () => tag === 'select' ? (el.options.find(o => o.selected)?.value || '') : value,
            set: v => {
                if (tag === 'select') el.options.forEach(o => { o.selected = o.value === String(v); });
                else value = String(v);
            },
        },
    });
    return el;
}
function pageMarkup() {
    const template = fs.readFileSync(path.join(apiRoot, 'templates/ai_settings.html'), 'utf8');
    const html = template.match(/<main\b[^]*?<\/main>/)[0].replace(
        '{% include "components/browser_preferences.html" %}',
        fs.readFileSync(path.join(apiRoot, 'templates/components/browser_preferences.html'), 'utf8'),
    );
    const root = element('body'), stack = [root];
    const voidTags = new Set(['input', 'br', 'hr', 'meta', 'link']);
    for (const [token] of html.matchAll(/<!--[^]*?-->|<\/?[a-z][^>]*>|[^<]+/gi)) {
        if (token.startsWith('<!--')) continue;
        if (!token.startsWith('<')) { stack.at(-1).appendChild(Object.assign(element('text'), { textContent: token })); continue; }
        if (token.startsWith('</')) { stack.pop(); continue; }
        const tag = token.match(/^<(\w+)/)[1].toLowerCase(), el = element(tag);
        for (const [, name, v] of token.matchAll(/([\w-]+)="([^"]*)"/g)) {
            if (name === 'class') el.className = v;
            else if (name.startsWith('data-')) el.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
            else el[name] = v;
        }
        if (/\schecked(?:\s|>)/.test(token)) el.checked = true;
        if (/\sselected(?:\s|>)/.test(token)) el.selected = true;
        stack.at(-1).appendChild(el);
        if (!voidTags.has(tag)) stack.push(el);
    }
    return root;
}
const settings = {
    quickadd_fallback_enabled: true, redact_before_send: true, preview_on_calendar: true,
    data_scope: { tasks: true, sessions: true, habits: false, reviews: false, ratings: false, timer: false },
    scheduling_window_days: 14, batch_undo_retention_days: 30, scheduling_day_start: '09:00', scheduling_day_end: '17:00',
    minimum_break_minutes: 15, maximum_daily_minutes: null, scheduling_days: ['monday'], preferred_tags: ['saved'],
    custom_instructions: 'Saved instructions',
};
const provider = {
    id: '01900000-0000-7000-8000-000000000001', name: 'Synthetic A', provider: 'openrouter', model: 'custom/exact-model',
    base_url: null, api_key_set: true, api_key_last4: '0123', temperature: 0.2, max_output_tokens: 2048,
    request_timeout_seconds: 90, sanitization_level: 'standard', use_native_openrouter: true,
    extra_params: { top_p: 0.7, custom_option: 'preserve' }, is_active: false,
};
async function page(respond = () => null) {
    const root = pageMarkup(), writes = [], reads = [], alerts = [], logs = [];
    const get = id => root.querySelector(`#${id}`);
    const context = vm.createContext({
        URL, Intl, Event, console: { error: (...args) => logs.push(args.map(String).join(' ')) },
        localStorage: { getItem: () => null, setItem() {} },
        document: {
            body: root, documentElement: element('html'), getElementById: get,
            querySelectorAll: s => root.querySelectorAll(s), querySelector: s => root.querySelector(s),
            createElement: element, createTextNode: s => Object.assign(element('text'), { textContent: s }), addEventListener() {},
        },
        window: { location: { href: 'http://unit.invalid/settings/ai', origin: 'http://unit.invalid' }, addEventListener() {}, confirm: () => false },
        alert: message => alerts.push(String(message)),
        fetch: async (url, options) => {
            const method = options.method || 'GET';
            const request = { url, method, body: options.body ? JSON.parse(options.body) : null };
            (method === 'GET' ? reads : writes).push(request);
            let result = await respond(request);
            if (!result) {
                assert.equal(method, 'GET', `Unexpected unfaked mutation ${method} ${url}`);
                if (url === '/api/ai/settings') result = { json: settings };
                else if (url === '/api/ai/providers') result = { json: [provider] };
                else if (url === '/api/ai/status') result = { json: { pending_draft_count: 0, undoable_batch_count: 0 } };
                else if (url === '/api/ai/providers/catalog') result = { json: { openrouter: [{ id: 'known/model', label: 'Known' }] } };
                else throw new Error(`Unexpected fixture GET ${url}`);
            }
            return { ok: (result.status || 200) < 400, status: result.status || 200,
                headers: { get: () => 'application/json' }, json: async () => result.json };
        },
    });
    context.window.appDialogs = {confirm:async ({message})=>context.window.confirm(message), alert:({message})=>context.alert(message), prompt:async()=>null};
    const run = code => vm.runInContext(code, context);
    for (const name of ['api_client.js', 'settings.js', 'ai_assistant.js', 'ai_settings_page.js']) {
        run(fs.readFileSync(path.join(apiRoot, 'static/js', name), 'utf8'), { filename: name });
    }
    run('aiSetupSettingsPage()');
    await tick();
    return {
        root, get, run, context, writes, reads, alerts, logs,
        async edit() {
            const card = get('ai_providers_list').children.find(c => c.dataset.providerId === provider.id);
            assert.ok(card, 'fixture/public provider list loaded');
            await card.querySelectorAll('button').find(b => b.textContent === 'Edit').click();
        },
        dirty: id => run(`hasSettingsDrafts([${JSON.stringify(id)}])`),
    };
}
function requiredButton(root, label, requirement) {
    const button = root.querySelectorAll('button').find(b => label.test(b.textContent));
    assert.ok(button, requirement); // Missing required product control, not an invented selector/function.
    return button;
}

test('fixture control: source markup, checkbox/select semantics and public provider open initialize faithfully', async () => {
    const b = await page();
    assert.equal(b.get('ai_scope_tasks').type, 'checkbox');
    assert.equal(b.get('ai_scope_tasks').checked, true);
    assert.equal(b.get('ai_scope_habits').checked, false);
    assert.equal(b.get('ai_provider_form_provider').value, 'anthropic');
    assert.equal(b.get('ai_provider_form_api_key').type, 'password');
    await b.edit();
    assert.equal(b.get('ai_provider_form_provider').value, 'openrouter');
    assert.equal(b.get('ai_provider_form_sanitization').value, 'standard');
    assert.equal(b.get('ai_provider_form_model_select').value, '');
    assert.equal(b.get('ai_provider_form_model').value, 'custom/exact-model');
    assert.equal(b.get('ai_provider_form_api_key').value, '');
    assert.equal(b.dirty('ai_provider_form_section'), false);
    assert.equal(b.dirty('ai_behavior_settings'), false);
    assert.equal(b.writes.length, 0);
});

for (const typed of ['', 'NONFUNCTIONAL-ticket20-replacement-4567']) {
    test(`provider credential ${typed ? 'replacement' : 'blank keep'} uses the actual Save HTTP payload`, async () => {
        const b = await page(req => req.method === 'PUT' ? { json: provider } : null);
        await b.edit();
        b.get('ai_provider_form_api_key').value = typed;
        await b.get('ai_provider_save_btn').click();
        assert.equal(b.writes.length, 1);
        assert.equal(b.writes[0].method, 'PUT');
        if (typed) assert.equal(b.writes[0].body.api_key, typed);
        else assert.equal(Object.hasOwn(b.writes[0].body, 'api_key'), false);
        assert.notEqual(b.writes[0].body.api_key, '0123');
    });
}

for (const outcome of ['concurrent', 'reverted', 'failure']) {
    test(`behavior submitted-field ACK control: ${outcome} stays independently dirty`, async () => {
        const held = deferred();
        const b = await page(req => req.method === 'PUT' ? held.promise : null);
        b.run('openSettingsModal()');
        b.get('setting_auto_scroll').checked = false;
        await b.edit(); b.get('ai_provider_form_name').value = 'Provider draft';
        b.get('ai_setting_custom_instructions').value = 'Submitted B';
        const saving = b.get('ai_settings_save_btn').click();
        assert.equal(b.writes.length, 1);
        assert.equal(b.writes[0].body.custom_instructions, 'Submitted B');
        b.get('ai_setting_custom_instructions').value = outcome === 'reverted' ? 'Saved instructions' : 'Concurrent C';
        held.resolve(outcome === 'failure' ? { status: 503, json: { detail: 'Synthetic rejected PUT' } } : { json: settings });
        await saving;
        assert.equal(b.dirty('ai_behavior_settings'), true);
        assert.equal(b.dirty('ai_provider_form_section'), true);
        assert.equal(b.dirty('settings_modal'), true);
        assert.equal(b.writes.length, 1);
        assert.match(b.get('ai_settings_save_status').textContent, outcome === 'failure' ? /Failed/ : /Saved/);
    });
}

test('unknown behavior baseline control: failed initial GET and Save cannot PUT or erase typing', async () => {
    const b = await page(req => req.url === '/api/ai/settings' ? { status: 503, json: { detail: 'Synthetic unavailable GET' } } : null);
    b.get('ai_setting_custom_instructions').value = 'Typed before known baseline';
    await b.get('ai_settings_save_btn').click();
    assert.equal(b.writes.length, 0);
    assert.equal(b.get('ai_setting_custom_instructions').value, 'Typed before known baseline');
    assert.equal(b.dirty('ai_behavior_settings'), true);
    assert.match(b.get('ai_settings_save_status').textContent, /Retry load/);
});

for (const baseline of ['loaded', 'accepted', 'conflict']) {
    test(`behavior Cancel restores only its latest ${baseline} baseline without reload, defaults or persistence`, async () => {
        const latest = 'New authoritative instructions';
        let settingsReads = 0;
        const b = await page(req => {
            if (req.url.endsWith('/accept')) return baseline === 'conflict'
                ? { status: 409, json: { detail: 'Settings changed; conflict' } }
                : { json: { settings: { ...settings, custom_instructions: latest }, proposal: { id: 'proposal', status: 'accepted' } } };
            if (req.url === '/api/ai/settings' && ++settingsReads > 1 && baseline === 'conflict') {
                return { json: { ...settings, custom_instructions: latest } };
            }
            return null;
        });
        b.run('openSettingsModal()'); b.get('setting_auto_scroll').checked = false;
        await b.edit(); b.get('ai_provider_form_name').value = 'Retained provider draft';
        b.get('ai_setting_custom_instructions').value = 'Unsaved instruction draft';
        b.get('ai_setting_preferred_tags').value = 'unsaved-tag';
        if (baseline !== 'loaded') {
            const card = b.run("aiBuildInstructionProposalNode({id:'proposal',status:'pending',proposed_instruction:'New instruction'})");
            b.root.appendChild(card);
            await requiredButton(card, /^Save to custom instructions$/, 'proposal approval control').click();
        }
        const readsBeforeCancel = b.reads.length, writesBeforeCancel = b.writes.length;
        const cancel = requiredButton(b.get('ai_behavior_settings'), /^Cancel(?: changes)?$/i, 'B7: AI behavior needs its own explicit Cancel control');
        await cancel.click();
        assert.equal(b.get('ai_setting_custom_instructions').value, baseline === 'loaded' ? 'Saved instructions' : latest);
        assert.equal(b.get('ai_setting_preferred_tags').value, 'saved');
        assert.equal(b.get('ai_setting_minimum_break_minutes').value, '15');
        assert.equal(b.dirty('ai_behavior_settings'), false);
        assert.equal(b.dirty('ai_provider_form_section'), true);
        assert.equal(b.dirty('settings_modal'), true);
        assert.equal(b.reads.length, readsBeforeCancel);
        assert.equal(b.writes.length, writesBeforeCancel);
    });
}

test('provider explicit Clear is a distinct dirty intent and sends empty string, never blank-keep or mask', async () => {
    const b = await page(req => req.method === 'PUT' ? { json: provider } : null);
    await b.edit();
    const clear = requiredButton(b.get('ai_provider_form_section'), /clear.*key/i, 'B7: saved provider needs an explicit Clear key control');
    await clear.click();
    assert.equal(b.dirty('ai_provider_form_section'), true);
    await b.get('ai_provider_save_btn').click();
    assert.equal(b.writes.length, 1);
    assert.equal(b.writes[0].body.api_key, '');
});

test('provider Cancel discards typed secret from retained DOM without touching behavior or writing', async () => {
    const b = await page(); await b.edit();
    b.get('ai_setting_preferred_tags').value = 'Retained behavior draft';
    b.get('ai_provider_form_api_key').value = 'NONFUNCTIONAL-ticket20-discard-9876';
    await b.get('ai_provider_cancel_btn').click();
    assert.equal(b.get('ai_provider_form_section').classList.contains('hidden'), true);
    assert.equal(b.writes.length, 0);
    assert.equal(b.dirty('ai_behavior_settings'), true);
    assert.equal(b.get('ai_provider_form_api_key').value, '', 'Discard must dispose the typed password, not only hide it');
});

for (const fail of [false, true]) {
    test(`provider held Save then Cancel and new owner ignores late ${fail ? 'error' : 'ACK'}`, async () => {
        const held = deferred();
        const b = await page(req => req.method === 'PUT' ? held.promise : null);
        await b.edit(); b.get('ai_provider_form_name').value = 'Submitted A';
        const saving = b.get('ai_provider_save_btn').click();
        await b.get('ai_provider_cancel_btn').click();
        await b.get('ai_provider_new_btn').click();
        b.get('ai_provider_form_name').value = 'New owner B';
        b.get('ai_provider_form_model').value = 'new/custom-model';
        b.get('ai_provider_form_api_key').value = 'NONFUNCTIONAL-ticket20-new-owner-6789';
        held.resolve(fail ? { status: 503, json: { detail: 'Synthetic old-owner failure' } } : { json: provider });
        await saving;
        assert.equal(b.get('ai_provider_form_name').value, 'New owner B');
        assert.equal(b.get('ai_provider_form_api_key').value, 'NONFUNCTIONAL-ticket20-new-owner-6789');
        assert.equal(b.writes.length, 1);
        assert.equal(b.get('ai_provider_form_section').classList.contains('hidden'), false, 'Old ACK must not close new owner B');
        assert.equal(b.dirty('ai_provider_form_section'), true);
        assert.deepEqual(b.alerts, [], 'Old error must not report against newer owner B');
    });
}

test('provider successful ACK preserves concurrent typing in the same owner and checkpoints submitted values only', async () => {
    const held = deferred();
    const b = await page(req => req.method === 'PUT' ? held.promise : null);
    await b.edit(); b.get('ai_provider_form_name').value = 'Submitted B';
    const saving = b.get('ai_provider_save_btn').click();
    b.get('ai_provider_form_name').value = 'Concurrent C';
    held.resolve({ json: provider }); await saving;
    assert.equal(b.writes[0].body.name, 'Submitted B');
    assert.equal(b.get('ai_provider_form_name').value, 'Concurrent C');
    assert.equal(b.get('ai_provider_form_section').classList.contains('hidden'), false, 'Concurrent draft must remain open after ACK');
    assert.equal(b.dirty('ai_provider_form_section'), true);
});

test('provider pending Save blocks duplicate mutation for the same owner', async () => {
    const held = deferred();
    const b = await page(req => req.method === 'PUT' ? held.promise : null);
    await b.edit();
    const first = b.get('ai_provider_save_btn').click(), second = b.get('ai_provider_save_btn').click();
    const pendingCount = b.writes.length;
    held.resolve({ json: provider }); await Promise.all([first, second]);
    assert.equal(pendingCount, 1, 'One pending owner must not submit twice');
});

test('provider unrelated edit preserves hidden native OpenRouter option and exact custom model/extras', async () => {
    const b = await page(req => req.method === 'PUT' ? { json: provider } : null);
    await b.edit(); b.get('ai_provider_form_name').value = 'Rename only';
    await b.get('ai_provider_save_btn').click();
    const body = b.writes[0].body;
    assert.equal(body.model, 'custom/exact-model');
    assert.equal(Object.hasOwn(body, 'extra_params'), false, 'Unexposed extras use update omission/keep');
    assert.ok(!Object.hasOwn(body, 'use_native_openrouter') || body.use_native_openrouter === true,
        'An unrelated edit must not implicitly POST false for the saved hidden true option');
});

test('provider failed Save control retains editable secret/draft without logging it, retry is explicit', async () => {
    const b = await page(req => req.method === 'PUT' ? { status: 503, json: { detail: 'Synthetic rejected provider PUT' } } : null);
    await b.edit();
    const key = 'NONFUNCTIONAL-ticket20-failed-save-4681';
    b.get('ai_provider_form_api_key').value = key;
    await b.get('ai_provider_save_btn').click();
    assert.equal(b.get('ai_provider_form_section').classList.contains('hidden'), false);
    assert.equal(b.get('ai_provider_form_api_key').value, key);
    assert.equal(b.dirty('ai_provider_form_section'), true);
    assert.equal(b.writes.length, 1);
    assert.equal(b.logs.join('\n').includes(key), false);
    assert.equal(b.alerts.join('\n').includes(key), false);
});

test('provider saved versus inline Test control preserves exact model and does not write CRUD', async () => {
    const b = await page(req => req.url.endsWith('/test') ? { json: { success: true, error: null } } : null);
    await b.edit();
    b.get('ai_provider_form_model').value = 'unsaved/custom';
    await b.get('ai_provider_test_btn').click();
    assert.deepEqual(b.writes[0].body, { config_id: provider.id });
    b.get('ai_provider_form_api_key').value = 'NONFUNCTIONAL-ticket20-inline-5917';
    await b.get('ai_provider_test_btn').click();
    assert.equal(b.writes[1].body.inline_config.model, 'unsaved/custom');
    assert.equal(b.writes[1].body.inline_config.api_key, 'NONFUNCTIONAL-ticket20-inline-5917');
    assert.equal(b.writes.every(w => w.url === '/api/ai/providers/test'), true);
    assert.equal(b.get('ai_provider_test_result').textContent, 'Connection OK.');
});

test('provider superseded list refresh cannot append an obsolete provider snapshot after newer data', async () => {
    const oldList = deferred();
    let listReads = 0;
    const newer = { ...provider, name: 'New authoritative provider name' };
    const b = await page(req => {
        if (req.url !== '/api/ai/providers' || req.method !== 'GET') return null;
        listReads += 1;
        if (listReads === 2) return oldList.promise;
        return { json: [listReads === 1 ? provider : newer] };
    });
    const oldRefresh = b.run('aiLoadProviders()');
    await b.run('aiLoadProviders()');
    oldList.resolve({ json: [{ ...provider, name: 'Obsolete provider name' }] });
    await oldRefresh;
    const displayed = b.get('ai_providers_list').querySelectorAll('div').filter(el => el.classList.contains('ai-provider-card-name'));
    assert.deepEqual(displayed.map(el => el.textContent), ['New authoritative provider name']);
    assert.equal(b.writes.length, 0);
});

test('provider write ACK then failed list read control: public refresh retry never replays the mutation', async () => {
    let listReads = 0;
    const b = await page(req => {
        if (req.method === 'PUT') return { json: provider };
        if (req.url === '/api/ai/providers' && ++listReads === 2) {
            return { status: 503, json: { detail: 'Synthetic post-ACK list failure' } };
        }
        return null;
    });
    await b.edit();
    b.get('ai_provider_form_name').value = 'Submitted rename';
    await b.get('ai_provider_save_btn').click();
    await tick();
    assert.match(b.get('ai_providers_list').textContent, /Failed to load providers/);
    assert.equal(b.writes.length, 1);
    await b.run('aiLoadProviders()'); // Public read retry, NOT a claim that a Retry button exists.
    assert.equal(b.writes.length, 1);
    assert.match(b.get('ai_providers_list').textContent, /Synthetic A/);
});

test('provider clean ACK disposes its submitted typed key from retained password DOM', async () => {
    const b = await page(req => req.method === 'PUT' ? { json: provider } : null);
    await b.edit();
    b.get('ai_provider_form_api_key').value = 'NONFUNCTIONAL-ticket20-ack-disposal-8216';
    await b.get('ai_provider_save_btn').click();
    assert.equal(b.writes.length, 1);
    assert.equal(b.get('ai_provider_form_section').classList.contains('hidden'), true);
    assert.equal(b.get('ai_provider_form_api_key').value, '', 'Clean ACK must dispose only the completed owner password');
});

// Added current-base controls. The frozen 22 cases above remain unchanged.
for (const fail of [false, true]) {
    test(`behavior held Save Cancel then late ${fail ? 'failure' : 'ACK'} retains new typing and truthful baseline`, async () => {
        const held = deferred();
        const b = await page(req => req.method === 'PUT' ? held.promise : null);
        b.get('ai_setting_custom_instructions').value = 'Submitted instructions';
        const pending = b.get('ai_settings_save_btn').click();
        await b.get('ai_settings_cancel_btn').click();
        assert.equal(b.get('ai_setting_custom_instructions').value, settings.custom_instructions);
        b.get('ai_setting_preferred_tags').value = 'newer-tag';
        held.resolve(fail ? { status: 503, json: { detail: 'PRIVATE-ERROR-SENTINEL' } } : { json: settings });
        await pending;
        assert.equal(b.get('ai_setting_preferred_tags').value, 'newer-tag');
        assert.equal(b.dirty('ai_behavior_settings'), true);
        await b.get('ai_settings_cancel_btn').click();
        assert.equal(b.get('ai_setting_custom_instructions').value, fail ? settings.custom_instructions : 'Submitted instructions');
        assert.equal(b.writes.length, 1);
        assert.equal(b.get('ai_settings_save_status').textContent.includes('PRIVATE-ERROR-SENTINEL'), false);
    });
}

test('behavior unknown baseline Cancel cannot erase typing; held initial GET preserves it', async () => {
    const held = deferred();
    const b = await page(req => req.url === '/api/ai/settings' ? held.promise : null);
    b.get('ai_setting_custom_instructions').value = 'Typed during initial read';
    await b.get('ai_settings_cancel_btn').click();
    assert.equal(b.get('ai_setting_custom_instructions').value, 'Typed during initial read');
    held.resolve({ json: settings }); await tick();
    assert.equal(b.get('ai_setting_custom_instructions').value, 'Typed during initial read');
    assert.equal(b.dirty('ai_behavior_settings'), true);
    await b.get('ai_settings_cancel_btn').click();
    assert.equal(b.get('ai_setting_custom_instructions').value, settings.custom_instructions);
    assert.equal(b.writes.length, 0);
});

test('behavior pending Save refuses duplicate mutation', async () => {
    const held = deferred();
    const b = await page(req => req.method === 'PUT' ? held.promise : null);
    const first = b.get('ai_settings_save_btn').click();
    const duplicate = b.run('aiSaveBehaviorSettings()');
    assert.equal(b.writes.length, 1);
    held.resolve({ json: settings }); await Promise.all([first, duplicate]);
});

test('Clear probe is inline empty, Clear Cancel reopens as keep without saving', async () => {
    const b = await page(req => req.url.endsWith('/test') ? { json: { success: true } } : null);
    await b.edit();
    await b.get('ai_provider_clear_key_btn').click();
    await b.get('ai_provider_test_btn').click();
    assert.equal(b.writes[0].body.inline_config.api_key, '');
    assert.equal(Object.hasOwn(b.writes[0].body, 'config_id'), false);
    await b.get('ai_provider_cancel_btn').click(); await b.edit();
    assert.equal(b.dirty('ai_provider_form_section'), false);
    await b.get('ai_provider_test_btn').click();
    assert.deepEqual(b.writes[1].body, { config_id: provider.id });
});

test('Clear type then revert to blank means keep; explicitly clear again means clear', async () => {
    const b = await page(req => req.method === 'PUT' ? { json: provider } : null);
    await b.edit();
    await b.get('ai_provider_clear_key_btn').click();
    b.get('ai_provider_form_api_key').value = 'NONFUNCTIONAL-typed-while-clear';
    b.run('aiUpdateKeyIntent()'); // same production input callback
    b.get('ai_provider_form_api_key').value = ''; b.run('aiUpdateKeyIntent()');
    assert.equal(b.dirty('ai_provider_form_section'), false);
    await b.get('ai_provider_clear_key_btn').click();
    await b.get('ai_provider_save_btn').click();
    assert.equal(b.writes[0].body.api_key, '');
    assert.equal(b.run("settingsDrafts.has('ai_provider_form_section')"), false);
});

for (const fail of [false, true]) {
    test(`late Test ${fail ? 'error' : 'success'} cannot update a reopened A editor`, async () => {
        const held = deferred();
        const b = await page(req => req.url.endsWith('/test') ? held.promise : null);
        await b.edit();
        const pending = b.get('ai_provider_test_btn').click();
        await b.get('ai_provider_cancel_btn').click(); await b.edit();
        held.resolve(fail ? { status: 503, json: { detail: 'PRIVATE-RESPONSE' } } : { json: { success: true } });
        await pending;
        assert.equal(b.get('ai_provider_test_result').textContent, '');
        assert.equal(b.dirty('ai_provider_form_section'), false);
    });
}

test('create ACK with concurrent typing adopts saved ID so deliberate retry updates instead of duplicating', async () => {
    const held = deferred();
    const b = await page(req => req.method === 'POST' ? held.promise : req.method === 'PUT' ? { json: provider } : null);
    await b.get('ai_provider_new_btn').click();
    b.get('ai_provider_form_name').value = 'Submitted new';
    b.get('ai_provider_form_model').value = 'custom/exact';
    const pending = b.get('ai_provider_save_btn').click();
    b.get('ai_provider_form_name').value = 'Newer draft';
    await b.run('aiSaveProviderForm()'); assert.equal(b.writes.length, 1);
    held.resolve({ json: provider }); await pending;
    assert.equal(b.get('ai_provider_form_name').value, 'Newer draft');
    await b.get('ai_provider_save_btn').click();
    assert.deepEqual(b.writes.map(w => w.method), ['POST', 'PUT']);
    assert.equal(b.writes[1].url, `/api/ai/providers/${provider.id}`);
});

test('provider failure diagnostics exclude typed credentials and response bodies for write and probe', async () => {
    const sentinel = 'NONFUNCTIONAL-private-ui-sentinel';
    const b = await page(req => req.method !== 'GET' ? { status: 503, json: { detail: sentinel } } : null);
    await b.edit(); b.get('ai_provider_form_api_key').value = sentinel;
    await b.get('ai_provider_save_btn').click();
    await b.get('ai_provider_test_btn').click();
    assert.equal(b.alerts.join('\n').includes(sentinel), false);
    assert.equal(b.logs.join('\n').includes(sentinel), false);
    assert.equal(b.get('ai_provider_test_result').textContent.includes(sentinel), false);
    assert.equal(b.get('ai_provider_form_api_key').value, sentinel);
});

test('provider list refresh failure exposes deliberate read-only Retry button', async () => {
    let reads = 0;
    const b = await page(req => req.url === '/api/ai/providers' && ++reads === 1
        ? { status: 503, json: { detail: 'PRIVATE-READ' } } : null);
    await requiredButton(b.get('ai_providers_list'), /^Retry refresh$/, 'read Retry').click();
    assert.equal(reads, 2);
    assert.equal(b.writes.length, 0);
    assert.equal(b.get('ai_providers_list').textContent.includes('Synthetic A'), true);
});

test('catalog latest generation wins and custom exact model survives failure/retry', async () => {
    let reads = 0;
    const held = deferred();
    const b = await page(req => {
        if (req.url !== '/api/ai/providers/catalog') return null;
        if (++reads === 2) return held.promise;
        if (reads === 3) return { json: { openrouter: [{ id: 'new/catalog' }] } };
        return null;
    });
    await b.edit(); b.get('ai_provider_form_model').value = 'EXACT/custom-string';
    const stale = b.run('aiLoadCatalog()'); await b.run('aiLoadCatalog()');
    held.resolve({ status: 503, json: { detail: 'OLD-PRIVATE-READ' } }); await stale;
    assert.equal(b.get('ai_provider_form_model').value, 'EXACT/custom-string');
    assert.deepEqual(b.get('ai_provider_form_model_select').options.map(o => o.value), ['', 'new/catalog']);
    assert.equal(b.get('ai_catalog_status').textContent, '');
    assert.equal(b.writes.length, 0);
});

test('behavior rejected response body never reaches status or shared API-client diagnostics', async () => {
    const sentinel = 'NONFUNCTIONAL-private-settings-sentinel';
    const b = await page(req => req.method === 'PUT' ? { status: 503, json: { detail: sentinel } } : null);
    b.get('ai_setting_custom_instructions').value = 'New draft';
    await b.get('ai_settings_save_btn').click();
    assert.equal(b.get('ai_settings_save_status').textContent.includes(sentinel), false);
    assert.equal(b.logs.join('\n').includes(sentinel), false);
    assert.equal(b.dirty('ai_behavior_settings'), true);
    assert.equal(b.get('ai_setting_custom_instructions').value, 'New draft');
});

test('API client preserves thrown error and other-endpoint diagnostics while suppressing only known AI settings routes', async () => {
    const sentinel = 'NONFUNCTIONAL-private-api-sentinel';
    const b = await page(req => req.method === 'PUT' ? { status: 503, json: { detail: sentinel } } : null);
    for (const url of ['/api/ai/settings', '/api/ai/providers', '/api/ai/providers/synthetic-id', '/api/ai/status']) {
        await assert.rejects(b.run(`api.put(${JSON.stringify(url)}, {})`), error => error.message === sentinel);
    }
    assert.equal(b.logs.join('\n').includes(sentinel), false);
    await assert.rejects(b.run("api.put('/api/tasks/synthetic-id', {})"), error => error.message === sentinel);
    assert.equal(b.logs.join('\n').includes(sentinel), true, 'Unrelated endpoint logging remains unchanged');
});

for (const typed of [false, true]) {
    test(`initial held settings read preserves accepted instruction baseline with local typing=${typed}`, async () => {
        const held = deferred();
        const accepted = 'Accepted standing instructions';
        let canonical = { ...settings };
        let settingsReads = 0;
        const b = await page(req => {
            if (req.method === 'GET' && req.url === '/api/ai/settings') return ++settingsReads === 1
                ? held.promise : { json: canonical };
            if (req.url.endsWith('/accept')) {
                canonical = { ...canonical, custom_instructions: accepted };
                return { json: { settings: canonical, proposal: { id: 'initial-proposal', status: 'accepted' } } };
            }
            if (req.method === 'PUT') { canonical = { ...canonical, ...req.body }; return { json: canonical }; }
            return null;
        });
        if (typed) b.get('ai_setting_custom_instructions').value = 'Locally typed instructions';
        b.get('ai_setting_preferred_tags').value = 'local-tag';
        const card = b.run("aiBuildInstructionProposalNode({id:'initial-proposal', status:'pending', proposed_instruction:'Remember this'})");
        b.root.appendChild(card);
        await requiredButton(card, /^Save to custom instructions$/, 'actual proposal accept callback').click();
        held.resolve({ json: settings }); await tick();
        assert.equal(b.get('ai_setting_custom_instructions').value, typed ? 'Locally typed instructions' : accepted);
        assert.equal(b.get('ai_setting_preferred_tags').value, 'local-tag');
        if (typed) {
            await b.get('ai_settings_cancel_btn').click();
            assert.equal(b.get('ai_setting_custom_instructions').value, accepted);
            b.get('ai_setting_preferred_tags').value = 'local-tag';
        }
        await b.get('ai_settings_save_btn').click();
        assert.deepEqual(b.writes.map(r => r.method), ['POST', 'PUT']);
        assert.equal(b.writes[1].body.custom_instructions, accepted);
        assert.deepEqual(b.writes[1].body.preferred_tags, ['local-tag']);
        const readback = await b.run("api.get('/api/ai/settings')");
        assert.equal(readback.custom_instructions, accepted);
        b.get('ai_setting_custom_instructions').value = 'Discard me';
        await b.get('ai_settings_cancel_btn').click();
        assert.equal(b.get('ai_setting_custom_instructions').value, accepted);
    });
}

test('accepted instructions survive failed initial load and older retry read while retaining a later empty draft', async () => {
    const first = deferred(), retry = deferred(); let reads = 0;
    const accepted = 'Accepted before initialization retry';
    const b = await page(req => {
        if (req.url === '/api/ai/settings') return ++reads === 1 ? first.promise : retry.promise;
        if (req.url.endsWith('/accept')) return { json: {
            settings: { ...settings, custom_instructions: accepted },
            proposal: { id: 'retry-proposal', status: 'accepted' },
        } };
        return null;
    });
    const card = b.run("aiBuildInstructionProposalNode({id:'retry-proposal', status:'pending', proposed_instruction:'Remember this'})");
    b.root.appendChild(card);
    await requiredButton(card, /^Save to custom instructions$/, 'actual proposal accept callback').click();
    first.resolve({ status: 503, json: { detail: 'synthetic initial read failure' } }); await tick();
    const pending = requiredButton(b.get('ai_settings_save_status'), /^Retry load$/, 'behavior load retry').click();
    b.get('ai_setting_custom_instructions').value = '';
    b.get('ai_setting_preferred_tags').value = 'retained-draft';
    retry.resolve({ json: settings }); await pending;
    assert.equal(b.get('ai_setting_custom_instructions').value, '', 'empty local draft survives initialization');
    assert.equal(b.get('ai_setting_preferred_tags').value, 'retained-draft');
    await b.get('ai_settings_cancel_btn').click();
    assert.equal(b.get('ai_setting_custom_instructions').value, accepted, 'Cancel restores the accepted canonical text');
    assert.equal(b.writes.length, 1, 'load retry is read-only');
});

test('old behavior ACK cannot replace a newer authoritative instruction baseline', async () => {
    const held = deferred();
    const b = await page(req => req.method === 'PUT' ? held.promise : null);
    b.get('ai_setting_custom_instructions').value = 'Submitted old instructions';
    const pending = b.get('ai_settings_save_btn').click();
    b.run("aiSyncCustomInstructions({custom_instructions:'New authoritative instructions'})");
    held.resolve({ json: settings }); await pending;
    await b.get('ai_settings_cancel_btn').click();
    assert.equal(b.get('ai_setting_custom_instructions').value, 'New authoritative instructions');
});

test('late Test result after concurrent configuration typing is not reported as a current connection success', async () => {
    const held = deferred();
    const b = await page(req => req.url.endsWith('/test') ? held.promise : null);
    await b.edit(); const pending = b.get('ai_provider_test_btn').click();
    b.get('ai_provider_form_model').value = 'newer/custom-model';
    held.resolve({ json: { success: true } }); await pending;
    assert.equal(b.get('ai_provider_test_result').textContent.includes('Connection OK.'), false);
    assert.equal(b.get('ai_provider_form_model').value, 'newer/custom-model');
});

test('held settings refresh cannot overwrite a newer authoritative instruction baseline', async () => {
    const held = deferred();
    let settingsReads = 0;
    const b = await page(req => req.url === '/api/ai/settings' && ++settingsReads === 2 ? held.promise : null);
    const pending = b.run('aiLoadBehaviorSettings()');
    b.run("aiSyncCustomInstructions({custom_instructions:'New authoritative during GET'})");
    held.resolve({ json: settings }); await pending;
    assert.equal(b.get('ai_setting_custom_instructions').value, 'New authoritative during GET');
    assert.equal(b.dirty('ai_behavior_settings'), false);
    b.get('ai_setting_custom_instructions').value = 'Unsaved after read';
    await b.get('ai_settings_cancel_btn').click();
    assert.equal(b.get('ai_setting_custom_instructions').value, 'New authoritative during GET');
});

for (const action of ['Save', 'Activate']) {
    test(`${action} ACK and successful list read followed by real status failure offers visible GET-only Retry`, async () => {
        let statusReads = 0;
        const sentinel = 'PRIVATE-STATUS-RESPONSE';
        const b = await page(req => {
            if (req.url === '/api/ai/status') return ++statusReads === 1
                ? { status: 503, json: { detail: sentinel } } : { json: { pending_draft_count: 0 } };
            if (req.method !== 'GET') return { json: provider };
            return null;
        });
        if (action === 'Save') {
            await b.edit();
            await b.get('ai_provider_save_btn').click();
            assert.equal(b.get('ai_provider_form_section').classList.contains('hidden'), true);
        } else {
            await requiredButton(b.get('ai_providers_list'), /^Activate$/, 'public card Activate').click();
        }
        const notice = b.get('ai_provider_status');
        assert.ok(notice, 'provider status notice exists outside the closable editor');
        for (let node = notice; node; node = node.parentNode) {
            assert.notEqual(node.id, 'ai_provider_form_section');
            assert.equal(node.classList.contains('hidden'), false, 'notice remains visible after clean ACK');
        }
        assert.match(notice.textContent, /acknowledged changes remain saved/i);
        assert.equal(b.logs.join(' ').includes(sentinel), false, 'actual status HTTP diagnostics stay private');
        const before = b.reads.length;
        await requiredButton(notice, /^Retry status$/, 'status-only retry').click();
        assert.deepEqual(b.reads.slice(before).map(r => r.url), ['/api/ai/status']);
        assert.equal(b.writes.length, 1, 'retry never replays acknowledged mutation');
        assert.equal(notice.textContent, '');
    });
}

for (const [oldFails, latestFails] of [[false, true], [true, true], [false, false], [true, false]]) {
    test(`late status ${oldFails ? 'failure' : 'success'} cannot replace latest ${latestFails ? 'failure' : 'success'} outcome or badge`, async () => {
        const held = deferred(); let reads = 0;
        const b = await page(req => {
            if (req.url === '/api/ai/status') {
                if (++reads === 1) return held.promise;
                return latestFails ? { status: 503, json: { detail: 'PRIVATE-LATEST-STATUS' } }
                    : { json: { pending_draft_count: 3 } };
            }
            if (req.method !== 'GET') return { json: provider };
            return null;
        });
        const badge = element(); badge.id = 'ai_launcher_badge'; badge.textContent = '7'; b.root.appendChild(badge);
        const first = requiredButton(b.get('ai_providers_list'), /^Activate$/, 'Activate').click();
        await tick();
        await requiredButton(b.get('ai_providers_list'), /^Activate$/, 'newly refreshed Activate').click();
        held.resolve(oldFails ? { status: 503, json: { detail: 'PRIVATE-OLD-STATUS' } }
            : { json: { pending_draft_count: 99 } });
        await first;
        if (latestFails) assert.match(b.get('ai_provider_status')?.textContent || '', /Retry status/);
        else assert.equal(b.get('ai_provider_status')?.textContent, '');
        assert.equal(badge.textContent, latestFails ? '7' : '3', 'late shared badge outcome cannot repaint newer state');
    });
}

test('confirmed public Delete preserves other drafts and offers GET-only list Retry after ACK', async () => {
    let reads = 0;
    const b = await page(req => {
        if (req.url === '/api/ai/providers' && ++reads === 2) return { status: 503, json: { detail: 'PRIVATE-LIST' } };
        if (req.method === 'DELETE') return { status: 204 };
        return null;
    });
    await b.edit(); b.get('ai_provider_form_name').value = 'Unsaved provider draft';
    b.get('ai_setting_custom_instructions').value = 'Unsaved behavior draft';
    b.context.window.confirm = () => true;
    await requiredButton(b.get('ai_providers_list'), /^Delete$/, 'public confirmed Delete').click();
    await requiredButton(b.get('ai_providers_list'), /^Retry refresh$/, 'post-delete read Retry').click();
    assert.deepEqual(b.writes.map(r => r.method), ['DELETE']);
    assert.equal(b.get('ai_provider_form_name').value, 'Unsaved provider draft');
    assert.equal(b.get('ai_setting_custom_instructions').value, 'Unsaved behavior draft');
});

test('current catalog Retry uses only its GET and retains custom model draft', async () => {
    let reads = 0;
    const b = await page(req => req.url === '/api/ai/providers/catalog' && ++reads === 1
        ? { status: 503, json: { detail: 'PRIVATE-CATALOG' } } : null);
    await b.edit(); b.get('ai_provider_form_model').value = 'exact/custom-draft';
    const before = b.reads.length;
    await requiredButton(b.get('ai_catalog_status'), /^Retry catalog$/, 'current catalog Retry').click();
    assert.deepEqual(b.reads.slice(before).map(r => r.url), ['/api/ai/providers/catalog']);
    assert.equal(b.get('ai_provider_form_model').value, 'exact/custom-draft');
    assert.equal(b.writes.length, 0);
});

// Pure route-policy unit check: no browser, daemon, HTTP, or provider is started.
test('authored native guard delegates exact real Tailwind asset to parent guard without substituting CSS', async () => {
    let guard;
    let closeCount = 0;
    const stopped = Error('synthetic stop before private health read');
    const context = {
        newPage: async () => ({ on() {} }), addInitScript: async () => {},
        route: async (pattern, fn) => { guard = fn; },
        request: { get: async () => { throw stopped; } },
        close: async () => { ++closeCount; },
    };
    const probe = vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'browser_ai_settings_providers.js'), 'utf8'), { URL });
    await assert.rejects(probe({ context: () => ({ browser: () => ({ newContext: async () => context }) }) },
        'http://127.0.0.1:18347'), error => error === stopped);
    assert.equal(closeCount, 1, 'cleanup closes its context and preserves the primary error identity');
    for (const [url, method, expected] of [
        ['https://cdn.tailwindcss.com/', 'GET', 'fallback'],
        ['https://cdn.tailwindcss.com/other.js', 'GET', 'abort'],
        ['https://cdn.tailwindcss.com/?unexpected=1', 'GET', 'abort'],
        ['https://cdn.tailwindcss.com/', 'POST', 'abort'],
        ['https://foreign.invalid/', 'GET', 'abort'],
    ]) {
        const calls = [];
        await guard({ request: () => ({ url: () => url, method: () => method }),
            fallback: () => calls.push('fallback'), abort: () => calls.push('abort'),
            continue: () => calls.push('continue'), fulfill: () => calls.push('fulfill') });
        assert.deepEqual(calls, [expected], 'only exact asset falls back; no unguarded continue or fake stylesheet');
    }
});

test('ordinary shared badge refresh cannot leave provider status failure stuck as refreshing', async () => {
    const held = deferred(); let reads = 0;
    const b = await page(req => {
        if (req.url === '/api/ai/status') return ++reads === 1 ? held.promise : { json: { pending_draft_count: 2 } };
        if (req.method === 'POST') return { json: provider };
        return null;
    });
    const badge = element(); badge.id = 'ai_launcher_badge'; b.root.appendChild(badge);
    const action = requiredButton(b.get('ai_providers_list'), /^Activate$/, 'Activate').click();
    await tick();
    await b.run('refreshAiStatusBadge()'); // Same ordinary shared callback used by Assistant/draft callers.
    held.resolve({ status: 503, json: { detail: 'PRIVATE-OLD-STATUS' } }); await action;
    assert.match(b.get('ai_provider_status').textContent, /Retry status/);
    assert.equal(badge.textContent, '2');
    const before = b.reads.length;
    await requiredButton(b.get('ai_provider_status'), /^Retry status$/, 'recover status').click();
    assert.deepEqual(b.reads.slice(before).map(r => r.url), ['/api/ai/status']);
    assert.equal(b.writes.length, 1);
});
