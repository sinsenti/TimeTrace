/** Read-only Calendar adapter. Exact service geometry; never extrapolate across gaps. */
function calendarLiveEvents(status) {
    return (status?.timers || []).filter(t => t.state !== 'stopped').flatMap(timer => {
        const fragments = (timer.segments || []).filter(s => !s.recorded_work_id);
        if (timer.running_start && status.observed_at) fragments.push({
            id:timer.running_segment_id, start_time:timer.running_start,
            end_time:status.observed_at, notes:timer.notes
        });
        return fragments.filter(s => s.id && Date.parse(s.end_time) > Date.parse(s.start_time)).map(s => ({
            id:`live:${timer.id}:${s.id}`, start:s.start_time, end:s.end_time,
            title:`LIVE · ${timer.state} · ${timer.task_title || 'Taskless work'}${s.notes ? ` · ${s.notes}` : ''}`,
            editable:false, startEditable:false, durationEditable:false,
            classNames:['calendar-live-work'], backgroundColor:'#0f766e', borderColor:'#5eead4',
            extendedProps:{kind:'live_work', timer_id:timer.id, segment_id:s.id}
        }));
    });
}
if (typeof module !== 'undefined') module.exports = {calendarLiveEvents};
if (typeof window !== 'undefined') {
    let status = null;
    window.addEventListener('timetrace:timer-state', event => {
        status = event.detail;
        if (typeof calendar === 'undefined' || !calendar) return;
        // This source has no asynchronous requests and cannot resurrect a pre-ACK read.
        let source = calendar.getEventSourceById('unfinished-live-work');
        if (!source) source = calendar.addEventSource({id:'unfinished-live-work',
            events:(_info, success) => success(calendarLiveEvents(status))});
        else source.refetch();
    });
}
