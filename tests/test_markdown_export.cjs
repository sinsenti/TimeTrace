const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const root = 'src/timetrace/interfaces/api/static/js/';

function ratingElement(id = '', tag = 'input') {
    const classes = new Set(); let value = '';
    return {id, tagName: tag.toUpperCase(), type: 'text', get value() {return value;}, set value(next) {value = String(next);}, checked: false, disabled: false,
        children: [], dataset: {}, textContent: '', innerText: '', isConnected: true, listeners: {},
        classList: {add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)),
            contains: x => classes.has(x)},
        appendChild(el) { this.children.push(el); return el; }, append(...els) { this.children.push(...els); },
        replaceChildren(...els) { this.children = els; this.innerHTML = ''; },
        setAttribute(name, value) { this[name] = value; }, getAttribute(name) {return this[name];},
        removeChild(el) {this.children = this.children.filter(child => child !== el);}, addEventListener(name, fn) {this.listeners[name] = fn;},
        focus() {this.focused = true;}, contains(el) {return this === el || this.children.includes(el);},
        querySelectorAll(selector) {return this.children.filter(el => selector.startsWith('#') ? el.id === selector.slice(1)
            : ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName));},
        querySelector() {return null;}
    };
}

function browser(withDispatcher = false, withRating = false) {
    const elements = {}, calls = [], replies = [], listeners = {window: [], document: []};
    const register = surface => (type, handler, capture = false) =>
        listeners[surface].push({type, handler, capture: capture === true || capture?.capture === true});
    const document = {
        activeElement: null, addEventListener: register('document'), querySelectorAll: () => [],
        getElementById: id => elements[id] || null,
        createElement: () => ({ click() {}, remove() {} }), body: {appendChild() {}}
    };
    for (const id of ['export_modal', 'export_mode_select', 'export_date_range_group', 'export_start_date',
        'export_end_date', 'export_preview', 'export_status', 'export_provenance', 'export_generate', 'export_copy',
        'export_download', 'calendar']) {
        const classes = new Set(id === 'export_modal' ? ['hidden'] : []);
        elements[id] = {
            id, value: id === 'export_mode_select' ? 'sessions' : '', textContent: '', disabled: false, isConnected: true,
            selectedOptions: [{textContent:'Sessions'}], checkValidity: () => true,
            classList: {add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x)},
            attrs: {}, setAttribute(k,v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
            contains: el => el && el.id?.startsWith('export_'), querySelectorAll: () => [], addEventListener() {},
            focus() { document.activeElement = this; }
        };
    }
    const context = vm.createContext({document, localStorage: {getItem: () => null}, console: {error() {}}, URLSearchParams, Blob,
        URL: {createObjectURL: () => 'blob:export', revokeObjectURL() {}}, setTimeout,
        navigator: {clipboard: {writeText: async () => {}}}, window: {location: {href:'/dashboard'}, addEventListener: register('window')},
        fetch: async (url, options) => {calls.push({url,options}); return new Promise(resolve => replies.push(resolve));}
    });
    if (withRating) {
        for (const id of ['rating_def_modal','edit_rating_def_id','rating_modal_title','modal_rating_name',
            'modal_rating_target_type','modal_rating_min','modal_rating_max','modal_rating_required','modal_rating_desc',
            'modal_rating_delete_btn','modal_rating_save_btn','rating_def_status','rating_defs_new_btn',
            'rating_defs_card_list','rating_defs_status','rating_defs_retry_btn']) {
            elements[id] = ratingElement(id);
            elements[id].focus = () => { document.activeElement = elements[id]; };
        }
        elements.rating_def_modal.children = Object.values(elements).filter(el => el.id.startsWith('modal_rating_'));
        elements.rating_def_modal.classList.add('hidden');
    }
    for (const file of (withDispatcher ? ['api_client.js', 'utils.js', 'dashboard.js'] : ['api_client.js', 'dashboard.js'])) vm.runInContext(fs.readFileSync(root + file,'utf8'),context);
    if (withRating) for (const file of ['settings.js', 'ratings_config.js'])
        vm.runInContext(fs.readFileSync(root + file, 'utf8'), context);
    const run = code => vm.runInContext(code, context);
    const respond = (content, status = 200) => replies.shift()({ok:status === 200,status,headers:{get:()=>'text/markdown'},text:async()=>content,json:async()=>({detail:content})});
    return {elements,calls,replies,context,document,run,respond, escape() {
        const event = {key: 'Escape', defaultPrevented: false, stopped: false, immediate: false,
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; },
            stopImmediatePropagation() { this.stopped = this.immediate = true; }};
        for (const [surface, capture] of [['window', true], ['document', true], ['document', false], ['window', false]]) {
            for (const listener of listeners[surface]) {
                if (listener.type === 'keydown' && listener.capture === capture) listener.handler(event);
                if (event.immediate) break;
            }
            if (event.stopped) break;
        }
        return event;
    }};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('opening Export reads the real agenda through api_client and displays inert Markdown without downloading', async () => {
    const b = browser(); b.run('openExportModal()');
    assert.equal(b.calls[0]?.url, '/api/agenda/export?mode=sessions');
    b.respond('# Real <img src=x onerror=alert(1)>\n**Markdown**'); await settle();
    assert.equal(b.elements.export_preview.value, '# Real <img src=x onerror=alert(1)>\n**Markdown**');
    assert.equal(b.context.window.location.href, '/dashboard');
});

