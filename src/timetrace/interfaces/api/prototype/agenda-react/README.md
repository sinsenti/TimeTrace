# Touch-first Agenda — throwaway React + TypeScript prototype

Does a React Agenda feel familiar without copying every detail? **D Familiar** is now the default.
It follows the current page's order: timer, Activity toolbar, discovery, and one History & Plans
ledger. The inspector sits beside the ledger on desktop and below it on narrow screens. The
new pending-sync feedback lives beside the timer. **A Dayline**, **B Split desk**, and **C Focus**
remain available for comparison and share the synthetic fixtures.
This standalone page sits alongside the existing Agenda interface because the approved preview
must not load or mutate any live TimeTrace data.

## Run

Use Node 22.12+ and npm. From the repository root:

```sh
cd src/timetrace/interfaces/api/prototype/agenda-react
npm ci && npm run dev
```

Open http://127.0.0.1:18783/ (or use `?variant=D`, `?variant=A`, `?variant=B`, or `?variant=C`).
The bottom switcher keeps plans, pins, and recordings when switching. Local filters and open
panels can reset between layouts. Arrow keys switch when focus is not in an interactive control.
`npm run build` type-checks and builds static files.

For physical phones on a trusted local network, replace the dev command with
`npm exec -- vite --host 0.0.0.0 --port 18783 --strictPort` and open the development
machine's LAN address on the phone. Do not expose the dev server to the public internet.
The preview does **not** deploy TimeTrace.

## Try the same workflow in each variant

1. Edit a scheduled session or add another one. Pick a task, enter the date and times with the
   browser controls, then Save. No drag gesture is required. The plan stays separate from work.
2. Type a task name in **Task to time** at the top. Pick a match, or use the arrow keys and
   Enter. The field clears after launch and never mirrors the selected timer. Start another task
   and use **Other timers** to switch. Try **+5** and **−5** on one clock;
   the other stays unchanged. Picking the same task selects its existing timer. Toggle **Simulate connection loss**
   and use **Stop & record**: the
   original timestamps show under **Saved on this device · Stop pending sync**. Reconnect
   without a collision and the same interval becomes Synced.
3. Repeat, then choose **Reconnect with overlap**. Compare the phone and laptop intervals and
   explicitly choose one for this scripted example. The losing capture is not counted; the
   original times are shown for comparison. This previews the review UI, not all eventual
   correction/keep-both behavior.
4. Open **Start an activity** to search by title or priority and manage pins. Select an
   activity without starting it, or start it explicitly. Try a taskless timer and an Entry note.
5. Use **Add recorded work** (in the Activity toolbar in Familiar; inside History & Plans in
   the other layouts). Optionally link it to a same-task plan,
   filter the ledger and preview selected/all-filtered saved work as Markdown or CSV.
6. Compare which layout makes the timer, schedule, discovery, and history easiest to reach.
   Try the forms using touch and the software keyboard, then a desktop keyboard.

### Designed vs. wired

Activity selection, pins, plan editing, Start/Stop, quick ±5, timer discard, Entry notes, manual recording, basic ledger
filters and export **preview** work in memory. Plan details show original vs. current times.
Expanding **Timer tools**, **Plan details & actions**, and a history row shows where the existing
advanced tools go: pause/resume, correction, idle/focus, assignment,
plan extension, Delete everything/Squeeze, and saved-work editing. Apart from the simulated
quick steps and discard, the advanced actions, goal totals,
actual export copying/downloading, and server error recovery are illustrations or not wired;
the prototype does not attempt the production Agenda's exact policy or report math.

## Performance and scope

Only the clock component updates each second; it uses its start timestamp rather than counting
callbacks and skips display updates while the page is hidden. The layouts on this page do not load
calendar, chart, or font libraries. This is not a production performance baseline: it has no
real API, dense calendar, database, or offline persistence to measure. Those need realistic data
and physical phones in the next stage.

All tasks, plans, and the laptop interval are synthetic. Connection loss, local saving,
and sync are **labels for simulated transitions**, not browser network or storage behavior. The
preview holds only one pending offline Stop; other timers can keep running while it is pending.
Reload resets everything. There is no backend, database, network API, service worker,
persistence guarantee, real device sync, or claim of production accessibility.
