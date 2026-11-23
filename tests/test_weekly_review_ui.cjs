const test=require('node:test');const assert=require('node:assert/strict');
const {createWeeklyReviewController}=require('../src/timetrace/interfaces/api/static/js/weekly_review.js');
test('A and C share the same authoritative selected week and real previous/future navigation',async()=>{
 const urls=[];const api={get:async url=>{urls.push(url);return {week_start:new URL(url,'http://x').searchParams.get('week_start'),basis:'summed_recorded_work'};}};
 const c=createWeeklyReviewController({api,onState:()=>{},initialWeek:'2000-01-03',context:{timezone:'UTC',first_day_of_week:1}});
 await c.refresh();const evidence=c.snapshot().data;c.show('C');assert.equal(c.snapshot().data,evidence);
 c.show('A');assert.equal(c.snapshot().week,'2000-01-03');await c.navigate(-7);assert.equal(c.snapshot().week,'1999-12-27');await c.navigate(14);assert.equal(c.snapshot().week,'2000-01-10');
 assert.equal(urls.length,3);assert.ok(urls.every(u=>u.includes('timezone=UTC')));
});