test('Copy waits for clipboard acknowledgement; Download uses current preview bytes and filename without navigation', async () => {
    const b = browser(), copies = [], files = [];
    let finishCopy;
    b.context.navigator.clipboard.writeText = text => {copies.push(text); return new Promise(resolve => finishCopy = resolve);};
    b.context.URL.createObjectURL = blob => {files.push(blob); return 'blob:export';};
    const links = [];
    b.document.createElement = () => {const link = {click() {this.clicked = true;},remove() {}};links.push(link);return link;};
    b.run('openExportModal()'); b.respond('# Literal export\n日本語'); await settle();
    assert.equal(b.run('typeof copyExportPreview'), 'function', 'Copy must be implemented');
    const pending = b.run('copyExportPreview()');
    assert.deepEqual(copies, ['# Literal export\n日本語']);
    assert.match(b.elements.export_status.textContent, /Copying/);
    assert.equal(b.elements.export_copy.disabled, true);
    finishCopy(); await pending;
    assert.match(b.elements.export_status.textContent, /Copied/);
    b.run('triggerExportDownload()');
    assert.equal(await files[0].text(), '# Literal export\n日本語');
    assert.equal(links[0].download, 'timetrace_export_sessions.md'); assert.equal(links[0].clicked, true);
    assert.match(b.elements.export_status.textContent, /requested/);
    assert.equal(b.context.window.location.href, '/dashboard');
});

test('selection changes and close/reopen invalidate late previews and errors; pending activation reads once', async () => {
    const b = browser(); b.run('openExportModal(); generateExportPreview(); triggerExportDownload()');
    assert.equal(b.calls.length, 1); assert.match(b.elements.export_status.textContent, /loading/);
    b.elements.export_mode_select.value = 'tasks_short'; b.run("toggleExportDateInputs('tasks_short')");
    assert.equal(b.calls.length, 2); assert.equal(b.elements.export_copy.disabled, true);
    b.respond('old sessions'); await settle(); assert.equal(b.elements.export_preview.value, '');
    b.respond('new tasks'); await settle(); assert.equal(b.elements.export_preview.value, 'new tasks');
    b.run('generateExportPreview(); closeExportModal(); openExportModal()');
    b.respond('old owner failed', 503); await settle(); assert.doesNotMatch(b.elements.export_status.textContent, /old owner/);
    b.respond('new owner'); await settle(); assert.equal(b.elements.export_preview.value, 'new owner');
    b.elements.export_mode_select.value = 'habits';
    b.run('triggerExportDownload()'); assert.match(b.elements.export_status.textContent, /Generate a current/);
});

