const {test} = require('node:test');
const assert = require('node:assert/strict');
const {calendarLiveEvents} = require('../src/timetrace/interfaces/api/static/js/calendar_live.js');
test('Calendar shows only uncommitted exact coverage, never bridges pause gaps', () => {
    const events = calendarLiveEvents({observed_at:'2026-01-01T12:00:00Z', timers:[{
        id:'timer', state:'paused', task_title:'Example', segments:[
            {id:'saved',recorded_work_id:'work',start_time:'2026-01-01T10:00:00Z',end_time:'2026-01-01T10:10:00Z'},
            {id:'buffer',start_time:'2026-01-01T10:20:00Z',end_time:'2026-01-01T10:30:00Z',notes:'note'}]
    }]});
    assert.equal(events.length,1);
    assert.equal(events[0].id,'live:timer:buffer');
    assert.equal(events[0].end,'2026-01-01T10:30:00Z');
    assert.match(events[0].title,/LIVE.*paused.*Example.*note/);
    assert.equal(events[0].editable,false);
});
test('running coverage uses only server cutoff; frozen and unknown cutoffs never project', () => {
    const timer = {id:'t',state:'running',running_segment_id:'s',running_start:'2026-01-01T10:00:00Z',segments:[]};
    const events = calendarLiveEvents({timers:[timer],observed_at:'2026-01-01T10:05:00Z'});
    assert.equal(events[0].end,'2026-01-01T10:05:00Z');
    assert.deepEqual(calendarLiveEvents({timers:[timer]}),[]);
    assert.deepEqual(calendarLiveEvents({timers:[{...timer,state:'stopped'}],observed_at:'2026-01-01T11:00:00Z'}),[]);
});
