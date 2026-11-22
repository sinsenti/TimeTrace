const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createTimerController} = require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');

test('taskless start journals stable operation, ACK survives held refresh, retry only reads', async () => {
    const storage = new Map();
    let failRefresh = false;
    const posts = [];
    const control = createTimerController({
        api: {get: async path => {
            if (failRefresh) throw Error('refresh failed');
            return {timers: [{id: 'timer-a', state: 'running'}]};
        }, post: async (path, payload) => {
            assert.equal(JSON.parse(storage.get('timetrace_timer_v2_operation')).payload.operation_id, payload.operation_id);
            posts.push([path, payload]);
            failRefresh = true;
            return {operation_id: payload.operation_id, timer: {id: 'timer-a', state: 'running'}};
        }},
        storage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
        operationId: () => 'stable-op', onState: () => {}
    });
    assert.equal(await control.start({}), true);
    assert.equal(posts.length, 1);
    assert.equal(control.snapshot().receipt.outcome, 'acknowledged');
    failRefresh = false;
    await control.refresh();
    assert.equal(control.snapshot().receipt, null);
    assert.equal(posts.length, 1);
});

test('definite stale-target rejection is released only after operation-not-found, never replayed', async () => {
    let posts = 0;
    const control = createTimerController({api: {
        get: async () => { throw Object.assign(Error('Not found'), {status:404}); },
        post: async () => { posts++; throw Object.assign(Error('Timer changed'), {status:409, code:'revision_stale'}); }
    }, storage: {getItem: () => null, setItem() {}, removeItem() {}}, operationId: () => 'stale-op', onState() {}});
    assert.equal(await control.act('a','pause',{expected_revision:1}), false);
    assert.equal(control.snapshot().receipt, null);
    assert.match(control.snapshot().message, /Timer changed/);
    assert.equal(posts, 1);
});

test('migration cannot bypass an uncertain legacy timer verification hold', async () => {
    const values = new Map([['timetrace_timer_receipt', JSON.stringify({operation:'stop', outcome:'uncertain'})]]);
    let posts = 0;
    const storage = {getItem: key => values.get(key), setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key)};
    const control = createTimerController({api: {
        get: async () => ({timers:[]}),
        post: async (path,payload) => { posts++; return {operation_id:payload.operation_id,timer:{id:'new',state:'running'}}; }
    }, storage, operationId: () => 'new-op', onState() {}});
    await control.refresh();
    assert.equal(await control.start({}), false);
    assert.equal(posts, 0);
    storage.removeItem('timetrace_timer_receipt'); // Existing explicit human-verification action.
    await control.refresh();
    assert.equal(await control.start({}), true);
    assert.equal(posts, 1);
});

test('uncertain capture recovery adopts committed identities before a held refresh without another POST', async () => {
    const values = new Map();
    let posts = 0;
    const ack = {operation_id:'capture-op', captured_plan_id:'real-plan', requested_scheduled_session_id:'virt:plan', timer:{id:'timer-a',state:'running',scheduled_session_id:'real-plan'}};
    const control = createTimerController({api: {
        get: async path => {
            if (path.startsWith('/operations/')) return {status:'finalized',result:ack};
            throw Error('held read');
        },
        post: async () => { posts++; throw Error('lost response'); }
    }, storage: {getItem:key=>values.get(key), setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key)},
    operationId:()=> 'capture-op', onState() {}});
    assert.equal(await control.start({scheduled_session_id:'virt:plan'}), false);
    await control.recover();
    assert.equal(control.snapshot().lastResult.captured_plan_id, 'real-plan');
    assert.equal(control.snapshot().timers[0].id, 'timer-a');
    assert.equal(control.snapshot().receipt.outcome, 'acknowledged');
    assert.equal(posts, 1);
});

test('targeted pause never falls back to a global action', async () => {
    const posts = [];
    const control = createTimerController({api: {
        get: async () => ({timers: [{id:'a', state:'running'}, {id:'b', state:'running'}]}),
        post: async (path, payload) => {posts.push(path); return {timer:{id:'a'}, operation_id: payload.operation_id};}
    }, storage: {getItem: () => null, setItem() {}, removeItem() {}}, operationId: () => 'op', onState() {}});
    await control.act('a', 'pause');
    assert.deepEqual(posts, ['/timers/a/pause']);
});