test('current read error and empty Markdown keep actions disabled; explicit retry reads only', async () => {
    const b = browser(); b.run('openExportModal()'); b.respond('<untrusted outage>', 503); await settle();
    assert.match(b.elements.export_status.textContent, /<untrusted outage>/);
    assert.equal(b.elements.export_download.disabled, true);
    b.run('generateExportPreview()'); b.respond(''); await settle();
    assert.match(b.elements.export_status.textContent, /empty Markdown/); assert.equal(b.elements.export_copy.disabled, true);
    b.run('generateExportPreview()'); b.respond('recovered'); await settle();
    assert.equal(b.elements.export_copy.disabled, false); assert.ok(b.calls.every(c=>c.options.method === 'GET'));
});

test('clipboard permission denial preserves preview; stale copy acknowledgement cannot replace a newer status', async () => {
    const b = browser(); b.run('openExportModal()'); b.respond('kept Markdown'); await settle();
    b.context.navigator.clipboard.writeText = async () => {throw Error('Permission denied');};
    await b.run('copyExportPreview()'); assert.match(b.elements.export_status.textContent, /Copy failed: Permission denied/);
    assert.equal(b.elements.export_preview.value, 'kept Markdown'); assert.equal(b.elements.export_copy.disabled, false);
    let release;
    b.context.navigator.clipboard.writeText = () => new Promise(resolve => release = resolve);
    const copying = b.run('copyExportPreview()'); b.run('closeExportModal(); openExportModal()');
    const status = b.elements.export_status.textContent; release(); await copying;
    assert.equal(b.elements.export_status.textContent, status);
    b.respond('reopened'); await settle();
});

test('range selection is date-only, optional, inclusive and cleared previews cannot be reused', async () => {
    const b = browser(); b.run('openExportModal()'); b.respond('initial'); await settle();
    b.elements.export_mode_select.value = 'all_date_range';
    b.elements.export_start_date.value = '2026-11-10'; b.elements.export_end_date.value = '2026-11-09';
    b.run("toggleExportDateInputs('all_date_range')"); assert.equal(b.calls.length, 1);
    assert.match(b.elements.export_status.textContent, /Start must not be after End/);
    b.elements.export_end_date.value = '2026-11-10'; b.run('exportInputsChanged(); generateExportPreview()');
    assert.equal(b.calls[1].url, '/api/agenda/export?mode=all_date_range&start_date=2026-11-10&end_date=2026-11-10');
    b.respond('range'); await settle(); b.run('closeExportModal(); openExportModal()');
    assert.equal(b.elements.export_start_date.value, '2026-11-10'); assert.equal(b.elements.export_end_date.value, '2026-11-10');
    assert.equal(b.elements.export_copy.disabled, true); b.respond('current range'); await settle();
});

test('Cancel restores connected launcher, disposed launcher falls back to Calendar and newer dialogs keep focus', async () => {
    const b = browser(); const launcher = {isConnected:true,focus(){b.document.activeElement=this;}};
    b.document.activeElement = launcher; b.run('openExportModal(); closeExportModal()');
    assert.equal(b.document.activeElement, launcher);
    b.run('openExportModal()'); launcher.isConnected=false; b.run('closeExportModal()');
    assert.equal(b.document.activeElement, b.elements.calendar);
    b.run('openExportModal()'); const newer = {isConnected:true}; b.document.activeElement=newer; b.run('closeExportModal()');
    assert.equal(b.document.activeElement,newer);
    for (let i=0;i<3;i++) {b.respond('late'); await settle();}
    assert.equal(b.document.activeElement,newer);
});

test('Export opened over an existing Session returns to its connected Notes launcher without stranding hidden focus', () => {
    const b = browser();
    const notes = {isConnected:true,focus(){b.document.activeElement=this;}};
    const session = {classList:{contains:()=>false},getAttribute:()=>null,contains:el=>el===notes};
    b.document.querySelectorAll = () => [b.elements.export_modal,session];
    b.document.activeElement=notes; b.run('openExportModal(); closeExportModal()');
    assert.equal(b.document.activeElement, notes);
});

