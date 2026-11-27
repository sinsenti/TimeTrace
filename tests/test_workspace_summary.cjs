const test=require('node:test');const assert=require('node:assert/strict');
const {renderWorkSummary}=require('../src/timetrace/interfaces/api/static/js/workspace_summary.js');
class Element{constructor(tag){this.tagName=tag;this.children=[];this.textContent='';}append(...n){this.children.push(...n);}replaceChildren(...n){this.children=n;}}
const text=n=>[n.textContent,...n.children.map(text)].join(' ');
test('readable summary keeps elapsed union separate from task credit and non-additive unassigned totals',()=>{
 const root=new Element('div');root.ownerDocument={createElement:t=>new Element(t)};
 renderWorkSummary(root,{recorded_task_time:{total:3,meta:{timezone:'UTC'}},elapsed_recorded_time:{total:2},unassigned_recorded_time:{total:1},tasks:{rows:[]},cohort:'By local work start',measurement_at:'2026-11-24T12:00:00Z'});
 assert.match(text(root.children[0]),/2h 00m.*recorded time/);assert.match(text(root.children[0]),/3h 00m task credit/);assert.match(text(root.children[0]),/1h 00m unassigned/);
 const details=root.children[1];assert.equal(details.tagName,'details');assert.match(text(details),/not additive/);assert.match(text(details),/By local work start/);
});

test('overlapping unassigned intervals are described as full-duration sums, not clock coverage',()=>{
 const root=new Element('div');root.ownerDocument={createElement:t=>new Element(t)};
 renderWorkSummary(root,{recorded_task_time:{total:0,meta:{timezone:'UTC'}},elapsed_recorded_time:{total:1/3},unassigned_recorded_time:{total:2/3},tasks:{rows:[]}});
 assert.match(text(root.children[0]),/0h 20m.*recorded time/);
 assert.match(text(root.children[0]),/0h 40m unassigned/);
 assert.match(text(root.children[1]),/Unassigned time sums each saved interval in full, including overlaps/);
 assert.match(text(root.children[1]),/not additive/);
});
