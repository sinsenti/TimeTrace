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

test('targeted pause never falls back to a global action', async () => {
    const posts = [];
    const control = createTimerController({api: {
        get: async () => ({timers: [{id:'a', state:'running'}, {id:'b', state:'running'}]}),
        post: async (path, payload) => {posts.push(path); return {timer:{id:'a'}, operation_id: payload.operation_id};}
    }, storage: {getItem: () => null, setItem() {}, removeItem() {}}, operationId: () => 'op', onState() {}});
    await control.act('a', 'pause');
    assert.deepEqual(posts, ['/timers/a/pause']);
});
