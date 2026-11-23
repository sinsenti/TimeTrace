/* Folio owns one editable draft; range reads never replace that draft. */
const agendaPage = (() => {
    const get = id => document.getElementById(`agenda-${id}`);
    // Reuse the sole shared controller region, below the prominent current card.
    const unfinished = document.getElementById('multiple_timers');
    if (unfinished) get('unfinished').append(unfinished);
    const date = get('date');
    const fields = ['task', 'tags', 'notes', 'start', 'end'];
    const values = () => ({...Object.fromEntries(fields.map(key => [key, get(key).value])), attach: Boolean(get('attach').checked)});
    const pad = (value, digits = 2) => String(value).padStart(digits, '0');
    const localDay = value => {
        const date = new Date(value);
        return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    const localInput = value => {
        const at = new Date(value);
        return `${localDay(at)}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;
    };
    const localDayBounds = day => {
        const [year, month, dayOfMonth] = day.split('-').map(Number);
        const start = new Date(0);
        start.setFullYear(year, month - 1, dayOfMonth);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        end.setHours(0, 0, 0, 0);
        return [start, end];
    };
    const time = value => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No end';
    const interval = (start, end) => [start, end].map(value => value ? new Date(value).toLocaleString() : 'No end').join(' — ');
    const kind = row => row.kind === 'scheduled_session' ? (row.is_virtual ? 'Projected schedule' : 'Scheduled session')
        : row.kind === 'recorded_work' ? 'Recorded work' : 'Uncertain legacy history';
    const taskTitle = row => row.task_id ? taskKnowledge.get(row.task_id)?.title || 'Task unavailable' : 'No task';
    const make = (tag, text, className) => {
        const el = document.createElement(tag);
        el.textContent = text;
        if (className) el.className = className;
        return el;
    };
    const clear = el => { el.textContent = ''; };
    let rows = [], owner = null, generation = 0, createPending = false, unconfirmedCreate = null;
    const entryParams = new URLSearchParams(window.location?.search || '');
    let requestedEntry = entryParams.get('entry');
    let activeDate = /^\d{4}-\d{2}-\d{2}$/.test(entryParams.get('date') || '')
        ? entryParams.get('date') : localDay(new Date());
    date.value = activeDate;

    let pins = null;
    try { pins = createWorkspacePins(localStorage); } catch (error) { get('pin-status').textContent = error.message; }
    const queryText = id => (get(id)?.value || '').trim().toLocaleLowerCase();
    async function startActivity(taskId) {
        await taskKnowledge.load(true);
        if (taskId && (taskKnowledge.state().status !== 'fresh' || !taskKnowledge.get(taskId))) {
            get('pin-status').textContent = 'Task unavailable or metadata stale. Refresh before starting.'; return;
        }
        const timerState = window.multipleTimers?.snapshot();
        if (!timerState?.fresh || timerState.pending || timerState.receipt) {
            get('pin-status').textContent = 'Refresh timer status or resolve its saved operation before starting.'; return;
        }
        // Repeat activities never inherit an old plan association, note or timestamp.
        await window.multipleTimers?.start({task_id:taskId || null});
    }
    let discoveryGeneration = 0;
    async function discovery() {
        const read = ++discoveryGeneration;
        const pinned = get('pins'), activities = get('activities');
        clear(pinned); clear(activities);
        const fresh = taskKnowledge.state().status === 'fresh';
        const action = (label, fn, disabled = false) => {
            const button = make('button', label); button.type = 'button'; button.disabled = disabled;
            if (label === 'Start') {
                button.dataset.workspaceStart = 'true'; button.dataset.metadataAvailable = String(!disabled);
                const state = window.multipleTimers?.snapshot(); button.disabled ||= !state?.fresh || state.pending || Boolean(state.receipt);
            }
            button.addEventListener('click', fn); return button;
        };
        const toggle = (id, remove) => {
            try { remove ? pins.unpin(id) : pins.pin(id); get('pin-status').textContent = ''; discovery(); }
            catch (error) { get('pin-status').textContent = `Pins not saved: ${error.message}`; }
        };
        for (const id of pins?.ids() || []) {
            const task = taskKnowledge.get(id);
            const item = make('div', task ? `${task.title} · ${id.slice(-8)} ` : `Unavailable task · ${id.slice(-8)} `);
            item.append(action('Start', () => startActivity(id), !fresh || !task), action('Unpin', () => toggle(id, true)));
            pinned.append(item);
        }
        const search = queryText('search'), tag = queryText('filter-tag');
        let matches;
        try {
            matches = await api.get(`/api/tasks?${new URLSearchParams({status:'all',title_contains:search,tag_contains:tag,limit:'50'})}`);
            if (read !== discoveryGeneration) return;
            if (!Array.isArray(matches)) throw Error('Unknown task response');
        } catch {
            if (read !== discoveryGeneration) return;
            activities.append(make('p', 'Task search unavailable. Refresh agenda to retry; no mutation was sent.')); return;
        }
        clear(activities);
        if (matches.length === 50) activities.append(make('p', 'Showing at most 50 matches in stable ID order; narrow the search for more.'));
        for (const task of matches) {
            const item = make('div', `${task.title} · ${task.id.slice(-8)} `);
            item.append(action('Start', () => startActivity(task.id), !fresh),
                action(pins?.ids().includes(task.id) ? 'Unpin' : 'Pin', () => toggle(task.id, pins.ids().includes(task.id)), !pins));
            activities.append(item);
        }
    }

    function ledger() {
        const root = get('ledger');
        const focused = document.activeElement?.dataset?.agendaRow;
        clear(root);
        const search = queryText('search'), tag = queryText('filter-tag'), note = queryText('filter-note');
        const visible = rows.filter(row => (!search || taskTitle(row).toLocaleLowerCase().includes(search)) &&
            (!tag || (row.tags || '').toLocaleLowerCase().includes(tag)) && (!note || (row.notes || '').toLocaleLowerCase().includes(note)));
        const parents = new Map();
        for (const group of groupWorkspaceHistory(visible)) {
            const details = make('details', '');
            details.append(make('summary', `${group.day} · ${group.taskId ? taskTitle(group.rows[0]) + ' · ' + group.taskId.slice(-8) : 'Unassigned work'} · ${group.kind === 'recorded_work' ? 'Recorded work' : 'Uncertain legacy'} · ${group.rows.length} interval(s)`));
            root.append(details);
            for (const row of group.rows) parents.set(row.id, details);
        }
        for (const row of visible) {
            const button = make('button', '', 'agenda-entry');
            button.type = 'button';
            button.dataset.agendaRow = row.id;
            button.setAttribute('aria-pressed', String(row.id === owner?.row?.id));
            const times = make('span', time(row.start_time), 'agenda-time');
            times.appendChild(make('span', time(row.end_time)));
            const label = make('span', '');
            label.appendChild(make('span', kind(row), 'agenda-type'));
            label.appendChild(make('span', taskTitle(row), 'agenda-name'));
            button.appendChild(times);
            button.appendChild(label);
            button.addEventListener('click', () => {
                if (switchAllowed()) open(row, true);
            });
            (parents.get(row.id) || root).appendChild(button);
            if (row.kind !== 'scheduled_session') {
                const metadata = make('p', `${interval(row.start_time,row.end_time)} · ${row.provenance || 'Uncertain legacy provenance'} · ${row.notes || 'No work note'}`);
                parents.get(row.id).append(metadata);
                const again = make('button', 'Start again'); again.type = 'button';
                again.disabled = Boolean(row.task_id && (taskKnowledge.state().status !== 'fresh' || !taskKnowledge.get(row.task_id)));
                again.dataset.workspaceStart = 'true'; again.dataset.metadataAvailable = String(!again.disabled);
                const timerState = window.multipleTimers?.snapshot(); again.disabled ||= !timerState?.fresh || timerState.pending || Boolean(timerState.receipt);
                again.addEventListener('click', () => startActivity(row.task_id)); parents.get(row.id).append(again);
            }
            if (focused === row.id) button.focus();
        }
    }

    function updateTaskOptions() {
        const select = get('task');
        const selected = select.value;
        clear(select);
        const empty = make('option', 'No task');
        empty.value = '';
        select.appendChild(empty);
        for (const task of taskKnowledge.values()) {
            const option = make('option', task.title);
            option.value = task.id;
            select.appendChild(option);
        }
        if (selected && !taskKnowledge.get(selected)) {
            const option = make('option', 'Task unavailable');
            option.value = selected;
            select.appendChild(option);
        }
        select.value = selected;
    }

    let progress = null;
    function showProgress() {
        const root = get('progress');
        clear(root);
        if (!progress) return;
        const hours = value => `${Number(value || 0).toLocaleString(undefined, {maximumFractionDigits: 3})} h`;
        root.appendChild(make('p', `Recorded task time: ${hours(progress.recorded_task_time.total)} · Elapsed recorded time: ${hours(progress.elapsed_recorded_time.total)} · Unassigned: ${hours(progress.unassigned_recorded_time.total)}`));
        root.appendChild(make('p', `${progress.cohort} Measured ${new Date(progress.measurement_at).toLocaleString()}. Zone: ${progress.recorded_task_time.meta?.timezone || 'daemon local'}.`));
        for (const task of progress.tasks.rows) root.appendChild(make('p', `${task.labels.join(' / ')} — recorded task union ${hours(task.value)}`));
        for (const basis of ['original', 'current']) {
            if (!progress[basis]) continue;
            root.appendChild(make('p', `${basis === 'original' ? 'Original-plan' : 'Current-schedule'} comparison, selected day's visible plans: inside ${hours(progress[basis].inside.total)}, outside ${hours(progress[basis].outside.total)}. Matching does not imply attachment; overlapping plan fills are non-additive.`));
        }
        const row = owner?.row;
        if (row?.kind === 'scheduled_session') {
            for (const basis of ['original', 'current']) {
                const fill = progress[basis]?.fill.rows.find(item => item.keys[0] === row.id);
                if (fill) root.appendChild(make('p', `${basis === 'original' ? 'Original-plan' : 'Current-schedule'} fill for selected plan: ${hours(fill.value)} (matching same-task work, including unattached work).`));
            }
        }
    }

    async function refresh() {
        const read = ++generation;
        const [start, end] = localDayBounds(activeDate);
        const query = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
        get('status').textContent = 'Loading agenda…';
        const [range] = await Promise.allSettled([api.get(`/agenda?${query}`), taskKnowledge.load(true)]);
        if (read !== generation) return;
        const rangeFailed = range.status === 'rejected' || !Array.isArray(range.value?.items);
        if (!rangeFailed) rows = range.value.items;
        if (!rangeFailed && requestedEntry && !owner) {
            const row = rows.find(row => row.id === requestedEntry);
            requestedEntry = null;
            if (row) open(row);
        }
        ledger(); discovery();
        const taskFailed = taskKnowledge.state().failed;
        get('retry').hidden = !rangeFailed && !taskFailed && !unconfirmedCreate;
        get('status').textContent = rangeFailed ? 'Could not refresh the day. Showing last known entries, if any.'
            : taskFailed ? 'Could not load tasks. Refresh to retry.'
            : rows.length ? '' : 'No scheduled sessions, recorded work, or legacy entries for this day.';
        try {
            const params = new URLSearchParams({start_date: activeDate, end_date: activeDate});
            for (const row of rows) if (row.kind === 'scheduled_session') params.append('plan_ids', row.id);
            const data = await api.get(`/recorded-work-progress?${params}`);
            if (read !== generation) return;
            progress = data?.recorded_task_time ? data : null;
            showProgress();
        } catch {
            if (read !== generation) return;
            progress = null;
            clear(get('progress'));
            get('progress').appendChild(make('p', 'Recorded-work progress unavailable. Refresh reads only.'));
            get('retry').hidden = false;
        }
        if (unconfirmedCreate) {
            if (!rangeFailed && unconfirmedCreate.day === activeDate) unconfirmedCreate.checked = true;
            get('status').textContent += ` A create was not confirmed. Check the ledger for ${unconfirmedCreate.day} before starting another entry.`;
        }
    }

    function details(row) {
        const root = get('detail');
        clear(root);
        const add = (label, text) => { root.appendChild(make('dt', label)); root.appendChild(make('dd', text)); };
        get('kind').textContent = row ? kind(row) : owner ? 'New scheduled session' : 'Inspector';
        get('inspector-title').textContent = row ? taskTitle(row) : owner ? 'Make room for a task.' : 'Select a ledger entry';
        if (!row) return;
        if (row.kind === 'scheduled_session') {
            add(row.is_virtual ? 'Original plan (provisional)' : 'Original plan', interval(row.original_start, row.original_end));
            add('Current schedule', interval(row.start_time, row.end_time));
            const start = make('button', 'Start working');
            start.type = 'button';
            start.disabled = !row.task_id;
            if (!row.task_id) start.title = 'Assign a task before linking a plan timer. Unassigned timers are available above.';
            start.addEventListener('click', async () => {
                const capturedOwner = owner;
                if (!window.multipleTimers || capturedOwner?.pending || capturedOwner?.removalPending) return;
                start.disabled = true;
                const payload = {task_id:row.task_id, tags:row.tags || '', notes:row.notes || '', scheduled_session_id:row.id};
                if (row.is_virtual) payload.expected_projection_revision = row.projection_revision;
                else payload.expected_plan_revision = row.revision;
                try {
                    const acknowledged = await window.multipleTimers.start(payload);
                    // The authoritative timer-mutated event already adopted this ACK's
                    // identity/revision. Never rebuild from the pre-capture row or a mutable
                    // global lastResult after status refresh; either may belong to older intent.
                    if (acknowledged && owner === capturedOwner) await refresh();
                } finally { if (start.isConnected) start.disabled = false; }
            });
            root.appendChild(start);
            const extend = make('button', 'Extend current schedule');
            extend.type = 'button';
            extend.addEventListener('click', () => showExtension(row));
            root.appendChild(extend);
            const capturedDraft = owner;
            window.planRemoval?.mount(root, row, {
                api,
                available: () => owner === capturedDraft && !owner?.pending && !owner?.extensionPending && !owner?.removalPending && switchAllowed(),
                lock: pending => { if (owner === capturedDraft) { owner.removalPending = pending; controls(); } },
                ack: async result => {
                    generation++;
                    if (owner === capturedDraft) {
                        if (result.action === 'delete_everything') open(null);
                        else open({...row, ...result.plan}); // Adopt fixed ACK before any refresh read.
                    }
                    await refresh();
                },
            });
        } else {
            add('Interval', interval(row.start_time, row.end_time));
            if (row.kind === 'recorded_work') {
                add('Provenance', row.provenance || 'Not specified');
                const captured = owner;
                const label = make('label', 'Work-entry note (not task description)');
                const input = make('textarea', ''); input.value = row.notes || ''; label.append(input);
                const save = make('button', 'Save work note'); save.type = 'button'; save.disabled = true;
                const retry = make('button', 'Refresh saved note (read only)'); retry.type = 'button';
                const status = make('p', ''); status.setAttribute('role','status');
                const editor = createWorkNoteEditor({api,row,refresh:()=>refresh(),onState(state) {
                    if (owner !== captured) return;
                    captured.notePending = state.pending;
                    captured.noteDirty = input.value !== (state.saved.notes || '');
                    save.disabled = state.pending || state.blocked || !captured.noteDirty;
                    status.textContent = state.message;
                    if (state.saved.revision !== row.revision) captured.row = state.saved;
                }});
                input.addEventListener('input',()=> { captured.noteDirty = input.value !== (editor.state().saved.notes || ''); save.disabled = editor.state().pending || editor.state().blocked || !captured.noteDirty; });
                save.addEventListener('click',()=>editor.save(input.value)); retry.addEventListener('click',editor.retry);
                root.append(label,save,retry,status);
            }
            else add('Basis', 'Legacy meaning is uncertain. Not included in plan-versus-record comparisons.');
        }
        const calendarLink = make('a', 'Open this day in Calendar');
        calendarLink.href = `/dashboard?${new URLSearchParams({date:localDay(row.start_time), view:'timeGridDay',
            ...(row.task_id ? {task:row.task_id} : {})})}`;
        root.appendChild(calendarLink);
        add('Tags', row.tags || 'None');
        add('Notes', row.notes || 'None');
    }

    function showExtension(plan) {
        if (owner?.pending || owner?.removalPending || owner?.extensionPending) return;
        const root = get('extension');
        clear(root);
        const end = make('input', '');
        end.type = 'datetime-local'; end.step = '0.001';
        end.value = localInput(new Date(Math.max(Date.now(), Date.parse(plan.end_time) + 60000)));
        end.setAttribute('aria-label', 'Proposed current scheduled end');
        const status = make('p', 'Choose an end, then preview the current interval. Original plan and recorded work stay unchanged.');
        status.setAttribute('role', 'status');
        const preview = make('button', 'Preview extension'); preview.type = 'button';
        const apply = make('button', 'Apply extension'); apply.type = 'button'; apply.hidden = true;
        const retry = make('button', 'Check result / refresh only'); retry.type = 'button'; retry.hidden = true;
        const captured = owner;
        const action = createPlanExtensionAction({api,
            acknowledge(saved) {
                if (owner === captured) { owner.row = saved; details(saved); controls(); }
                rows = rows.filter(item => item.id !== plan.id && item.id !== saved.id);
                rows.push(saved); ledger();
            },
            async refresh() {
                // Reread both comparison bases together via the existing shared-snapshot endpoint.
                await agendaPage.refresh();
                if (!get('retry').hidden) throw Error('Refresh incomplete');
            },
            onState(state) {
                if (owner === captured) {
                    owner.extensionPending = state.pending || state.phase === 'uncertain';
                    if (state.phase === 'stale') owner.blocked = true;
                    controls();
                }
                apply.hidden = state.phase !== 'preview'; apply.disabled = state.pending;
                preview.disabled = state.pending || ['uncertain', 'stale', 'acknowledged', 'refresh_failed', 'complete'].includes(state.phase);
                end.disabled = state.pending || state.phase !== 'idle';
                retry.hidden = !['uncertain', 'refresh_failed', 'acknowledged'].includes(state.phase);
                retry.disabled = state.pending;
                const messages = {
                    preview:`Proposed CURRENT interval: ${interval(plan.start_time, state.end)}. Apply is consent; other plans, timers and work stay unchanged.`,
                    stale:'Schedule changed. Attempted extension is retained above; review saved schedule, then explicitly open a new extension.',
                    uncertain:'Apply not confirmed. Check the operation result; this control never repeats the write.',
                    refresh_failed:'Extension saved; refresh failed. Retry reads only.',
                    complete:'Current schedule extended. Original plan and recorded work unchanged.',
                };
                status.textContent = messages[state.phase] || state.error || 'Saving extension…';
            }});
        preview.addEventListener('click', () => { try { action.preview(plan, end.value); } catch (err) { status.textContent = err.message; } });
        apply.addEventListener('click', action.apply);
        retry.addEventListener('click', action.recover);
        root.append(end, preview, status, apply, retry);
    }

    window.addEventListener('extend-selected-plan', async event => {
        const id = event.detail?.planId;
        if (!id || !switchAllowed()) return;
        const draft = owner, day = activeDate, read = ++generation, input = JSON.stringify(values());
        const stillCurrent = () => owner === draft && activeDate === day && generation === read &&
            JSON.stringify(values()) === input && !owner?.pending && !owner?.extensionPending && !owner?.removalPending;
        try {
            const plan = await api.get(`/scheduled-sessions/${encodeURIComponent(id)}`);
            if (!stillCurrent()) return;
            open(plan, true); showExtension(plan);
        } catch (err) {
            if (stillCurrent()) get('edit-status').textContent = `Could not read selected timer's plan: ${err.message}`;
        }
    });

    const saveUnavailable = () => Boolean(owner?.pending || owner?.extensionPending || owner?.removalPending || owner?.blocked || owner?.row?.kind === 'recorded_work' ||
        (!owner?.row && (createPending || unconfirmedCreate)));

    function controls() {
        const row = owner?.row;
        get('form').hidden = !owner || Boolean(row && row.kind !== 'scheduled_session' && !owner.retainedWorkDraft);
        get('attachment').hidden = !owner?.work || !owner?.context;
        get('attach').disabled = Boolean(row || owner?.pending);
        for (const field of fields) get(field).disabled = Boolean(owner?.retainedWorkDraft || owner?.extensionPending || owner?.removalPending);
        get('cancel').disabled = Boolean(owner?.extensionPending || owner?.removalPending);
        get('metadata').hidden = Boolean(row);
        get('metadata').disabled = Boolean(row || owner?.pending);
        get('save').textContent = owner?.work ? 'Save recorded work' : row ? 'Save current schedule' : 'Add to schedule';
        // Keep the focused submitter in place while the write or conflict read is unsettled.
        get('save').setAttribute('aria-disabled', String(saveUnavailable()));
        get('review').hidden = !(row || owner?.context) || !owner?.blocked;
        get('use-latest').hidden = !owner?.latest || owner?.work;
    }

    function open(row, focus = false, create = false, work = false, context = null) {
        owner = row || create ? { row, pending: false, blocked: false, work, context } : null;
        if (owner) {
            const initial = {
                task: row?.task_id || context?.task_id || '', tags: row?.tags || '', notes: row?.notes || '',
                start: row ? localInput(row.start_time) : `${activeDate}T09:00`,
                end: row?.end_time ? localInput(row.end_time) : `${activeDate}T10:00`,
            };
            for (const key of fields) get(key).value = initial[key];
            get('attach').checked = false;
            owner.baseline = values();
        }
        clear(get('extension'));
        details(row);
        showProgress();
        get('edit-status').textContent = work ? 'Record actual past work. Plan context does not attach work unless explicitly checked.' : create ? 'Scheduling time does not record work.' : '';
        if (work) { get('kind').textContent = 'New manual recorded work'; get('inspector-title').textContent = 'Record what you did.'; }
        clear(get('latest'));
        controls();
        ledger();
        if (focus) get('inspector-title').focus();
    }

    function switchAllowed() {
        if (owner?.removalPending || owner?.extensionPending || owner?.notePending) return false;
        const dirty = owner && !get('form').hidden && JSON.stringify(values()) !== JSON.stringify(owner.baseline);
        return !(dirty || owner?.noteDirty) || window.confirm('Leave these unsaved entry edits?');
    }

    async function review() {
        const draft = owner;
        if (!(draft?.row || draft?.context) || draft.reviewing) return;
        draft.reviewing = true;
        try {
            const latest = await api.get(`/scheduled-sessions/${encodeURIComponent((draft.row || draft.context).id)}`);
            if (draft !== owner) return;
            draft.latest = latest;
            get('latest').textContent = `Latest saved schedule: ${interval(latest.start_time, latest.end_time)}. Your input is unchanged.${draft.work ? ' Start an explicit new work entry after review; this write is not replayed.' : ''}`;
        } catch (err) {
            if (draft === owner) get('latest').textContent = `Could not read this schedule: ${err.message}. Refresh the ledger to inspect the day.`;
        } finally {
            draft.reviewing = false;
            if (draft === owner) controls();
        }
    }

    async function save(event) {
        event.preventDefault();
        const draft = owner;
        if (!draft || get('form').hidden || saveUnavailable()) return;
        const submitted = values();
        const row = draft.row;
        const endpoint = (key, stored) => row && submitted[key] === draft.baseline[key] ? row[stored] : new Date(submitted[key]).toISOString();
        let payload;
        try {
            payload = { start_time: endpoint('start', 'start_time'), end_time: endpoint('end', 'end_time') };
            if (new Date(payload.end_time) <= new Date(payload.start_time)) throw Error();
        } catch {
            get('edit-status').textContent = 'Choose valid times with End after Start.';
            return;
        }
        if (!row) Object.assign(payload, { task_id: submitted.task || null, tags: submitted.tags, notes: submitted.notes });
        if (draft.work && submitted.attach && draft.context) {
            payload.scheduled_session_id = draft.context.id;
            if (draft.context.is_virtual) payload.expected_projection_revision = draft.context.projection_revision;
            else payload.expected_plan_revision = draft.context.revision;
        }
        draft.pending = true;
        createPending = !row || createPending;
        controls();
        get('edit-status').textContent = 'Saving entry…';
        let saved;
        try {
            saved = draft.work ? await api.saveRecordedWork(payload) : await api.saveScheduledSession(row, payload);
        } catch (err) {
            const uncertain = !err.status || err.status >= 500;
            draft.blocked = uncertain || err.status === 409;
            if (uncertain && !row) unconfirmedCreate = { day: localDay(payload.start_time), checked: false };
            if (draft === owner) {
                get('edit-status').textContent = uncertain ? 'Save not confirmed. Check the saved entry or refresh the ledger; do not repeat this write.'
                    : err.status === 409 ? 'Plan association or schedule changed on the server. Review saved times before editing again.' : err.message;
                if (draft.blocked && (row || draft.context)) void review();
            }
            if (draft.blocked) void refresh();
            return;
        } finally {
            draft.pending = false;
            if (!row) createPending = false;
            controls();
        }
        generation++; // Any pre-acknowledgement range response is obsolete.
        rows = rows.filter(item => item.id !== (row?.id || saved.id));
        const [dayStart, dayEnd] = localDayBounds(activeDate);
        if (new Date(saved.start_time) < dayEnd && new Date(saved.end_time) > dayStart) {
            rows.push(saved);
            rows.sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time) || a.id.localeCompare(b.id));
        }
        if (draft === owner) {
            draft.retainedWorkDraft = draft.work && JSON.stringify(values()) !== JSON.stringify(submitted);
            draft.row = saved;
            // Retain later endpoint typing; task/tags/notes are create-only, so preserve any
            // unsent metadata by preventing metadata edits while POST is in flight.
            draft.baseline = submitted;
            details(saved);
            controls();
            get('edit-status').textContent = draft.work ? 'Recorded work saved.' : 'Schedule saved.';
            if (draft.retainedWorkDraft) get('edit-status').textContent += ' Later input is retained read-only, not saved. Start an explicit new entry to record more work.';
            for (const warning of saved.warnings || []) get('edit-status').textContent += ` Same-task overlap: ${warning.overlap_seconds} seconds with records ${warning.record_ids.join(', ')}. Both raw entries retained.`;
        }
        ledger();
        await refresh();
    }

    date.addEventListener('change', () => {
        if (!date.value || !switchAllowed()) { date.value = activeDate; return; }
        activeDate = date.value;
        rows = [];
        open(null);
        void refresh();
    });
    get('new').addEventListener('click', () => {
        if (!switchAllowed()) return;
        if (unconfirmedCreate) {
            if (!unconfirmedCreate.checked) {
                get('status').textContent = `Check ${unconfirmedCreate.day} with Refresh agenda before starting another entry.`;
                return;
            }
            if (!window.confirm('Only start a new plan after checking that the unconfirmed plan does not already exist. Start a new plan?')) return;
            unconfirmedCreate = null;
        }
        open(null, true, true);
    });
    get('record').addEventListener('click', () => {
        if (!switchAllowed()) return;
        if (unconfirmedCreate) {
            if (!unconfirmedCreate.checked || !window.confirm('Inspect the ledger first. Start an explicitly new work entry, not a retry?')) return;
            unconfirmedCreate = null;
        }
        const context = owner?.row?.kind === 'scheduled_session' ? owner.row : null;
        open(null, true, true, true, context);
    });
    get('retry').addEventListener('click', refresh);
    get('review').addEventListener('click', review);
    get('use-latest').addEventListener('click', () => {
        if (owner?.latest && switchAllowed()) open(owner.latest);
    });
    get('cancel').addEventListener('click', () => {
        if (!owner?.blocked) open(owner?.row || null);
        else open(null);
    });
    get('form').addEventListener('submit', save);
    window.addEventListener('beforeunload', event => {
        if (createPending || owner?.pending || (owner && !get('form').hidden && JSON.stringify(values()) !== JSON.stringify(owner.baseline))) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
    function refreshTaskLabels() {
        updateTaskOptions();
        if (owner?.row) get('inspector-title').textContent = taskTitle(owner.row);
        ledger(); void discovery();
    }

    window.addEventListener('timetrace:timer-mutated', event => {
        const result = event.detail;
        if (result?.captured_plan_id && owner?.row?.id === result.requested_scheduled_session_id) {
            owner.row = {...owner.row, id:result.captured_plan_id, is_virtual:false, revision:result.plan_revision};
            details(owner.row); controls();
        } else if (result?.plan_revision && owner?.row?.id === result.timer?.scheduled_session_id) {
            owner.row.revision = result.plan_revision;
        }
    });
    window.addEventListener('beforeunload', event => {
        if (!agendaPage.hasDraft() && !window.multipleTimers?.hasNoteDraft?.()) return;
        event.preventDefault(); event.returnValue = '';
    });
    void refresh();
    for (const id of ['search','filter-tag','filter-note']) get(id).addEventListener('input', () => { discovery(); ledger(); });
    return { refresh, refreshTaskLabels,
        hasDraft: () => Boolean(owner && (!get('form').hidden && JSON.stringify(values()) !== JSON.stringify(owner.baseline) || owner.pending || owner.extensionPending || owner.removalPending || owner.noteDirty || owner.notePending))
    };
})();
