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
    const dialog = element('dialog'); dialog.style.cssText = 'width:min(900px,95vw);max-height:90vh;overflow:auto;color:var(--text-main);background:var(--bg-card,#fff)';
    dialog.setAttribute('aria-labelledby', 'history-export-title');
    const heading = element('h2', 'Saved history export'); heading.id = 'history-export-title';
    const status = element('p'); status.setAttribute('role', 'status');
    const from = element('input'), to = element('input'); from.type = to.type = 'date';
    const legacy = element('input'); legacy.type = 'checkbox';
    const label = (name, input) => { const node = element('label', name + ' '); node.append(input); return node; };
    const list = element('div'); list.setAttribute('aria-label', 'Export eligible start-day history');
    const output = element('textarea'); output.readOnly = true; output.setAttribute('aria-label', 'Immutable report preview'); output.style.cssText = 'width:100%;height:250px';
    const format = element('select'); format.setAttribute('aria-label', 'Report format');
    for (const kind of ['markdown', 'csv']) { const option = element('option', kind); option.value = kind; format.append(option); }
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
    let eligible = [];
    const copy = button('Copy preview', async () => { const ok = await controller.copy(format.value); status.textContent = ok ? 'Copied preview bytes.' : controller.state().error; });
    const download = button('Download preview', () => { const ok = controller.download(format.value); status.textContent = ok ? 'Download requested; check browser downloads.' : controller.state().error; });
    function paint() {
        const value = controller.state().envelope;
        copy.disabled = download.disabled = !value;
        output.value = value ? value[format.value].content : '';
        if (value) status.textContent = `${value.work_count} saved work; ${value.legacy_count} uncertain. ${value.request.start_date} through ${value.request.end_date}. Effective zone ${value.timezone}. Filters: title=${JSON.stringify(value.request.title)}, tag=${JSON.stringify(value.request.tag)}, note=${JSON.stringify(value.request.note)}. Snapshot as of ${value.snapshot_at}; regenerate for latest. Summed work ${value.summed_recorded_work_seconds}s; elapsed union ${value.elapsed_recorded_time_seconds}s. ${value.warnings.join(' ')}`;
    }
    function configure() {
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
        const promise = controller.preview(mode); paint(); status.textContent = 'Reading bounded snapshot…';
        const value = await promise;
        if (!dialog.open) return;
        if (!value) { paint(); status.textContent = controller.state().error || 'Selection changed; regenerate.'; return; }
        if (selectionOnly) { eligible = value.rows; controller.invalidate(); showRows(eligible); paint(); status.textContent = `${eligible.length} eligible start-day rows. ${value.request.start_date} through ${value.request.end_date}; effective zone ${value.timezone}. Filters: title=${JSON.stringify(value.request.title)}, tag=${JSON.stringify(value.request.tag)}, note=${JSON.stringify(value.request.note)}. ${value.warnings.join(' ')} Select rows/groups then preview selected; selection [] exports zero.`; }
        else paint();
    }
    dialog.append(heading, element('p', 'Read-only report, not a backup. Whole intervals by start day. Plans/live timers excluded: stop/save first. Uncertain legacy is separate and contributes zero to both totals. CSV apostrophes protect spreadsheet formulas and may alter display.'),
        label('From local start day',from),label('Through local start day',to),label('Include uncertain legacy',legacy),
        button('Load eligible rows', () => read('filtered',true)),button('Preview ALL filtered matches', () => read('filtered')),
        button('Preview checkbox selection', () => read('selected')),status,list,format,output,copy,download,
        button('Close', () => dialog.close()));
    document.body.append(dialog);
    launch.addEventListener('click', () => { from.value = to.value = document.getElementById('agenda-date').value; configure(); dialog.showModal(); });
    for (const input of [from,to,legacy]) input.addEventListener('change',configure);
    format.addEventListener('change',paint);
    dialog.addEventListener('close', () => { controller.close(); paint(); launch.focus(); });
    for (const id of ['agenda-date','agenda-search','agenda-filter-tag','agenda-filter-note']) document.getElementById(id).addEventListener('input',configure);
    for (const event of ['timetrace:timer-mutated','timetrace:history-mutated']) window.addEventListener(event, () => {
        controller.invalidate(); paint(); status.textContent = 'Work changed; regenerate explicitly.';
    });
});
