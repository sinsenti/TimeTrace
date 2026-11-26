const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; }
function matches(el, selector) {
    return selector.split(',').some(part => {
        const s = part.trim();
        const tagAttr=s.match(/^([a-z]+)\[([\w-]+)\]$/);
        if(tagAttr)return el.tagName.toLowerCase()===tagAttr[1]&&el.hasAttribute(tagAttr[2]);
        if (s.startsWith('#')) return el.id === s.slice(1);
        if (s.startsWith('.')) return el.classList.contains(s.slice(1));
        const attr = s.match(/^\[([\w-]+)(?:([\^]?=)"([^"]*)")?\]$/);
        if (attr) {const v = el.getAttribute(attr[1]); return attr[2] === '^=' ? String(v || '').startsWith(attr[3]) : attr[2] ? String(v) === attr[3] : v !== null;}
        return el.tagName.toLowerCase() === s;
    });
}
function element(tag = 'div', attrs = {}) {
    const listeners = {}, classes = new Set();
    const el = {tagName:tag.toUpperCase(), children:[], dataset:{}, style:{}, value:'', disabled:false, checked:false, id:'', type:tag === 'input' ? 'text' : '', textContent:'', innerText:'', attributes:{},
        classList:{contains:n=>classes.has(n), add:(...ns)=>ns.forEach(n=>classes.add(n)), remove:(...ns)=>ns.forEach(n=>classes.delete(n)), toggle(n,on=!classes.has(n)){on ? classes.add(n) : classes.delete(n);}},
        setAttribute(name,value) {this.attributes[name]=String(value); if(name === 'class'){classes.clear();String(value).split(/\s+/).filter(Boolean).forEach(n=>classes.add(n));} else if(name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value); else this[name]=String(value);},
        getAttribute(name) {if(name === 'id') return this.id || null; return this.attributes[name] ?? null;},
        hasAttribute(name){return this.getAttribute(name)!==null;},
        appendChild(child){child.remove();this.children.push(child);child.parentNode=this;return child;},
        append(...children){children.forEach(c=>this.appendChild(c));},
        remove(){if(this.parentNode){const at=this.parentNode.children.indexOf(this);if(at>=0)this.parentNode.children.splice(at,1);this.parentNode=null;}},
        replaceWith(next){const parent=this.parentNode;if(!parent)return;const at=parent.children.indexOf(this);next.remove();parent.children.splice(at,1,next);next.parentNode=parent;this.parentNode=null;},
        replaceChildren(...children){this.children=[];this.append(...children);},
        querySelectorAll(selector){return this.children.flatMap(child=>[child,...child.querySelectorAll('*')]).filter(child=>selector === '*' || matches(child,selector));},
        querySelector(selector){return this.querySelectorAll(selector)[0] || null;},
        contains(target){return target === this || this.querySelectorAll('*').includes(target);},
        closest(selector){return matches(this,selector)?this:this.parentNode?.closest(selector) || null;},
        addEventListener(name,fn){(listeners[name] ||= []).push(fn);},
        dispatchEvent(event){event.target ||= this;for(const fn of listeners[event.type] || [])fn(event);if(!event.stopped)this.parentNode?.dispatchEvent(event);return !event.defaultPrevented;},
        focus(){}, showModal(){this.open=true;}, close(){this.open=false;}, select(){}, cloneNode(deep){const copy=element(tag,{...this.attributes,id:this.id,type:this.type,value:this.value});copy.disabled=this.disabled;copy.checked=this.checked;if(deep)this.children.forEach(c=>copy.appendChild(c.cloneNode(true)));return copy;}
    };
    Object.defineProperty(el,'innerHTML',{get(){return this._html || '';},set(html){this._html=html;this.children=[];const stack=[this];for(const token of String(html).matchAll(/<\/?[a-z][^>]*>/gi)){const text=token[0];if(text.startsWith('</')){stack.pop();continue;}const t=text.match(/^<(\w+)/)[1];const child=element(t);for(const [,n,v] of text.matchAll(/([\w-]+)="([^"]*)"/g))child.setAttribute(n,v);if(/\sdisabled(?:\s|>)/.test(text))child.disabled=true;stack.at(-1).appendChild(child);if(!['input','br','hr'].includes(t))stack.push(child);}}});
    for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);
    return el;
}
function reviewRoot(id) {
    const root=element('section',{id,'data-settings-draft-retained':'true'});
    const fieldset=element('fieldset',{'data-task-review':'fields'});root.appendChild(fieldset);
    for(const name of ['difficulty','what_went_well','blockers','key_takeaways'])fieldset.appendChild(element(name === 'difficulty'?'input':'textarea',{id:`${id}_${name}`,'data-task-review':name,value:name === 'difficulty'?'3':''}));
    fieldset.appendChild(element('div',{id:`${id}_ratings`,'data-task-review':'ratings','data-settings-draft-retained':'true'}));
    for(const name of ['save','discard','retry'])root.appendChild(element('button',{'data-task-review':name}));
    root.appendChild(element('p',{'data-task-review':'status'}));return root;
}
const taskA='0195e535-0000-7000-8000-00000000000a', taskB='0195e535-0000-7000-8000-00000000000b';
const definitions=[{id:'definition-one',name:'Focus <b>literal</b>',description:'<img src=x>',min_score:1,max_score:5,is_required:true},{id:'definition-two',name:'Energy',min_score:1,max_score:5,is_required:false}];
function statistics(id=taskA){return {task:{id,title:id === taskA?'Task A':'Task B',status:'To Do'},task_review:null,custom_ratings:[],sessions:[],logged_hours:0,scheduled_hours:0,estimated_hours:0,progress_pct:null};}
function fixture(respond = () => undefined, caller='revision') {
    const body=element('body'), review=reviewRoot(caller === 'revision'?'revision_task_postmortem':'details_task_postmortem');body.appendChild(review);
    const fields={};
    const ids=['task_inspector_body','inspect_task_title','inspect_task_desc','inspect_task_status_badge','task_inspector_status','task_inspector_kpis','inspect_task_details_link','inspect_task_sessions_list','task_inspector_search','task_inspector_dropdown','task_quick_chips_bar','inspector_task_id','subtasks_tree_container','task_properties_editor','task_properties_status'];
    for(const id of ids){fields[id]=element(id === 'inspector_task_id'?'input':'div',{id});body.appendChild(fields[id]);}
    fields.inspector_task_id.value=taskA;
    const events={}, requests=[], writes=[], alerts=[];let confirm=true;
    const document={body,documentElement:element('html'),getElementById:id=>body.querySelector(`#${id}`),querySelectorAll:s=>body.querySelectorAll(s),querySelector:s=>body.querySelector(s),createElement:t=>element(t),addEventListener:(n,fn)=>(events[n] ||= []).push(fn)};
    const context=vm.createContext({URL,URLSearchParams,console:{error(){}},setTimeout:fn=>fn(),document,localStorage:{getItem:()=>null,setItem(){}},window:{location:{href:'http://localhost/revision',pathname:'/revision'},confirm:()=>confirm,addEventListener:(n,fn)=>(events[n] ||= []).push(fn)},alert:s=>alerts.push(s),
        fetch:async(url,options={})=>{const method=options.method || 'GET';const request={url,method,body:options.body?JSON.parse(options.body):null};requests.push(request);if(method !== 'GET')writes.push(request);let result=await respond(request);if(result===undefined)result=url.startsWith('/rating-definitions')?definitions:url.endsWith('/stats')?statistics(url.includes(taskB)?taskB:taskA):url.endsWith('/tree')?{...statistics().task,subtasks:[]}:{};const httpStatus=typeof result?.status==='number'?result.status:200;return {ok:httpStatus<400,status:httpStatus,headers:{get:()=> 'application/json'},json:async()=>typeof result?.status==='number'?result.json:result};},
        taskKnowledge:{state:()=>({generation:0}),values:()=>[statistics(taskA).task,statistics(taskB).task],get:id=>statistics(id).task,viewResult(){}},escapeHtml:s=>String(s??''),roundVal:x=>x,formatMinutesToDuration:x=>String(x),formatFlexibleDateForInput:x=>x,parseFlexibleDateInput:()=>null,showCustomConfirm:async()=>true});
    context.window.appDialogs = {confirm:async ({message})=>context.window.confirm(message), alert:({message})=>context.alert(message), prompt:async()=>null};
    const run=code=>vm.runInContext(code,context);
    for(const file of ['api_client.js','settings.js','ratings_config.js','task_postmortem.js',caller === 'revision'?'task_inspector.js':'subtasks.js'])run(fs.readFileSync(path.join(source,file),'utf8'));
    return {run,context,review,fields,requests,writes,alerts,events,set confirm(value){confirm=value;},field:name=>review.querySelector(`[data-task-review="${name}"]`),input:index=>review.querySelectorAll('.custom-rating-input')[index],async load(id=taskA){if(caller === 'revision'){run(`selectedInspectedTaskId=${JSON.stringify(id)}`);await context.loadTaskInspectorStats(id);}else {await context.loadTaskDetailTree();await tick();}}};
}

test('Revision task review waits for actual statistics and scoped rating initialization before saving',async()=>{
    const held=deferred();const b=fixture(r=>r.url.startsWith('/rating-definitions')?held.promise:undefined);
    const loading=b.load();await tick();
    await b.context.saveTaskReviewForm();assert.equal(b.writes.length,0);
    held.resolve(definitions);await loading;
    b.field('what_went_well').value='Ready after both reads';await b.context.saveTaskReviewForm();
    assert.equal(b.writes.filter(r=>r.url==='/api/task-reviews').length,1);
    assert.equal(b.writes.find(r=>r.url==='/api/task-reviews').body.task_id,taskA);
    assert.equal(b.input(0).id.startsWith('rating_range_input_revision_task_postmortem_ratings_'),true);
});

test('Task save freezes text, every score and dismissal before the first POST; double activation writes once',async()=>{
    const held=deferred();let block=true;
    const b=fixture(r=>r.url==='/api/task-reviews' && block?held.promise:undefined);
    await b.load();b.field('what_went_well').value='Submitted text';b.input(0).value='1';b.input(1).value='2';b.input(1).disabled=true;
    const saving=b.context.saveTaskReviewForm();await tick();await b.context.saveTaskReviewForm();
    b.field('what_went_well').value='New typing';b.input(0).value='5';b.input(1).value='4';b.input(1).disabled=false;
    block=false;held.resolve({id:'persisted-review'});await saving;
    assert.deepEqual(b.writes.map(r=>r.url),['/api/task-reviews','/rating-entries','/rating-entries']);
    assert.equal(b.writes[0].body.what_went_well,'Submitted text');
    assert.deepEqual(b.writes.slice(1).map(r=>[r.body.target_id,r.body.score,r.body.dismissed]),[[taskA,1,false],[taskA,0,true]]);
    assert.equal(b.field('what_went_well').value,'New typing');assert.equal(b.input(0).value,'5');assert.equal(b.input(1).disabled,false);
    assert.equal(b.run("hasSettingsDrafts(['revision_task_postmortem','revision_task_postmortem_ratings'])"),true);
});

test('Partial task save retry skips acknowledged text and rating entries while retaining unrelated editors',async()=>{
    let fail=true;
    const b=fixture(r=>r.url==='/rating-entries' && r.body.rating_definition_id==='definition-two' && fail?{status:503,json:{detail:'Synthetic second rating rejection'}}:undefined);
    const unrelated=reviewRoot('unrelated_day');b.context.document.body.appendChild(unrelated);
    unrelated.querySelector('[data-task-review="what_went_well"]').value='Day draft';
    await b.load();b.field('what_went_well').value='Successful review';b.input(0).value='4';b.input(1).value='2';
    await b.context.saveTaskReviewForm();assert.match(b.field('status').textContent,/incomplete|remaining/i);
    assert.equal(b.run("hasSettingsDrafts(['revision_task_postmortem_ratings'])"),true);
    fail=false;await b.context.saveTaskReviewForm();
    assert.equal(b.writes.filter(r=>r.url==='/api/task-reviews').length,1);
    assert.equal(b.writes.filter(r=>r.body?.rating_definition_id==='definition-one').length,1);
    assert.equal(b.writes.filter(r=>r.body?.rating_definition_id==='definition-two').length,2);
    assert.equal(unrelated.querySelector('[data-task-review="what_went_well"]').value,'Day draft');
    assert.equal(b.writes.every(r=>r.url==='/api/task-reviews' || r.url==='/rating-entries'),true);
});

test('Accepted task save followed by failed refresh uses read-only recovery',async()=>{
    let failed=false;
    const b=fixture(r=>{if(r.url==='/api/task-reviews')failed=true;if(r.url.endsWith('/stats')&&failed)return {status:503,json:{detail:'Synthetic read failure'}};});
    await b.load();b.field('blockers').value='Persisted despite unavailable read';await b.context.saveTaskReviewForm();
    assert.match(b.field('status').textContent,/saved.*refresh unavailable/i);const count=b.writes.length;
    failed=false;await b.review.taskPostmortem.retry();assert.equal(b.writes.length,count);
});

test('Cancelled Task Inspector replacement preserves initialized owner, task label and hidden retained drafts',async()=>{
    const b=fixture();await b.load();b.field('blockers').value='Keep A';b.fields.task_inspector_search.value='Task A';
    b.review.classList.add('hidden');b.confirm=false;b.context.selectTaskInspectorById(taskB);await tick();
    assert.equal(b.run('selectedInspectedTaskId'),taskA);assert.equal(b.field('blockers').value,'Keep A');
    assert.equal(b.fields.task_inspector_search.value,'Task A');assert.equal(b.run('followSettingsLink({})'),false);
    assert.equal(b.writes.length,0);
});

test('Late text success cannot checkpoint or continue rating writes after A to B to A replacement',async()=>{
    const held=deferred();let holding=true;
    const b=fixture(r=>r.url==='/api/task-reviews'&&holding?held.promise:undefined);await b.load();
    b.field('what_went_well').value='Old A submitted';const saving=b.context.saveTaskReviewForm();await tick();
    b.confirm=true;b.context.selectTaskInspectorById(taskB);await tick();b.context.selectTaskInspectorById(taskA);await tick();
    b.field('what_went_well').value='New A owner draft';holding=false;held.resolve({id:'old-A-review'});await saving;
    assert.equal(b.field('what_went_well').value,'New A owner draft');assert.equal(b.writes.length,1);
    assert.equal(b.run("hasSettingsDrafts(['revision_task_postmortem'])"),true);
});

test('Dedicated details caller hydrates a scoped task review and Ctrl Enter saves review without property writes',async()=>{
    const b=fixture(undefined,'details');await b.load();b.field('key_takeaways').value='Review through details';
    b.context.setupInspectorKeyboardShortcuts();
    const event={type:'keydown',target:b.field('key_takeaways'),key:'Enter',ctrlKey:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};
    b.review.dispatchEvent(event);if(!event.stopped)for(const fn of b.events.keydown || [])fn(event);await tick();
    assert.equal(b.writes.filter(r=>r.url==='/api/task-reviews').length,1);
    assert.equal(b.writes.some(r=>r.method==='PUT'||r.method==='DELETE'),false);
    assert.equal(b.writes.find(r=>r.url==='/api/task-reviews').body.key_takeaways,'Review through details');
    assert.equal(b.context.window.location.href,'http://localhost/revision');
});

test('Discard cancellation and failed persisted reads retain drafts without writes',async()=>{
    let fail=false;const b=fixture(r=>fail&&r.url.endsWith('/stats')?{status:503,json:{detail:'Synthetic discard read failure'}}:undefined);await b.load();
    b.field('blockers').value='Retained draft';b.confirm=false;await b.review.taskPostmortem.discard();
    assert.equal(b.field('blockers').value,'Retained draft');assert.equal(b.writes.length,0);
    b.confirm=true;fail=true;await b.review.taskPostmortem.discard();
    assert.equal(b.field('blockers').value,'Retained draft');assert.match(b.field('status').textContent,/failed|unavailable/i);assert.equal(b.writes.length,0);
});

test('Typing after Discard begins survives a late persisted review response',async()=>{
    const held=deferred();let hold=false;const b=fixture(r=>hold&&r.url.endsWith('/stats')?held.promise:undefined);await b.load();
    b.field('blockers').value='Discard this';hold=true;const discarding=b.review.taskPostmortem.discard();await tick();
    b.field('blockers').value='Typed after Discard';b.field('blockers').dispatchEvent({type:'input'});
    held.resolve({...statistics(),task_review:{id:'existing',blockers:'Persisted server text',difficulty:3}});await discarding;
    assert.equal(b.field('blockers').value,'Typed after Discard');assert.equal(b.writes.length,0);
});

test('Discard respects edit intent when typing returns to the same visible value before a late read',async()=>{
    const held=deferred();let hold=false;const b=fixture(r=>hold&&r.url.endsWith('/stats')?held.promise:undefined);await b.load();
    b.field('blockers').value='Draft A';hold=true;const discarding=b.review.taskPostmortem.discard();await tick();
    b.field('blockers').value='Draft B';b.field('blockers').dispatchEvent({type:'input'});
    b.field('blockers').value='Draft A';b.field('blockers').dispatchEvent({type:'input'});
    held.resolve({...statistics(),task_review:{id:'existing',blockers:'Server persisted',difficulty:3}});await discarding;
    assert.equal(b.field('blockers').value,'Draft A');assert.equal(b.writes.length,0);
});

test('Fresh task definitions retain text, score and dismissal drafts and block unavailable definitions with editor-neutral recovery',async()=>{
    let defs=definitions;
    const b=fixture(r=>r.url.startsWith('/rating-definitions')?defs:undefined);await b.load();
    b.field('blockers').value='Keep task draft';b.input(0).value='5';b.input(1).disabled=true;
    defs=[{...definitions[0],max_score:3},definitions[1]];
    await b.context.loadTaskInspectorStats(taskA,true);
    assert.equal(b.field('blockers').value,'Keep task draft');assert.equal(b.input(0).value,'5');assert.equal(b.input(0).type,'number');assert.equal(b.input(1).disabled,true);
    await b.context.saveTaskReviewForm();assert.equal(b.writes.length,0);
    defs=[definitions[1]];await b.context.loadTaskInspectorStats(taskA,true);
    await b.context.saveTaskReviewForm();assert.equal(b.writes.length,0);
    const unavailable=b.review.querySelector('[data-rating-unavailable="true"]');
    assert.ok(unavailable);assert.match(unavailable.children.at(-1).textContent,/Discard drafts/);assert.doesNotMatch(unavailable.children.at(-1).textContent,/day drafts/);
});

test('Successful explicit Discard restores persisted review and task ratings using reads only',async()=>{
    const persisted={id:'persisted-review',difficulty:7,what_went_well:'Server text',blockers:'Server blocker',key_takeaways:'Server takeaway'};
    const b=fixture(r=>r.url.endsWith('/stats')?{...statistics(),task_review:persisted,custom_ratings:[{rating_definition_id:'definition-one',score:2,dismissed:false},{rating_definition_id:'definition-two',score:0,dismissed:true}]}:undefined);
    await b.load();b.field('what_went_well').value='Discard this draft';b.input(0).value='5';b.input(1).disabled=false;
    await b.review.taskPostmortem.discard();
    assert.equal(b.field('what_went_well').value,'Server text');assert.equal(b.field('difficulty').value,7);
    assert.equal(b.input(0).value,'2');assert.equal(b.input(1).disabled,true);assert.equal(b.writes.length,0);
    assert.equal(b.run("hasSettingsDrafts(['revision_task_postmortem','revision_task_postmortem_ratings'])"),false);
});

test('Late statistics and definitions cannot hydrate a replaced task owner',async()=>{
    for(const boundary of ['stats','definitions']){
        const held=deferred();let holding=true;
        const b=fixture(r=>holding&&((boundary==='stats'&&r.url===`/api/tasks/${taskA}/stats`)||(boundary==='definitions'&&r.url.startsWith('/rating-definitions')))?held.promise:undefined);
        const loading=b.load();await tick();holding=false;b.context.selectTaskInspectorById(taskB);await tick();
        held.resolve(boundary==='stats'?{...statistics(taskA),task_review:{id:'old',blockers:'Obsolete A text'}}:[{...definitions[0],name:'Obsolete definition'}]);await loading;
        assert.equal(b.review.taskPostmortem.taskId,taskB);assert.equal(b.field('blockers').value,'');
        assert.doesNotMatch(b.field('ratings').innerHTML,/Obsolete/);assert.equal(b.writes.length,0);
    }
});

test('Initial failed task definitions block Save; read-only Retry initializes without wrong-target writes',async()=>{
    let fail=true;const b=fixture(r=>r.url.startsWith('/rating-definitions')&&fail?{status:503,json:{detail:'Synthetic first definition read failure'}}:undefined);
    await b.load();b.field('blockers').value='Typed before recovery';await b.context.saveTaskReviewForm();
    assert.equal(b.writes.length,0);assert.equal(b.field('save').disabled,true);assert.match(b.field('status').textContent,/unavailable/i);
    fail=false;await b.review.taskPostmortem.retry();assert.equal(b.field('blockers').value,'Typed before recovery');
    assert.equal(b.field('save').disabled,false);assert.equal(b.writes.length,0);
});

test('Late rejected text write cannot replace a new task owner status or dirty baseline',async()=>{
    const held=deferred();const b=fixture(r=>r.url==='/api/task-reviews'?held.promise:undefined);await b.load();
    b.field('blockers').value='Old A write';const saving=b.context.saveTaskReviewForm();await tick();
    b.context.selectTaskInspectorById(taskB);await tick();b.field('blockers').value='New B draft';const status=b.field('status').textContent;
    held.resolve({status:503,json:{detail:'Late rejected A write'}});await saving;
    assert.equal(b.field('blockers').value,'New B draft');assert.equal(b.field('status').textContent,status);
    assert.equal(b.run("hasSettingsDrafts(['revision_task_postmortem'])"),true);assert.equal(b.writes.length,1);
});

test('Same rating definition in Task, Day and another task retains distinct controls and target-scoped writes',async()=>{
    const b=fixture();await b.load();
    const day=element('div',{id:'unrelated_day_ratings'}), other=element('div',{id:'other_task_ratings'});
    b.context.document.body.append(day,other);
    await b.context.renderCustomRatingsInputs('day','2026-11-13',day.id,[],()=>true,day);
    await b.context.renderCustomRatingsInputs('task',taskB,other.id,[],()=>true,other);
    day.querySelector('.custom-rating-input').value='1';other.querySelector('.custom-rating-input').value='2';
    b.input(0).value='5';b.field('what_went_well').value='Only A review';await b.context.saveTaskReviewForm();
    const controls=b.context.document.querySelectorAll('.custom-rating-input');assert.equal(new Set(controls.map(input=>input.id)).size,controls.length);
    assert.equal(day.querySelector('.custom-rating-input').value,'1');assert.equal(other.querySelector('.custom-rating-input').value,'2');
    assert.equal(b.writes.filter(r=>r.url==='/rating-entries').every(r=>r.body.target_type==='task'&&r.body.target_id===taskA),true);
    assert.equal(b.writes.filter(r=>r.url==='/rating-entries').length,2);
});

test('Actual Revision document link and beforeunload guards protect a hidden retained review draft',async()=>{
    const b=fixture();await b.load();b.field('blockers').value='Hidden review must survive';b.review.classList.add('hidden');b.confirm=false;
    const link=element('a',{href:'/dashboard'});b.context.document.body.appendChild(link);
    const event={target:link,button:0,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};
    for(const handler of b.events.click || [])handler(event);
    assert.equal(event.defaultPrevented,true);assert.equal(b.field('blockers').value,'Hidden review must survive');
    const unload={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
    for(const handler of b.events.beforeunload || [])handler(unload);
    assert.equal(unload.defaultPrevented,true);assert.equal(unload.returnValue,'');assert.equal(b.writes.length,0);
});

test('Typing during initial held definitions survives definitions failure and metadata caller retry',async()=>{
    const held=deferred();let first=true;
    const b=fixture(r=>r.url.startsWith('/rating-definitions')&&first?held.promise:undefined);
    const loading=b.load();await tick();b.field('blockers').value='Typed while initial definitions held';
    b.field('blockers').dispatchEvent({type:'input'});held.resolve({status:503,json:{detail:'Synthetic held definitions rejection'}});await loading;
    assert.equal(b.field('save').disabled,true);first=false;await b.context.refreshTaskInspectorKnowledge();
    assert.equal(b.field('blockers').value,'Typed while initial definitions held');assert.equal(b.field('save').disabled,false);assert.equal(b.writes.length,0);
});

test('Metadata refresh during captured rating save preserves the complete batch and newer drafts',async()=>{
    for(const rejectSecond of [false,true]) {
        const held=deferred();let defs=definitions,hold=true,fail=rejectSecond;
        const b=fixture(r=>r.url.startsWith('/rating-definitions')?defs:r.url==='/rating-entries'&&r.body.rating_definition_id==='definition-one'&&hold?held.promise:r.url==='/rating-entries'&&r.body.rating_definition_id==='definition-two'&&fail?{status:503,json:{detail:'Second rating rejected'}}:undefined);
        await b.load();b.input(1).value='4';
        const saving=b.context.saveTaskReviewForm();await tick();
        const capturedFirst=b.input(0);defs=definitions.map(d=>({...d,name:`Updated ${d.name}`}));
        await b.context.refreshTaskInspectorKnowledge();
        b.field('blockers').value='New text while saving';b.input(1).value='5';b.input(1).disabled=true;
        hold=false;held.resolve({id:'first-ack'});await saving;
        assert.deepEqual(b.writes.filter(r=>r.url==='/rating-entries').map(r=>[r.body.rating_definition_id,r.body.score,r.body.dismissed]),[['definition-one',3,false],['definition-two',4,false]]);
        assert.equal(b.field('blockers').value,'New text while saving');assert.equal(b.input(1).value,'5');assert.equal(b.input(1).disabled,true);
        assert.match(b.field('ratings').innerHTML,/Updated/);
        assert.equal(b.run("hasSettingsDrafts(['revision_task_postmortem','revision_task_postmortem_ratings'])"),true);
        assert.equal(b.field('status').textContent.includes('Save incomplete'),rejectSecond);
        fail=false;await b.context.saveTaskReviewForm();
        assert.equal(b.writes.filter(r=>r.url==='/rating-entries'&&r.body.rating_definition_id==='definition-one').length,1);
        assert.equal(b.writes.filter(r=>r.url==='/rating-entries'&&r.body.rating_definition_id==='definition-two').length,2);
        assert.notEqual(b.input(0),capturedFirst);
    }
});

test('Dedicated details paints its own accounting and history while review definitions are pending',async()=>{
    const held=deferred();const b=fixture(r=>r.url.startsWith('/rating-definitions')?held.promise:r.url.endsWith('/stats')?{...statistics(),logged_hours:2.5,sessions:[]}:undefined,'details');
    const tracked=element('span',{id:'detail_task_tracked'}),history=element('div',{id:'detail_task_sessions_list'});b.context.document.body.append(tracked,history);
    const loading=b.load();await tick();
    assert.equal(tracked.innerText,'2.5h');assert.match(history.innerHTML,/No recorded sessions/);assert.equal(b.field('save').disabled,true);
    held.resolve({status:503,json:{detail:'Definitions unavailable'}});await loading;await tick();
    assert.equal(tracked.innerText,'2.5h');assert.match(history.innerHTML,/No recorded sessions/);assert.equal(b.field('save').disabled,true);assert.equal(b.writes.length,0);
});

test('Deferred refresh and late rating ACK or rejection cannot touch an A to B to A replacement',async()=>{
    for(const reject of [false,true]) {
        const held=deferred();let hold=true,defs=definitions;
        const b=fixture(r=>r.url.startsWith('/rating-definitions')?defs:r.url==='/rating-entries'&&hold?held.promise:undefined);
        await b.load();b.input(1).value='4';
        const saving=b.context.saveTaskReviewForm();await tick();
        defs=definitions.map(d=>({...d,name:`Changed ${d.name}`}));await b.context.refreshTaskInspectorKnowledge();
        b.context.selectTaskInspectorById(taskB);await tick();
        b.context.selectTaskInspectorById(taskA);await tick();
        assert.equal(b.review.taskPostmortem.ready,true,b.field('status').textContent);
        b.field('blockers').value='Replacement A draft';b.input(1).value='5';
        const status=b.field('status').textContent,first=b.input(0);
        hold=false;held.resolve(reject?{status:503,json:{detail:'Late rating rejection'}}:{id:'late-rating-ack'});await saving;
        assert.equal(b.field('blockers').value,'Replacement A draft');assert.equal(b.input(1).value,'5');
        assert.equal(b.field('status').textContent,status);assert.equal(b.input(0),first);
        assert.equal(b.writes.filter(r=>r.url==='/rating-entries').length,1);
        assert.equal(b.run("hasSettingsDrafts(['revision_task_postmortem','revision_task_postmortem_ratings'])"),true);
    }
});


test('Dedicated document shortcuts exclude review controls and keep the property Save caller',async()=>{
    const b=fixture(undefined,'details');await b.load();b.context.setupInspectorKeyboardShortcuts();
    let propertySaves=0;b.context.saveInspectorTaskProperties=()=>{propertySaves++;};
    const dispatch=target=>{const event={target,key:'Enter',ctrlKey:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};for(const handler of b.events.keydown)handler(event);return event;};
    assert.equal(dispatch(b.field('blockers')).defaultPrevented,false);assert.equal(propertySaves,0);
    assert.equal(dispatch(b.fields.task_properties_editor).defaultPrevented,true);assert.equal(propertySaves,1);
    assert.equal(b.writes.length,0);
});

test('Outline root-absent caller paints evidence without a review and guards hidden inert and outside Ctrl Enter',async()=>{
    const b=fixture(undefined,'details');b.review.remove();
    const host=element('aside',{id:'outline_inspector'});b.context.document.body.appendChild(host);host.appendChild(b.fields.task_properties_editor);
    const unrelated=element('button');host.appendChild(unrelated);
    const tracked=element('span',{id:'detail_task_tracked'});b.context.document.body.appendChild(tracked);
    b.context.createTaskPostmortemEditor=()=>{throw new Error('Outline must not initialize review');};
    await b.context.loadTaskDetailTree();assert.equal(tracked.innerText,'0h');assert.equal(b.writes.length,0);
    b.context.setupInspectorKeyboardShortcuts();let propertySaves=0;b.context.saveInspectorTaskProperties=()=>propertySaves++;
    const dispatch=target=>{const event={target,key:'Enter',ctrlKey:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};for(const handler of b.events.keydown)handler(event);return event;};
    host.hidden=true;assert.equal(dispatch(b.fields.task_properties_editor).defaultPrevented,false);
    host.hidden=false;host.inert=true;assert.equal(dispatch(b.fields.task_properties_editor).defaultPrevented,false);
    host.inert=false;assert.equal(dispatch(b.fields.inspector_task_id).defaultPrevented,false);
    assert.equal(dispatch(unrelated).defaultPrevented,false);assert.equal(propertySaves,0);
    assert.equal(dispatch(b.fields.task_properties_editor).defaultPrevented,true);assert.equal(propertySaves,1);
});

test('Dedicated same-task metadata refresh preserves pending captured writes and newer dirty review edits',async()=>{
    const held=deferred();let hold=true;
    const b=fixture(r=>r.url==='/rating-entries'&&r.body.rating_definition_id==='definition-one'&&hold?held.promise:undefined,'details');
    await b.load();b.field('blockers').value='Captured text';b.input(1).value='4';
    const saving=b.review.taskPostmortem.save();await tick();const first=b.input(0);
    await b.context.loadTaskDetailTree(true);assert.equal(b.input(0),first);
    b.field('blockers').value='New text';b.input(1).value='5';
    hold=false;held.resolve({id:'captured-rating'});await saving;
    assert.deepEqual(b.writes.filter(r=>r.url==='/rating-entries').map(r=>r.body.score),[3,4]);
    assert.equal(b.field('blockers').value,'New text');assert.equal(b.input(1).value,'5');
    assert.equal(b.run("hasSettingsDrafts(['details_task_postmortem','details_task_postmortem_ratings'])"),true);
});

test('Dedicated selection A to B to A rejects stale same-ID statistics and retains the latest review and evidence',async()=>{
    const held=deferred();let hold=true;
    const b=fixture(r=>r.url===`/api/tasks/${taskA}/stats`&&hold?held.promise:undefined,'details');
    const tracked=element('span',{id:'detail_task_tracked'});b.context.document.body.appendChild(tracked);
    const old=b.context.loadTaskDetailTree();await tick();
    b.context.resetInlineTaskDetail(taskB);await b.context.loadTaskDetailTree();await tick();
    b.context.resetInlineTaskDetail(taskA);hold=false;await b.context.loadTaskDetailTree();await tick();
    b.field('blockers').value='Latest A draft';
    held.resolve({...statistics(),logged_hours:99,task_review:{id:'stale',blockers:'Stale A review',difficulty:9}});await old;await tick();
    assert.equal(tracked.innerText,'0h');assert.equal(b.field('blockers').value,'Latest A draft');assert.equal(b.field('difficulty').value,3);
    assert.equal(b.review.taskPostmortem.taskId,taskA);assert.equal(b.review.taskPostmortem.ready,true);assert.equal(b.writes.length,0);
});

test('Dedicated begin disables Save before a failed same-task tree refresh without losing dirty input',async()=>{
    let fail=false;const b=fixture(r=>fail&&r.url.endsWith('/tree')?{status:503,json:{detail:'Tree unavailable'}}:undefined,'details');
    await b.load();b.field('blockers').value='Keep during failed read';assert.equal(b.field('save').disabled,false);
    fail=true;const loading=b.context.loadTaskDetailTree(true);assert.equal(b.field('save').disabled,true);
    await loading;assert.equal(b.field('blockers').value,'Keep during failed read');assert.equal(b.field('save').disabled,true);
    await b.review.taskPostmortem.save();assert.equal(b.writes.length,0);
    fail=false;await b.load();assert.equal(b.field('blockers').value,'Keep during failed read');assert.equal(b.field('save').disabled,false);
});
test('ui72 task-selection approval cannot consume typing made while the confirmation is open',async()=>{
    const b=fixture();await b.load();b.fields.task_inspector_search.value='Task A';b.field('blockers').value='First draft';
    b.run(fs.readFileSync(path.join(source,'app_dialogs.js'),'utf8'));
    const selecting=b.context.selectTaskInspectorById(taskB);
    b.field('blockers').value='Newer draft';b.field('blockers').dispatchEvent({type:'input'});
    b.context.document.body.querySelectorAll('button').find(button=>button.textContent==='Discard changes').dispatchEvent({type:'click'});await selecting;
    assert.equal(b.field('blockers').value,'Newer draft');assert.equal(b.fields.task_inspector_search.value,'Task A');assert.equal(b.writes.length,0);
});
test('ui72 newer task-selection intent invalidates an older approval without changing retained drafts',async()=>{
    const b=fixture();await b.load();b.field('blockers').value='Retain A';
    b.run(fs.readFileSync(path.join(source,'app_dialogs.js'),'utf8'));
    const old=b.context.selectTaskInspectorById(taskB);
    await b.context.selectTaskInspectorById(taskA);await tick();b.context.document.body.querySelectorAll('button').find(button=>button.textContent==='Discard changes').dispatchEvent({type:'click'});await old;
    assert.equal(b.fields.task_inspector_search.value,'Task A');assert.equal(b.field('blockers').value,'Retain A');assert.equal(b.writes.length,0);
});