function dialog(b, id, openClass = null) {
    const classes = new Set(openClass ? [openClass] : []);
    const field = {value: 'Unsaved draft', isConnected: true, focus() { b.document.activeElement = this; }};
    const modal = {classList: {contains: x => classes.has(x), add: x => classes.add(x), remove: x => classes.delete(x)},
        contains: el => el === field, getAttribute: () => null};
    b.elements[id] = modal;
    return {modal, field};
}

test('Export Escape closes Export above Assistant without discarding the drawer', async () => {
    const b = browser(true), assistant = dialog(b, 'ai_drawer', 'ai-drawer-open');
    b.context.closeAiDrawer = () => assistant.modal.classList.remove('ai-drawer-open');
    b.document.activeElement = assistant.field;
    b.run('openExportModal()'); b.escape();
    assert.equal(b.elements.export_modal.classList.contains('hidden'), true);
    assert.equal(assistant.modal.classList.contains('ai-drawer-open'), true);
    assert.equal(assistant.field.value, 'Unsaved draft');
    assert.equal(b.document.activeElement, assistant.field);
    b.respond('late hidden export'); await settle();
    assert.equal(b.document.activeElement, assistant.field);
});

test('late Export read and Escape preserve the newer editor owner', async () => {
    const b = browser(true), assistant = dialog(b, 'ai_drawer', 'ai-drawer-open');
    b.context.closeAiDrawer = () => assistant.modal.classList.remove('ai-drawer-open');
    b.run('openExportModal()');
    const task = dialog(b, 'task_modal'); task.field.focus();
    b.context.closeTaskModal = () => task.modal.classList.add('hidden');
    b.respond('old export read'); await settle();
    assert.equal(b.document.activeElement, task.field);
    b.escape();
    assert.equal(task.modal.classList.contains('hidden'), true);
    assert.equal(b.elements.export_modal.classList.contains('hidden'), false);
    assert.equal(assistant.modal.classList.contains('ai-drawer-open'), true);
    assert.equal(task.field.value, 'Unsaved draft');
});

test('hidden Export does not change Assistant Escape and visible confirmations retain capture ownership', () => {
    const b = browser(true), assistant = dialog(b, 'ai_drawer', 'ai-drawer-open');
    b.context.closeAiDrawer = () => assistant.modal.classList.remove('ai-drawer-open');
    assistant.field.focus(); b.escape();
    assert.equal(assistant.modal.classList.contains('ai-drawer-open'), false);
    assistant.modal.classList.add('ai-drawer-open'); b.run('openExportModal()');
    dialog(b, 'custom_confirm_modal'); b.escape();
    assert.equal(b.elements.export_modal.classList.contains('hidden'), false);
    assert.equal(assistant.modal.classList.contains('ai-drawer-open'), true);
});


test('delayed task edit lookup over Export returns keyboard ownership to the still-visible preview on Escape', async () => {
    const b = browser(true), assistant = dialog(b, 'ai_drawer', 'ai-drawer-open');
    b.context.closeAiDrawer = () => assistant.modal.classList.remove('ai-drawer-open');
    const task = dialog(b, 'task_modal');
    task.modal.classList.add('hidden');
    task.modal.querySelectorAll = () => [];
    task.field.id = 'modal_input_title'; task.field.select = () => {};
    b.elements.modal_input_title = task.field;
    // The sidebar Edit button invokes this real async public caller. An unloaded registry
    // forces its real api_client GET rather than inventing a newer dialog after Export.
    for (const file of ['task_knowledge.js', 'task_modal.js']) {
        vm.runInContext(fs.readFileSync(root + file, 'utf8'), b.context);
    }
    const sidebarEdit = {isConnected: true, focus() { b.document.activeElement = this; }};
    b.document.activeElement = sidebarEdit;
    const editing = b.run("openEditTaskModal('held-task')");
    assert.equal(b.calls[0].url, '/api/tasks/held-task');
    assert.equal(task.modal.classList.contains('hidden'), true);
    b.run('openExportModal()');
    b.replies.shift()({ok:true,status:200,headers:{get:()=> 'application/json'},
        json:async()=>({id:'held-task',title:'Requested task',status:'To Do'})});
    await editing;
    assert.equal(b.document.activeElement, task.field);
    task.field.value = 'Retained Task draft';
    b.respond('Current Markdown'); await settle();
    assert.equal(b.document.activeElement, task.field);
    b.escape();
    assert.equal(task.modal.classList.contains('hidden'), true);
    assert.equal(task.field.value, 'Retained Task draft');
    assert.equal(b.elements.export_modal.classList.contains('hidden'), false);
    assert.equal(b.document.activeElement, b.elements.export_mode_select,
        'closing the newer editor must return focus to the visible Export, above the sidebar');
    b.escape();
    assert.equal(b.elements.export_modal.classList.contains('hidden'), true);
    assert.equal(assistant.modal.classList.contains('ai-drawer-open'), true);
});


