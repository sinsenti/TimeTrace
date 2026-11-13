const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
function element(id = '', tag = 'input') {
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
function browser(respond = () => ({json: []})) {
    const ids = ['rating_def_modal','edit_rating_def_id','rating_modal_title','modal_rating_name','modal_rating_target_type',
        'modal_rating_min','modal_rating_max','modal_rating_required','modal_rating_desc','modal_rating_delete_btn',
        'modal_rating_save_btn','rating_def_status','rating_defs_card_list','rating_defs_status','rating_defs_retry_btn','rating_defs_new_btn'];
    const fields = Object.fromEntries(ids.map(id => [id, element(id)]));
    fields.rating_def_modal.children = Object.values(fields).filter(el => el.id.startsWith('modal_rating_'));
    fields.rating_def_modal.classList.add('hidden');
    const writes = [], reads = [], events = {}, listeners = {window: [], document: []};
    const register = surface => (name, fn, capture = false) => {
        listeners[surface].push({name, fn, capture: capture === true || capture?.capture === true});
        if (surface === 'document') events[name] = fn;
    };
    const context = vm.createContext({URL, console: {error(){}}, setTimeout, clearTimeout,
        document: {activeElement: fields.rating_defs_new_btn, body: element('body'),
            getElementById: id => fields[id] || null, createElement: tag => element('', tag), querySelectorAll: () => [],
            addEventListener: register('document'), documentElement: {setAttribute(){}, style: {setProperty(){}}}},
        window: {location: {href: 'http://localhost/revision'}, addEventListener: register('window'), confirm: () => false},
        localStorage: {getItem: () => null, setItem(){}}, showCustomConfirm: async () => true,
        fetch: async (url, options) => {
            (options.method === 'GET' ? reads : writes).push({url, method: options.method, body: options.body && JSON.parse(options.body)});
            const result = await respond(url, options);
            return {ok: (result.status || 200) < 400, status: result.status || 200,
                headers: {get: () => 'application/json'}, json: async () => result.json};
        }});
    for (const field of Object.values(fields)) field.focus = () => {
        field.focused = true; context.document.activeElement = field;
    };
    const run = code => vm.runInContext(code, context);
    const keydown = (key, options = {}) => {
        const event = {key, ...options, prevented: false, defaultPrevented: false, stopped: false, immediate: false,
            preventDefault() {this.prevented = this.defaultPrevented = true;}, stopPropagation() {this.stopped = true;},
            stopImmediatePropagation() {this.stopped = this.immediate = true;}};
        // Native order: window capture, document capture, document bubble, window bubble.
        for (const [surface, capture] of [['window', true], ['document', true], ['document', false], ['window', false]]) {
            for (const listener of listeners[surface]) {
                if (listener.name === 'keydown' && listener.capture === capture) listener.fn(event);
                if (event.immediate) break;
            }
            if (event.stopped) break;
        }
        return event;
    };
    for (const file of ['api_client.js','settings.js','utils.js','ratings_config.js']) run(fs.readFileSync(path.join(js, file), 'utf8'));
    return {fields, writes, reads, run, events, context, keydown};
}

test('Save preserves valid zero and negative API bounds', async () => {
    const b = browser((url, options) => ({json: options.method === 'POST' ? {id: 'new-definition'} : []}));
    b.run('openNewRatingDefModal()');
    b.fields.modal_rating_name.value = 'Zero-based'; b.fields.modal_rating_min.value = '-10'; b.fields.modal_rating_max.value = '0';
    await b.run('saveRatingDefinition()');
    assert.equal(b.writes[0].body.min_score, -10);
    assert.equal(b.writes[0].body.max_score, 0);
});

test('Pending Save is single-write; ACK adopts ID and preserves concurrent draft; refresh retry reads only', async () => {
    const held = deferred(); let failedRead = true;
    const b = browser((url, options) => options.method === 'POST' ? held.promise
        : failedRead ? {status: 503, json: {detail: 'Synthetic list failure'}} : {json: []});
    b.run('openNewRatingDefModal()'); b.fields.modal_rating_name.value = 'Submitted';
    const saving = b.run('saveRatingDefinition()');
    b.fields.modal_rating_name.value = 'Concurrent typing';
    const duplicate = b.run('saveRatingDefinition()');
    held.resolve({json: {id: 'created-id'}}); await Promise.all([saving, duplicate]); await tick();
    assert.equal(b.writes.length, 1);
    assert.equal(b.fields.edit_rating_def_id.value, 'created-id');
    assert.equal(b.fields.modal_rating_name.value, 'Concurrent typing');
    assert.equal(b.fields.rating_def_modal.classList.contains('hidden'), false);
    assert.equal(b.run("hasSettingsDrafts(['rating_def_modal'])"), true);
    assert.match(b.fields.rating_defs_status.textContent, /saved.*refresh/i);
    failedRead = false; await b.run('loadRatingDefinitionsList()');
    assert.equal(b.writes.length, 1);
    b.fields.modal_rating_name.value = 'Submitted';
    assert.equal(b.run("hasSettingsDrafts(['rating_def_modal'])"), false);
});

test('Existing single-editor consumer renders hostile names/descriptions inertly', async () => {
    const b = browser(() => ({json: [{id: 'def-id', name: '<img src=x onerror=alert(1)>', description: '<svg onload=alert(2)>',
        min_score: 0, max_score: 10, is_required: true}]}));
    b.fields.day_custom_ratings_container = element('day_custom_ratings_container', 'div');
    await b.run("renderCustomRatingsInputs('day', '2026-11-01', 'day_custom_ratings_container')");
    assert.ok(!b.fields.day_custom_ratings_container.innerHTML.includes('<img'));
    assert.ok(!b.fields.day_custom_ratings_container.innerHTML.includes('<svg'));
    assert.ok(b.fields.day_custom_ratings_container.innerHTML.includes('&lt;img'));
});

for (const completion of ['success', 'failure']) test(`Late ${completion} cannot close or checkpoint a newer rating editor`, async () => {
    const held = deferred();
    const b = browser((url, options) => options.method === 'POST' ? held.promise : {json: []});
    b.run('openNewRatingDefModal()'); b.fields.modal_rating_name.value = 'Old submit';
    const saving = b.run('saveRatingDefinition()');
    b.run('closeRatingDefModal(); openNewRatingDefModal()'); b.fields.modal_rating_name.value = 'New owner draft';
    held.resolve(completion === 'success' ? {json: {id: 'old-id'}} : {status: 400, json: {detail: 'Synthetic rejection'}});
    await saving;
    assert.equal(b.fields.edit_rating_def_id.value, '');
    assert.equal(b.fields.modal_rating_name.value, 'New owner draft');
    assert.equal(b.fields.rating_def_modal.classList.contains('hidden'), false);
    assert.equal(b.run("hasSettingsDrafts(['rating_def_modal'])"), true);
    assert.equal(b.fields.rating_def_status.textContent, '');
});

test('Older initial list cannot overwrite acknowledged post-Save list', async () => {
    const held = deferred(); let first = true;
    const b = browser((url, options) => options.method === 'POST' ? {json: {id: 'saved-id'}}
        : first ? (first = false, held.promise) : {json: [{id: 'saved-id', name: 'Saved', target_type: 'day', min_score: 0, max_score: 5}]} );
    const initial = b.run('loadRatingDefinitionsList()');
    b.run('openNewRatingDefModal()'); b.fields.modal_rating_name.value = 'Saved'; await b.run('saveRatingDefinition()');
    held.resolve({json: [{id: 'stale-id', name: 'Stale'}]}); await initial;
    assert.equal(b.fields.rating_defs_card_list.children[0].children[0].textContent, 'Saved');
});

test('Rejected Save retains draft; Cancel and confirmation cancellation never write', async () => {
    const b = browser((url, options) => options.method === 'GET' ? {json: [{id: 'existing', name: 'Stored', target_type: 'day', min_score: 0, max_score: 5}]}
        : {status: 400, json: {detail: 'Synthetic rejection'}});
    await b.run('loadRatingDefinitionsList();'); b.run("openEditRatingDefModal('existing')");
    b.fields.modal_rating_name.value = 'Rejected'; await b.run('saveRatingDefinition()');
    assert.equal(b.fields.rating_def_modal.classList.contains('hidden'), false);
    assert.equal(b.run("hasSettingsDrafts(['rating_def_modal'])"), true);
    b.run('showCustomConfirm = async () => false'); await b.run('deleteRatingDefinition()');
    b.run('closeRatingDefModal()'); assert.equal(b.writes.length, 1);
});

test('Delete confirmation belongs to its captured editor, not a later opening', async () => {
    const held = deferred();
    const b = browser(() => ({json: [{id: 'existing', name: 'Stored', target_type: 'day', min_score: 0, max_score: 5}]}));
    b.context.heldConfirm = held.promise;
    await b.run('loadRatingDefinitionsList()'); b.run("openEditRatingDefModal('existing'); showCustomConfirm = () => heldConfirm");
    const deleting = b.run('deleteRatingDefinition()');
    b.run('closeRatingDefModal(); openNewRatingDefModal()'); b.fields.modal_rating_name.value = 'Other draft';
    held.resolve(true); await deleting;
    assert.equal(b.writes.length, 0);
    assert.equal(b.fields.modal_rating_name.value, 'Other draft');
});

test('Shared grade helper keeps five ordered bands and nondefault boundaries', () => {
    const b = browser();
    for (const [score, color] of [[0,'red'],[1,'red'],[2,'orange'],[3,'orange'],[4,'amber'],[5,'amber'],[6,'lime'],[7,'lime'],[8,'emerald'],[10,'emerald']]) {
        assert.equal(b.run(`getGradeColorClasses(${score},0,10).text`), `text-${color}-400`);
    }
    assert.equal(b.run('getGradeColorClasses(-10,-10,0).text'), 'text-red-400');
    assert.equal(b.run('getGradeColorClasses(0,-10,0).text'), 'text-emerald-400');
    assert.equal(b.run('getGradeColorClasses(0,0,0).text'), 'text-slate-400');
    for (const [score, color] of [[1,'red'],[2,'orange'],[3,'amber'],[4,'lime'],[5,'emerald']]) {
        assert.match(b.run(`getGradeColorClasses(${score},1,5).badge`), new RegExp(`bg-${color}-900`));
    }
});

test('Rejected Save does not strand an in-flight initial read in Loading', async () => {
    const held = deferred();
    const b = browser((url, options) => options.method === 'GET' ? held.promise : {status:400,json:{detail:'Synthetic rejection'}});
    const initial = b.run('loadRatingDefinitionsList()');
    b.run('openNewRatingDefModal()'); b.fields.modal_rating_name.value = 'Rejected';
    await b.run('saveRatingDefinition()');
    held.resolve({json:[{id:'stored',name:'Still stored',target_type:'day',min_score:1,max_score:5}]}); await initial;
    assert.equal(b.fields.rating_defs_card_list['aria-busy'], 'false');
    assert.equal(b.fields.rating_defs_card_list.children[0].children[0].textContent, 'Still stored');
});

for (const raw of ['', '1.5', 'not-a-number']) test(`Invalid bound ${JSON.stringify(raw)} retains draft without write`, async () => {
    const b = browser(); b.run('openNewRatingDefModal()');
    b.fields.modal_rating_name.value = 'Kept'; b.fields.modal_rating_min.value = raw;
    await b.run('saveRatingDefinition()');
    assert.equal(b.writes.length, 0);
    assert.equal(b.fields.rating_def_modal.classList.contains('hidden'), false);
    assert.match(b.fields.rating_def_status.textContent, /whole-number/);
});

test('Definition cards render literal API text and retain last good cards after a read failure', async () => {
    let failed = false;
    const b = browser(() => failed ? {status:503,json:{detail:'Synthetic read failure'}} : {json:[{id:'literal',name:'<img src=x>',description:'<script>bad()</script>',target_type:'<custom>',min_score:0,max_score:0}]});
    await b.run('loadRatingDefinitionsList()');
    const card = b.fields.rating_defs_card_list.children[0];
    assert.equal(card.tagName, 'BUTTON'); assert.equal(card.children[0].textContent, '<img src=x>');
    assert.equal(card.children[2].textContent, '<script>bad()</script>');
    failed = true; await b.run('loadRatingDefinitionsList()');
    assert.equal(b.fields.rating_defs_card_list.children[0], card);
    assert.equal(b.fields.rating_defs_retry_btn.hidden, false);
});

test('Unknown contexts and equal or reversed bounds stay editable without duplicate temporary options', async () => {
    const b = browser((url, options) => ({json: options.method === 'GET' ? [{id:'unknown',name:'Custom',target_type:'<unknown>',min_score:5,max_score:-2}] : {id:'unknown'}}));
    await b.run('loadRatingDefinitionsList()');
    b.run("openEditRatingDefModal('unknown'); closeRatingDefModal(); openEditRatingDefModal('unknown')");
    assert.equal(b.fields.modal_rating_target_type.children.length, 1);
    assert.equal(b.fields.modal_rating_target_type.value, '<unknown>');
    await b.run('saveRatingDefinition()');
    assert.equal(b.writes[0].body.min_score, 5); assert.equal(b.writes[0].body.max_score, -2);
    b.run("openEditRatingDefModal('unknown')"); b.fields.modal_rating_max.value = '5';
    await b.run('saveRatingDefinition()'); assert.equal(b.writes[1].body.max_score, 5);
});

test('Two editor score controls update only their known grade wrappers and retain dismissal and invalid numeric draft', async () => {
    const b = browser();
    for (const [key,value] of [['main_scale','20'],['history_scale','2']]) {
        const card = element('', 'div'); card.className = 'rev-card preserved-card';
        const band = element('', 'div'); band.className = 'custom-rating-band text-amber-400';
        band.classList.add('custom-rating-band'); band.parentElement = card;
        const input = element(`rating_range_input_${key}`); input.type = 'number'; input.value = value;
        input.parentElement = band;
        b.fields[input.id] = input; b.fields[`score_label_${key}`] = element(); b.fields[`dismiss_btn_${key}`] = element();
    }
    b.run("onRatingRangeInput('main_scale', 0, 10)");
    assert.equal(b.fields.rating_range_input_main_scale.value, '20');
    assert.match(b.fields.rating_range_input_main_scale.parentElement.className, /text-emerald-400/);
    assert.equal(b.fields.rating_range_input_main_scale.parentElement.parentElement.className, 'rev-card preserved-card');
    assert.equal(b.fields.rating_range_input_history_scale.parentElement.className, 'custom-rating-band text-amber-400');
    b.run("toggleDismissRatingInput('history_scale', 0, 10)");
    assert.equal(b.fields.rating_range_input_history_scale.disabled, true);
    assert.equal(b.fields.rating_range_input_main_scale.disabled, false);
    assert.equal(b.fields.score_label_history_scale.innerText, 'Dismissed');
    b.run("toggleDismissRatingInput('history_scale', -10, 0)");
    assert.equal(b.fields.score_label_history_scale.innerText, '2 / 0');
    assert.match(b.fields.score_label_history_scale.className, /text-emerald-400/);
    assert.equal(b.writes.length, 0);
});

test('Definition refresh retains an out-of-range raw draft inside the new grade wrapper', async () => {
    const b = browser(() => ({json:[{id:'scale',name:'Refreshed <scale>',min_score:0,max_score:5}]}));
    const oldInput = element('rating_range_input_retained_scale'); oldInput.value = '9'; oldInput.min = '0'; oldInput.max = '10';
    const oldCard = {getAttribute:()=> 'scale',querySelector:()=>oldInput};
    let cards = [oldCard], rendered = '';
    const container = {id:'retained',ratingBaselines:new Map([[oldInput.id, JSON.stringify(['3',false])]]),
        querySelectorAll:()=>cards, appendChild:card=>cards.push(card),
        get innerHTML(){return rendered;}, set innerHTML(html){
            rendered = html;
            const input = element('rating_range_input_retained_scale'); input.min = '0'; input.max = '5'; input.value = '3';
            const band = element('', 'div'); band.classList.add('custom-rating-band');
            const card = element('', 'div'); card.className = 'rev-card space-y-2'; band.parentElement = card; input.parentElement = band;
            input.replaceWith = retained => {retained.parentElement = band; card.input = retained;};
            card.input = input; card.getAttribute = ()=>'scale'; card.querySelector = selector=>selector==='button' ? b.fields.dismiss_btn_retained_scale : card.input;
            cards = [card];
            b.fields[input.id] = oldInput; b.fields.score_label_retained_scale = element(); b.fields.dismiss_btn_retained_scale = element();
        }};
    b.fields.retained = container;
    await b.run("renderCustomRatingsInputs('day','2026-11-01','retained',[],()=>true,document.getElementById('retained'),true)");
    assert.equal(cards[0].input, oldInput); assert.equal(oldInput.value, '9'); assert.equal(oldInput.type, 'number');
    assert.match(oldInput.parentElement.className,/custom-rating-band text-emerald-400/);
    assert.equal(oldInput.parentElement.parentElement.className,'rev-card space-y-2');
    assert.match(rendered,/aria-label="Refreshed &lt;scale&gt;"/);
});

test('History rating affordances use the shared five grades without changing selection or dismissed state', () => {
    const b = browser(); b.fields.day_history_grid = element('day_history_grid','div');
    b.run("let dayReviewEditor={date:'2026-11-10'};let currentDayHistoryFilter='all';let expandedHistoryDate=null;");
    b.run(fs.readFileSync(path.join(js,'day_history.js'),'utf8'));
    b.run(`allDayHistoryList = [1,2,3,4,5].map(rating=>({date_str:'2026-11-0'+rating,has_review:true,rating,total_hours:0,session_count:0}));
        allDayHistoryList.push({date_str:'2026-11-06',has_review:true,rating:5,review_skipped:true,total_hours:0,session_count:0});renderDayHistoryGrid();`);
    for (const [index,color] of ['red','orange','amber','lime','emerald'].entries()) {
        const card=b.fields.day_history_grid.children[index];
        assert.match(card.children[1].className,new RegExp(`bg-${color}-900`));
        assert.match(card.children[1].textContent,new RegExp(`Reviewed \\(${index+1}/5\\)`));
        assert.equal(typeof card.listeners.click,'function');
    }
    assert.doesNotMatch(b.fields.day_history_grid.children[5].className,/bg-emerald/);
    assert.match(b.fields.day_history_grid.children[5].textContent,/Dismissed/);
});

test('Escape closes the rating dialog above an already open Assistant through real capture ordering', () => {
    const b = browser();
    b.fields.ai_drawer = element('ai_drawer', 'div'); b.fields.ai_drawer.classList.add('ai-drawer-open');
    b.run("function closeAiDrawer(){document.getElementById('ai_drawer').classList.remove('ai-drawer-open');} openNewRatingDefModal();");
    const event = b.keydown('Escape');
    assert.equal(b.fields.rating_def_modal.classList.contains('hidden'), true);
    assert.equal(b.fields.ai_drawer.classList.contains('ai-drawer-open'), true);
    assert.equal(b.context.document.activeElement, b.fields.rating_defs_new_btn);
    assert.equal(event.prevented, true); assert.equal(event.stopped, true); assert.equal(b.writes.length, 0);
});

for (const prompt of ['custom_confirm_modal', 'recurring_resize_modal', 'idle_resolution_modal', 'completion_policy_modal', 'recurring_delete_modal']) {
    test(`Higher ${prompt} owns Escape above rating administration`, () => {
        const b = browser(); b.run('openNewRatingDefModal()');
        b.fields[prompt] = element(prompt, 'div');
        // Dynamic prompts install capture handlers when opened, after the static rating handler.
        b.run(`function closeCompletionPolicyModal(){document.getElementById('completion_policy_modal').classList.add('hidden');}
            function closeRecurringDeleteModal(){document.getElementById('recurring_delete_modal').classList.add('hidden');}
            document.addEventListener('keydown', event => {
                if(event.key !== 'Escape') return;
                document.getElementById('${prompt}').classList.add('hidden');
                event.preventDefault(); event.stopImmediatePropagation();
            }, true);`);
        const event = b.keydown('Escape');
        assert.equal(b.fields[prompt].classList.contains('hidden'), true);
        assert.equal(b.fields.rating_def_modal.classList.contains('hidden'), false);
        assert.equal(event.prevented, true); assert.equal(event.stopped, true); assert.equal(b.writes.length, 0);
    });
}

for (const owner of ['task_modal', 'session_modal']) for (const decline of [false, true]) {
    test(`Newer focused ${owner} owns Escape when close is ${decline ? 'declined' : 'accepted'}`, () => {
        const b = browser();
        b.fields.ai_drawer = element('ai_drawer', 'div'); b.fields.ai_drawer.classList.add('ai-drawer-open');
        b.run('openNewRatingDefModal()');
        b.fields[owner] = element(owner, 'div');
        const input = element(`${owner}_notes`); b.fields[owner].appendChild(input); b.context.document.activeElement = input;
        const close = owner === 'task_modal' ? 'closeTaskModal' : 'closeSessionModal';
        b.run(`function ${close}(){${decline ? '' : `document.getElementById('${owner}').classList.add('hidden');`}}`);
        const event = b.keydown('Escape');
        assert.equal(b.fields[owner].classList.contains('hidden'), !decline);
        assert.equal(b.fields.rating_def_modal.classList.contains('hidden'), false);
        assert.equal(b.fields.ai_drawer.classList.contains('ai-drawer-open'), true);
        assert.equal(event.prevented, true); assert.equal(event.stopped, true); assert.equal(b.writes.length, 0);
    });
}

test('Escape during pending rating Save closes only its dialog and late ACK preserves underlying Assistant', async () => {
    const held = deferred(); const b = browser((url, options) => options.method === 'POST' ? held.promise : {json: []});
    b.fields.ai_drawer = element('ai_drawer', 'div'); b.fields.ai_drawer.classList.add('ai-drawer-open');
    b.run('openNewRatingDefModal()'); b.fields.modal_rating_name.value = 'Pending scale';
    const saving = b.run('saveRatingDefinition()'); b.keydown('Escape');
    assert.equal(b.fields.rating_def_modal.classList.contains('hidden'), true);
    assert.equal(b.fields.ai_drawer.classList.contains('ai-drawer-open'), true);
    held.resolve({json: {id: 'pending-scale'}}); await saving;
    assert.equal(b.fields.ai_drawer.classList.contains('ai-drawer-open'), true);
    assert.equal(b.fields.rating_def_modal.classList.contains('hidden'), true);
    assert.equal(b.writes.length, 1);
});
