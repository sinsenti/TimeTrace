const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PlanRemovalController} = require('../src/timetrace/interfaces/api/static/js/plan_removal.js');
test('preview is read only, approval exact, lost ACK recovery reads receipt without replay', async () => {
    const calls = [];
    const api = {
        get: async path => { calls.push(['GET', path]); return {consent_token:'scope', manifest:{work:[]}}; },
        post: async (path, payload) => { calls.push(['POST', path, payload]); throw Error('lost ACK'); },
    };
    const c = new PlanRemovalController(api, 'plan');
    await c.load();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'GET');
    await assert.rejects(c.apply('delete_everything'), /lost ACK/);
    assert.equal(calls[1][2].consent_token, 'scope');
    await c.recover();
    assert.equal(calls[2][0], 'GET');
    assert.ok(decodeURIComponent(calls[2][1]).includes('plan-removal:' + c.attempt.operation_id));
    await assert.rejects(c.apply('squeeze'), /fresh manifest/);
    assert.equal(calls.filter(c => c[0] === 'POST').length, 1);
});
