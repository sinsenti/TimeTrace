/** Group presentation only: each source interval retains its identity and metadata. */
function groupWorkspaceHistory(rows, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
    const format = new Intl.DateTimeFormat('en-CA', {timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
    const groups = new Map();
    for (const row of rows) {
        if (row.kind === 'scheduled_session') continue;
        const parts = Object.fromEntries(format.formatToParts(new Date(row.start_time)).map(part=>[part.type,part.value]));
        const day = `${parts.year}-${parts.month}-${parts.day}`;
        const key = JSON.stringify([day,row.task_id || null,row.kind]);
        if (!groups.has(key)) groups.set(key,{day,taskId:row.task_id || null,kind:row.kind,rows:[]});
        groups.get(key).rows.push(row);
    }
    return [...groups.values()];
}
/** Shared visible literal predicate: ECMAScript Unicode lower(), not locale-specific matching. */
function workspaceHistoryMatches(row, title, filters) {
    return [[filters.title,title],[filters.tag,row.tags],[filters.note,row.notes]].every(
        ([needle,value]) => String(value || '').toLowerCase().includes(String(needle || '').toLowerCase()));
}
if (typeof module !== 'undefined') module.exports = {groupWorkspaceHistory,workspaceHistoryMatches};
