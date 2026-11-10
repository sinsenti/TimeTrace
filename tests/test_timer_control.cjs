const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// HTTP, storage and clock are boundaries; exercise the actual public controller and API client.
function page(storage = new Map()) {
    const elements = new Map();
    const document = {
        title: '', activeElement: null, body: { append() {} },
        getElementById(id) { return elements.get(id) || null; },
        addEventListener() {},
        querySelectorAll() { return []; }
    };
    for (const id of ['idle_resolution_modal', 'idle_time_summary_label', 'idle_retag_input',
        'idle_retag_notes', 'timer_status_label', 'toggle_btn', 'timer_task_select',
        'timer_recovery_notice', 'timer_notice_text', 'timer_manual_ack', 'timer_recovery_open',
        'idle_resolution_feedback']) {
        const classes = new Set(id === 'idle_resolution_modal' ? ['hidden'] : []);
        elements.set(id, { id, value: '', textContent: '', innerText: '', disabled: false,
            classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
                toggle(c, force) { force ? classes.add(c) : classes.delete(c); } },
            setAttribute() {}, querySelectorAll() { return []; },
            focus() { document.activeElement = this; }, isConnected: true });
    }
    let status = { is_running: false, is_frozen_idle: true, idle_detection_enabled: false,
        pending_idle_gap: { idle_start: '2026-10-01T10:00:00+00:00', idle_end: '2026-10-01T10:10:00+00:00',
            idle_seconds: 600, task_id: 'task-uuid', tags: '#original', notes: 'Original' } };
    const writes = [];
    const context = vm.createContext({ document, console: { error() {} }, Date, Promise,
        setInterval() {}, setTimeout, window: { addEventListener() {} },
        sessionStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
        fetch: async (url, config) => {
            if (config.method === 'GET') {
                if (url === '/timer/status') {
                    if (status instanceof Error) throw status;
                    return { ok: true, headers: { get: () => 'application/json' }, json: async () => status };
                }
                return { ok: true, headers: { get: () => 'application/json' }, json: async () => [] };
            }
            writes.push({ url, body: JSON.parse(config.body || 'null') });
            return p.write(url, config);
        }
    });
    context.window = context;
    const p = { context, elements, writes, storage, setStatus(value) { status = value; },
        run: code => vm.runInContext(code, context),
        write: async () => {
            status = { is_running: false, is_frozen_idle: false, pending_idle_gap: null };
            return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ status: 'success' }) };
        }
    };
    for (const file of ['api_client.js', 'timer_control.js']) {
        vm.runInContext(fs.readFileSync(`src/timetrace/interfaces/api/static/js/${file}`, 'utf8'), context);
    }
    return p;
}

test('frozen timer opens recovery instead of silently starting; explicit choice logs once', async () => {
    const p = page();
    await p.run('fetchTimerStatus()');
    await p.run('toggleTimer()');
    assert.equal(p.writes.length, 0, 'Start must not clear a pending file gap');
    assert.equal(p.elements.get('idle_resolution_modal').classList.contains('hidden'), false);
    p.elements.get('idle_retag_input').value = '#new';
    p.elements.get('idle_retag_notes').value = 'Retag notes';
    await p.run('resolveIdleGap("re_tag")');
    assert.deepEqual(p.writes, [{ url: '/idle/resolve', body: { option: 're_tag', new_tags: '#new', new_notes: 'Retag notes' } }]);
});

const stopped = { is_running: false, is_frozen_idle: false, pending_idle_gap: null, idle_detection_enabled: false };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('pending preflight and held resolution prevent double activation and late poll replacement', async () => {
    const p = page(), held = deferred();
    await p.run('fetchTimerStatus()');
    p.write = async () => { await held.promise; p.setStatus(stopped); return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({}) }; };
    const first = p.run('resolveIdleGap("break")');
    const second = p.run('resolveIdleGap("claim_work")');
    await new Promise(setImmediate);
    assert.equal(p.writes.length, 1);
    await p.run('fetchTimerStatus()');
    await p.run('toggleTimer()');
    assert.equal(p.writes.length, 1);
    held.resolve(); await Promise.all([first, second]);
    await p.run('toggleTimer()');
    assert.equal(p.writes.length, 2, 'new explicit action after ACK and authoritative read');
});

test('failed status preflight never writes even with a last-known stopped timer', async () => {
    const p = page(); p.setStatus(stopped); await p.run('fetchTimerStatus()');
    p.setStatus(new Error('offline'));
    await p.run('toggleTimer()');
    assert.equal(p.writes.length, 0);
    assert.match(p.elements.get('timer_notice_text').textContent, /status/i);
});

test('ACK followed by failed status read offers read-only retry, not POST replay', async () => {
    const p = page();
    p.write = async () => { p.setStatus(new Error('read offline')); return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({}) }; };
    await p.run('resolveIdleGap("break")');
    assert.equal(p.writes.length, 1);
    assert.match(p.elements.get('timer_notice_text').textContent, /acknowledged/i);
    await p.run('toggleTimer()'); assert.equal(p.writes.length, 1);
    p.setStatus(stopped); await p.run('retryTimerRead()');
    assert.equal(p.writes.length, 1);
    await p.run('toggleTimer()'); assert.equal(p.writes.length, 2);
});

