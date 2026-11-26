/** Ephemeral report ownership is independent of timer/editor drafts. */
function createHistoryExportController(api) {
    let generation = 0, request = {}, envelope = null, pending = false, error = '';
    const selected = new Set();
    const freeze = value => {
        if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
        return value;
    };
    function invalidate() { generation++; envelope = null; pending = false; }
    return {
        configure(value) { invalidate(); request = structuredClone(value); selected.clear(); },
        select(id, checked) { invalidate(); checked ? selected.add(id) : selected.delete(id); },
        selectGroup(rows, checked) { invalidate(); for (const row of rows) checked ? selected.add(row.id) : selected.delete(row.id); },
        invalidate,
        corrected(correction) {
            invalidate(); error='';
            const changed=correction.changed_work_ids || [];
            const maps=correction.work_fragments || [];
            for(const id of changed) {
                if(!selected.has(id))continue;
                const mapping=maps.find(item=>item.source_work_id===id);
                selected.delete(id);
                if(mapping?.work_ids?.length)for(const retained of mapping.work_ids)selected.add(retained);
                else error='Older correction receipt has no exact source mapping. Reload eligible rows and explicitly select the retained fragments; affected old selection was removed, not guessed.';
            }
        },
        close() { invalidate(); },
        state() { return {envelope, pending, error, selected: [...selected]}; },
        async copy(format) {
            if (!envelope) { error = 'Regenerate preview first.'; return false; }
            try { await api.copy(envelope[format].content); error = ''; return true; }
            catch (failure) { error = `Copy failed: ${failure.message}`; return false; }
        },
        download(format) {
            if (!envelope) { error = 'Regenerate preview first.'; return false; }
            try { api.download(envelope[format]); error = ''; return true; }
            catch (failure) { error = `Download failed: ${failure.message}`; return false; }
        },
        async preview(mode) {
            const read = ++generation;
            const body = {...request, mode, selected_ids: mode === 'selected' ? [...selected] : []};
            const fingerprint = JSON.stringify(body);
            pending = true; envelope = null; error = '';
            try {
                const value = await api.preview(structuredClone(body));
                if (read !== generation || fingerprint !== JSON.stringify({...request, mode, selected_ids:mode === 'selected' ? [...selected] : []})) return null;
                envelope = freeze(structuredClone(value));
                return envelope;
            } catch (failure) { if (read === generation) error = failure.message; return null; }
            finally { if (read === generation) pending = false; }
        },
    };
}
if (typeof module !== 'undefined') module.exports = {createHistoryExportController};

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    const launch = document.getElementById('history-export-open');
    if (!launch) return;
    const element = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
    const dialog = element('dialog'); dialog.id = 'history-export-dialog'; dialog.className = 'app-dialog app-dialog-wide';
    dialog.setAttribute('aria-labelledby', 'history-export-title'); dialog.setAttribute('role', 'dialog');
    const heading = element('h2', 'Saved history export'); heading.id = 'history-export-title';
    const status = element('p'); status.setAttribute('role', 'status');
    const from = element('input'), to = element('input'); from.type = to.type = 'date';
    const legacy = element('input'); legacy.type = 'checkbox';
    const label = (name, input) => { const node = element('label', name + ' '); node.append(input); return node; };
    const list = element('div'); list.id = 'history-export-rows'; list.setAttribute('aria-label', 'Export eligible start-day history');
    const output = element('textarea'); output.readOnly = true; output.setAttribute('aria-label', 'Immutable report preview'); output.id = 'history-export-preview';
    const format = element('select'); format.setAttribute('aria-label', 'Report format');
    for (const kind of ['markdown', 'csv']) { const option = element('option', kind); option.value = kind; format.append(option); }
    const reportDetails = element('p'); reportDetails.id = 'history-export-report-details';
    const controller = createHistoryExportController({
        preview: request => api.post('/api/agenda/history-export/preview', request),
        copy: value => navigator.clipboard.writeText(value),
        download: artifact => {
            const url = URL.createObjectURL(new Blob([artifact.content], {type:artifact.media_type}));
            const link = element('a'); link.href = url; link.download = artifact.filename; document.body.append(link);
            try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
        },
    });
    const button = (text, action) => { const node = element('button', text); node.type = 'button'; node.addEventListener('click', action); return node; };
    let eligible = [], opened = false, readGeneration = 0;
    const copy = button('Copy preview', async () => { const ok = await controller.copy(format.value); status.textContent = ok ? 'Copied preview bytes.' : controller.state().error; });
    const download = button('Download preview', () => { const ok = controller.download(format.value); status.textContent = ok ? 'Download requested; check browser downloads.' : controller.state().error; });
    function paint() {
        const value = controller.state().envelope;
        copy.disabled = download.disabled = !value;
        output.value = value ? value[format.value].content : '';
        reportDetails.textContent = '';
        if (value) {
            status.textContent = `${value.work_count} saved entries; ${value.legacy_count} uncertain. Preview ready to copy or download.`;
            reportDetails.textContent = `${value.work_count} saved work; ${value.legacy_count} uncertain. ${value.request.start_date} through ${value.request.end_date}. Effective zone ${value.timezone}. Filters: title=${JSON.stringify(value.request.title)}, Task tag=${JSON.stringify(value.request.tag)}, Entry note=${JSON.stringify(value.request.note)}. Snapshot as of ${value.snapshot_at}; regenerate for latest. Summed work ${value.summed_recorded_work_seconds}s; elapsed union ${value.elapsed_recorded_time_seconds}s. ${value.warnings.join(' ')}`;
        }
    }
    function configure() {
        ++readGeneration;
        controller.configure({start_date:from.value,end_date:to.value,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
            title:document.getElementById('agenda-search').value.trim(),tag:document.getElementById('agenda-filter-tag').value.trim(),
            note:document.getElementById('agenda-filter-note').value.trim(),include_uncertain:legacy.checked});
        eligible = []; list.textContent = ''; paint(); status.textContent = 'Selection cleared. Load eligible start-day rows or preview all filtered matches.';
    }
    function showRows(rows) {
        list.textContent = '';
        const groups = new Map();
        for (const row of rows) {
            const key = JSON.stringify([row.start.slice(0,10),row.task_id,row.classification]);
            if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row);
        }
        for (const group of groups.values()) {
            const section = element('fieldset'); const groupBox = element('input'); groupBox.type = 'checkbox';
            groupBox.addEventListener('change', () => { controller.selectGroup(group,groupBox.checked); for (const box of section.querySelectorAll('input')) box.checked = groupBox.checked; paint(); });
            const first = group[0]; const legend = element('legend'); legend.append(label(`${first.start.slice(0,10)} / ${first.task_name} / ${first.task_id || 'taskless'} / ${first.classification}`, groupBox)); section.append(legend);
            for (const row of group) {
                const box = element('input'); box.type = 'checkbox'; box.setAttribute('aria-label', `Select ${row.id}`);
                box.addEventListener('change', () => {
                    controller.select(row.id,box.checked);
                    const count = group.filter(item => controller.state().selected.includes(item.id)).length;
                    groupBox.checked = count === group.length; groupBox.indeterminate = count > 0 && count < group.length;
                    paint();
                });
                section.append(label(`${row.start} — ${row.end || 'Unknown'} · ${row.note} · ${row.source || 'Unknown source'}`, box),element('br'));
            }
            list.append(section);
        }
    }
    async function read(mode, selectionOnly = false) {
        if (selectionOnly) configure();
        const read = ++readGeneration;
        const promise = controller.preview(mode); paint(); status.textContent = 'Reading bounded snapshot…';
        const value = await promise;
        if (!dialog.open || read !== readGeneration) return;
        if (!value) { paint(); status.textContent = controller.state().error || 'Selection changed; regenerate.'; return; }
        if (selectionOnly) {
            eligible = value.rows; controller.invalidate(); showRows(eligible); paint();
            status.textContent = `${eligible.length} eligible start-day rows. Select rows/groups, then preview checkbox selection; an empty selection exports zero.`;
            reportDetails.textContent = `${value.request.start_date} through ${value.request.end_date}; effective zone ${value.timezone}. Filters: title=${JSON.stringify(value.request.title)}, Task tag=${JSON.stringify(value.request.tag)}, Entry note=${JSON.stringify(value.request.note)}. ${value.warnings.join(' ')}`;
        }
        else paint();
    }
    const fields = element('div'); fields.className = 'app-dialog-fields';
    const legacyLabel = label('Include uncertain legacy history', legacy); legacyLabel.className = 'app-dialog-check';
    fields.append(label('From local start day',from), label('Through local start day',to), legacyLabel);
    const toolbar = element('div'); toolbar.className = 'app-dialog-toolbar';
    toolbar.append(button('Load eligible rows', () => read('filtered',true)),
        button('Preview all filtered matches', () => read('filtered')), button('Preview checkbox selection', () => read('selected')));
    const details = element('details');
    details.append(element('summary', 'Scope, precision & report details'),
        element('p', 'Whole saved intervals by local start day, including full timestamp precision. Plans and live timers are excluded: stop/save first. Carry-ins belong to their start day. Uncertain legacy history is separate and contributes zero to both totals. CSV apostrophes protect spreadsheet formulas and may alter display.'), reportDetails);
    const footer = element('footer'); footer.className = 'app-dialog-actions';
    function finish() {
        if (!opened) return;
        opened = false; ++readGeneration;
        controller.close(); paint();
        if (dialog.open) dialog.close();
        launch.focus();
    }
    const close = button('Close', finish); close.autofocus = true;
    footer.append(close, copy, download);
    dialog.append(heading, element('p', 'Export saved history as a read-only report, not a backup. Choose dates, then preview all filtered matches or select eligible rows.'),
        fields, toolbar, status, list, label('Report format',format), label('Preview',output), details, footer);
    document.body.append(dialog);
    launch.addEventListener('click', () => { from.value = to.value = document.getElementById('agenda-date').value; configure(); opened = true; dialog.showModal(); close.focus(); });
    for (const input of [from,to,legacy]) input.addEventListener('change',configure);
    format.addEventListener('change',paint);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
    dialog.addEventListener('close', () => { if (!dialog.open) finish(); });
    for (const id of ['agenda-date','agenda-search','agenda-filter-tag','agenda-filter-note']) document.getElementById(id).addEventListener('input',configure);
    for (const event of ['timetrace:timer-mutated','timetrace:history-mutated']) window.addEventListener(event, change => {
        ++readGeneration;
        if(change.detail?.correction) {
            controller.corrected(change.detail.correction);
            eligible=[]; list.textContent='';
        } else controller.invalidate();
        paint(); status.textContent = controller.state().error || 'Work changed; regenerate explicitly from retained selected IDs. Start-day dates may have changed; review the date cohort before previewing.';
    });
});
