# Timer workspace design archive (#59)

Throwaway prototypes, not production implementation. This branch must not be merged into dev/main.

## Question and selected answer

How should Agenda support visible timer starts, repeat activities, editing and time correction?

The owner selected plan context from the initial B direction, a large current-timer card inspired by C, pinned activities above daily history (not a left sidebar), comfortable spacing and history grouped by stable task within local day. Start returns visibly to the selected timer. All unfinished timers remain independently accessible. Use the existing full task editor; keep the work-entry note separate. Keep Edit task / Adjust time / Pause-Resume / Stop & record in one row, wrapping on narrow screens.

The final quick-control choice is **B in prototype_timer_control_styles.html**: subtle circular minus/plus controls beside the clock. Open that file with `?variant=inline` or select B. Its default A/stepper is a comparison, not the selected verdict. Plus adds five minutes of credited work by moving the applicable start earlier; minus removes five by moving it later. Production must support reviewed running/paused corrections and exact middle-break exclusion without erasing idle/association state. Prototype same-day/running-only limitations are not approved product restrictions.

Production must integrate with the existing Calendar and retain its visual design; prototype Calendar tabs are schematic illustrations only. Live work and saved actual work remain distinct from immutable originals/current schedules; Stop is not task completion.

## Iterations (all standalone HTML)

Files live in `src/timetrace/interfaces/api/prototypes/`:

1. `prototype_timer_choices.html`: original A/B/C comparison and feature picker.
2. `prototype_timer_hybrid.html`: first combined B/C layout; left-start/right-timer separation was rejected.
3. `prototype_timer_current_first.html`: visible current timer and pins above history.
4. `prototype_timer_editing.html`: task editor and start-time preview.
5. `prototype_timer_inline_controls.html`: inline five-minute controls and single action row; chunky quick-button appearance was rejected.
6. `prototype_timer_control_styles.html?variant=inline`: final selected control styling B; builds on the preceding direction.

## Run

Open the HTML directly in a browser, or from this branch checkout run:

```bash
python3 -m http.server 18012 --bind 127.0.0.1 --directory src/timetrace/interfaces/api/prototypes
```

Then open `http://127.0.0.1:18012/prototype_timer_control_styles.html?variant=inline`. No TimeTrace import, daemon, database, keys, provider calls or frontend build. All data is synthetic and in-memory; reload resets it. Archived mockups remain design evidence, not a production backend.

## Scope and evidence

Canonical scope/remaining questions: https://github.com/sinsenti/TimeTrace/issues/59 and children #60-65. Notification-only Pomodoro, a fixed two-hour warning without configuration, manual/paused corrections, taskless tracking, goals/review and selected-history export are requested, but the mocks do not implement all of them. Google Calendar #11 and cross-device #58 stay deferred. Do not infer duration/goal/export defaults from sample data.

Prior bounded browser smoke checks covered variant switching, selected-timer focus/uniqueness, pause/stop, notes, task-name propagation, five-minute corrections, actual-work Calendar sketch updates and 390px layout without console errors. These are not production acceptance, OS-idle or accessibility certification. Archive validation runs JavaScript syntax checks for all inline scripts and verifies exact archived bytes. No new full application regression run is claimed. Implement the winner properly through the domain services and existing shared callers.