test('Export handback respects resumed Session focus and a Task closer declining discard', () => {
    const b = browser(true); b.run('openExportModal()');
    const task = dialog(b, 'task_modal'), session = dialog(b, 'session_modal');
    session.modal.classList.add('hidden');task.field.focus();
    b.context.closeTaskModal = () => {};
    b.escape();
    assert.equal(task.modal.classList.contains('hidden'), false);
    assert.equal(b.document.activeElement, task.field);
    b.context.closeTaskModal = () => {
        task.modal.classList.add('hidden');session.modal.classList.remove('hidden');session.field.focus();
    };
    b.escape();
    assert.equal(b.document.activeElement, session.field);
    assert.equal(session.modal.classList.contains('hidden'), false);
    assert.equal(b.elements.export_modal.classList.contains('hidden'), false);
    // A closer may resume another editor; the Export handback cannot steal that focus.
    session.modal.classList.add('hidden');task.modal.classList.remove('hidden');task.field.focus();
    const newer = dialog(b, 'widget_builder_modal');newer.modal.classList.add('hidden');
    b.context.closeTaskModal = () => {
        task.modal.classList.add('hidden');newer.modal.classList.remove('hidden');newer.field.focus();
    };
    b.escape();assert.equal(b.document.activeElement, newer.field);
});

test('Export keeps recovery and higher deletion/completion confirmations ahead of its focused controls', () => {
    for (const id of ['idle_resolution_modal', 'recurring_delete_modal', 'completion_policy_modal']) {
        const b = browser(true); b.run('openExportModal()');
        const prompt = dialog(b, id);
        b.context.closeRecurringDeleteModal = () => prompt.modal.classList.add('hidden');
        b.context.closeCompletionPolicyModal = () => prompt.modal.classList.add('hidden');
        b.escape();
        assert.equal(b.elements.export_modal.classList.contains('hidden'), false, id);
        if (id === 'idle_resolution_modal') assert.equal(prompt.modal.classList.contains('hidden'), false);
        else assert.equal(prompt.modal.classList.contains('hidden'), true);
    }
});


test('visible Export stays ahead of Assistant when focus temporarily returns to the Calendar', () => {
    const b = browser(true), assistant = dialog(b, 'ai_drawer', 'ai-drawer-open');
    b.context.closeAiDrawer = () => assistant.modal.classList.remove('ai-drawer-open');
    b.run('openExportModal()');b.elements.calendar.focus();b.escape();
    assert.equal(b.elements.export_modal.classList.contains('hidden'), true);
    assert.equal(assistant.modal.classList.contains('ai-drawer-open'), true);
});

