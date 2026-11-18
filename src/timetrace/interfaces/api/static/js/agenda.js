/* Folio owns one editable draft; range reads never replace that draft. */
const agendaPage = (() => {
    const get = id => document.getElementById(`agenda-${id}`);
    const date = get('date');
    const fields = ['task', 'tags', 'notes', 'start', 'end'];
    const values = () => Object.fromEntries(fields.map(key => [key, get(key).value]));
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
    let activeDate = localDay(new Date());
    date.value = activeDate;

    function ledger() {
        const root = get('ledger');
        const focused = document.activeElement?.dataset?.agendaRow;
        clear(root);
        for (const row of rows) {
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
            root.appendChild(button);
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

    async function refresh() {
        const read = ++generation;
        const [start, end] = localDayBounds(activeDate);
        const query = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
        get('status').textContent = 'Loading agenda…';
        const [range] = await Promise.allSettled([api.get(`/agenda?${query}`), taskKnowledge.load(true)]);
        if (read !== generation) return;
        const rangeFailed = range.status === 'rejected' || !Array.isArray(range.value?.items);
        if (!rangeFailed) rows = range.value.items;
        ledger();
        const taskFailed = taskKnowledge.state().failed;
        get('retry').hidden = !rangeFailed && !taskFailed && !unconfirmedCreate;
        get('status').textContent = rangeFailed ? 'Could not refresh the day. Showing last known entries, if any.'
            : taskFailed ? 'Could not load tasks. Refresh to retry.'
            : rows.length ? '' : 'No scheduled sessions, recorded work, or legacy entries for this day.';
        if (unconfirmedCreate) {
            if (!rangeFailed && unconfirmedCreate.day === activeDate) unconfirmedCreate.checked = true;
            get('status').textContent += ` A create was not confirmed. Check the ledger for ${unconfirmedCreate.day} before starting another plan.`;
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
        } else {
            add('Interval', interval(row.start_time, row.end_time));
            if (row.kind === 'recorded_work') add('Provenance', row.provenance || 'Not specified');
            else add('Basis', 'Legacy meaning is uncertain. Not included in plan-versus-record comparisons.');
        }
        add('Tags', row.tags || 'None');
        add('Notes', row.notes || 'None');
    }

    const saveUnavailable = () => Boolean(owner?.pending || owner?.blocked ||
        (!owner?.row && (createPending || unconfirmedCreate)));

    function controls() {
        const row = owner?.row;
        get('form').hidden = !owner || Boolean(row && row.kind !== 'scheduled_session');
        get('metadata').hidden = Boolean(row);
        get('metadata').disabled = Boolean(row || owner?.pending);
        get('save').textContent = row ? 'Save current schedule' : 'Add to schedule';
        // Keep the focused submitter in place while the write or conflict read is unsettled.
        get('save').setAttribute('aria-disabled', String(saveUnavailable()));
        get('review').hidden = !row || !owner.blocked;
        get('use-latest').hidden = !owner?.latest;
    }

    function open(row, focus = false, create = false) {
        owner = row || create ? { row, pending: false, blocked: false } : null;
        if (owner) {
            const initial = {
                task: row?.task_id || '', tags: row?.tags || '', notes: row?.notes || '',
                start: row ? localInput(row.start_time) : `${activeDate}T09:00`,
                end: row?.end_time ? localInput(row.end_time) : `${activeDate}T10:00`,
            };
            for (const key of fields) get(key).value = initial[key];
            owner.baseline = values();
        }
        details(row);
        get('edit-status').textContent = create ? 'Scheduling time does not record work.' : '';
        clear(get('latest'));
        controls();
        ledger();
        if (focus) get('inspector-title').focus();
    }

    function switchAllowed() {
        const dirty = owner && !get('form').hidden && JSON.stringify(values()) !== JSON.stringify(owner.baseline);
        return !dirty || window.confirm('Leave these unsaved schedule edits?');
    }

    async function review() {
        const draft = owner;
        if (!draft?.row || draft.reviewing) return;
        draft.reviewing = true;
        try {
            const latest = await api.get(`/scheduled-sessions/${encodeURIComponent(draft.row.id)}`);
            if (draft !== owner) return;
            draft.latest = latest;
            get('latest').textContent = `Latest saved schedule: ${interval(latest.start_time, latest.end_time)}. Your input is unchanged.`;
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
        draft.pending = true;
        createPending = !row || createPending;
        controls();
        get('edit-status').textContent = 'Saving schedule…';
        let saved;
        try {
            saved = await api.saveScheduledSession(row, payload);
        } catch (err) {
            const uncertain = !err.status || err.status >= 500;
            draft.blocked = uncertain || err.status === 409;
            if (uncertain && !row) unconfirmedCreate = { day: localDay(payload.start_time), checked: false };
            if (draft === owner) {
                get('edit-status').textContent = uncertain ? 'Save not confirmed. Check the saved schedule or refresh the ledger; do not repeat this write.'
                    : err.status === 409 ? 'Schedule changed on the server. Review saved times before editing again.' : err.message;
                if (draft.blocked && row) void review();
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
            draft.row = saved;
            // Retain later endpoint typing; task/tags/notes are create-only, so preserve any
            // unsent metadata by preventing metadata edits while POST is in flight.
            draft.baseline = submitted;
            details(saved);
            controls();
            get('edit-status').textContent = 'Schedule saved.';
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
                get('status').textContent = `Check ${unconfirmedCreate.day} with Refresh agenda before starting another plan.`;
                return;
            }
            if (!window.confirm('Only start a new plan after checking that the unconfirmed plan does not already exist. Start a new plan?')) return;
            unconfirmedCreate = null;
        }
        open(null, true, true);
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
        ledger();
    }

    void refresh();
    return { refresh, refreshTaskLabels };
})();
