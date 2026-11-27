# Touch-first Agenda — throwaway React + TypeScript prototype

Which arrangement makes scheduling and timer recovery clear on a phone without giving up the
desktop overview? Three structurally different variants share the same synthetic fixtures and
live in-memory state: **A Dayline**, **B Split desk**, **C Focus**. The default is Dayline.
This standalone page sits alongside the existing Agenda interface because the approved preview
must not load or mutate any live TimeTrace data.

## Run

Use Node 22.12+ and npm. From the repository root:

```sh
cd src/timetrace/interfaces/api/prototype/agenda-react
npm ci && npm run dev
```

Open http://127.0.0.1:18783/ (or append `?variant=A`, `?variant=B`, or `?variant=C`).
The bottom switcher keeps plans, pins, and recordings when switching. Local filters and open
panels can reset between layouts. Arrow keys switch when focus is not in an interactive control. `npm run build` type-checks and builds static files.

For physical phones on a trusted local network, replace the dev command with
`npm exec -- vite --host 0.0.0.0 --port 18783 --strictPort` and open the development
machine's LAN address on the phone. Do not expose the dev server to the public internet.
The preview does **not** deploy TimeTrace.

## Try the same workflow in each variant

1. Edit a scheduled session or add another one. Pick a task, enter the date and times with the
   browser controls, then Save. No drag gesture is required. The plan stays separate from work.
2. Pick a task in the Timer panel and Start. Toggle **Simulate connection loss**. Stop: the
   original timestamps show under **Saved on this device · Stop pending sync**. Reconnect
   without a collision and the same interval becomes Synced.
3. Repeat, then choose **Reconnect with overlap**. Compare the phone and laptop intervals and
   explicitly choose one for this scripted example. The losing capture is not counted; the
   original times are shown for comparison. This previews the review UI, not all eventual
   correction/keep-both behavior.
4. Open **Start an activity** to search by title or priority and manage pins. Select an
   activity without starting it, or start it explicitly. Try a taskless timer and an Entry note.
5. Open **History & plans** to add past recorded work, optionally link it to a same-task plan,
   filter the ledger and preview selected/all-filtered saved work as Markdown or CSV.
6. Compare which layout makes the timer, schedule, discovery, and history easiest to reach.
   Try the forms using touch and the software keyboard, then a desktop keyboard.

### Designed vs. wired

Activity selection, pins, plan editing, Start/Stop, Entry notes, manual recording, basic ledger
filters and export **preview** work in memory. Plan details show original vs. current times.
Expanding **Timer tools**, **Plan details & actions**, and a history row shows where the existing
advanced tools go: switching timers, pause/resume, correction/discard, idle/focus, assignment,
plan extension, Delete everything/Squeeze, and saved-work editing. Those actions, goal totals,
actual export copying/downloading, and server error recovery are illustrations or not wired;
the prototype does not attempt the production Agenda's exact policy or report math.

## Performance and scope

Only the clock component updates each second; it uses its start timestamp rather than counting
callbacks and skips display updates while the page is hidden. The layouts on this page do not load
calendar, chart, or font libraries. This is not a production performance baseline: it has no
real API, dense calendar, database, or offline persistence to measure. Those need realistic data
and physical phones in the next stage.

All tasks, plans, and the laptop interval are synthetic. Connection loss, local saving,
and sync are **labels for simulated transitions**, not browser network or storage behavior.
Reload resets everything. There is no backend, database, network API, service worker,
persistence guarantee, real device sync, or claim of production accessibility.
