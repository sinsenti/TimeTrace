const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js/completion_policy.js');

function element(id = '') {
    const classes = new Set();
    let html = '';
    return {
        id,
        checked: false,
        innerText: '',
        classList: {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name)
        },
        get innerHTML() { return html; },
        set innerHTML(value) { html = value; },
        getAttribute(name) { return this.attributes?.[name] ?? null; }
    };
}

function fixture() {
    const ids = [
        'completion_policy_modal_title',
        'completion_policy_session_list',
        'completion_policy_subtask_row',
        'completion_policy_include_subtasks',
        'completion_policy_subtask_label',
        'completion_policy_modal'
    ];
    const fields = Object.fromEntries(ids.map(id => [id, element(id)]));
    const writes = [];
    const sessionId = '0190aabb-ccdd-7eef-8a11-223344556677';
    const otherSessionId = '0190aabb-ccdd-7eef-8a11-223344556688';
    fields.completion_policy_session_list.innerHTML = '';
    const document = {
        getElementById: id => fields[id] || null,
        querySelectorAll: selector => selector === '.completion_policy_session_checkbox'
            ? [sessionId, otherSessionId].map(id => ({
                checked: true,
                getAttribute: name => name === 'data-session-id' ? id : null
            }))
            : []
    };
    const context = vm.createContext({
        document,
        console: { error() {} },
        parseApiDateTime: value => new Date(value),
        api: { post: async (url, body) => { writes.push({ url, body }); } },
        taskKnowledge: { changed: async () => {} }
    });
    vm.runInContext(fs.readFileSync(source, 'utf8'), context);
    return { context, fields, writes, sessionId, otherSessionId };
}

const ownSessions = (sessionId, otherSessionId) => [
    { id: sessionId, start_time: '2026-11-15T09:00:00Z', end_time: '2026-11-15T10:00:00Z' },
    { id: otherSessionId, start_time: '2026-11-15T10:00:00Z', end_time: '2026-11-15T11:00:00Z' }
];

test('completion policy resets a hidden subtree choice between P2 and P3 while preserving own-session selection', async () => {
    const b = fixture();
    const handle = b.context.handleCompletionPolicy;
    const clear = b.context.clearCompletionPolicySessions;

    handle({ completion_policy: {
        task_id: '0190aabb-ccdd-7eef-8a11-223344556699',
        reason: 'left_scheduled',
        scheduled_sessions: ownSessions(b.sessionId, b.otherSessionId),
        subtask_scheduled_count: 1
    } });
    assert.equal(b.fields.completion_policy_subtask_row.classList.contains('hidden'), false);
    b.fields.completion_policy_include_subtasks.checked = true;
    await clear();
    assert.equal(b.writes[0].body.include_subtasks, true);
    assert.equal(b.writes[0].body.session_ids, null);

    handle({ completion_policy: {
        task_id: '0190aabb-ccdd-7eef-8a11-223344556699',
        reason: 'completed',
        scheduled_sessions: ownSessions(b.sessionId, b.otherSessionId),
        subtask_scheduled_count: 0
    } });
    assert.equal(b.fields.completion_policy_subtask_row.classList.contains('hidden'), true);
    assert.equal(b.fields.completion_policy_include_subtasks.checked, false);
    b.fields.completion_policy_session_list.innerHTML = '';
    const ownSelection = [
        { checked: true, getAttribute: () => b.sessionId },
        { checked: false, getAttribute: () => b.otherSessionId }
    ];
    b.context.document.querySelectorAll = () => ownSelection;
    await clear();

    assert.deepEqual(JSON.parse(JSON.stringify(b.writes[1])), {
        url: '/api/tasks/0190aabb-ccdd-7eef-8a11-223344556699/clear-scheduled-sessions',
        body: { include_subtasks: false, session_ids: [b.sessionId] }
    });
});

test('completion policy can clear an empty own-session selection and the whole subtree', async () => {
    const b = fixture();
    b.context.handleCompletionPolicy({ completion_policy: {
        task_id: '0190aabb-ccdd-7eef-8a11-223344556699',
        reason: 'completed',
        scheduled_sessions: ownSessions(b.sessionId, b.otherSessionId),
        subtask_scheduled_count: 2
    } });
    b.fields.completion_policy_include_subtasks.checked = true;
    b.context.document.querySelectorAll = () => [
        { checked: false, getAttribute: () => b.sessionId },
        { checked: false, getAttribute: () => b.otherSessionId }
    ];

    await b.context.clearCompletionPolicySessions();

    assert.deepEqual(JSON.parse(JSON.stringify(b.writes[0].body)), { include_subtasks: true, session_ids: [] });
});

test('completion refuses a selected protected plan instead of trimming the requested clear', async () => {
    const b = fixture();
    b.fields.completion_policy_feedback = element();
    const sessions = ownSessions(b.sessionId, b.otherSessionId);
    sessions[1].kind = 'scheduled_session';
    b.context.handleCompletionPolicy({ completion_policy: {
        task_id: 'task', reason: 'completed', scheduled_sessions: sessions, subtask_scheduled_count: 0
    } });
    await b.context.clearCompletionPolicySessions();
    assert.equal(b.writes.length, 0);
    assert.match(b.fields.completion_policy_feedback.textContent, /not available/i);
    b.context.document.querySelectorAll = () => [
        { checked: true, getAttribute: () => b.sessionId },
        { checked: false, getAttribute: () => b.otherSessionId }
    ];
    await b.context.clearCompletionPolicySessions();
    assert.deepEqual(Array.from(b.writes[0].body.session_ids), [b.sessionId]);
});
