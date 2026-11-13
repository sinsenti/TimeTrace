const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync('src/timetrace/interfaces/api/static/js/api_client.js', 'utf8');
function client(fetch) {
    const context = vm.createContext({fetch, TextDecoder, console});
    vm.runInContext(source + '\nglobalThis.client = api;', context);
    return context.client;
}
test('ApiClient.stream returns generic JSON without AI-specific events', async () => {
    const payload = {message: {content: '<literal>'}};
    const result = await client(async () => Response.json(payload)).stream('/chat', {}, () => assert.fail('JSON is not SSE'));
    assert.deepEqual(result, payload);
});
test('ApiClient.stream forwards AbortSignal and stops pending HTTP', async () => {
    const controller = new AbortController();
    const api = client((_url, options) => new Promise((_resolve, reject) => {
        assert.equal(options.signal, controller.signal);
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = api.stream('/chat', {}, () => {}, {}, {signal: controller.signal});
    controller.abort();
    await assert.rejects(pending, {name: 'AbortError'});
});
test('ApiClient.stream parses split UTF8, CRLF, comments, multiline data and EOF', async () => {
    const bytes = new TextEncoder().encode(': hello\r\nevent: token\r\ndata: {"text":"é"}\r\n\r\nevent: status\ndata: first\ndata: second\n\nevent: end\ndata: {}');
    const events = [];
    const body = new ReadableStream({start(c) {for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close();}});
    await client(async () => new Response(body)).stream('/chat', {}, event => events.push(JSON.parse(JSON.stringify(event))));
    assert.deepEqual(events, [{event:'token', data:{text:'é'}}, {event:'status',data:'first\nsecond'}, {event:'end',data:{}}]);
    assert.equal(body.locked, false);
});
test('ApiClient.stream releases and cancels reader when handler throws', async () => {
    let canceled = false;
    const body = new ReadableStream({start(c) {c.enqueue(new TextEncoder().encode('data: {}\n\n'));}, cancel() {canceled = true;}});
    await assert.rejects(client(async () => new Response(body)).stream('/chat', {}, () => {throw Error('handler');}), /handler/);
    assert.equal(canceled, true);
    assert.equal(body.locked, false);
});
test('ApiClient.stream preserves HTTP error reporting', async () => {
    await assert.rejects(client(async () => Response.json({detail:'Synthetic failure'}, {status:502})).stream('/chat', {}, () => {}), /Synthetic failure/);
});
test('ApiClient.stream releases errored reader after mid-stream abort and keeps four-argument headers', async () => {
    const controller = new AbortController();
    const body = new ReadableStream({start(c) {
        c.enqueue(new TextEncoder().encode('event: token\ndata: {"text":"partial"}\n\n'));
        controller.signal.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError')));
    }});
    const events=[];
    const api=client(async (_url, options) => {
        assert.equal(options.headers['X-Synthetic'], 'retained');
        assert.equal(JSON.parse(options.body).stream, true);
        return new Response(body);
    });
    await assert.rejects(api.stream('/chat', {stream:true}, event => {events.push(event);controller.abort();}, {'X-Synthetic':'retained'}, {signal:controller.signal}), {name:'AbortError'});
    assert.equal(events.length,1);
    assert.equal(body.locked,false);
});
