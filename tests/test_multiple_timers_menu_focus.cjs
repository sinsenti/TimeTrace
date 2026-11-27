const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const web = path.resolve(__dirname, '../src/timetrace/interfaces/api');
const tick = () => new Promise(setImmediate);

// DOM boundary for the actual shared-strip template and DOMContentLoaded mount. Removing
// a focused subtree resets focus to body, as in a browser; controller/render code is not stubbed.
function mountMenu({review=false}={}) {
    const listeners = new Map(), intervals = [], calls = [], planReads = [];
    let document;
    class Element {
        constructor(tag) {
            this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {};
            this.listeners = {}; this.parentNode = null; this.ownerDocument = document;
            this.textContent = ''; this.value = ''; this.replacements = 0;
        }
        append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
        contains(node) { return node === this || this.children.some(child => child.contains(node)); }
        replaceChildren(...nodes) {
            this.replacements++;
            for (const child of this.children) {
                if (child.contains(document.activeElement)) document.activeElement = document.body;
                child.parentNode = null;
            }
            this.children = []; this.append(...nodes);
        }
        setAttribute(name, value) {
            this.attributes[name] = value;
            if (name === 'id') this.id = value;
            if (name === 'class') this.className = value;
            if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
        }
        matches(selector) {
            if (selector.startsWith('.')) return this.className === selector.slice(1);
            assert.match(selector, /^\[[\w-]+\]$/, `unsupported selector ${selector}`);
            return Object.hasOwn(this.attributes, selector.slice(1, -1)) ||
                (selector.startsWith('[data-') && Object.hasOwn(this.dataset, selector.slice(6, -1).replace(/-([a-z])/g, (_, c) => c.toUpperCase())));
        }
        querySelectorAll(selector) {
            return this.children.flatMap(child => [child, ...child.descendants()]).filter(node => node.matches(selector));
        }
        descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        addEventListener(type, handler) { this.listeners[type] = handler; }
        get isConnected(){return document.body.contains(this);}
        showModal(){this.open=true;}
        close(){this.open=false;}
        remove(){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}
        focus() { assert.ok(document.body.contains(this), 'only connected controls can be focused'); document.activeElement = this; }
    }
    document = {
        createElement: tag => new Element(tag),
        addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); },
        getElementById: id => document.body.descendants().find(node => node.id === id) || null,
        querySelectorAll: selector => document.body.querySelectorAll(selector)
    };
    document.body = new Element('body'); document.activeElement = document.body;
    // Only the shared timer section is needed; scripts are loaded explicitly below.
    const html = fs.readFileSync(path.join(web, 'templates/components/timer_workspace_bar.html'), 'utf8');
    const section = html.slice(html.indexOf('<section id="multiple_timers"'), html.indexOf('<section data-focus-alerts'));
    const stack = [document.body];
    for (const [token] of section.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
        if (!token.startsWith('<')) { stack.at(-1).textContent += token; continue; }
        if (token.startsWith('</')) { stack.pop(); continue; }
        const tag = token.match(/^<(\w+)/)[1], node = new Element(tag);
        for (const [, name, value] of token.slice(tag.length + 1, -1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(name, value ?? '');
        stack.at(-1).append(node);
        if (tag !== 'input') stack.push(node);
    }
    const timer = {id:'paused-timer',revision:7,task_id:'task',task_title:'Reading',state:'paused',scheduled_session_id:'plan',elapsed_seconds:60};
    const other = {id:'other-timer',revision:3,state:'running',elapsed_seconds:10};
    const window = {location:{search:'',href:'http://unit.invalid/dashboard'},addEventListener(){},dispatchEvent(){}};
    const values = new Map();
    const context = vm.createContext({document, window, URLSearchParams, crypto:require('node:crypto').webcrypto,
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        sessionStorage:{getItem:key => values.get(key) ?? null,setItem:(key,value) => values.set(key,value),removeItem:key => values.delete(key)},
        setInterval(fn, delay) { intervals.push({fn,delay}); },
        api:{
            async get(url) {
                calls.push(['GET',url]);
                if (url === '/api/tasks') return [];
                if (url === '/timers') return {revision:12,timers:[{...timer},{...other}]};
                assert.equal(url, '/scheduled-sessions/plan');
                return new Promise(resolve => planReads.push(resolve));
            },
            async post(url,payload) {
                calls.push(['POST',url]);
                if(!review)throw Error('No mutation expected');
                if(url.endsWith('/stop-review')){
                    timer.revision++;timer.stop_review={id:payload.operation_id,was_running:false};
                    return {operation_id:payload.operation_id,timer:{...timer}};
                }
                assert.equal(url,'/timers/paused-timer/stop-preview');
                return {candidates:[],actual_parts:[],blocked:{actual:[],continue:['Already paused'],fit:['No work'],split:['No work'],scheduled:['No work']},effects:{},consent_token:'exact'};
            }
        }});
    vm.runInContext(fs.readFileSync(path.join(web, 'static/js/stop_review.js'), 'utf8'), context, {filename:'stop_review.js'});
    vm.runInContext(fs.readFileSync(path.join(web, 'static/js/multiple_timers.js'), 'utf8'), context, {filename:'multiple_timers.js'});
    for (const handler of listeners.get('DOMContentLoaded')) handler();
    return {document,window,calls,planReads,intervals,timer,other};
}

test('mounted shared menu preserves exact Resume DOM and focus across periodic plan loading/ready generations without writes', async () => {
    const p = mountMenu(); await tick();
    const region = p.document.getElementById('multiple_timers');
    const menu = region.querySelector('[data-timer-expander]'); menu.open = true;
    const list = region.querySelector('[data-timer-list]');
    const plan = {id:'plan',task_id:'task',start_time:'2026-01-02T09:00:00Z',end_time:'2026-01-02T10:00:00Z'};
    assert.equal(p.window.multipleTimers.snapshot().planContext.status, 'loading');
    p.planReads.shift()(plan); await tick();
    assert.equal(p.window.multipleTimers.snapshot().planContext.status, 'ready');
    const resume = list.querySelectorAll('[data-timer-focus]').find(node => node.dataset.timerFocus === 'paused-timer/pause-resume');
    assert.equal(resume.textContent, 'Resume'); assert.equal(resume.disabled, false);
    resume.focus();
    const rows = list.querySelectorAll('.multiple-timer-row');
    const controls = list.querySelectorAll('[data-timer-focus]');
    const replacements = list.replacements;
    const poll = p.intervals.find(interval => interval.delay === 3000); assert.ok(poll);
    const assertRetained = phase => {
        assert.equal(list.replacements, replacements, `${phase}: unchanged timer controls must not rebuild`);
        const currentRows = list.querySelectorAll('.multiple-timer-row');
        const currentControls = list.querySelectorAll('[data-timer-focus]');
        assert.equal(currentRows.length, rows.length); assert.equal(currentControls.length, controls.length);
        rows.forEach((row, index) => assert.equal(currentRows[index], row, `${phase}: exact row identity`));
        controls.forEach((control, index) => assert.equal(currentControls[index], control, `${phase}: exact control identity`));
        assert.equal(p.document.activeElement, resume, `${phase}: focus stays on original Resume`);
        assert.equal(resume.disabled, false); assert.equal(menu.open, true);
        assert.equal(p.window.multipleTimers.snapshot().selectedTimerId, p.timer.id);
        assert.equal(p.window.multipleTimers.snapshot().timers[0].state, 'paused');
        assert.equal(p.window.multipleTimers.snapshot().timers[0].scheduled_session_id, 'plan');
        assert.equal(p.calls.filter(([method]) => method !== 'GET').length, 0);
    };
    for (let generation = 0; generation < 2; generation++) {
        p.other.elapsed_seconds++;
        poll.fn(); await tick();
        assert.equal(p.window.multipleTimers.snapshot().planContext.status, 'loading');
        assertRetained(`generation ${generation} loading`);
        assert.match(rows[0].querySelector('.timer-plan-context').children[0].textContent, /loading current schedule/);
        assert.match(rows[1].querySelector('[data-timer-label]').textContent, new RegExp(`0:${11 + generation} live`));
        const current = {...plan,start_time:`2026-01-02T0${7 + generation}:00:00Z`};
        p.planReads.shift()(current); await tick();
        assert.equal(p.window.multipleTimers.snapshot().planContext.status, 'ready');
        const context = rows[0].querySelector('.timer-plan-context');
        assert.ok(context.children[0].textContent.includes(new Date(current.start_time).toLocaleString()));
        assert.equal(context.children[1].textContent, 'Open linked plan');
        assertRetained(`generation ${generation} ready`);
    }
    assert.equal(p.calls.filter(([,url]) => url === '/timers').length, 3);
    assert.equal(p.calls.filter(([,url]) => url === '/scheduled-sessions/plan').length, 3);
});

test('#67 mounted shared-menu Stop opens durable paused review, and Escape keeps paused with no commit',async()=>{
    const p=mountMenu({review:true});await tick();
    const stop=p.document.getElementById('multiple_timers').querySelectorAll('[data-timer-focus]').find(n=>n.dataset.timerFocus==='paused-timer/stop');
    stop.focus();await stop.listeners.click();await tick();
    const dialog=p.document.body.children.find(n=>n.tagName==='dialog');
    assert.ok(dialog,'shared Stop mounts app-owned review');
    assert.equal(p.timer.state,'paused');
    assert.equal(p.calls.filter(c=>c[0]==='POST'&&!c[1].endsWith('/stop-preview')).length,1);
    assert.ok(p.calls.some(c=>c[1]==='/timers/paused-timer/stop-review'));
    dialog.listeners.cancel({preventDefault(){}});
    const currentStop=p.document.getElementById('multiple_timers').querySelectorAll('[data-timer-focus]').find(n=>n.dataset.timerFocus==='paused-timer/stop');
    assert.equal(p.document.activeElement,currentStop,'dismissal restores the replacement Stop control, not removed DOM');
    assert.equal(p.calls.filter(c=>c[1].endsWith('/stop-commit')).length,0);
});
