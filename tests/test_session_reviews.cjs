const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; }
let activeDocument;
function node(tag = 'div', id = '') {
    const classes = new Set(), listeners = {};
    const el = {id, tagName:tag.toUpperCase(), type:'text', value:'', checked:false, disabled:false, dataset:{}, style:{}, children:[], textContent:'', listeners,
        classList:{add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle(x,on=!classes.has(x)){on?classes.add(x):classes.delete(x);}},
        appendChild(child){if(child.parentNode){const i=child.parentNode.children.indexOf(child);if(i>=0)child.parentNode.children.splice(i,1);}this.children.push(child);child.parentNode=this;return child;},
        append(...children){children.forEach(child=>this.appendChild(child));},replaceChildren(...children){this.children.splice(0);this.append(...children);},
        setAttribute(k,v){this[k]=String(v);},getAttribute(k){return this[k] ?? null;},removeAttribute(k){delete this[k];},addEventListener(k,fn){listeners[k]=fn;},removeEventListener(k,fn){if(listeners[k]===fn)delete listeners[k];},focus(){this.focused=true;if(activeDocument)activeDocument.activeElement=this;},getClientRects(){return [1];},contains(target){return target===this||this.querySelectorAll('*').includes(target);},
        replaceWith(other){const p=this.parentNode,i=p.children.indexOf(this);p.children[i]=other;other.parentNode=p;},
        querySelectorAll(selector){return this.children.flatMap(child=>[child,...child.querySelectorAll('*')]).filter(child=>selector.split(',').some(s=>{
            s=s.trim();if(s==='*')return true;if(s.startsWith('#'))return child.id===s.slice(1);if(s.startsWith('.'))return child.classList.contains(s.slice(1));
            if(s==='[data-rating-def-id]')return !!child['data-rating-def-id'];if(s==='[data-session-action]')return !!child.dataset.sessionAction;
            return child.tagName.toLowerCase()===s;
        }));},querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    };
    Object.defineProperty(el,'innerText',{get(){return this.textContent;},set(value){this.textContent=String(value);}});
    Object.defineProperty(el,'innerHTML',{get(){return this.html||'';},set(html){
        this.html=html;this.children.splice(0);
        // Only the existing shared rating renderer emits HTML in these caller fixtures.
        for(const match of html.matchAll(/<div class="rev-card[^]*?<\/div>\s*<p[^]*?<\/div>/g)){
            const text=match[0],card=node(),input=node('input',text.match(/id="(rating_range_input_[^"]+)"/)[1]);
            card['data-rating-def-id']=text.match(/data-rating-def-id="([^"]+)"/)[1];card['data-required']=text.match(/data-required="([^"]+)"/)[1];
            input.value=text.match(/value="([^"]*)"/)[1];input.type='range';input.min=text.match(/min="([^"]+)"/)[1];input.max=text.match(/max="([^"]+)"/)[1];input.disabled=/value="[^"]*" disabled/.test(text);input.classList.add('custom-rating-input');
            const label=node('span',text.match(/id="(score_label_[^"]+)"/)[1]),button=node('button',text.match(/id="(dismiss_btn_[^"]+)"/)[1]);
            card.append(label,button,input);this.appendChild(card);
        }
    }});
    return el;
}
function browser(respond = () => ({})) {
    const fields={};
    for(const id of ['session_review_modal','session_custom_ratings_container','session_rev_modal_id','session_rev_modal_tags','session_rev_modal_notes','session_rev_modal_skip_check','session_rev_modal_time','session_rev_modal_status','session_rev_list_status','session_rev_modal_save','session_rev_modal_retry','session_rev_modal_reset','session_rev_modal_delete','session_rev_modal_cancel','session_rev_save','session_rev_delete','session_rev_reset','session_rev_retry','session_rev_search','session_rev_count_badge','sessions_review_list',...['all','reviewed','missed','dismissed'].map(x=>'sess_filter_'+x)])fields[id]=node(id.includes('notes')?'textarea':id.includes('modal_tags')||id.includes('skip_check')||id.endsWith('_id')?'input':'div',id);
    fields.session_rev_modal_skip_check.type='checkbox';fields.session_review_modal.classList.add('hidden');
    fields.session_review_modal.append(...['session_rev_modal_id','session_rev_modal_tags','session_rev_modal_notes','session_rev_modal_skip_check','session_custom_ratings_container'].map(id=>fields[id]));
    const writes=[],reads=[],confirms=[];let confirm=async()=>true;
    const handlers=[];
    const document={body:node('body'),activeElement:null,getElementById:id=>fields[id]||Object.values(fields).flatMap(el=>el.querySelectorAll('*')).find(el=>el.id===id)||null,createElement:tag=>node(tag),querySelectorAll:()=>[],addEventListener(type,fn,capture=false){handlers.push({type,fn,capture});},removeEventListener(type,fn){const i=handlers.findIndex(h=>h.type===type&&h.fn===fn);if(i>=0)handlers.splice(i,1);},documentElement:{style:{setProperty(){}},setAttribute(){}}};
    activeDocument=document;
    const context=vm.createContext({document,URL,URLSearchParams,Intl,Event,TextDecoder,console:{error(){}},setTimeout:fn=>fn(),alert(){},localStorage:{getItem:()=>null,setItem(){}},window:{location:{href:'http://localhost/revision'},addEventListener(){},confirm:()=>false},currentSessionReviewFilter:'all',roundVal:(v,p)=>Math.round(v*10**p)/10**p,loadCurrentRevisionView:async()=>{},showCustomConfirm:async(...args)=>{confirms.push(args);return confirm(...args);},fetch:async(url,options)=>{
        const request={url,method:options.method,body:options.body?JSON.parse(options.body):null};(options.method==='GET'?reads:writes).push(request);
        const result=await respond(request)||{};return {ok:(result.status||200)<400,status:result.status||200,headers:{get:()=> 'application/json'},json:async()=>result.json};
    }});
    const run=code=>vm.runInContext(code,context);
    for(const file of ['api_client.js','settings.js','ratings_config.js','session_review.js'])run(fs.readFileSync(path.join(js,file),'utf8'));
    return {fields,writes,reads,run,context,confirms,
        key(key,shiftKey=false){const event={key,shiftKey,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};for(const h of [...handlers].sort((a,b)=>Number(b.capture)-Number(a.capture))){if(h.type==='keydown'){h.fn(event);if(event.stopped)break;}}return event;},
        realConfirm(){for(const id of ['custom_confirm_modal','confirm_modal_title','confirm_modal_message','confirm_modal_cancel_btn','confirm_modal_proceed_btn'])fields[id]=node(id.endsWith('_btn')?'button':'div',id);fields.custom_confirm_modal.classList.add('hidden');fields.custom_confirm_modal.append(fields.confirm_modal_cancel_btn,fields.confirm_modal_proceed_btn);run(fs.readFileSync(path.join(js,'utils.js'),'utf8'));},
        confirm:fn=>confirm=fn,input:(index=0)=>fields.session_custom_ratings_container.querySelectorAll('.custom-rating-input')[index]};
}
const defs=[{id:'one',name:'Required zero scale',is_required:true,min_score:0,max_score:4},{id:'two',name:'Second scale',min_score:2,max_score:8}];
const row=id=>({id,start_time:'2026-11-01T10:00:00Z',end_time:'2026-11-01T11:00:00Z',tags:'#seed',notes:'Baseline',review_skipped:false});
function standard(request){if(request.url.startsWith('/rating-definitions'))return {json:defs};if(request.url.startsWith('/rating-entries'))return {json:[]};if(request.url.startsWith('/sessions/'))return {json:row(request.url.slice(10))};return {json:[]};}

test('fresh Sessions tab renders API rows and preserves independent review filters without preloaded list state',async()=>{
    const b=browser(r=>r.url==='/sessions'?{json:[
        {...row('reviewed-and-exempt'),review_skipped:true},
        {...row('task-exempt'),task_id:'T'},
        {...row('missed-one'),notes:'First missed'},
        {...row('missed-two'),notes:'Second missed'}
    ]}:r.url==='/api/tasks?status=all'?{json:[{id:'T',title:'Exempt task',requires_session_review:false}]}:
        r.url==='/rating-entries?target_type=session&target_id=all'?{json:[{target_id:'reviewed-and-exempt',dismissed:false}]}:standard(r));
    b.fields.rev_tab_sessions=node('section','rev_tab_sessions');b.fields.rev_tab_sessions.classList.add('hidden');
    b.run(fs.readFileSync(path.join(js,'revision_nav.js'),'utf8'));
    b.run("switchRevisionTab('sessions', false)");await tick();
    const list=b.fields.sessions_review_list;
    const titles=()=>list.querySelectorAll('strong').map(el=>el.textContent);
    assert.equal(b.fields.rev_tab_sessions.classList.contains('hidden'),false);
    assert.equal(b.fields.session_rev_list_status.textContent,'');
    assert.deepEqual(titles(),['Baseline','Exempt task','First missed','Second missed']);
    assert.equal(list.querySelectorAll('article').length,4);
    b.run("setSessionReviewFilter('reviewed')");assert.deepEqual(titles(),['Baseline']);
    b.run("setSessionReviewFilter('dismissed')");assert.deepEqual(titles(),['Baseline','Exempt task']);
    b.run("setSessionReviewFilter('missed')");assert.deepEqual(titles(),['First missed','Second missed']);
    b.run("setSessionReviewFilter('all')");assert.equal(list.querySelectorAll('article').length,4);
    assert.equal(b.writes.length,0);
});

test('cancel invalidates late session hydration and cannot reopen its dialog',async()=>{
    const held=deferred(),b=browser(r=>r.url==='/sessions/A'?held.promise:standard(r));
    const loading=b.run("openSessionReviewModal('A')");b.run('closeSessionReviewModal()');held.resolve({json:row('A')});await loading;
    assert.equal(b.fields.session_review_modal.classList.contains('hidden'),true);assert.equal(b.writes.length,0);
});

test('late A read cannot hydrate newer selected B and save before ratings initialization writes nothing',async()=>{
    const held=deferred(),entries=deferred(),b=browser(r=>r.url==='/sessions/A'?held.promise:r.url==='/rating-entries?target_type=session&target_id=B'?entries.promise:standard(r));
    const loadingA=b.run("openSessionReviewModal('A')"),loadingB=b.run("openSessionReviewModal('B')");await tick();
    await b.run('saveSessionReviewModal()');assert.equal(b.writes.length,0);
    entries.resolve({json:[]});await loadingB;held.resolve({json:row('A')});await loadingA;
    assert.equal(b.fields.session_rev_modal_id.value,'B');assert.equal(b.fields.session_rev_modal_notes.value,'Baseline');
});

test('session Save freezes all scoped rating values before PUT and later edits remain dirty',async()=>{
    const held=deferred(),b=browser(r=>r.method==='PUT'?held.promise:standard(r));
    await b.run("openSessionReviewModal('A')");b.fields.session_rev_modal_notes.value='Submitted';b.input(0).value='0';b.input(1).value='7';
    const outside=node('input','day_rating');outside.value='5';outside.classList.add('custom-rating-input');b.fields.day_custom_ratings_container=node('div','day_custom_ratings_container');b.fields.day_custom_ratings_container.appendChild(outside);
    const saving=b.run('saveSessionReviewModal()');await tick();b.input(0).value='4';b.input(1).disabled=true;b.fields.session_rev_modal_notes.value='New draft';
    held.resolve({json:row('A')});await saving;
    assert.deepEqual(b.writes.filter(r=>r.method==='POST').map(r=>[r.body.target_id,r.body.score,r.body.dismissed]),[['A',0,false],['A',7,false]]);
    assert.equal(b.fields.session_review_modal.classList.contains('hidden'),false);assert.equal(b.run('hasSettingsDrafts()'),true);assert.equal(outside.value,'5');
});

test('partial session retry skips acknowledged identical text and first rating',async()=>{
    let fail=true;const b=browser(r=>r.method==='POST'&&r.body.rating_definition_id==='two'&&fail?(fail=false,{status:503,json:{detail:'Synthetic second rating failure'}}):standard(r));
    await b.run("openSessionReviewModal('A')");b.fields.session_rev_modal_notes.value='Submitted';b.input(0).value='0';b.input(1).value='7';
    await b.run('saveSessionReviewModal()');assert.equal(b.writes.length,3);assert.equal(b.fields.session_review_modal.classList.contains('hidden'),false);
    assert.match(b.fields.session_rev_modal_status.textContent,/rat|partial|sav/i);assert.equal(b.run('hasSettingsDrafts()'),true);
    await b.run('saveSessionReviewModal()');assert.equal(b.writes.length,4);assert.equal(b.writes[3].body.rating_definition_id,'two');
});

test('required zero and dismissed ratings use actual scoped helper and cancel retires nested draft',async()=>{
    const b=browser(standard);await b.run("openSessionReviewModal('A')");b.input(0).value='0';b.input(1).disabled=true;
    await b.run('saveSessionReviewModal()');assert.deepEqual(b.writes.filter(r=>r.method==='POST').map(r=>[r.body.score,r.body.dismissed]),[[0,false],[0,true]]);
    await b.run("openSessionReviewModal('A')");b.input(0).value='4';assert.equal(b.run('hasSettingsDrafts()'),true);
    b.run('closeSessionReviewModal()');assert.equal(b.run('hasSettingsDrafts()'),false);
});

test('dirty session switch canceled confirmation preserves original exact owner',async()=>{
    const b=browser(standard);await b.run("openSessionReviewModal('A')");b.fields.session_rev_modal_notes.value='Private A';b.confirm(async()=>false);
    await b.run("openSessionReviewModal('B')");assert.equal(b.fields.session_rev_modal_id.value,'A');assert.equal(b.fields.session_rev_modal_notes.value,'Private A');assert.equal(b.confirms.length,1);assert.equal(b.writes.length,0);
});

for(const action of ['resetSessionReview','deleteSessionFromReviewModal']) test(`${action} confirmation belongs to its originating editor incarnation`,async()=>{
    const held=deferred(),b=browser(standard);await b.run("openSessionReviewModal('A')");b.confirm(()=>held.promise);const acting=b.run(`${action}()`);b.run('closeSessionReviewModal()');await b.run("openSessionReviewModal('B')");held.resolve(true);await acting;
    assert.equal(b.writes.length,0);assert.equal(b.fields.session_rev_modal_id.value,'B');
});

test('quick exemption writes only review_skipped and preserves independent reviewed filter membership',async()=>{
    const b=browser(r=>r.url==='/sessions'?{json:[{...row('A'),review_skipped:true,task_id:'T'}]}:r.url==='/api/tasks?status=all'?{json:[{id:'T',title:'Task',requires_session_review:false}]}:r.url.includes('target_id=all')?{json:[{target_id:'A',dismissed:false}]}:standard(r));
    await b.run('loadAllSessionsReview()');assert.equal(b.fields.sessions_review_list.querySelectorAll('article').length,1);
    b.run("setSessionReviewFilter('reviewed')");assert.match(b.fields.session_rev_count_badge.textContent,/1/);b.run("setSessionReviewFilter('dismissed')");assert.match(b.fields.session_rev_count_badge.textContent,/1/);b.run("setSessionReviewFilter('missed')");assert.match(b.fields.session_rev_count_badge.textContent,/0/);
    await b.run("quickDismissSessionReview('A')");assert.deepEqual(b.writes.map(r=>[r.method,r.url,r.body]),[['PUT','/sessions/A',{review_skipped:true}]]);
});

test('failed list classifications remain unknown instead of manufacturing missed reviews',async()=>{
    const b=browser(r=>r.url==='/sessions'?{json:[row('A')]}:r.url.includes('target_id=all')||r.url==='/api/tasks?status=all'?{status:503,json:{detail:'Synthetic metadata failure'}}:standard(r));
    await b.run('loadAllSessionsReview()');assert.equal(b.fields.sessions_review_list.querySelectorAll('article').length,1);assert.match(b.fields.session_rev_list_status.textContent,/unavailable|fail|retry/i);
    b.run("setSessionReviewFilter('missed')");assert.equal(b.fields.sessions_review_list.querySelectorAll('article').length,0);
});

test('session list untrusted notes tags and task labels render only as text',async()=>{
    const hostile='<img src=x onerror="boom()">';const b=browser(r=>r.url==='/sessions'?{json:[{...row('A'),tags:hostile,notes:hostile,task_id:'T'}]}:r.url==='/api/tasks?status=all'?{json:[{id:'T',title:hostile,description:hostile}]}:standard(r));
    await b.run('loadAllSessionsReview()');const list=b.fields.sessions_review_list;
    assert.equal(list.innerHTML.includes('<img'),false);assert.equal(list.querySelectorAll('img').length,0);
    assert.ok(list.querySelectorAll('button').length>0,'keyboard-selectable session action');
});

test('partial reset retries only unfinished exemption stage',async()=>{
    let fail=true;const b=browser(r=>r.method==='PUT'&&fail?(fail=false,{status:503,json:{detail:'Synthetic reset PUT failure'}}):standard(r));
    await b.run("openSessionReviewModal('A')");await b.run('resetSessionReview()');
    assert.deepEqual(b.writes.map(r=>r.method),['DELETE','PUT']);assert.equal(b.fields.session_review_modal.classList.contains('hidden'),false);
    await b.run('resetSessionReview()');assert.deepEqual(b.writes.map(r=>r.method),['DELETE','PUT','PUT']);assert.deepEqual(b.writes.at(-1).body,{review_skipped:false});
});

test('virtual session materialization retargets frozen rating bodies to the real id',async()=>{
    const real='019b0000-0000-7000-8000-000000000007',virtual='virt:task:2026-11-01T10:00:00';
    const b=browser(r=>r.method==='PUT'?{json:row(real)}:r.url.startsWith('/sessions/')?{json:row(virtual)}:standard(r));
    b.context.target=virtual;await b.run('openSessionReviewModal(target)');b.input(0).value='0';await b.run('saveSessionReviewModal()');
    assert.deepEqual(b.writes.filter(r=>r.method==='POST').map(r=>r.body.target_id),[real,real]);assert.equal(b.writes[0].url,'/sessions/'+encodeURIComponent(virtual));
});

test('same target refresh retains initialized text and ratings instead of rehydrating saved values',async()=>{
    const b=browser(standard);await b.run("openSessionReviewModal('A')");b.fields.session_rev_modal_notes.value='Private current draft';b.input(0).value='4';b.input(1).disabled=true;
    await b.run("openSessionReviewModal('A')");assert.equal(b.fields.session_rev_modal_notes.value,'Private current draft');assert.equal(b.input(0).value,'4');assert.equal(b.input(1).disabled,true);assert.equal(b.writes.length,0);assert.equal(b.run('hasSettingsDrafts()'),true);
});

test('duplicate pending Save sends one text PUT and one POST per definition',async()=>{
    const held=deferred(),b=browser(r=>r.method==='PUT'?held.promise:standard(r));await b.run("openSessionReviewModal('A')");
    const saving=b.run('saveSessionReviewModal()');await b.run('saveSessionReviewModal()');assert.equal(b.writes.length,1);held.resolve({json:row('A')});await saving;
    assert.deepEqual(b.writes.map(r=>r.method),['PUT','POST','POST']);
});

test('saved mutation with failed list refresh is recovered by reads only',async()=>{
    let fail=true;const b=browser(r=>r.url==='/sessions'&&fail?{status:503,json:{detail:'Synthetic refresh failure'}}:standard(r));
    await b.run("openSessionReviewModal('A')");await b.run('saveSessionReviewModal()');const count=b.writes.length;
    assert.match(b.fields.session_rev_list_status.textContent,/refresh|fail/i);fail=false;await b.run('retrySessionReviewRefresh()');assert.equal(b.writes.length,count);
});

for(const action of ['resetSessionReview','deleteSessionFromReviewModal']) test(`${action} canceled confirmation sends no mutation`,async()=>{
    const b=browser(standard);await b.run("openSessionReviewModal('A')");b.confirm(async()=>false);await b.run(`${action}()`);assert.equal(b.writes.length,0);assert.equal(b.fields.session_review_modal.classList.contains('hidden'),false);
});

test('failed rating-definition initialization blocks Save and retry preserves text typed meanwhile',async()=>{
    let fail=true;const b=browser(r=>r.url.startsWith('/rating-definitions')&&fail?{status:503,json:{detail:'Synthetic definitions failure'}}:standard(r));
    await b.run("openSessionReviewModal('A')");b.fields.session_rev_modal_notes.value='Typed with unavailable ratings';await b.run('saveSessionReviewModal()');assert.equal(b.writes.length,0);
    fail=false;await b.run('retrySessionReviewLoad()');assert.equal(b.fields.session_rev_modal_notes.value,'Typed with unavailable ratings');assert.equal(b.input(0).value,'2');assert.equal(b.run('hasSettingsDrafts()'),true);
});

test('partial save ACKs survive same-target definition refresh before retry',async()=>{
    let fail=true;const b=browser(r=>r.method==='POST'&&r.body.rating_definition_id==='two'&&fail?(fail=false,{status:503,json:{detail:'Synthetic partial failure'}}):standard(r));
    await b.run("openSessionReviewModal('A')");b.fields.session_rev_modal_notes.value='Saved once';b.input(0).value='4';b.input(1).value='8';await b.run('saveSessionReviewModal()');
    await b.run('retrySessionReviewLoad()');assert.equal(b.input(0).value,'4');assert.equal(b.input(1).value,'8');
    const before=b.writes.length;await b.run('saveSessionReviewModal()');assert.deepEqual(b.writes.slice(before).map(r=>[r.method,r.body.rating_definition_id]),[['POST','two']]);
});

test('same-session quick exemption pending serializes modal Save',async()=>{
    const held=deferred(),b=browser(r=>r.method==='PUT'?held.promise:standard(r));await b.run("openSessionReviewModal('A')");
    const quick=b.run("quickDismissSessionReview('A')");await tick();b.fields.session_rev_modal_notes.value='Draft during exemption';const saving=b.run('saveSessionReviewModal()');await tick();
    const count=b.writes.length;held.resolve({json:row('A')});await Promise.all([quick,saving]);assert.equal(count,1,'modal Save must wait for same-target quick mutation');
});

test('partial reset blocks Save until reset finishes rather than recreating removed ratings',async()=>{
    let fail=true;const b=browser(r=>r.method==='PUT'&&fail?(fail=false,{status:503,json:{detail:'Synthetic reset partial failure'}}):standard(r));await b.run("openSessionReviewModal('A')");
    await b.run('resetSessionReview()');const count=b.writes.length;await b.run('saveSessionReviewModal()');assert.equal(b.writes.length,count,'Save must not restore ratings after acknowledged DELETE');
    await b.run('resetSessionReview()');assert.deepEqual(b.writes.map(r=>r.method),['DELETE','PUT','PUT']);
});

test('late successful text PUT after Cancel refreshes reads but sends no ratings',async()=>{
    const held=deferred(),b=browser(r=>r.method==='PUT'?held.promise:standard(r));await b.run("openSessionReviewModal('A')");
    const saving=b.run('saveSessionReviewModal()');await tick();const before=b.reads.length;b.run('closeSessionReviewModal()');held.resolve({json:row('A')});await saving;
    assert.deepEqual(b.writes.map(r=>r.method),['PUT']);assert.ok(b.reads.slice(before).some(r=>r.url==='/sessions'),'acknowledged mutation refreshes stale read views');assert.equal(b.fields.session_review_modal.classList.contains('hidden'),true);
});

test('saved mutation failed refresh remains visible locally and retry is read-only',async()=>{
    let fail=true;const b=browser(r=>r.url==='/sessions'&&fail?{status:503,json:{detail:'Synthetic refresh failure'}}:standard(r));
    await b.run("openSessionReviewModal('A')");await b.run('saveSessionReviewModal()');const count=b.writes.length;
    assert.equal(b.fields.session_review_modal.classList.contains('hidden'),false,'Day caller can see local refresh failure');assert.match(b.fields.session_rev_modal_status.textContent,/saved.*refresh.*fail/i);
    fail=false;await b.run('retrySessionReviewRefresh()');assert.equal(b.writes.length,count);
});

test('Day evidence removed by refresh restores focus to visible day date on close',async()=>{
    const b=browser(standard);b.fields.day_review_date_input=node('input','day_review_date_input');b.context.currentActiveRevTab='day';b.context.document.activeElement=node('button','removed_evidence_row');
    await b.run("openSessionReviewModal('A')");b.context.document.activeElement.isConnected=false;b.run('closeSessionReviewModal()');
    assert.equal(b.fields.day_review_date_input.focused,true,'fallback stays in the visible Day workspace');
});


for(const action of ['resetSessionReview','deleteSessionFromReviewModal',"openSessionReviewModal('B')"]) test(`${action} transfers keyboard focus to real confirmation and restores originating session focus`,async()=>{
    const b=browser(standard);b.realConfirm();b.run(fs.readFileSync(path.join(js,'revision_nav.js'),'utf8'));b.run('setupRevisionKeyboardShortcuts()');await b.run("openSessionReviewModal('A')");
    if(action.startsWith('open'))b.fields.session_rev_modal_notes.value='Draft';
    const origin=b.fields.session_rev_modal_notes;origin.focus();
    const pending=b.run(action.includes('(')?action:`${action}()`);await tick();
    assert.equal(b.context.document.activeElement,b.fields.confirm_modal_cancel_btn);
    b.fields.confirm_modal_proceed_btn.focus();assert.equal(b.key('Tab').prevented,true);assert.equal(b.context.document.activeElement,b.fields.confirm_modal_cancel_btn);
    assert.equal(b.key('Tab',true).prevented,true);assert.equal(b.context.document.activeElement,b.fields.confirm_modal_proceed_btn);
    b.key('Escape');await pending;assert.equal(b.context.document.activeElement,origin);assert.equal(b.writes.length,0);assert.equal(b.fields.session_rev_modal_id.value,'A');
});

for(const stage of ['ratings','reset exemption','session']) for(const replace of [false,true]) test(`late acknowledged ${stage} deletion/reset refreshes evidence after ${replace?'new owner':'Close'} without further mutations`,async()=>{
    const held=deferred();let pending=false;const b=browser(r=>{
        if(r.method==='DELETE'&&(stage==='ratings'&&r.url.startsWith('/rating-entries')||stage==='session'&&r.url==='/sessions/A')||stage==='reset exemption'&&r.method==='PUT'){pending=true;return held.promise;}
        return standard(r);
    });
    b.context.currentActiveRevTab='day';b.context.dayRefreshes=0;b.run('loadDayReviewData=async()=>{dayRefreshes++;}');
    await b.run("openSessionReviewModal('A')");const acting=b.run(stage==='session'?'deleteSessionFromReviewModal()':'resetSessionReview()');await tick();assert.equal(pending,true);
    b.run('closeSessionReviewModal()');if(replace)await b.run("openSessionReviewModal('B')");const before=b.reads.length;
    held.resolve({json:row('A')});await acting;
    assert.ok(b.reads.slice(before).some(r=>r.url==='/sessions'),'acknowledged write refreshes Sessions');assert.equal(b.context.dayRefreshes,1,'active Day evidence refreshed');
    assert.deepEqual(b.writes.map(r=>r.method),stage==='reset exemption'?['DELETE','PUT']:['DELETE']);
    if(replace)assert.equal(b.fields.session_rev_modal_id.value,'B');else assert.equal(b.fields.session_review_modal.classList.contains('hidden'),true);
});

for(const newerCheckbox of [false,true]) test(`quick exemption acknowledged after editor loads stale row survives notes Save${newerCheckbox?' while preserving a newer checkbox draft':''}`,async()=>{
    const held=deferred();let first=true;const b=browser(r=>r.method==='PUT'&&first?(first=false,held.promise):standard(r));
    const quick=b.run("quickDismissSessionReview('A')");await b.run("openSessionReviewModal('A')");
    b.fields.session_rev_modal_notes.value='Only notes changed';
    if(newerCheckbox){b.fields.session_rev_modal_skip_check.checked=true;b.fields.session_rev_modal_skip_check.listeners.change?.();b.fields.session_rev_modal_skip_check.checked=false;b.fields.session_rev_modal_skip_check.listeners.change?.();}
    held.resolve({json:{...row('A'),review_skipped:true}});await quick;
    assert.equal(b.fields.session_rev_modal_notes.value,'Only notes changed');assert.equal(b.fields.session_rev_modal_skip_check.checked,!newerCheckbox);
    await b.run('saveSessionReviewModal()');assert.equal(b.writes[1].body.review_skipped,!newerCheckbox);assert.equal(b.writes[1].body.notes,'Only notes changed');assert.equal(b.writes.filter(r=>r.method==='PUT').length,2);
});


test('quick exemption acknowledgement preceding held old GET hydration remains true on subsequent Save',async()=>{
    const put=deferred(),get=deferred();let first=true;const b=browser(r=>r.method==='PUT'&&first?(first=false,put.promise):r.method==='GET'&&r.url==='/sessions/A'?get.promise:standard(r));
    const quick=b.run("quickDismissSessionReview('A')"),opening=b.run("openSessionReviewModal('A')");put.resolve({json:{...row('A'),review_skipped:true}});await quick;
    get.resolve({json:row('A')});await opening;b.fields.session_rev_modal_notes.value='New notes';await b.run('saveSessionReviewModal()');assert.equal(b.writes[1].body.review_skipped,true);
});

test('late quick exemption failure preserves existing checkbox and text drafts and permits one subsequent Save',async()=>{
    const held=deferred();let first=true;const b=browser(r=>r.method==='PUT'&&first?(first=false,held.promise):standard(r));const quick=b.run("quickDismissSessionReview('A')");await b.run("openSessionReviewModal('A')");b.fields.session_rev_modal_notes.value='Retained after failure';held.resolve({status:503,json:{detail:'Synthetic quick failure'}});await quick;
    assert.equal(b.fields.session_rev_modal_skip_check.checked,false);await b.run('saveSessionReviewModal()');assert.equal(b.writes[1].body.notes,'Retained after failure');assert.equal(b.writes[1].body.review_skipped,false);assert.equal(b.writes.filter(r=>r.method==='PUT').length,2);
});

test('late failed Delete after Close sends no mutation retry or invented acknowledgement refresh',async()=>{
    const held=deferred(),b=browser(r=>r.method==='DELETE'?held.promise:standard(r));await b.run("openSessionReviewModal('A')");const acting=b.run('deleteSessionFromReviewModal()');await tick();b.run('closeSessionReviewModal()');await b.run("openSessionReviewModal('B')");const before=b.reads.length;held.resolve({status:503,json:{detail:'Synthetic deletion failure'}});await acting;
    assert.equal(b.writes.length,1);assert.equal(b.reads.length,before);assert.equal(b.fields.session_rev_modal_id.value,'B');
});

test('Reset acknowledged ratings DELETE then late failed exemption PUT still refreshes evidence after Close',async()=>{
    const held=deferred(),b=browser(r=>r.method==='PUT'?held.promise:standard(r));await b.run("openSessionReviewModal('A')");const acting=b.run('resetSessionReview()');await tick();b.run('closeSessionReviewModal()');const before=b.reads.length;held.resolve({status:503,json:{detail:'Synthetic reset failure'}});await acting;
    assert.ok(b.reads.slice(before).some(r=>r.url==='/sessions'));assert.deepEqual(b.writes.map(r=>r.method),['DELETE','PUT']);assert.equal(b.fields.session_review_modal.classList.contains('hidden'),true);
});

test('retired real confirmation cannot restore old session focus or mutate a newer owner',async()=>{
    const b=browser(standard);b.realConfirm();await b.run("openSessionReviewModal('A')");const acting=b.run('deleteSessionFromReviewModal()');b.run('closeSessionReviewModal()');await b.run("openSessionReviewModal('B')");const focus=b.context.document.activeElement;b.fields.confirm_modal_proceed_btn.listeners.click();await acting;
    assert.equal(b.context.document.activeElement,focus);assert.equal(b.fields.session_rev_modal_id.value,'B');assert.equal(b.writes.length,0);
});


for(const action of ['resetSessionReview()', 'deleteSessionFromReviewModal()', "openSessionReviewModal('B')"]) for(const focused of ['cancel','proceed','elsewhere']) test(`${action} actual global confirmation Enter respects ${focused} focus`,async()=>{
    const b=browser(standard);b.realConfirm();await b.run("openSessionReviewModal('A')");
    if(action.startsWith('open'))b.fields.session_rev_modal_notes.value='Draft';
    const pending=b.run(action);await tick();
    if(focused==='proceed')b.fields.confirm_modal_proceed_btn.focus();
    if(focused==='elsewhere')b.fields.session_rev_modal_notes.focus();
    b.key('Enter');await pending;
    if(focused==='cancel'){
        assert.equal(b.writes.length,0);assert.equal(b.fields.session_rev_modal_id.value,'A');
        if(action.startsWith('open'))assert.equal(b.fields.session_rev_modal_notes.value,'Draft');
    }else if(action.startsWith('open')){assert.equal(b.fields.session_rev_modal_id.value,'B');assert.equal(b.writes.length,0);}
    else assert.deepEqual(b.writes.map(r=>r.method),action.startsWith('reset')?['DELETE','PUT']:['DELETE']);
});

for(const replace of [false,true]) for(const failDefinition of ['one','two']) test(`acknowledged text Save then late ${failDefinition} rating failure refreshes after ${replace?'new owner':'Close'} without further writes`,async()=>{
    const held=deferred();let pending=false;const b=browser(r=>{
        if(r.method==='POST'&&r.body.rating_definition_id===failDefinition){pending=true;return held.promise;}
        return standard(r);
    });
    b.context.currentActiveRevTab='day';b.context.dayRefreshes=0;b.run('loadDayReviewData=async()=>{dayRefreshes++;}');
    await b.run("openSessionReviewModal('A')");b.fields.session_rev_modal_notes.value='Acknowledged new notes';
    const saving=b.run('saveSessionReviewModal()');await tick();assert.equal(pending,true);
    await b.run('saveSessionReviewModal()');assert.equal(b.writes.filter(r=>r.method==='PUT').length,1,'duplicate Save is blocked');
    b.run('closeSessionReviewModal()');if(replace){await b.run("openSessionReviewModal('B')");b.fields.session_rev_modal_notes.value='New owner draft';b.input(0).value='4';b.run("sessionReviewEditor.refreshFailed=true;sessionReviewStatus('New owner pending refresh');");}
    const before=b.reads.length,writeCount=b.writes.length;
    held.resolve({status:503,json:{detail:'Synthetic late rating failure'}});await saving;
    assert.ok(b.reads.slice(before).some(r=>r.url==='/sessions'),'acknowledged text refreshes Sessions');assert.equal(b.context.dayRefreshes,1);
    assert.equal(b.writes.length,writeCount);assert.equal(b.writes[0].body.notes,'Acknowledged new notes');
    if(replace){assert.equal(b.fields.session_rev_modal_id.value,'B');assert.equal(b.fields.session_rev_modal_notes.value,'New owner draft');assert.equal(b.input(0).value,'4');assert.equal(b.run('hasSettingsDrafts()'),true);assert.equal(b.fields.session_rev_modal_status.textContent,'New owner pending refresh');assert.equal(b.run('sessionReviewEditor.refreshFailed'),true);}
    else assert.equal(b.fields.session_review_modal.classList.contains('hidden'),true);
});

test('unacknowledged text Save failure after Close does not invent persisted evidence refresh',async()=>{
    const held=deferred(),b=browser(r=>r.method==='PUT'?held.promise:standard(r));await b.run("openSessionReviewModal('A')");const saving=b.run('saveSessionReviewModal()');await tick();b.run('closeSessionReviewModal()');const before=b.reads.length;held.resolve({status:503,json:{detail:'Synthetic unacknowledged text'}});await saving;assert.equal(b.reads.length,before);assert.deepEqual(b.writes.map(r=>r.method),['PUT']);
});


test('current partial rating failure retains mutation error and read-only failed-refresh retry',async()=>{
    let failRating=true,failRead=true;const b=browser(r=>r.method==='POST'&&r.body.rating_definition_id==='two'&&failRating?{status:503,json:{detail:'Synthetic rating failure'}}:r.url==='/sessions'&&failRead?{status:503,json:{detail:'Synthetic read failure'}}:standard(r));
    await b.run("openSessionReviewModal('A')");b.fields.session_rev_modal_notes.value='Acknowledged';b.input(1).value='7';await b.run('saveSessionReviewModal()');
    assert.match(b.fields.session_rev_modal_status.textContent,/Ratings save failed/);assert.match(b.fields.session_rev_modal_status.textContent,/Evidence refresh also failed/);
    const count=b.writes.length;failRead=false;await b.run('retrySessionReviewRefresh()');assert.equal(b.writes.length,count);assert.equal(b.run('hasSettingsDrafts()'),true);assert.match(b.fields.session_rev_modal_status.textContent,/Ratings save failed/);
    failRating=false;await b.run('saveSessionReviewModal()');assert.deepEqual(b.writes.slice(count).map(r=>[r.method,r.body.rating_definition_id]),[['POST','two']]);
});
