const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const base = path.resolve(__dirname, '../src/timetrace/interfaces/api');
function harness(respond = async () => []) {
    const roots = {};
    const context = vm.createContext({console, alert() {}, document:{getElementById:id=>roots[id], querySelectorAll:()=>[],
        createElement:tag=>({tagName:tag,attributes:{},children:[],style:{},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
            addEventListener(){},setAttribute(name,value){this.attributes[name]=value;}})},
        api:{get:respond, post:respond}});
    vm.runInContext(fs.readFileSync(path.join(base,'static/js/ratings_config.js'),'utf8'),context);
    return {context, roots};
}
test('same definition has distinct controls and inert labels in two day editors', async () => {
    const {context:c,roots} = harness(async()=>[{id:'definition-uuid',name:'<img src=x onerror=bad()>',description:'<b>literal</b>',min_score:1,max_score:5}]);
    roots.a={id:'a'}; roots.b={id:'b'};
    await c.renderCustomRatingsInputs('day','2026-11-01','a',[],()=>true,roots.a);
    await c.renderCustomRatingsInputs('day','2026-11-02','b',[],()=>true,roots.b);
    const ids = html=>[...html.matchAll(/\sid="([^"]+)"/g)].map(x=>x[1]);
    assert.equal(ids(roots.a.innerHTML).some(id=>ids(roots.b.innerHTML).includes(id)),false);
    assert.ok(roots.a.innerHTML.includes('&lt;img'));
    assert.ok(!roots.a.innerHTML.includes('<img'));
});
test('validation uses only its editor root',()=>{
    const {context:c}=harness();
    const root={querySelectorAll:()=>[{getAttribute:()=> 'true',querySelector:()=>({value:'',disabled:false})}]};
    assert.equal(c.validateRequiredCustomRatings('day','2026-11-01',root),false);
});
test('submission snapshots every entry before first await and retries only acknowledged differences',async()=>{
    let release; const held=new Promise(r=>release=r); const writes=[];
    const {context:c,roots}=harness(async(url,body)=>{writes.push({...body});if(writes.length===1)await held;});
    const inputs=[{id:'a1',value:'1',disabled:false},{id:'a2',value:'2',disabled:true}];
    const cards=inputs.map((input,i)=>({getAttribute:()=>String(i),querySelector:()=>input}));
    const root={id:'a',querySelectorAll:()=>cards};roots.a=root; inputs.forEach(x=>roots[x.id]=x);
    const saving=c.submitCustomRatings('day','2026-11-01',()=>true,root);
    inputs[1].value='5';inputs[1].disabled=false;release();await saving;
    assert.deepEqual(writes.map(w=>[w.target_id,w.score,w.dismissed]),[['2026-11-01',1,false],['2026-11-01',0,true]]);
    await c.submitCustomRatings('day','2026-11-01',()=>true,root);
    assert.deepEqual(writes.map(w=>[w.score,w.dismissed]),[[1,false],[0,true],[5,false]]);
});
test('workspace declares reusable retained editors and initially closed bottom history',()=>{
    const html=fs.readFileSync(path.join(base,'templates/revision.html'),'utf8');
    assert.match(html,/<template id="day_editor_template"/);
    assert.match(html,/id="day_history_panel"[^>]*class="[^"]*hidden/);
    assert.ok(!html.includes('day_kpi_badges'));
});
test('day workspace template presents distinct review and evidence sections with stable actions',()=>{
    const html=fs.readFileSync(path.join(base,'templates/revision.html'),'utf8');
    const css=fs.readFileSync(path.join(base,'static/css/day_workspace.css'),'utf8');
    const review=fs.readFileSync(path.join(base,'static/js/day_review.js'),'utf8');
    assert.match(html,/class="day-editor-header"/);
    assert.match(html,/data-day="date"[\s\S]*?data-day="status"/);
    assert.match(html,/data-action="retry" class="day-quiet-action">Refresh/);
    assert.match(html,/aria-label="Retrospective"[\s\S]*?<h3>Retrospective<\/h3>/);
    assert.match(html,/aria-label="Recorded activity"[\s\S]*?<h3>Recorded activity<\/h3>/);
    assert.match(html,/class="day-segmented-control"[\s\S]*?data-action="activity"[\s\S]*?data-action="tasks"/);
    assert.match(html,/data-action="save" class="day-save-primary">Save day review/);
    assert.match(html,/data-action="discard" class="day-discard-secondary">Discard drafts/);
    assert.match(html,/data-action="dismiss" class="day-dismiss-action">Dismiss day/);
    assert.match(html,/data-day="session-count" class="day-session-count"/);
    assert.match(html,/How to read this breakdown[\s\S]*?scheduled rows[\s\S]*?fan-out attribution/);
    assert.match(html,/day_workspace\.css\?v=ui-review2-1/);
    assert.match(html,/day_review\.js\?v=ui-review2-1/);
    assert.match(html,/day_history\.js\?v=ui-review2-1/);
    assert.match(css,/grid-template-columns:minmax\(300px,\.9fr\) minmax\(0,1\.1fr\)/);
    assert.match(css,/\.day-editor \[hidden\] \{ display:none !important; \}/);
    assert.match(css,/@media \(max-width:900px\) \{ \.day-editor-columns/);
    assert.doesNotMatch(css,/^[\t ]*(?:header|main)\s*\{/m);
    for (const selector of ['day-session-title','day-session-when','day-session-duration']) assert.ok(review.includes(selector));
    assert.match(review,/count\.setAttribute\('aria-label'/);
});
test('day evidence renderer gives recorded sessions separate title, local date/time, duration and tags',()=>{
    const {context:c}=harness();
    vm.runInContext(fs.readFileSync(path.join(base,'static/js/day_review.js'),'utf8'),c);
    const values={
        total:{},'created-tasks':{},breakdown:{replaceChildren(...children){this.children=children;}},
        filter:{},'filter-label':{},'session-count':{attributes:{},setAttribute(name,value){this.attributes[name]=value;}},
        sessions:{replaceChildren(...children){this.children=children;},appendChild(child){this.children.push(child);}}
    };
    const actions={activity:{attributes:{},setAttribute(name,value){this.attributes[name]=value;}},tasks:{attributes:{},setAttribute(name,value){this.attributes[name]=value;}}};
    const root={querySelector(selector){
        const field=selector.match(/data-day="([^"]+)"/)?.[1];
        const action=selector.match(/data-action="([^"]+)"/)?.[1];
        return field ? values[field] : actions[action];
    }};
    const editor={root,date:'2026-11-01',summary:{total_hours:1.5,total_sessions:1,completed_tasks_count:0,tag_breakdown:[],task_breakdown:[],sessions:[{
        id:'session-uuid',start_time:'2026-11-01T09:30:00',duration_seconds:2700,tags:'#work',task:{title:'Write a report'}
    }]},group:'tag',filter:null};
    c.renderDayEvidence(editor);
    const [row]=values.sessions.children;
    assert.equal(row.className,'day-session-row');
    assert.equal(row.children.map(child=>child.className).join(','),'day-session-title,day-session-when,day-session-tags,day-session-duration');
    assert.equal(row.children[0].textContent,'Write a report');
    const start=new Date('2026-11-01T09:30:00');
    assert.equal(row.children[1].textContent,`${start.toLocaleDateString([],{month:'short',day:'numeric'})} · ${start.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`);
    assert.equal(row.children[2].textContent,'#work');
    assert.equal(row.children[3].textContent,'45 min');
    assert.equal(values['session-count'].textContent,'1');
    assert.equal(values['session-count'].attributes['aria-label'],'1 recorded session');
});
test('out-of-order definition reads cannot replace newer controls in the same container',async()=>{
    let resolve;const held=new Promise(r=>resolve=r);let count=0;
    const {context:c,roots}=harness(async()=>++count===1?held:[{id:'new',name:'New owner',min_score:1,max_score:5}]);
    roots.a={id:'a'};
    const first=c.renderCustomRatingsInputs('day','2026-11-01','a',[],()=>true,roots.a);
    await c.renderCustomRatingsInputs('day','2026-11-02','a',[],()=>true,roots.a);
    resolve([{id:'old',name:'Old owner',min_score:1,max_score:5}]);await first;
    assert.ok(roots.a.innerHTML.includes('New owner'));assert.ok(!roots.a.innerHTML.includes('Old owner'));
});
test('late captured rating ACK cannot checkpoint or continue a container rebound to another target',async()=>{
    let release;const held=new Promise(r=>release=r);const writes=[];let checkpoints=0;
    const {context:c,roots}=harness(async(url,body)=>{writes.push(body);await held;});
    c.settingsDraftCheckpoint=()=>()=>checkpoints++;
    const inputs=[{id:'one',value:'1',disabled:false},{id:'two',value:'2',disabled:false}];
    const root={id:'a',ratingTarget:'day:2026-11-01',querySelectorAll:()=>inputs.map((input,i)=>({getAttribute:()=>String(i),querySelector:()=>input}))};
    roots.a=root;inputs.forEach(input=>roots[input.id]=input);
    const saving=c.submitCustomRatings('day','2026-11-01',()=>true,root);
    root.ratingTarget='day:2026-11-02';release();await saving;
    assert.equal(writes.length,1);assert.equal(checkpoints,0);
    await c.submitCustomRatings('day','2026-11-01',()=>true,root);
    assert.equal(writes.length,1);
});
