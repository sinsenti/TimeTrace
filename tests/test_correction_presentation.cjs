const test=require('node:test');const assert=require('node:assert/strict');
const {correctionPresentation}=require('../src/timetrace/interfaces/api/static/js/timer_corrections.js');
test('normal correction preview shows dates before/after and warnings without machine identities',()=>{
 const envelope={cutoff:'2026-11-24T11:00:00+00:00',plan:{before:[{segment_id:'opaque-segment',start_utc:'2026-11-24T10:00:00+00:00',end_utc:'2026-11-24T11:00:00+00:00'}],after:[{segment_id:'opaque-segment',start_utc:'2026-11-24T10:05:00+00:00',end_utc:'2026-11-24T11:00:00+00:00'}],duration_seconds:3300,warnings:['Other work is unchanged.']}};
 const result=correctionPresentation(envelope,{human:true,timeZone:'UTC'});
 assert.match(result,/Before/);assert.match(result,/After/);assert.match(result,/10:00/);assert.match(result,/10:05/);assert.doesNotMatch(result,/opaque-segment/);assert.match(result,/Other work is unchanged/);assert.match(result,/paused/i);
});
