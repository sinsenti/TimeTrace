/** Read-only presentation of one authoritative progress response; never recompute its cohort. */
function renderWorkSummary(root,progress,selectedPlanId=null) {
    const doc=root.ownerDocument,node=(tag,text='')=>{const el=doc.createElement(tag);el.textContent=text;return el;};
    const human=hours=>{if(!Number.isFinite(hours))return 'Unavailable';const minutes=Math.round(hours*60);return `${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,'0')}m`;};
    const precise=value=>Number.isFinite(value)?`${value.toLocaleString(undefined,{maximumFractionDigits:6})} h`:'Unavailable';
    const task=progress.recorded_task_time.total,elapsed=progress.elapsed_recorded_time.total,unassigned=progress.unassigned_recorded_time.total;
    const main=node('div');main.className='work-summary-main';main.append(node('strong',human(elapsed)),node('span','recorded time'));
    if(!Number.isFinite(task)||Math.round(task*60)!==Math.round(elapsed*60))main.append(node('span',`${human(task)} task credit`));
    if(!Number.isFinite(unassigned)||unassigned>0)main.append(node('span',`${human(unassigned)} unassigned`));
    const detail=node('details');detail.className='work-summary-details';detail.append(node('summary','How time is counted & breakdown'));
    detail.append(node('p','Recorded time counts overlapping minutes once. Task credit counts overlaps once within each task; simultaneous work on different tasks can count more than once. Unassigned work can overlap assigned work. These figures are not additive.'));
    detail.append(node('p',`Recorded task time: ${precise(task)} · Elapsed recorded time: ${precise(elapsed)} · Unassigned: ${precise(unassigned)}`));
    const iso=progress.measurement_at,instant=iso?new Date(/[zZ]$|[+-]\d{2}:\d{2}$/.test(iso)?iso:iso+'Z'):null;
    detail.append(node('p',`${progress.cohort||''} Measured ${instant&&Number.isFinite(instant.getTime())?instant.toLocaleString():'unavailable'}. Zone: ${progress.recorded_task_time.meta?.timezone||'daemon local'}.`));
    for(const row of progress.tasks?.rows||[])detail.append(node('p',`${row.labels.join(' / ')} — recorded task union ${precise(row.value)}`));
    for(const basis of ['original','current']){
        const comparison=progress[basis];if(!comparison)continue;
        detail.append(node('p',`${basis==='original'?'Original-plan':'Current-schedule'} comparison, selected day's visible plans: inside ${precise(comparison.inside.total)}, outside ${precise(comparison.outside.total)}. Matching does not imply attachment; overlapping plan fills are non-additive.`));
        const fill=selectedPlanId&&comparison.fill?.rows.find(row=>row.keys[0]===selectedPlanId);
        if(fill)detail.append(node('p',`${basis==='original'?'Original-plan':'Current-schedule'} fill for selected plan: ${precise(fill.value)} (matching same-task work, including unattached work).`));
    }
    root.replaceChildren(main,detail);
}
if(typeof module!=='undefined')module.exports={renderWorkSummary};
