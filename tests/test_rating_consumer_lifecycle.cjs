const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const receipts = [];
const probe = vm.runInNewContext(`(${fs.readFileSync(path.join(__dirname, 'browser_rating_administration_consumers.js'), 'utf8').trim().replace(/;$/, '')})`, {
    URL, console: {error: line => receipts.push(JSON.parse(line.replace(/^RATING18_CONSUMER_DIAGNOSTICS /, '')))},
});
function fixture(failures = {}) {
    const calls = [], handler = async () => {}, primary = Error('original consumer failure');
    const operation = async name => {calls.push(name); if (failures[name]) throw failures[name];};
    const resources = {
        definitions: [{id: 'owned-definition'}], task: {id: 'owned-task'}, session: {id: 'owned-session'},
        context: {close: () => operation('close')},
        p: {
            route: async (pattern, callback) => {assert.equal(pattern, '**/rating-entries'); assert.equal(callback, handler); await operation('route');},
            unroute: async (pattern, callback) => {assert.equal(pattern, '**/rating-entries'); assert.equal(callback, handler); await operation('unroute');},
        },
        api: async (url, method = 'GET') => {await operation(`${method} ${url}`); return [{id: 'owned-definition'}, {id: 'foreign-definition'}];},
    };
    return {resources, calls, handler, primary};
}
test('failure before registration retains original failure and closes without removing a route', async () => {
    const f = fixture();
    await assert.rejects(probe.runWithCleanup(f.resources, async ({at}) => {
        await at('session-readback', async () => {throw f.primary;});
    }), error => error === f.primary);
    assert.deepEqual(f.calls, ['GET /rating-definitions', 'DELETE /rating-definitions/owned-definition', 'DELETE /sessions/owned-session', 'DELETE /api/tasks/owned-task', 'close']);
    const receipt = receipts.at(-1);
    assert.equal(receipt.primary.stage, 'session-readback');
    assert.equal(receipt.primary.message, f.primary.message);
    assert.equal(receipt.primary.stack, f.primary.stack);
    assert.deepEqual(receipt.cleanupErrors, []);
    assert.equal(receipt.breadcrumbs.find(x => x.stage === 'session-readback').event, 'before');
});
test('failure after registration removes only the exact registered callback', async () => {
    const f = fixture();
    await assert.rejects(probe.runWithCleanup(f.resources, async ({at,registerRatingRoute}) => {
        await registerRatingRoute(f.handler);
        await at('task-save', async () => {throw f.primary;});
    }), error => error === f.primary);
    assert.deepEqual(f.calls.slice(0, 2), ['route', 'unroute']);
    assert.equal(f.calls.filter(x => x === 'unroute').length, 1);
    assert.equal(receipts.at(-1).primary.stage, 'task-save');
});
test('failed registration never authorizes route removal', async () => {
    const f = fixture({route: Error('registration rejected')});
    await assert.rejects(probe.runWithCleanup(f.resources, async ({registerRatingRoute}) => {
        await registerRatingRoute(f.handler);
    }), /registration rejected/);
    assert.equal(f.calls.includes('unroute'), false);
    assert.equal(f.calls.at(-1), 'close');
});
test('route cleanup failure retains captured primary and attempts remaining cleanup', async () => {
    const f = fixture({unroute: Error('guard rejection')});
    const originalStack = f.primary.stack;
    f.resources.api = async (url, method = 'GET') => {
        assert.equal(receipts.at(-1).event, 'primary-captured');
        assert.equal(receipts.at(-1).primary.message, 'original consumer failure');
        // A cleanup collaborator cannot change the already-captured primary evidence.
        f.primary.message = 'changed during cleanup';
        f.primary.stack = 'changed stack';
        f.calls.push(`${method} ${url}`);
        return [{id: 'owned-definition'}];
    };
    await assert.rejects(probe.runWithCleanup(f.resources, async ({at,registerRatingRoute}) => {
        await registerRatingRoute(f.handler);
        await at('day-partial-save', async () => {throw f.primary;});
    }), error => error === f.primary);
    const receipt = receipts.at(-1);
    assert.equal(receipt.primary.message, 'original consumer failure');
    assert.equal(receipt.primary.stack, originalStack);
    assert.deepEqual(receipt.cleanupErrors.map(x => x.operation), ['rating-route-remove']);
    assert.match(receipt.cleanupErrors[0].message, /guard rejection/);
    assert.deepEqual(f.calls.slice(-3), ['DELETE /sessions/owned-session', 'DELETE /api/tasks/owned-task', 'close']);
});
test('definition list failure still attempts session, task and close independently', async () => {
    const f = fixture({'GET /rating-definitions': Error('list failed'), 'DELETE /sessions/owned-session': Error('session failed'), close: Error('close failed')});
    await assert.rejects(probe.runWithCleanup(f.resources, async () => {throw f.primary;}), error => error === f.primary);
    assert.deepEqual(f.calls, ['GET /rating-definitions', 'DELETE /sessions/owned-session', 'DELETE /api/tasks/owned-task', 'close']);
    assert.deepEqual(receipts.at(-1).cleanupErrors.map(x => x.operation), ['definitions-list', 'session-delete', 'context-close']);
});
test('one owned definition delete failure does not skip the next owned fixture or teardown', async () => {
    const f = fixture({'DELETE /rating-definitions/owned-definition': Error('delete failed')});
    f.resources.definitions.push({id: 'other-owned-definition'});
    const originalApi = f.resources.api;
    f.resources.api = async (url, method = 'GET') => {
        if (method === 'GET') {f.calls.push(`${method} ${url}`); return [{id:'owned-definition'}, {id:'other-owned-definition'}, {id:'foreign-definition'}];}
        return originalApi(url, method);
    };
    await assert.rejects(probe.runWithCleanup(f.resources, async () => {throw f.primary;}), error => error === f.primary);
    assert.deepEqual(f.calls, ['GET /rating-definitions', 'DELETE /rating-definitions/owned-definition', 'DELETE /rating-definitions/other-owned-definition', 'DELETE /sessions/owned-session', 'DELETE /api/tasks/owned-task', 'close']);
    assert.deepEqual(receipts.at(-1).cleanupErrors.map(x => x.operation), ['definition-delete:owned-definition']);
});
test('successful body plus cleanup failure fails with structured evidence', async () => {
    const f = fixture({'DELETE /api/tasks/owned-task': Error('task cleanup failed')});
    await assert.rejects(probe.runWithCleanup(f.resources, async () => ({ok:true})), error => {
        assert.equal(error.consumerDiagnostics.status, 'failed');
        assert.equal(error.consumerDiagnostics.primary, null);
        assert.equal(error.consumerDiagnostics.cleanupErrors[0].operation, 'task-delete');
        return /Consumer cleanup failed/.test(error.message);
    });
    assert.equal(f.calls.at(-1), 'close');
});
test('successful body and cleanup return a passing receipt with ordered stage breadcrumbs', async () => {
    const f = fixture();
    const result = await probe.runWithCleanup(f.resources, async ({at,registerRatingRoute}) => {
        await at('task-tab', async () => {});
        await registerRatingRoute(f.handler);
        return {readbacks:['fixture-readback']};
    });
    assert.equal(result.diagnostics.status, 'passed');
    assert.equal(result.diagnostics.primary, null);
    assert.deepEqual(Array.from(result.readbacks), ['fixture-readback']);
    assert.deepEqual(JSON.parse(JSON.stringify(result.diagnostics.breadcrumbs.slice(0,2))), [{stage:'task-tab',event:'before'}, {stage:'task-tab',event:'after'}]);
    assert.equal(f.calls.at(-1), 'close');
});
test('actual probe initialization failure closes an allocated context and preserves primary', async () => {
    const primary = Error('init script rejected'), calls = [];
    const context = {addInitScript: async () => {throw primary;}, close: async () => {calls.push('close');}};
    const page = {context: () => ({browser: () => ({newContext: async () => context})})};
    await assert.rejects(probe(page, 'http://127.0.0.1:18018'), error => error === primary);
    assert.deepEqual(calls, ['close']);
    assert.equal(receipts.at(-1).primary.stage, 'context-init-script');
});
test('malformed definition list is secondary and cannot interrupt remaining teardown', async () => {
    const f = fixture();
    const originalApi = f.resources.api;
    f.resources.api = async (url, method = 'GET') => {
        if (method === 'GET') {f.calls.push(`${method} ${url}`); return {unexpected:true};}
        return originalApi(url, method);
    };
    await assert.rejects(probe.runWithCleanup(f.resources, async () => {throw f.primary;}), error => error === f.primary);
    assert.deepEqual(receipts.at(-1).cleanupErrors.map(x => x.operation), ['definitions-list']);
    assert.deepEqual(f.calls.slice(-3), ['DELETE /sessions/owned-session', 'DELETE /api/tasks/owned-task', 'close']);
});