function combined() {
    const b = browser(true, true), assistant = dialog(b, 'ai_drawer', 'ai-drawer-open');
    b.context.closeAiDrawer = () => assistant.modal.classList.remove('ai-drawer-open');
    b.run('openExportModal(); openNewRatingDefModal()');
    b.elements.modal_rating_name.value = 'Unsaved scale';
    return {b, assistant};
}
function retained(b, assistant) {
    assert.equal(b.elements.export_modal.classList.contains('hidden'), false);
    assert.equal(assistant.modal.classList.contains('ai-drawer-open'), true);
    assert.equal(assistant.field.value, 'Unsaved draft');
    assert.equal(b.elements.modal_rating_name.value, 'Unsaved scale');
    assert.ok(b.calls.every(call => call.options.method === 'GET'));
}
for (const focus of ['export', 'rating', 'assistant', 'calendar']) {
    test(`combined real capture gives ${focus} focus the visible top owner`, () => {
        const {b, assistant} = combined();
        ({export: b.elements.export_mode_select, rating: b.elements.modal_rating_name,
            assistant: assistant.field, calendar: b.elements.calendar})[focus].focus();
        const event = b.escape();
        assert.equal(b.elements.export_modal.classList.contains('hidden'), focus === 'export');
        assert.equal(b.elements.rating_def_modal.classList.contains('hidden'), focus !== 'export');
        assert.equal(assistant.modal.classList.contains('ai-drawer-open'), true);
        assert.equal(b.elements.modal_rating_name.value, 'Unsaved scale');
        assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
        assert.equal(b.calls.length, 1);
    });
}
for (const owner of ['task_modal', 'session_modal']) for (const decline of [false, true])
    for (const late of ['pending', 'pending failure', 'success', 'failure']) {
        test(`combined ${owner} ${decline ? 'declines' : 'accepts'} Escape after Export ${late}`, async () => {
            const {b, assistant} = combined(), editor = dialog(b, owner);
            let closes = 0, blurs = 0, unselects = 0;
            editor.field.blur = () => { blurs++; };
            b.context.calendar = {unselect() { unselects++; }};
            b.context[owner === 'task_modal' ? 'closeTaskModal' : 'closeSessionModal'] = () => {
                closes++; if (!decline) editor.modal.classList.add('hidden');
            };
            editor.field.focus();
            if (!late.startsWith('pending')) { b.respond('late preview', late === 'failure' ? 503 : 200); await settle(); }
            assert.equal(b.document.activeElement, editor.field);
            const event = b.escape(); retained(b, assistant);
            assert.equal(editor.modal.classList.contains('hidden'), !decline);
            assert.equal(b.elements.rating_def_modal.classList.contains('hidden'), false);
            assert.equal(editor.field.value, 'Unsaved draft'); assert.equal(closes, 1);
            assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
            if (decline) {
                assert.equal(blurs, 0); assert.equal(unselects, 0);
                assert.equal(b.document.activeElement, editor.field);
                b.escape(); assert.equal(closes, 2); retained(b, assistant);
            }
            if (late.startsWith('pending')) {
                const focus = b.document.activeElement;
                b.respond('late preview', late === 'pending failure' ? 503 : 200); await settle();
                assert.equal(b.document.activeElement, focus); retained(b, assistant);
            }
        });
    }
