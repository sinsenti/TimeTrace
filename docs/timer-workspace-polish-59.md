# Timer workspace UI polish — #59

## Contract and implementation

The owner-approved revision 6 is archived at
`prototype/timer-workspace-polish-59:docs/prototypes/timer-workspace-polish-59.md`
(commit `abfd67db1c34ff5bd2ccd301317cee2be07867c2`). Approval receipt:
https://github.com/sinsenti/TimeTrace/issues/59#issuecomment-7145716670.
This implementation starts at `bb899fc7095aeccce5b4eaa4bf5921f06dbad021`.

- Normal templates mount `components/timer_workspace_bar.html` outside the header.
  Calendar retains actual task cards/FullCalendar, with one compact start/selected-timer strip.
  Other timers, idle review and exact operation recovery remain accessible. Ordinary writes do
  not leave the recovery popup open. Live Calendar intervals are explicitly labelled LIVE,
  not uncertain legacy sessions; their exact geometry/ACK fences are unchanged.
- `/timer-settings` provides named goal cards, direct target editing and explicit activity/group,
  cadence, descendants, enabled and optional total-start controls. Weekly history stays linked.
  Existing tiny positive targets survive unit conversion and unrelated settings edits unchanged.
  Metadata refresh updates names without replacing target typing or launcher selections.
- Focus defaults and selected-timer overrides use the existing controllers. Defaults remain
  Off/25/5/notify-only; sound stays global and automatic breaks never auto-resume. Urgent notices,
  due/break actions and dismissal remain outside settings. Other/stopped-timer focus drafts stay
  visible and explicitly reviewable/discardable rather than trapping an invisible dirty editor.
- Reporting preferences use weekday buttons and Save/Cancel. An unchanged choice creates no
  context, but exact uncertain retries are not suppressed. Historical context boundaries remain
  authoritative and must not be merged.
- Agenda retains its current card, circular B-style ±5 controls, real pins, on-demand discovery,
  history and contextual inspector. The summary presents authoritative elapsed union, task credit,
  unassigned work and original/current-plan evidence; it never recomputes or redefines them.
- The collapsed work note has one primary Save, dirty/Saving/Saved text and secondary explicit
  Discard. It remains separate from task description and protects Stop/navigation. Delayed own
  acknowledgements do not erase newer typing.
- Corrections use ordinary dialog controls and dated before/after previews. IDs, exact values,
  timezone/offset choices and full signed evidence remain in Advanced. Unchanged native date
  input events preserve six-digit fractions, including browser normalization of zero seconds.
  Explicit initialization, pinned identities, DST validation, preview-before-apply and uncertain
  recovery continue through the original controller/service protocol.

No schema, migration, accounting compiler, timer protocol, provider integration or production
fixture/default goal is added. Prototype overlays/observers are not production dependencies.
Original #60–65 contracts and the five-repair ledger remain supporting contracts, not rewritten
historical verification receipts.

## Verification

Candidate verification is in progress; do not interpret prototype approval as deployment.
The first complete Python run passed 1,235 tests and failed one obsolete hard-coded asset-version
assertion. That fixture is updated to test one versioned controller on every route, including the
new settings page. An earlier run incorrectly disabled synthetic idle observation; that environment
was corrected. Two 600-second limits were insufficient for the process/crash matrices; the complete
run took 22m25s, with individual subprocess matrix cases around 28s. Final gate results and independent
Standards/Spec review will be recorded before delivery. Current Node gate: **914 passed**.
The corrected recovery/page HTTP suites: **33 passed**. Full Ruff has the same **17 inherited**
findings; scoped Python lint and changed-JS syntax checks are separate gates.

Actual application verification uses port **18128**, external DB/HOME/TMPDIR under
`/tmp/timetrace-polish-browser-*`, native delivery and OS idle observation disabled, and AI routes
blocked by the external test harness. No personal database/daemon or provider is used. The normal
application components, controllers and FullCalendar renderer are used without prototype overlays.
One synthetic dataset exercised:

- Work group target 2→3→2 hours, plus delayed 3-hour ACK while 4-hour typing remained owned;
- explicit All activities creation without an invalid task association;
- future focus 25→30→25, Off throughout, with delayed 30-minute ACK retaining newer 45-minute typing;
- reporting same-choice Save disabled, changed choice/Cancel without another context;
- delayed work-note ACK retaining later typing, explicit discard/restore and blocked dirty-note Stop;
- stopped timer's retained focus draft exposed by name and explicitly discarded;
- native date normalization preserving microseconds and explicit initialized signed +5-minute apply,
  preserving immutable creation origin; task estimate/description and plan meaning unchanged;
- overlapping physical work: goal SUM 3,600.033429s versus about 45 minutes elapsed union;
- actual Calendar/task cards/full task editor, original 120-minute estimate and distinct work note.

`tests/browser_timer_workspace_polish.js` supplies guarded, repeatable public-UI cases for note ACK,
exact date precision, metadata ownership and live Calendar labelling. Run its function through the
owned Orca page only after seeding ordinary synthetic HTTP data. Its origin/DB guards reject the
personal daemon; it does not reset storage, request notification permission or send OS alerts.
Historical dated browser probes target their original interfaces, not a claim that all their old
label selectors were replayed against this polish.

Raster capture succeeded in this runtime (the earlier prototype runtime timed out). AI-blocking
and existing Tailwind-CDN warnings are known harness/environment messages, not clean-console proof.
Screenshots/DOM checks are not manual OS notification, sound, accessibility or platform certification.
