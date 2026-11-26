const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function page(preview = async()=>({})) {
    const events={}, nodes=new Map();
    const document={addEventListener:(name,fn)=>events[name]=fn, getElementById:id=>nodes.get(id)};
    const node=tag=>({tagName:tag.toUpperCase(),children:[],listeners:{},style:{},value:'',
        append(...children){this.children.push(...children);if(this.tagName==='SELECT'&&!this.value)this.value=children[0].value;},setAttribute(name,value){this[name]=value;},
        addEventListener(name,fn){this.listeners[name]=fn;},focus(){document.activeElement=this;},
        showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();}});
    document.createElement=node;document.body=node('body');
    for(const id of ['history-export-open','agenda-date','agenda-search','agenda-activity-filter','agenda-filter-tag','agenda-filter-note']) nodes.set(id,node('input'));
    nodes.get('agenda-date').value='2000-01-04';
    const requests=[], copies=[];
    const response={work_count:1,legacy_count:0,timezone:'UTC',snapshot_at:'2000-01-05T00:00:00.123456Z',summed_recorded_work_seconds:61.123456,
        elapsed_recorded_time_seconds:61.123456,warnings:[],rows:[],markdown:{content:'Exact 09:00:00.123456 bytes'},csv:{content:'Exact,csv'}};
    const context={document,window:{addEventListener(){}},Intl,structuredClone,
        navigator:{clipboard:{writeText:async value=>copies.push(value)}},api:{post:async (path,request)=>{requests.push(request);return {...response,...await preview(request),request};}}};
    vm.runInNewContext(fs.readFileSync('src/timetrace/interfaces/api/static/js/history_export.js','utf8'),context);
    events.DOMContentLoaded();
    const descendants=root=>root.children.flatMap(child=>[child,...descendants(child)]);
    const find=text=>descendants(document.body).find(child=>child.textContent?.trim()===text);
    return {document,nodes,requests,copies,find,all:()=>descendants(document.body)};
}
test('ui72 saved history export has named fields, contextual exact details and bottom actions without changing preview bytes',async()=>{
    const p=page();p.nodes.get('history-export-open').listeners.click();
    const dialog=p.document.body.children[0];
    assert.equal(dialog.id,'history-export-dialog');
    assert.equal(dialog.children.at(-1).tagName,'FOOTER');
    assert.equal(p.document.activeElement.textContent,'Close');
    assert.ok(p.find('Report format')); assert.ok(p.find('Preview'));
    await p.find('Preview all filtered matches').listeners.click();
    assert.equal(p.requests[0].mode,'filtered');
    assert.equal(p.all().find(node=>node.tagName==='TEXTAREA').value,'Exact 09:00:00.123456 bytes');
    const details=p.all().find(node=>node.id==='history-export-report-details');
    assert.match(details.textContent,/61\.123456s/); assert.match(details.textContent,/Entry note/);
    await p.find('Copy preview').listeners.click();
    assert.equal(p.copies[0],'Exact 09:00:00.123456 bytes');
    p.find('Close').listeners.click(); assert.equal(dialog.open,false);
});

test('history export follows the history title field, independently of the activity filter',async()=>{
    const p=page();p.nodes.get('agenda-search').value='Reading history';p.nodes.get('agenda-activity-filter').value='Different activity';
    p.nodes.get('history-export-open').listeners.click();await p.find('Preview all filtered matches').listeners.click();
    assert.equal(p.requests[0].title,'Reading history');
    assert.equal(p.nodes.get('agenda-activity-filter').listeners.input,undefined,'activity filtering does not invalidate history export');
    p.nodes.get('agenda-search').value='New history';p.nodes.get('agenda-search').listeners.input();
    assert.equal(p.find('Copy preview').disabled,true,'a real history-title change still invalidates its preview');
});
test('ui72 closing and reopening export invalidates a late preview without replacing the new selection status',async()=>{
    let release;const held=new Promise(resolve=>release=resolve);const p=page(()=>held);
    p.nodes.get('history-export-open').listeners.click();const reading=p.find('Preview all filtered matches').listeners.click();
    p.find('Close').listeners.click();p.nodes.get('history-export-open').listeners.click();
    release({});await reading;
    assert.equal(p.all().find(node=>node.tagName==='TEXTAREA').value,'');
    assert.match(p.all().find(node=>node.role==='status').textContent,/Selection cleared/);
    assert.equal(p.find('Copy preview').disabled,true);
});
