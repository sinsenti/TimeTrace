import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { TaskLauncher } from './task-launcher';
import {
  activities,
  ActivityPicker,
  HistoryTools,
  localDate,
  ManualRecording,
  PlanDetails,
  range,
  RecordedDetails,
  TimerTools,
  unassigned,
  type Interval,
  type RecordedInterval,
  type Plan,
} from './agenda-tools';

// Throwaway: a current-Agenda baseline, plus earlier touch-layout comparisons.
const modes = ['D', 'A', 'B', 'C'] as const;
type Mode = (typeof modes)[number];
const names: Record<Mode, string> = { D: 'Familiar', A: 'Dayline', B: 'Split desk', C: 'Focus' };
const tasks = activities.map(({ title }) => title);
const day = localDate(Date.now());
const sample: Plan[] = [
  {
    id: 1,
    task: tasks[0],
    date: day,
    start: '09:00',
    end: '09:45',
    notes: 'Keep time to outline the first section.',
  },
  { id: 2, task: tasks[1], date: day, start: '11:00', end: '11:30' },
  { id: 3, task: tasks[2], date: day, start: '14:00', end: '14:30' },
];
function fromUrl(): Mode {
  const mode = new URLSearchParams(location.search).get('variant');
  return modes.find((key) => key === mode) ?? 'D';
}
function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

type RunningTimer = { id: number; task: string; start: number; note: string };

