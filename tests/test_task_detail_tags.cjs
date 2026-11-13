const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync('src/timetrace/interfaces/api/static/js/tags_engine.js','utf8');
function node() {
    const children=[],listeners={};
    return {children,listeners,style:{},value:'',innerHTML:'',textContent:'',className:'',
        classList:{add(){},remove(){}},querySelectorAll:()=>children,
        appendChild(child){children.push(child);},replaceChildren(){children.length=0;},
        addEventListener:(type,fn)=>listeners[type]=fn,insertBefore(child){children.push(child);},focus(){},remove(){}};
}
for(const tag of ['#<img/src=x/onerror=globalThis.pwned=1>',"#quote');globalThis.pwned=1;//"])
    test(`tags_engine renders stored/typed tag inertly and selects/removes exact value: ${tag}`,()=>{
        const fields={session_modal_tags_input:node(),tag_chips_container:node(),tag_suggestions_dropdown:node()};
        const context=vm.createContext({document:{getElementById:id=>fields[id],createElement:node},getTagColor:()=> '#000000',allSessions:[{tags:tag}]});
        vm.runInContext(source,context);
        context.renderTagSuggestions(tag);
        const item=fields.tag_suggestions_dropdown.children[0];
        assert.ok(item,'suggestions are constructed as DOM nodes, not interpolated HTML');
        assert.equal(item.children[0].textContent,tag);
        item.listeners.click();
        assert.equal(vm.runInContext('currentTagChips[0]',context),tag);
        const chip=fields.tag_chips_container.children[0];
        assert.equal(chip.children[0].textContent,tag);
        assert.equal(chip.innerHTML,'');
        chip.children[1].listeners.click();
        assert.equal(vm.runInContext('currentTagChips.length',context),0);
        context.addTagChip(tag);
        assert.equal(vm.runInContext('currentTagChips[0]',context),tag);
    });

test('details stored session tags remain selectable without publishing own history to Timer',async()=>{
    const stored='#own-history-tag';
    const fields={inspector_task_id:{value:'parent'},session_modal_tags_input:node(),tag_chips_container:node(),tag_suggestions_dropdown:node()};
    const context=vm.createContext({console,document:{getElementById:id=>fields[id] || null,createElement:node,addEventListener(){}},
        getTagColor:()=> '#000000',taskKnowledge:{state:()=>({generation:0}),viewResult(){}},
        api:{get:async url=>url.endsWith('/tree') ? {id:'parent',title:'Parent',subtasks:[]} : {sessions:[{id:'own',tags:stored}]}},
        formatMinutesToDuration:()=>'-',window:{location:{}},setTimeout});
    vm.runInContext(source,context);
    vm.runInContext(fs.readFileSync('src/timetrace/interfaces/api/static/js/subtasks.js','utf8'),context);
    await context.loadTaskDetailTree();
    context.renderTagSuggestions(stored);
    const item=fields.tag_suggestions_dropdown.children[0];
    assert.ok(item,'the actual details history supplies stored tag suggestions');
    item.listeners.click();
    assert.equal(vm.runInContext('currentTagChips[0]',context),stored);
    assert.equal(context.allSessions,undefined,'tags must not republish scoped history as Timer global hints');
});