test('unknown or partial resolve stays latched across read, reload and manual acknowledgment writes nothing', async () => {
    const p = page();
    p.write = async () => { throw Error('lost response or second commit failed'); };
    await p.run('resolveIdleGap("break")');
    assert.equal(p.writes.length, 1);
    await p.run('retryTimerRead()'); await p.run('resolveIdleGap("claim_work")');
    assert.equal(p.writes.length, 1);
    const reloaded = page(p.storage);
    await reloaded.run('fetchTimerStatus()'); await reloaded.run('resolveIdleGap("break")');
    assert.equal(reloaded.writes.length, 0);
    assert.match(reloaded.elements.get('timer_notice_text').textContent, /partial|uncertain/i);
    await reloaded.run('acknowledgeTimerVerification()');
    assert.equal(reloaded.writes.length, 0);
    await reloaded.run('resolveIdleGap("skip")');
    assert.equal(reloaded.writes.length, 1, 'a separate explicit action after human verification');
});

test('unavailable session storage refuses a timer write before sending it', async () => {
    const p = page(); p.setStatus(stopped);
    p.context.sessionStorage.setItem = () => { throw Error('storage denied'); };
    await p.run('toggleTimer()');
    assert.equal(p.writes.length, 0);
    assert.match(p.elements.get('timer_notice_text').textContent, /storage/i);
});

test('a changed timer or captured gap during preflight requires a new explicit action', async () => {
    const p = page();
    p.setStatus({ ...stopped, is_running: true, start_time: '2026-10-01T09:00:00Z' });
    await p.run('fetchTimerStatus()');
    p.setStatus(stopped);
    await p.run('toggleTimer()');
    assert.equal(p.writes.length, 0, 'Stop intent must not turn into Start after an external Stop');
    const q = page(); await q.run('fetchTimerStatus()');
    q.setStatus({ ...stopped, is_frozen_idle: true, pending_idle_gap: {
        idle_start: '2026-10-02T10:00:00Z', idle_end: '2026-10-02T10:10:00Z' } });
    await q.run('resolveIdleGap("skip")');
    assert.equal(q.writes.length, 0, 'a choice for the old interval cannot resolve a newer interval');
});

for (const operation of ['start', 'stop']) {
    test(`unknown ${operation} remains blocked even when fresh status changes, including Session Timer Now`, async () => {
        const p = page();
        p.setStatus(operation === 'stop' ? { ...stopped, is_running: true, start_time: '2026-10-01T10:00:00Z' } : stopped);
        p.write = async () => { throw Error('unknown commit outcome'); };
        await p.run('toggleTimer()');
        p.setStatus(stopped); await p.run('retryTimerRead()');
        await p.run('startTimerFromSession({task_id:"other"}, () => true)');
        assert.equal(p.writes.length, 1);
        assert.match(p.elements.get('timer_notice_text').textContent, /uncertain/);
    });
}

test('authoritative merged next schedule title is used instead of stale upcoming helper rows', async () => {
    const p = page();
    p.setStatus({ ...stopped, next_scheduled_session: { title: 'Projected occurrence', start_time: new Date(Date.now() + 600000).toISOString() } });
    p.run('globalSessionsCache = [{ start_time: new Date(Date.now() + 300000).toISOString(), notes: "Stale helper row" }]');
    await p.run('fetchTimerStatus()');
    assert.match(p.context.document.title, /Projected occurrence/);
});

test('R09 startup receipt-storage failure stays visible after successful status and read-only Retry', async () => {
    const storage = new Map();
    storage.get = () => { throw Error('receipt storage denied'); };
    const p = page(storage);
    p.setStatus(stopped);
    await p.run('fetchTimerStatus()');
    assert.equal(p.elements.get('toggle_btn').disabled, true, 'unknown receipt keeps timer writes blocked');
    assert.equal(p.elements.get('timer_recovery_notice').classList.contains('hidden'), false,
        'INTENDED RED R09: successful status cannot hide the unresolved receipt-storage hold');
    assert.match(p.elements.get('timer_notice_text').textContent, /storage.*unavailable/i);
    assert.equal(p.elements.get('timer_manual_ack').classList.contains('hidden'), false);
    await p.run('retryTimerRead()');
    assert.equal(p.elements.get('timer_recovery_notice').classList.contains('hidden'), false);
    await p.run('toggleTimer()');
    assert.deepEqual(p.writes, [], 'Retry and blocked Start never replay or send a write');
    await p.run('acknowledgeTimerVerification()');
    assert.deepEqual(p.writes, [], 'explicit manual verification does not create timer/session work');
    assert.equal(p.elements.get('toggle_btn').disabled, false, 'existing explicit verification clears the hold when storage permits removal');
});
