const test=require('node:test');const assert=require('node:assert/strict');
const {createWeeklyReviewController}=require('../src/timetrace/interfaces/api/static/js/weekly_review.js');
const {revisionEntryDate}=require('../src/timetrace/interfaces/api/static/js/revision_nav.js');
test('weekly links open the existing date-owned review, never an invalid or silently current date',()=>{
 assert.equal(revisionEntryDate('?date=2000-01-04','2000-01-05'),'2000-01-04');
 assert.equal(revisionEntryDate('?date=2000-02-30','2000-01-05'),'2000-01-05');
 assert.equal(revisionEntryDate('?date=0000-01-04','2000-01-05'),'2000-01-05');
});
test('A and C share the same authoritative selected week and real previous/future navigation',async()=>{
 const urls=[];const api={get:async url=>{urls.push(url);return {week_start:new URL(url,'http://x').searchParams.get('week_start'),basis:'summed_recorded_work'};}};
 const c=createWeeklyReviewController({api,onState:()=>{},initialWeek:'2000-01-03',context:{timezone:'UTC',first_day_of_week:1}});
 await c.refresh();const evidence=c.snapshot().data;c.show('C');assert.equal(c.snapshot().data,evidence);
 c.show('A');assert.equal(c.snapshot().week,'2000-01-03');await c.navigate(-7);assert.equal(c.snapshot().week,'1999-12-27');await c.navigate(14);assert.equal(c.snapshot().week,'2000-01-10');
 assert.equal(urls.length,3);assert.ok(urls.every(u=>u.includes('timezone=UTC')));
 await c.setContextRevision(2);assert.ok(urls.at(-1).includes('context_revision=2'));
 c.show('C');assert.equal(c.snapshot().context.context_revision,2);
 await c.setContextRevision(null);assert.ok(!urls.at(-1).includes('context_revision='));
});
