import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

// Throwaway: compare three layouts for the same touch scheduling and timer workflow.
const modes = ['A', 'B', 'C'] as const;
type Mode = (typeof modes)[number];
const names: Record<Mode, string> = { A: 'Dayline', B: 'Split desk', C: 'Focus' };
const tasks = ['Draft project outline', 'Review reading notes', 'Weekly planning'];
const day = '2026-06-16';
type Plan = { id: number; task: string; date: string; start: string; end: string };
type Interval = { task: string; start: number; end: number };
const sample: Plan[] = [
  { id: 1, task: tasks[0], date: day, start: '09:00', end: '09:45' },
  { id: 2, task: tasks[1], date: day, start: '11:00', end: '11:30' },
  { id: 3, task: tasks[2], date: day, start: '14:00', end: '14:30' },
];
const time = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});
function range(item: Interval) {
  return `${time.format(item.start)} – ${time.format(item.end)}`;
}
function fromUrl(): Mode {
  const mode = new URLSearchParams(location.search).get('variant');
  return modes.find((key) => key === mode) ?? 'A';
}
function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

function App() {
  const [variant, setVariant] = useState(fromUrl);
  const [plans, setPlans] = useState(sample);
  const [draft, setDraft] = useState<Plan | null>(null);
  const [formError, setFormError] = useState('');
  const [task, setTask] = useState(tasks[0]);
  const [online, setOnline] = useState(true);
  const [running, setRunning] = useState<Omit<Interval, 'end'> | null>(null);
  const [pending, setPending] = useState<Interval | null>(null);
  const [remote, setRemote] = useState<Interval | null>(null);
  const [recorded, setRecorded] = useState<Interval[]>([]);
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<'work' | 'plans'>('work');
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const editing = Boolean(draft);

  useEffect(() => {
    if (editing) editorHeading.current?.focus();
    else if (returnFocus.current) {
      if (returnFocus.current.isConnected) returnFocus.current.focus();
      else document.getElementById('agenda-title')?.focus();
      returnFocus.current = null;
    }
  }, [editing]);

  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if (
        !import.meta.env.DEV ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        (event.target instanceof Element &&
          event.target.closest('input, select, textarea, button, a, [contenteditable]'))
      )
        return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        cycle(event.key === 'ArrowLeft' ? -1 : 1);
      }
    }
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [variant]);

  function cycle(offset: number) {
    const next = modes[(modes.indexOf(variant) + offset + modes.length) % modes.length];
    const url = new URL(location.href);
    url.searchParams.set('variant', next);
    history.replaceState(null, '', url);
    setVariant(next);
  }
  function edit(plan: Plan, trigger: HTMLElement) {
    returnFocus.current = trigger;
    setDraft(plan);
    setFormError('');
  }
  function savePlan(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (draft.end <= draft.start) {
      setFormError('End time must be after start time.');
      return;
    }
    setPlans((previous) =>
      previous.some((row) => row.id === draft.id)
        ? previous.map((row) => (row.id === draft.id ? draft : row))
        : [...previous, draft],
    );
    setNotice(`Scheduled session saved for ${draft.task}.`);
    setDraft(null);
  }
  function start() {
    setRunning({ task, start: Date.now() });
    setNotice(online ? 'Timer started in the demo.' : 'Timer started on this device in the demo.');
  }
  function stop() {
    if (!running) return;
    const item = { ...running, end: Date.now() };
    setRunning(null);
    if (online) {
      setRecorded((previous) => [item, ...previous]);
      setNotice('Recorded interval synced in the demo.');
    } else {
      setPending(item);
      setNotice('Saved on this device. Stop pending sync.');
    }
  }
  function reconnect(overlap: boolean) {
    setOnline(true);
    if (!pending) {
      setNotice('Demo connection restored.');
      return;
    }
    if (overlap) {
      setRemote({ task: pending.task, start: pending.start - 900_000, end: pending.end + 900_000 });
      setNotice('Same-task overlap. Review the two captures before syncing.');
    } else {
      setRecorded((previous) => [pending, ...previous]);
      setPending(null);
      setNotice('Original time range synced in the demo.');
    }
  }
  function resolve(item: Interval) {
    setRecorded((previous) => [item, ...previous]);
    setPending(null);
    setRemote(null);
    setNotice('Choice synced in the demo. Only the selected interval is counted.');
  }

  const timer = (
    <section className="card timer" aria-labelledby="timer-title">
      <p className="eyebrow">Recorded work</p>
      <h2 id="timer-title">{running ? 'Timer running' : 'Timer'}</h2>
      {running ? <Clock key={running.start} start={running.start} /> : <p className="clock">00:00:00</p>}
      {running ? (
        <p>{running.task}</p>
      ) : (
        <label>
          Task
          <select value={task} onChange={(e) => setTask(e.target.value)}>
            {tasks.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
      )}
      {running ? (
        <button className="primary" onClick={stop}>
          Stop timer
        </button>
      ) : (
        <button className="primary" disabled={pending !== null} onClick={start}>
          Start timer
        </button>
      )}
      {pending && (
        <p className="hint">
          Review or sync the current recording before starting another in this demo.
        </p>
      )}
    </section>
  );
  const feedback = (
    <section className="card" aria-labelledby="work-title">
      <p className="eyebrow">Original times</p>
      <h2 id="work-title">Recorded intervals</h2>
      {pending && (
        <div className="pending">
          <strong>
            {remote ? 'Needs review · Same-task overlap' : 'Saved on this device · Stop pending sync'}
          </strong>
          <p>{pending.task}</p>
          <dl>
            <div>
              <dt>This phone</dt>
              <dd>{range(pending)}</dd>
            </div>
            {remote && (
              <div>
                <dt>Other device</dt>
                <dd>{range(remote)}</dd>
              </div>
            )}
          </dl>
          {remote && (
            <div className="button-row">
              <button onClick={() => resolve(pending)}>Keep this phone’s interval</button>
              <button onClick={() => resolve(remote)}>Keep other device’s interval</button>
            </div>
          )}
          <p className="hint">Not included in recorded time until accepted.</p>
        </div>
      )}
      {recorded.length === 0 && !pending && (
        <p className="hint">No recorded intervals in this demo yet.</p>
      )}
      {recorded.length > 0 && (
        <ul className="records">
          {recorded.map((item, index) => (
            <li key={`${item.start}-${index}`}>
              <strong>{item.task}</strong>
              <span>{range(item)}</span>
              <small>Synced</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  const agenda = (
    <section className="card agenda" aria-labelledby="agenda-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">Plans only</p>
          <h2 id="agenda-title" tabIndex={-1}>
            Scheduled sessions
          </h2>
        </div>
        <button
          onClick={(e) =>
            edit({ id: Date.now(), task, date: day, start: '09:00', end: '09:30' }, e.currentTarget)
          }
        >
          Add session
        </button>
      </div>
      <ul className="plan-list">
        {[...plans]
          .sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`))
          .map((plan) => (
            <li key={plan.id}>
              <div className="slot">
                <span>
                  {plan.start}–{plan.end}
                </span>
                <small>{plan.date}</small>
              </div>
              <strong>{plan.task}</strong>
              <button
                onClick={(e) => edit(plan, e.currentTarget)}
                aria-label={`Edit times for ${plan.task}`}
              >
                Edit times
              </button>
            </li>
          ))}
      </ul>
    </section>
  );
  const editor = draft && (
    <section className="card editor" aria-labelledby="edit-title">
      <p className="eyebrow">Planned time, not recorded work</p>
      <h2 id="edit-title" ref={editorHeading} tabIndex={-1}>
        {plans.some((item) => item.id === draft.id) ? 'Edit scheduled session' : 'Add scheduled session'}
      </h2>
      <form onSubmit={savePlan}>
        <label>
          Scheduled task
          <select value={draft.task} onChange={(e) => setDraft({ ...draft, task: e.target.value })}>
            {tasks.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input
            required
            type="date"
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
        </label>
        <div className="time-fields">
          <label>
            Start time
            <input
              required
              type="time"
              value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
          </label>
          <label>
            End time
            <input
              required
              type="time"
              value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            />
          </label>
        </div>
        {formError && <p role="alert">{formError}</p>}
        <div className="button-row">
          <button className="primary" type="submit">
            Save session
          </button>
          <button type="button" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );

  return (
    <>
      <header>
        <div className="frame masthead">
          <div>
            <p className="eyebrow">TimeTrace / Prototype</p>
            <h1>Agenda</h1>
          </div>
          <span className="tag" data-online={online}>
            {online ? 'Demo online' : 'Demo offline'}
          </span>
        </div>
      </header>
      <main className={`frame layout layout-${variant}`}>
        <div className="intro">
          <p>
            {variant === 'A'
              ? 'Scan the day in time order.'
              : variant === 'B'
                ? 'Keep the plan and timer side by side.'
                : 'Put one activity in view at a time.'}
          </p>
          <p className="hint">
            Synthetic data only. Connection and saving are simulated; reload resets the preview.
          </p>
        </div>
        {variant === 'A' && (
          <VariantA agenda={agenda} editor={editor} timer={timer} feedback={feedback} />
        )}
        {variant === 'B' && (
          <VariantB agenda={agenda} editor={editor} timer={timer} feedback={feedback} />
        )}
        {variant === 'C' && (
          <>
            <nav className="segmented" aria-label="Focus view">
              <button aria-pressed={panel === 'work'} onClick={() => setPanel('work')}>
                Timer and work
              </button>
              <button aria-pressed={panel === 'plans'} onClick={() => setPanel('plans')}>
                Schedule
              </button>
            </nav>
            {panel === 'work' ? (
              <div className="focus-pane">
                {timer}
                {feedback}
              </div>
            ) : (
              <div className="focus-pane">{editor || agenda}</div>
            )}
          </>
        )}
        <section className="card demo" aria-labelledby="demo-title">
          <h2 id="demo-title">Demo controls</h2>
          <div className="button-row">
            {online ? (
              <button
                disabled={Boolean(remote)}
                onClick={() => {
                  setOnline(false);
                  setNotice('Demo connection lost.');
                }}
              >
                Simulate connection loss
              </button>
            ) : (
              <>
                <button onClick={() => reconnect(false)}>Reconnect</button>
                {pending && <button onClick={() => reconnect(true)}>Reconnect with overlap</button>}
              </>
            )}
          </div>
          <p className="hint">
            {plans.length} scheduled · {running ? '1' : '0'} running · {pending ? '1' : '0'} awaiting
            sync or review · {recorded.length} synced
          </p>
        </section>
        <p className="notice" role="status">
          {notice}
        </p>
      </main>
      {import.meta.env.DEV && (
        <nav className="switcher" aria-label="Prototype layout">
          <button aria-label="Previous layout" onClick={() => cycle(-1)}>
            ←
          </button>
          <span aria-live="polite">
            {variant} · {names[variant]}
          </span>
          <button aria-label="Next layout" onClick={() => cycle(1)}>
            →
          </button>
        </nav>
      )}
    </>
  );
}

// Only the clock re-renders on a tick. Elapsed time comes from the start stamp,
// not the number of callbacks the browser was able to run.
function Clock({ start }: { start: number }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - start));
  useEffect(() => {
    let timeout: number | undefined;
    function refresh() {
      window.clearTimeout(timeout);
      if (document.hidden) return;
      const current = Math.max(0, Date.now() - start);
      setElapsed(current);
      timeout = window.setTimeout(refresh, 1000 - (current % 1000));
    }
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [start]);
  return <p className="clock">{duration(elapsed)}</p>;
}

type Blocks = { agenda: ReactNode; editor: ReactNode; timer: ReactNode; feedback: ReactNode };
function VariantA({ agenda, editor, timer, feedback }: Blocks) {
  return (
    <div className="dayline">
      {editor}
      {agenda}
      {timer}
      {feedback}
    </div>
  );
}
function VariantB({ agenda, editor, timer, feedback }: Blocks) {
  return (
    <div className="split">
      <aside aria-label="Timer and work">
        {timer}
        {feedback}
      </aside>
      <div className="planning">
        {editor}
        {agenda}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