for (const rating of [false, true]) for (const focus of ['export', 'rating']) for (const prompt of ['custom_confirm_modal', 'recurring_resize_modal',
    'idle_resolution_modal', 'completion_policy_modal', 'recurring_delete_modal']) {
    test(`combined higher ${prompt} captures Escape with Rating ${rating ? 'visible' : 'hidden'} and ${focus} focus`, () => {
        const {b, assistant} = combined();
        if (!rating) b.run('closeRatingDefModal()');
        const higher = dialog(b, prompt); let closes = 0;
        b.context.closeCompletionPolicyModal = b.context.closeRecurringDeleteModal = () => {
            closes++; higher.modal.classList.add('hidden');
        };
        if (['custom_confirm_modal', 'recurring_resize_modal', 'idle_resolution_modal'].includes(prompt))
            b.document.addEventListener('keydown', event => {
                closes++; higher.modal.classList.add('hidden'); event.preventDefault(); event.stopImmediatePropagation();
            }, true);
        (focus === 'rating' && rating ? b.elements.modal_rating_name : b.elements.export_mode_select).focus();
        const event = b.escape();
        assert.equal(closes, 1); assert.equal(higher.modal.classList.contains('hidden'), true);
        assert.equal(b.elements.rating_def_modal.classList.contains('hidden'), !rating);
        retained(b, assistant); assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
    });
}
test('combined recurring deletion outranks recovery without dismissing it', () => {
    const {b, assistant} = combined(); const recovery = dialog(b, 'idle_resolution_modal'), deletion = dialog(b, 'recurring_delete_modal');
    b.context.closeRecurringDeleteModal = () => deletion.modal.classList.add('hidden');
    const event = b.escape();
    assert.equal(deletion.modal.classList.contains('hidden'), true);
    assert.equal(recovery.modal.classList.contains('hidden'), false); retained(b, assistant);
    assert.equal(event.stopped, true);
});
test('combined accepted Task close preserves resumed Session focus above Rating and Export', () => {
    const {b, assistant} = combined(), task = dialog(b, 'task_modal'), session = dialog(b, 'session_modal');
    session.modal.classList.add('hidden'); task.field.focus();
    b.context.closeTaskModal = () => {task.modal.classList.add('hidden'); session.modal.classList.remove('hidden'); session.field.focus();};
    b.escape(); assert.equal(b.document.activeElement, session.field); retained(b, assistant);
    assert.equal(b.elements.rating_def_modal.classList.contains('hidden'), false);
});
test('capture fixture preserves same-target listeners but stops later targets', () => {
    const b = browser(); const seen = [];
    b.context.window.addEventListener('keydown', event => {seen.push('first'); event.stopPropagation();}, true);
    b.context.window.addEventListener('keydown', () => seen.push('second'), true);
    b.document.addEventListener('keydown', () => seen.push('document'), true);
    b.escape(); assert.deepEqual(seen, ['first', 'second']);
});
test('capture fixture stopImmediatePropagation stops same-target listeners too', () => {
    const b = browser(); const seen = [];
    b.context.window.addEventListener('keydown', event => {seen.push('first'); event.stopImmediatePropagation();}, true);
    b.context.window.addEventListener('keydown', () => seen.push('second'), true);
    b.escape(); assert.deepEqual(seen, ['first']);
});

for (const focus of ['assistant', 'calendar']) test(`Rating alone beats stale ${focus} focus above Assistant`, () => {
    const {b, assistant} = combined(); b.run('closeExportModal()');
    (focus === 'assistant' ? assistant.field : b.elements.calendar).focus();
    const event = b.escape();
    assert.equal(b.elements.rating_def_modal.classList.contains('hidden'), true);
    assert.equal(assistant.modal.classList.contains('ai-drawer-open'), true);
    assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
});
test('hidden Rating and Export retain ordinary Assistant Escape', () => {
    const {b, assistant} = combined(); b.run('closeRatingDefModal(); closeExportModal()');
    assistant.field.focus(); const event = b.escape();
    assert.equal(assistant.modal.classList.contains('ai-drawer-open'), false);
    assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
});
test('pending Rating Save Escape preserves Export and Assistant after late ACK', async () => {
    const {b, assistant} = combined();
    b.respond('preview'); await settle();
    b.elements.modal_rating_name.focus(); const saving = b.run('saveRatingDefinition()');
    assert.equal(b.calls.length, 2); assert.equal(b.calls[1].options.method, 'POST');
    const event = b.escape();
    assert.equal(b.elements.rating_def_modal.classList.contains('hidden'), true);
    assert.equal(b.elements.export_modal.classList.contains('hidden'), false);
    assert.equal(assistant.modal.classList.contains('ai-drawer-open'), true);
    b.replies.shift()({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({id:'saved-scale'})});
    await settle();
    if (b.replies.length) b.replies.shift()({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>[]});
    await saving;
    assert.equal(b.elements.rating_def_modal.classList.contains('hidden'), true);
    assert.equal(b.elements.export_modal.classList.contains('hidden'), false);
    assert.equal(assistant.modal.classList.contains('ai-drawer-open'), true);
    assert.equal(b.calls.filter(call => call.options.method !== 'GET').length, 1);
    assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
});

for (const focus of ['export', 'calendar']) test(`hidden Rating preserves Export ownership with ${focus} focus`, () => {
    const {b, assistant} = combined(); b.run('closeRatingDefModal()');
    (focus === 'export' ? b.elements.export_mode_select : b.elements.calendar).focus();
    const event = b.escape();
    assert.equal(b.elements.export_modal.classList.contains('hidden'), true);
    assert.equal(assistant.modal.classList.contains('ai-drawer-open'), true);
    assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
});
