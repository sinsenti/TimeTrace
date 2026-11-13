const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const base = path.resolve(__dirname, '../src/timetrace/interfaces/api');
function harness(respond = async () => []) {
    const roots = {};
    const context = vm.createContext({console, alert() {}, document:{getElementById:id=>roots[id], querySelectorAll:()=>[]},
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
