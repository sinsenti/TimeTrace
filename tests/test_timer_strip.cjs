const test=require('node:test');const assert=require('node:assert/strict');
const {renderTimerStripStatus}=require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');
test('primary workspace navigation respects retained editor drafts',()=>{
 const nodes={'[data-timer-selected]':{},'[data-timer-count]':{},'[data-timer-expander]':{open:false}},root={querySelector:key=>nodes[key]};
 const previous=global.hasSettingsDrafts,oldWindow=global.window;let prevented=0,confirmed=0;
 try{global.hasSettingsDrafts=()=>true;global.window={confirm:()=>{confirmed++;return false;}};
 renderTimerStripStatus(root,{timers:[],fresh:true});nodes['[data-timer-selected]'].onclick({preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(confirmed,1);
 global.window.confirm=()=>true;nodes['[data-timer-selected]'].onclick({preventDefault(){prevented++;}});assert.equal(prevented,1);
 global.hasSettingsDrafts=()=>false;global.window.confirm=()=>{throw Error('clean navigation must not prompt');};nodes['[data-timer-selected]'].onclick({preventDefault(){prevented++;}});assert.equal(prevented,1);
 }finally{global.hasSettingsDrafts=previous;global.window=oldWindow;}
});
test('ordinary pending/ACK writes do not leave the compact menu open; actual recovery does',()=>{
 const nodes={'[data-timer-selected]':{},'[data-timer-count]':{},'[data-timer-expander]':{open:false}},root={querySelector:key=>nodes[key]},state={selectedTimerId:'a',fresh:true,timers:[{id:'a',state:'running',elapsed_seconds:1}]};
 renderTimerStripStatus(root,{...state,pending:true,receipt:{outcome:'unknown'}});assert.equal(nodes['[data-timer-expander]'].open,false);
 renderTimerStripStatus(root,{...state,pending:false,receipt:{outcome:'acknowledged'}});assert.equal(nodes['[data-timer-expander]'].open,false);
 renderTimerStripStatus(root,{...state,pending:false,receipt:{outcome:'uncertain'}});assert.equal(nodes['[data-timer-expander]'].open,true);
 renderTimerStripStatus(root,state);assert.equal(nodes['[data-timer-expander]'].open,false);
 nodes['[data-timer-expander]'].open=true;renderTimerStripStatus(root,state);assert.equal(nodes['[data-timer-expander]'].open,true);
});
test('timer strip exposes selected work and keeps other-timer recovery reachable',()=>{
 const nodes={'[data-timer-selected]':{},'[data-timer-count]':{},'[data-timer-expander]':{open:false}};
 const root={querySelector:key=>nodes[key]};
 renderTimerStripStatus(root,{selectedTimerId:'a',fresh:true,timers:[{id:'a',task_title:'Reading',elapsed_seconds:65,state:'running'},{id:'b',state:'frozen',idle_gaps:[{id:'gap'}]}]});
 assert.match(nodes['[data-timer-selected]'].textContent,/Reading.*1:05/);assert.equal(nodes['[data-timer-selected]'].href,'/agenda-view?timer=a');assert.equal(nodes['[data-timer-count]'].textContent,'Other timers · 1');assert.equal(nodes['[data-timer-expander]'].open,true);
});
