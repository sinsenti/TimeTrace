import { useState, type FormEvent } from 'react';

export type Plan = {
  id: number;
  task: string;
  date: string;
  start: string;
  end: string;
  original?: string;
  tags?: string;
  notes?: string;
};
export type Interval = { task: string; start: number; end: number; note?: string; planId?: number };
export type RecordedInterval = Interval & { id: number };
export const unassigned = 'No task';
export const activities = [
  { title: 'Draft project outline', priority: 'High', tag: 'Project' },
  { title: 'Review reading notes', priority: 'Medium', tag: 'Learning' },
  { title: 'Weekly planning', priority: 'Low', tag: 'Planning' },
];
export function localDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const time = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});
export function range(item: Interval) {
  return `${time.format(item.start)} – ${time.format(item.end)}`;
}

export function ActivityPicker({
  pinned,
  setPinned,
  plans,
  onChoose,
  onStart,
  canStart,
}: {
  pinned: string[];
  setPinned: (next: string[]) => void;
  plans: Plan[];
  onChoose: (title: string) => void;
  onStart: (title: string) => void;
  canStart: boolean;
}) {
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('Any priority');
  const [pinsOnly, setPinsOnly] = useState(false);
  const [manage, setManage] = useState(false);
  const rows = activities.filter(
    (row) =>
      (!pinsOnly || pinned.includes(row.title)) &&
      (priority === 'Any priority' || row.priority === priority) &&
      includes(row.title, search),
  );
  return (
    <section className="card" aria-labelledby="activities-title">
      <div className="section-head">
        <h2 id="activities-title">Start an activity</h2>
        <button aria-expanded={manage} onClick={() => setManage(!manage)}>
          Manage pins
        </button>
      </div>
      {manage && (
        <fieldset>
          <legend>Pinned activities</legend>
          {activities.map(({ title }) => (
            <label className="check" key={title}>
              <input
                type="checkbox"
                checked={pinned.includes(title)}
                onChange={(event) =>
                  setPinned(
                    event.target.checked ? [...pinned, title] : pinned.filter((name) => name !== title),
                  )
                }
              />
              {title}
            </label>
          ))}
        </fieldset>
      )}
      <div className="button-row control-row">
        <button aria-pressed={!pinsOnly} onClick={() => setPinsOnly(false)}>
          By priority
        </button>
        <button aria-pressed={pinsOnly} onClick={() => setPinsOnly(true)}>
          Pinned activities
        </button>
      </div>
      <div className="time-fields">
        <label>
          Filter activities
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label>
          Priority
          <select value={priority} onChange={(event) => setPriority(event.target.value)}>
            {['Any priority', 'High', 'Medium', 'Low'].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>
      <ul className="tool-list">
        {rows.map(({ title, priority: level, tag }) => (
          <li key={title}>
            <strong>{title}</strong>
            <p className="hint">
              {level} · {tag}
              {plans.some((plan) => plan.task === title) ? ' · On schedule' : ''}
            </p>
            <div className="button-row">
              <button onClick={() => onChoose(title)}>Use in timer</button>
              <button disabled={!canStart} onClick={() => onStart(title)}>
                Start
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!rows.length && <p className="hint">No activities match.</p>}
      <p className="hint">A schedule badge does not attach the work to a plan.</p>
    </section>
  );
}

function includes(value: string | undefined, query: string) {
  return (value ?? '').toLowerCase().includes(query.trim().toLowerCase());
}
function tagOf(task: string) {
  return activities.find((row) => row.title === task)?.tag ?? '';
}
const fixtureTime = Date.now();
const exampleWork: RecordedInterval[] = [
  {
    id: 1,
    task: activities[0].title,
    start: fixtureTime - 3_600_000,
    end: fixtureTime - 1_800_000,
    note: 'Sketched the main sections.',
    planId: 1,
  },
  {
    id: 2,
    task: unassigned,
    start: fixtureTime - 1_500_000,
    end: fixtureTime - 900_000,
    note: 'Reviewed the inbox.',
  },
];

export function HistoryTools({
  recorded,
  plans,
  save,
  day,
}: {
  recorded: RecordedInterval[];
  plans: Plan[];
  save: (item: Interval) => void;
  day: string;
}) {
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [notes, setNotes] = useState('');
  const [kind, setKind] = useState('All entries');
  const [exportOpen, setExportOpen] = useState(false);
  const [format, setFormat] = useState('Markdown');
  const [selection, setSelection] = useState<'all' | 'selected'>('all');
  const [selected, setSelected] = useState<number[]>([]);
  const visibleWork = [...recorded, ...exampleWork]
    .map((item) => ({ item, key: item.id }))
    .filter(
      ({ item }) =>
        includes(item.task, search) && includes(tagOf(item.task), tag) && includes(item.note, notes),
    );
  const visiblePlans = plans.filter(
    (item) =>
      includes(item.task, search) &&
      includes(`${tagOf(item.task)} ${item.tags ?? ''}`, tag) &&
      includes(item.notes, notes),
  );
  const exporting = visibleWork.filter(
    ({ key }) => kind !== 'Scheduled sessions' && (selection === 'all' || selected.includes(key)),
  );
  const csv = (text: string) => `"${text.replaceAll('"', '""')}"`;
  const preview =
    format === 'CSV'
      ? `Task,Start,End,Entry note\n${exporting.map(({ item }) => [item.task, new Date(item.start).toISOString(), new Date(item.end).toISOString(), item.note ?? ''].map(csv).join(',')).join('\n')}`
      : `# Recorded work\n${exporting.map(({ item }) => `- ${localDate(item.start)} · ${item.task} · ${range(item)}${item.note ? ` — ${item.note}` : ''}`).join('\n')}`;
  return (
    <section className="card" aria-labelledby="history-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">Ledger</p>
          <h2 id="history-title">History &amp; plans</h2>
        </div>
      </div>
      <ManualRecording plans={plans} save={save} day={day} />
      <div className="control-row time-fields">
        <label>
          Search history &amp; plans
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label>
          Entry type
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            {['All entries', 'Recorded work', 'Scheduled sessions'].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>
      <details className="tool-details">
        <summary>Filter by task tag or note</summary>
        <div className="time-fields">
          <label>
            Task tag contains
            <input type="search" value={tag} onChange={(event) => setTag(event.target.value)} />
          </label>
          <label>
            Notes contain
            <input type="search" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
        </div>
      </details>
      <div className="button-row control-row">
        <button aria-expanded={exportOpen} onClick={() => setExportOpen(!exportOpen)}>
          Export saved history
        </button>
      </div>
      {exportOpen && (
        <div className="example">
          <div className="time-fields">
            <label>
              Format
              <select value={format} onChange={(event) => setFormat(event.target.value)}>
                <option>Markdown</option>
                <option>CSV</option>
              </select>
            </label>
            <label>
              Scope
              <select
                value={selection}
                onChange={(event) =>
                  setSelection(event.target.value === 'selected' ? 'selected' : 'all')
                }
              >
                <option value="all">All filtered saved work</option>
                <option value="selected">Selected work only</option>
              </select>
            </label>
          </div>
          <p className="hint">
            Demo preview only · {exporting.length} recorded intervals · no plans or live timers
          </p>
          {exporting.length ? <pre>{preview}</pre> : <p>No recorded intervals in this export.</p>}
        </div>
      )}
      {kind !== 'Scheduled sessions' && (
        <ul className="tool-list">
          {visibleWork.map(({ item, key }) => (
            <li key={key}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={selected.includes(key)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked ? [...selected, key] : selected.filter((id) => id !== key),
                    )
                  }
                />
                Select {item.task} for export
              </label>
              <details>
                <summary>
                  {localDate(item.start)} · {item.task} · {range(item)}
                </summary>
                <p>Entry note: {item.note || 'None'}.</p>
                <p>Plan link: {item.planId ? `Explicit link to plan ${item.planId}` : 'None'}</p>
                <p className="hint">
                  Recorded-work inspector: review or correct the interval, edit its Entry note, or
                  explicitly assign or link it. These inspector writes are illustrated, not wired.
                </p>
              </details>
            </li>
          ))}
        </ul>
      )}
      {kind !== 'Recorded work' && (
        <ul className="tool-list">
          {visiblePlans.map((plan) => (
            <li key={plan.id}>
              <strong>{plan.task}</strong>
              <p className="hint">
                Scheduled session · {plan.date} · {plan.start}–{plan.end}
              </p>
              <PlanDetails plan={plan} />
            </li>
          ))}
        </ul>
      )}
      <details className="tool-details">
        <summary>Recorded-time totals and goals</summary>
        <p>
          Show recorded task time, elapsed recorded time, and unassigned recorded time as distinct
          measures.
        </p>
        <p className="hint">
          Illustration: day and week goals use saved work, not planned time or active timers.
        </p>
      </details>
    </section>
  );
}

function ManualRecording({
  plans,
  save,
  day,
}: {
  plans: Plan[];
  save: (item: Interval) => void;
  day: string;
}) {
  const [task, setTask] = useState(unassigned);
  const [link, setLink] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const start = Date.parse(String(data.get('start')));
    const end = Date.parse(String(data.get('end')));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > Date.now()) {
      setError('Choose a past interval with the end after the start.');
      return;
    }
    save({ task, start, end, note: String(data.get('note')), planId: link ? Number(link) : undefined });
    cancel();
  }
  function cancel() {
    setOpen(false);
    setTask(unassigned);
    setLink('');
    setError('');
  }
  return (
    <div className="control-row">
      <button aria-expanded={open} onClick={() => (open ? cancel() : setOpen(true))}>
        Add recorded work
      </button>
      {open && (
        <form className="example" onSubmit={submit}>
          <label>
            Recorded task
            <select
              value={task}
              onChange={(event) => {
                setTask(event.target.value);
                setLink('');
              }}
            >
              {[unassigned, ...activities.map((row) => row.title)].map((title) => (
                <option key={title}>{title}</option>
              ))}
            </select>
          </label>
          <label>
            Start
            <input required name="start" type="datetime-local" defaultValue={`${day}T08:00`} />
          </label>
          <label>
            End
            <input required name="end" type="datetime-local" defaultValue={`${day}T08:30`} />
          </label>
          <label>
            Entry note
            <textarea name="note" rows={2} />
          </label>
          <label>
            Link to a scheduled session
            <select value={link} onChange={(event) => setLink(event.target.value)}>
              <option value="">No explicit link</option>
              {plans
                .filter((plan) => task !== unassigned && plan.task === task)
                .map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.date} · {plan.start}–{plan.end}
                  </option>
                ))}
            </select>
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="button-row">
            <button type="submit" className="primary">
              Save recorded work
            </button>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function PlanDetails({ plan }: { plan: Plan }) {
  return (
    <details className="tool-details">
      <summary>Plan details &amp; actions</summary>
      <p>Original plan: {plan.original ?? `${plan.date} · ${plan.start}–${plan.end}`}</p>
      <p>
        Current schedule: {plan.date} · {plan.start}–{plan.end}
      </p>
      <p>
        Plan notes: {plan.notes || 'None'} · Tags: {plan.tags || tagOf(plan.task) || 'None'}
      </p>
      <details className="tool-details">
        <summary>Extend schedule · preview example</summary>
        <p>Review new times before applying. Extending the plan never changes recorded intervals.</p>
      </details>
      <details className="tool-details">
        <summary>Delete everything or Squeeze · review example</summary>
        <p>
          Show the whole affected set of explicitly linked work before a destructive action. Squeeze fits
          the schedule to linked work without editing that work. An unfinished associated timer blocks
          either action.
        </p>
      </details>
      <p className="hint">Plan action examples do not change this schedule.</p>
    </details>
  );
}

export function TimerTools() {
  return (
    <details className="tool-details">
      <summary>Timer tools &amp; unfinished timers</summary>
      <p className="hint">Illustrations only. Start and Stop above are interactive.</p>
      <details className="tool-details">
        <summary>Switch timers · Pause / Resume</summary>
        <p>
          Keep the selected timer clear and let the user switch between unfinished timers without
          stopping the others.
        </p>
      </details>
      <details className="tool-details">
        <summary>Adjust time · Discard unsaved work</summary>
        <p>
          Show quick −5 / +5 adjustments and a full correction preview. Confirm discard separately from
          stopping and recording an interval.
        </p>
      </details>
      <details className="tool-details">
        <summary>Review inactivity gap · Focus and break</summary>
        <p>
          Review, claim or skip a gap separately from resuming. Focus information is separate from saved
          work. The host’s inactivity does not pause a timer.
        </p>
      </details>
      <details className="tool-details">
        <summary>Assign stopped work · Shortcuts and help</summary>
        <p>
          Offer explicit task assignment for unassigned work after Stop. Desktop shortcuts remain
          optional; touch controls must also be available.
        </p>
      </details>
    </details>
  );
}