function App() {
  const [variant, setVariant] = useState(fromUrl);
  const [plans, setPlans] = useState(sample);
  const [viewDate, setViewDate] = useState(day);
  const [pins, setPins] = useState([tasks[0]]);
  const [draft, setDraft] = useState<Plan | null>(null);
  const [extraInspector, setExtraInspector] = useState<'manual' | RecordedInterval | null>(null);
  const [formError, setFormError] = useState('');
  const [task, setTask] = useState(unassigned);
  const [timerMessage, setTimerMessage] = useState('');
  const [dialog, setDialog] = useState<'help' | 'adjust' | 'pause' | 'edit' | 'discard' | -5 | 5 | null>(
    null,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const quickAllowed = useRef(false);
  const [online, setOnline] = useState(true);
  const [timers, setTimers] = useState<RunningTimer[]>([]);
  const [selectedTimerId, setSelectedTimerId] = useState<number | null>(null);
  const nextTimerId = useRef(1);
  const focusTimerTitle = useRef(false);
  const timerHeading = useRef<HTMLHeadingElement>(null);
  const running = timers.find(({ id }) => id === selectedTimerId);
  const otherTimers = timers.filter(({ id }) => id !== selectedTimerId);
  const [pending, setPending] = useState<Interval | null>(null);
  const [remote, setRemote] = useState<Interval | null>(null);
  const [recorded, setRecorded] = useState<RecordedInterval[]>([]);
  const nextRecordingId = useRef(3);
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<'work' | 'activities' | 'plans' | 'history'>('work');
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const inspectorKey = draft
    ? `plan-${draft.id}`
    : variant === 'D' && extraInspector
      ? extraInspector === 'manual'
        ? 'manual'
        : `recorded-${extraInspector.id}`
      : '';

  useEffect(() => {
    if (inspectorKey) editorHeading.current?.focus();
    else if (returnFocus.current) {
      if (returnFocus.current.isConnected) returnFocus.current.focus();
      else document.getElementById(variant === 'D' ? 'history-title' : 'agenda-title')?.focus();
      returnFocus.current = null;
    }
  }, [inspectorKey, variant]);

  useEffect(() => {
    if (!focusTimerTitle.current) return;
    focusTimerTitle.current = false;
    timerHeading.current?.focus();
  }, [selectedTimerId]);

  useEffect(() => {
    if (dialog !== null && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [dialog]);

  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if (
        !import.meta.env.DEV ||
        dialogRef.current?.open ||
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
  function openInspector(selection: 'manual' | RecordedInterval, trigger: HTMLElement) {
    returnFocus.current = trigger;
    setDraft(null);
    setExtraInspector(selection);
  }
  function addPlan(trigger: HTMLElement) {
    const planTask = task === unassigned ? (running?.task ?? unassigned) : task;
    edit({ id: Date.now(), task: planTask, date: viewDate || day, start: '09:00', end: '09:30' }, trigger);
  }
  function edit(plan: Plan, trigger: HTMLElement) {
    returnFocus.current = trigger;
    setExtraInspector(null);
    setDraft(
      plans.some(({ id }) => id === plan.id)
        ? { ...plan, original: plan.original ?? `${plan.date} · ${plan.start}–${plan.end}` }
        : plan,
    );
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
    setViewDate(draft.date);
    setNotice(`Scheduled session saved for ${draft.task}.`);
    setDraft(null);
  }
  function selectTimer(timer: RunningTimer) {
    setSelectedTimerId(timer.id);
    setPanel('work');
    setTimerMessage('');
  }
  function start(title: string) {
    setTask(unassigned);
    const existing = title === unassigned ? undefined : timers.find((timer) => timer.task === title);
    if (existing) {
      selectTimer(existing);
      setNotice('Selected the existing timer. No duplicate was created.');
      return;
    }
    const timer = { id: nextTimerId.current++, task: title, start: Date.now(), note: '' };
    setTimers((previous) => [...previous, timer]);
    selectTimer(timer);
    setNotice(online ? 'Timer started in the demo.' : 'Timer started on this device in the demo.');
  }
  function updateSelected(update: Partial<Pick<RunningTimer, 'start' | 'note'>>) {
    setTimers((previous) =>
      previous.map((timer) => (timer.id === selectedTimerId ? { ...timer, ...update } : timer)),
    );
  }
  function removeSelected() {
    setTimers((previous) => previous.filter((timer) => timer.id !== selectedTimerId));
    const next = otherTimers[0];
    if (next) selectTimer(next);
    else setSelectedTimerId(null);
  }
  function saveRecording(item: Interval) {
    const saved = { ...item, id: nextRecordingId.current++ };
    setRecorded((previous) => [saved, ...previous]);
  }
  function stop() {
    if (!running || (!online && pending)) return;
    const item = {
      task: running.task,
      start: running.start,
      end: Date.now(),
      note: running.note.trim(),
    };
    setTimerMessage('');
    removeSelected();
    if (online) {
      saveRecording(item);
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
      saveRecording(pending);
      setPending(null);
      setNotice('Original time range synced in the demo.');
    }
  }
  function resolve(item: Interval) {
    saveRecording(item);
    setPending(null);
    setRemote(null);
    setNotice('Choice synced in the demo. Only the selected interval is counted.');
  }

  function applyQuickAdjustment(delta: -5 | 5) {
    if (!running) return;
    const start = running.start - delta * 60_000;
    if (start >= Date.now()) {
      setTimerMessage('Cannot remove five minutes: the current interval is shorter. No time changed.');
      return;
    }
    updateSelected({ start });
    setTimerMessage(
      delta === 5
        ? 'Added five minutes to this demo interval.'
        : 'Removed five minutes from this demo interval.',
    );
  }
  function requestQuickAdjustment(delta: -5 | 5) {
    if (!quickAllowed.current) setDialog(delta);
    else applyQuickAdjustment(delta);
  }
  function closeDialog() {
    dialogRef.current?.close();
    setDialog(null);
  }

  const timer = (
    <section className="card timer" aria-labelledby="timer-title">
      <p className="eyebrow">{running ? 'Selected timer' : 'Recorded work'}</p>
      <h2 id="timer-title" ref={timerHeading} tabIndex={-1} aria-live="polite">
        {running
          ? running.task === unassigned
            ? 'Unassigned recording'
            : running.task
          : 'Current timer'}
      </h2>
      {running ? (
        <div className="timer-clock-row">
          <button
            className="quick-step"
            aria-label="Remove five minutes"
            onClick={() => requestQuickAdjustment(-5)}
          >
            −5
          </button>
          {(variant !== 'C' || panel === 'work') && (
            <Clock key={`${running.id}:${running.start}`} start={running.start} />
          )}
          <button
            className="quick-step"
            aria-label="Add five minutes"
            onClick={() => requestQuickAdjustment(5)}
          >
            +5
          </button>
        </div>
      ) : (
        <p className="hint">Choose an activity above or start unassigned recording.</p>
      )}
      {running && (
        <div className="button-row timer-actions">
          {running.task !== unassigned && <button onClick={() => setDialog('edit')}>Edit task</button>}
          <button onClick={() => setDialog('adjust')}>Adjust time</button>
          <button onClick={() => setDialog('pause')}>Pause</button>
          <button className="primary" disabled={!online && pending !== null} onClick={stop}>
            Stop &amp; record
          </button>
          <button className="subtle danger" onClick={() => setDialog('discard')}>
            Discard timer
          </button>
        </div>
      )}
      {timerMessage && (
        <p className="timer-message" role="status">
          {timerMessage}
        </p>
      )}
      {otherTimers.length > 0 && (
        <section className="other-timers" aria-labelledby="other-timers-title">
          <h3 id="other-timers-title">
            Other timers <span className="hint">· {otherTimers.length} running</span>
          </h3>
          <ul>
            {otherTimers.map((timer) => (
              <li key={timer.id}>
                <button
                  onClick={() => {
                    focusTimerTitle.current = true;
                    selectTimer(timer);
                  }}
                >
                  <span>
                    {timer.task === unassigned ? `Unassigned recording ${timer.id}` : timer.task}
                  </span>
                  <span className="hint">Switch</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {running && (
        <details className="tool-details">
          <summary>Entry note</summary>
          <label>
            Entry note
            <textarea
              rows={2}
              value={running.note}
              onChange={(event) => updateSelected({ note: event.target.value })}
            />
          </label>
          <p className="hint">Stop includes this note in the simulated recorded interval.</p>
        </details>
      )}
      {running && !online && pending && (
        <p className="hint">
          The demo can hold one offline Stop. Reconnect to sync it before stopping another timer; this
          timer keeps running.
        </p>
      )}
      <TimerTools />
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
      {variant !== 'D' && recorded.length === 0 && !pending && (
        <p className="hint">No recorded intervals in this demo yet.</p>
      )}
      {variant !== 'D' && recorded.length > 0 && (
        <ul className="records">
          {recorded.map((item) => (
            <li key={item.id}>
              <strong>{item.task}</strong>
              <span>{range(item)}</span>
              <small>Synced</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  const discovery = (
    <ActivityPicker
      pinned={pins}
      setPinned={setPins}
      plans={plans.filter((plan) => plan.date === viewDate)}
      onChoose={(title) => {
        setTask(title);
        setPanel('work');
        setNotice(`${title} selected. No timer started.`);
      }}
      onStart={start}
    />
  );
  const previousDay = new Date();
  previousDay.setDate(previousDay.getDate() - 1);
  const previousDate = localDate(previousDay.getTime());
  const manualDate = viewDate && viewDate < day ? viewDate : previousDate;
  function saveManual(item: Interval) {
    saveRecording(item);
    if (variant === 'D') setViewDate(localDate(item.start));
    setNotice('Manual recorded work saved in the demo.');
  }
  const historyTools = (
    <HistoryTools
      recorded={recorded}
      plans={plans}
      day={manualDate}
      save={saveManual}
      scopeDate={variant === 'D' ? viewDate : undefined}
      openPlan={variant === 'D' ? edit : undefined}
      openWork={variant === 'D' ? openInspector : undefined}
    />
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
        <button onClick={(event) => addPlan(event.currentTarget)}>Add session</button>
      </div>
      <label>
        Local date
        <input type="date" value={viewDate} onChange={(event) => setViewDate(event.target.value)} />
      </label>
      <ul className="plan-list">
        {plans
          .filter((plan) => !viewDate || plan.date === viewDate)
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
              <div className="plan-more">
                <PlanDetails plan={plan} />
              </div>
            </li>
          ))}
      </ul>
      {!plans.some((plan) => !viewDate || plan.date === viewDate) && (
        <p className="hint">No scheduled sessions on this date.</p>
      )}
    </section>
  );
  const editor = draft && (
    <section className="card editor" aria-labelledby="edit-title">
      <p className="eyebrow">Planned time, not recorded work</p>
      <h2 id="edit-title" ref={editorHeading} tabIndex={-1}>
        {plans.some((item) => item.id === draft.id) ? 'Edit scheduled session' : 'Add scheduled session'}
      </h2>
      {variant === 'D' && plans.some((plan) => plan.id === draft.id) && (
        <PlanDetails plan={plans.find((plan) => plan.id === draft.id)!} />
      )}
      <form onSubmit={savePlan}>
        <label>
          Scheduled task
          <select value={draft.task} onChange={(e) => setDraft({ ...draft, task: e.target.value })}>
            {[...tasks, unassigned].map((name) => (
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
        <label>
          Tags
          <input
            value={draft.tags ?? ''}
            onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
          />
        </label>
        <label>
          Plan notes
          <textarea
            rows={2}
            value={draft.notes ?? ''}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
        </label>
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
                : variant === 'C'
                  ? 'Put one activity in view at a time.'
                  : 'The familiar Agenda order, adapted for touch.'}
          </p>
          <p className="hint">
            Synthetic data only. Connection and saving are simulated; reload resets the preview.
          </p>
        </div>
        <TaskLauncher
          selected={task}
          runningTasks={timers.map((timer) => timer.task)}
          choose={setTask}
          start={start}
        />
        {variant === 'D' && (
          <div className="familiar">
            <div className="familiar-timer">
              {timer}
              {pending && feedback}
            </div>
            <section className="activity-toolbar" aria-labelledby="activity-heading">
              <div className="activity-context">
                <h2 id="activity-heading">Activity</h2>
                <label>
                  Local date
                  <input
                    type="date"
                    value={viewDate}
                    onChange={(event) => setViewDate(event.target.value)}
                  />
                </label>
              </div>
              <div className="button-row activity-actions">
                <button className="primary" onClick={(event) => addPlan(event.currentTarget)}>
                  + Plan session
                </button>
                <button onClick={(event) => openInspector('manual', event.currentTarget)}>
                  Add recorded work
                </button>
                <button className="subtle" onClick={() => setDialog('help')}>
                  Shortcuts &amp; help
                </button>
              </div>
            </section>
            {discovery}
            <div className={`familiar-ledger ${editor || extraInspector ? 'has-inspector' : ''}`}>
              {historyTools}
              {editor ||
                (extraInspector && (
                  <aside className="card editor" aria-labelledby="extra-inspector-title">
                    <p className="eyebrow">Inspector</p>
                    <h2 id="extra-inspector-title" ref={editorHeading} tabIndex={-1}>
                      {extraInspector === 'manual' ? 'Record what you did' : extraInspector.task}
                    </h2>
                    {extraInspector === 'manual' ? (
                      <ManualRecording
                        plans={plans}
                        day={manualDate}
                        save={saveManual}
                        dismiss={() => setExtraInspector(null)}
                      />
                    ) : (
                      <>
                        <RecordedDetails item={extraInspector} />
                        <button onClick={() => setExtraInspector(null)}>Close inspector</button>
                      </>
                    )}
                  </aside>
                ))}
            </div>
          </div>
        )}
        {variant === 'A' && (
          <VariantA
            agenda={agenda}
            editor={editor}
            timer={timer}
            feedback={feedback}
            discovery={discovery}
            historyTools={historyTools}
          />
        )}
        {variant === 'B' && (
          <VariantB
            agenda={agenda}
            editor={editor}
            timer={timer}
            feedback={feedback}
            discovery={discovery}
            historyTools={historyTools}
          />
        )}
        {variant === 'C' && (
          <>
            <nav className="segmented" aria-label="Focus view">
              <button aria-pressed={panel === 'work'} onClick={() => setPanel('work')}>
                Timer and work
              </button>
              <button aria-pressed={panel === 'activities'} onClick={() => setPanel('activities')}>
                Activities
              </button>
              <button aria-pressed={panel === 'plans'} onClick={() => setPanel('plans')}>
                Schedule
              </button>
              <button aria-pressed={panel === 'history'} onClick={() => setPanel('history')}>
                History
              </button>
            </nav>
            <div className="focus-pane">
              <div className="focus-pane" hidden={panel !== 'work'}>
                {timer}
                {feedback}
              </div>
              <div hidden={panel !== 'activities'}>{discovery}</div>
              <div hidden={panel !== 'plans'}>{editor || agenda}</div>
              <div hidden={panel !== 'history'}>{historyTools}</div>
            </div>
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
            {plans.length} scheduled · {timers.length} running · {pending ? '1' : '0'} awaiting sync or
            review · {recorded.length} synced
          </p>
        </section>
        <p className="notice" role="status">
          {notice}
        </p>
      </main>
      <dialog ref={dialogRef} aria-labelledby="preview-dialog-title" onClose={() => setDialog(null)}>
        <h2 id="preview-dialog-title">
          {dialog === 'help'
            ? 'Shortcuts & recording help'
            : dialog === 'discard'
              ? 'Discard this timer?'
              : dialog === 'pause'
                ? 'Pause / Resume'
                : dialog === 'edit'
                  ? 'Edit task'
                  : dialog === 'adjust'
                    ? 'Adjust time'
                    : 'Enable quick five-minute adjustments?'}
        </h2>
        <p>
          {dialog === 'help'
            ? 'Type in Task to time to find an activity. Use the arrow keys to highlight a result, then Enter to start it. Plan session sets aside time; Add recorded work saves past work instead.'
            : dialog === 'discard'
              ? 'This removes the current demo timer without recording work. Previously saved intervals stay unchanged.'
              : dialog === 'pause'
                ? 'In the existing app Pause holds this timer without saving it; Resume continues the same timer. This preview shows placement only.'
                : dialog === 'edit'
                  ? 'The existing app opens the assigned task editor here. Editing the task is not wired in this preview.'
                  : dialog === 'adjust'
                    ? 'The existing app lets you preview exact changes to tracked intervals before applying them. This preview shows placement only.'
                    : '+5 moves the start earlier and −5 moves it later. This changes recorded time, not your plan. A change that would leave no valid interval is refused.'}
        </p>
        <div className="button-row control-row">
          <button autoFocus onClick={closeDialog}>
            {typeof dialog === 'number' || dialog === 'discard' ? 'Cancel' : 'Close'}
          </button>
          {typeof dialog === 'number' && (
            <button
              className="primary"
              onClick={() => {
                quickAllowed.current = true;
                applyQuickAdjustment(dialog);
                closeDialog();
              }}
            >
              Enable and apply
            </button>
          )}
          {dialog === 'discard' && (
            <button
              className="danger"
              onClick={() => {
                removeSelected();
                setTimerMessage('Demo timer discarded. No work recorded.');
                closeDialog();
              }}
            >
              Discard unsaved time
            </button>
          )}
        </div>
      </dialog>
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

type Blocks = {
  agenda: ReactNode;
  editor: ReactNode;
  timer: ReactNode;
  feedback: ReactNode;
  discovery: ReactNode;
  historyTools: ReactNode;
};
function VariantA({ agenda, editor, timer, feedback, discovery, historyTools }: Blocks) {
  return (
    <div className="dayline">
      {editor}
      {agenda}
      {timer}
      {feedback}
      {discovery}
      {historyTools}
    </div>
  );
}
function VariantB({ agenda, editor, timer, feedback, discovery, historyTools }: Blocks) {
  return (
    <div className="split">
      <aside aria-label="Timer and work">
        {timer}
        {feedback}
        {discovery}
      </aside>
      <div className="planning">
        {editor}
        {agenda}
        {historyTools}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
