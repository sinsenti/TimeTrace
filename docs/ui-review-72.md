# Owner UI review #72 — first implementation batch

Canonical review map: https://github.com/sinsenti/TimeTrace/issues/72.
Review baseline: `cacf0466df45cb72400c57c0f249f5bed025e853`.
This ledger describes local work, not deployment or final visual acceptance.

## Owner decisions

- Use **Entry note** for both current timer notes and saved recorded-interval notes. The task
  description and a scheduled session's notes remain separate concepts.
- **Discard timer** removes only the selected timer's not-yet-recorded work and timer-bound notes.
  Saved recorded intervals, tasks, original/current plans and other timers remain unchanged.
- The owner authorized starting the full initial review batch with subagents. Existing root edits
  in `docs/development.md` and the dashboard prototype wrapper are unrelated and protected.
- The existing real test UI on18131 stays available while isolated work is developed. No personal
  database/provider/key access, personal-daemon restart, deployment, push or dev merge is implicit.

## Work and shared contracts

Parallel isolated lanes: shared in-app dialogs/Agenda presentation/light-mode controls;
selected-timer discard/secondary timer presence; real dashboard widget drag-and-drop. Activity
layout/frequency source feasibility is investigated separately before inventing a historical metric.

The shared browser API is `window.appDialogs.confirm({title, message, confirmLabel, cancelLabel,
danger}) -> Promise<boolean>`; any needed alert/prompt equivalents are app-owned too. Confirmations
must capture their intended target before awaiting and revalidate stale state afterward; no global
Promise-returning replacement masquerading as synchronous `window.confirm`. Cancel/Escape send no
mutation and cannot leave pending ownership stuck on a delayed native close event. Platform-owned
file/permission/unload dialogs are outside this application-controlled contract.

Use the established public service/root-HTTP and JS-controller/presenter test seams, fake external
boundaries and isolated synthetic actual-app checks. Workers run focused red/green slices; the parent
runs full Python/Node gates at the end and the independent Standards/Spec review. No passing drag
unit test substitutes for a real drag gesture, persisted order and reload verification.

## Integration and bounded evidence

- Statistics lane commit `bd8190f` integrated as `1448502`: handle-only native widget dragging,
  keyboard reordering, persisted full-ID order and dashboard-local uncertainty/read-start fences.
  Worker focused Node checks:133 passed; full gates/review remain pending.
- Parent's Orca-native equivalent of the tracked drag probe passed against the owned18132 scratch
  app: actual mouse down/moves/up exposed the insertion indicator, one intended drag reorder was
  persisted, reload retained it, keyboard moved exactly one place, and other dashboards stayed
  unchanged. The temporary dashboard alone was removed after the check. Narrow viewport, physical
  touch, other engines/screen readers and owner visual acceptance remain unclaimed here.
- Source correction: the existing Agenda note filter matches both saved-entry notes and scheduled
  plan notes (not task descriptions/live timer notes). Preserve that behavior with neutral label
  **Notes contain** and accurate help; do not silently hide plans under a presentation change.
- Discard note input may be read-only only for that target while discard is sent/uncertain, retaining
  text until own confirmed ACK and leaving other drafts editable. New typing before submission
  invalidates approval; refusal restores editability; unknown outcomes recover by GET only.

- Timer lane commit `ee77193` integrated as `e7ed44a`: durable selected discard, target-note
  ownership/unknown recovery, Entry note editor label, and stable secondary-timer presence. Worker
  focused checks:106 Python passed/84 warnings and41 Node passed. Parent added the presence CSS
  include; combined native discard and review/full gates remain pending.

- Dialog/presentation commits `095de12`/`53063ef` integrated as `130864f`/`547dc7d`. The single
  conflict was the shared canvas DOM adapter/test additions; both sets were retained and30 canvas
  cases passed. Worker focused gates:646 Node and39 Python passed. Parent cache-versioned changed
  assets across every serving template; two old fixed-version assertions were updated to require
  versioned assets without pinning an obsolete literal. Combined focused checks:24 Python/56 Node
  passed after those test repairs.
- Priority discovery `bb6cb36` integrated as `7872b12`: Agenda's compact High/Medium/Low/No priority
  groups use server-filtered selectors before bounds; shared Suggested defaults stay unchanged.
  Worker focused gates:62 Python/87 Node passed. Start-frequency/history ranking remains entirely
  pending the owner's choice; no false Frequent label or historical reconstruction was added.
- Combined owned18132 native checks passed: actual mouse drag + persisted/reloaded order and keyboard
  movement; default Enter and Escape cancel discard with zero writes; target Entry note becomes
  read-only during a held actual discard response; own ACK removes only that timer/draft, with one
  discard POST and unchanged saved rows and other timer geometry. Early discard-probe attempts used
  an over-broad closed-dialog selector and an unbound fetch spy (Illegal invocation); those harness
  faults were corrected, not represented as product failures or passing checks.
- Help/filter dialogs have footer Close; filter copy accurately includes plan notes; schedule inputs
  use second granularity. Native computed styles across Refined Archive/Stone/Porcelain show no
  purple estimate badge fill, while the existing purple dark Edit/badge styling remains.

## Independent review and repair

Initial `cacf046...ce3f30b` review: **Standards0 findings**, **Spec1 P1**. The Spec finding was
identity loss during keyboard reorder when widget titles match: focus restoration used a display
label rather than the owning widget ID. `26acca8` adds ID/control ownership; a mounted consecutive
keyboard-move regression failed before the fix and all31 canvas cases passed afterward. Two actual
native keyboard moves on identically titled widgets also kept the exact UUID and persisted order.
An additional duplicate-title mouse probe exceeded its harness timeout and is not counted as passed;
the earlier actual mouse drag/persistence/reload evidence remains separate.

Initial combined gates: **1281 Python passed/1696 warnings; Node958 passed/24 failed** out of982.
All24 failures reproduced as missing async app-dialog boundaries in four older test adapters. No
production fallback or weakened assertions were introduced. Repair `d0e9bf2`, integrated as
`e01cfcf`, gives983/983 Node passes in that lane (the extra case is the P1 regression, not a removed
failure). Scope/syntax/whitespace passed; broad Ruff retains17 inherited findings.

Independent post-P1 recheck found no unresolved issues on either axis. The post-P1 full combined
run passed1281 Python/1696 warnings and983 Node, zero failed/skipped (7m07s Python); this checkpoint
precedes the additional static-dialog correction below, not a blanket final claim.

A later parent native check found an additional **P2**: the window keyboard shield intercepted
Escape on static Help/Filter/Export modals without delegating cancellation. The new public window-
entry regression failed first; the shield now delegates to the focused static dialog's cancel
owner (`requestClose`, with cancel-event fallback), preserving export invalidation without waiting
for a close frame. Focused74 Node cases passed, followed by actual native Escape checks closing
all three dialogs. The bounded independent recheck verified this P2 resolved with no new issue.

## Final verified checkpoint

Code `f8ec350`: **1281 Python passed/1696 warnings (7m03s),984 Node passed**, zero failures,
cancellations or skips. Python used four work-stealing workers, safe path, external HOME/TMPDIR/DB,
notifications/tracing disabled and synthetic idle coverage enabled. Changed Python Ruff, all changed
JS/CJS syntax and whitespace pass; broad Ruff retains17 inherited findings in unchanged files.

Initial Standards0 / Spec1 P1 and the later parent-found P2 remain in this ledger; both fixes were
independently rechecked with no unresolved/new findings. No screenshot, physical touch, screen-reader,
other-engine or blanket platform certification is claimed. The four finished implementation checkouts
were removed after preserving their branches; the clean integration branch and owned18132 synthetic
preview remain for owner review. The owner's original18131 test UI and unrelated root edits remain
untouched. No dev merge, push, personal-daemon restart or deployment occurred.

Owner visual acceptance and the history-ranking choice remain separate; the ongoing #72 review map
is not completed by this batch. The remaining choice is an honestly labelled Most worked on view from
existing recorded-time history, or prospective Frequently started tracking with explicit coverage.

## Follow-up: Activity toolbar and priority disclosures

The owner clarified the next redesign scope with a screenshot: the Activity title, local date,
Plan session, Add recorded work and Shortcuts & help row, not the whole Agenda page. The compact
responsive toolbar groups title/date on the left and the existing actions on the right, with a
filled theme-aware Plan action, secondary recording action and quieter Help. Existing control IDs,
handlers, local-date meaning and all three actions remain; timer/history layout is unchanged.

Each priority heading is now a full-width native button with expanded state, result count and a
controlled group body. Clicking, Enter or Space folds/unfolds the entire body while retaining the
header and its focus. Folds are page-local (no storage or server writes), survive result refreshes,
and are independent by title-match rank and priority. A new page opens all groups. Collapsed tasks
are not eligible for Arrow/Enter or stale row activation, and folding a selected row clears that
selection. A fold is a newer selection generation: an earlier Start ACK cannot clear its view.
Unfolding never counts as explicit selection of a fuzzy match. Shared Suggested remains unchanged.

Red-first evidence: the four new Node regressions and one root-HTTP toolbar case failed against the
previous code. Focused green checks passed **80 Node and13 Python**. The existing Agenda-mounted
writer test's direct-child fixture was adjusted for the controlled group body without removing its
task-only writer assertions. Full-suite checks follow this checkpoint; do not substitute the
previous batch's final counts for this candidate.

The follow-up independent review returned **Standards1 P1 / Spec0**: the full-width disclosure's
outward focus outline was clipped by its rounded section, especially when folded. Retained browser
probe `tests/browser_agenda_priority_focus_72.js` reproduced red with a2px outward offset. A scoped
important negative offset now keeps the2px outline inside the group, overriding the shared positive
offset. The same probe passed after native Space in both folded/expanded states (-3px offset, focus
retained); the stylesheet cache token advances. This is computed browser geometry, not raster proof.

Native checks on the owned synthetic18132 app passed Space/Enter and pointer activation at the
header's far edge, body removal from layout, focus retention and read-preserved folds. All three
toolbar actions still open their original editor/help and cancel safely. Toolbar controls wrap without
horizontal overflow at1217/768/390/320 CSS pixels; all three light palettes and dark mode use their
own primary background/foreground. The probe observed **zero mutation requests**. No physical-touch,
other-engine, screen-reader or owner visual acceptance is inferred. The final CSS-only focus repair
has its own native red/green evidence; it does not alter the Python/JS behavior under the full gates.
The bounded independent recheck resolved the P1 with no new finding on either axis.

The first follow-up full run passed **988 Node** and **1281 Python**, with one Python failure:
a discovery composition test hardcoded the old asset-cache tokens. The test now retains exact
asset paths, requires one versioned inclusion with a nonempty version and fetches both actual URLs
successfully instead of pinning an obsolete token. All existing priority/pin assertions remain.
Focused root/launcher checks then passed **28 Python**; full verification is repeated after this
test-only repair rather than reporting1282 green cases from the failed full run.

Final complete gates after the focus and fixture repairs (`99d8eaa8`): **1282 Python passed /
1696 warnings in228.69s;988 Node passed**, zero failures/cancellations/skips. Scoped Ruff, changed
JS/CJS syntax and whitespace pass; broad Ruff retains17 inherited findings. The full run kept the
same isolated environment and four-worker/synthetic-idle policy. The integration preview remains
available for owner review; all commits remain local, without dev merge/push or personal deployment.

## Follow-up: saved-entry actions and pinned-activity dialog

The next screenshots identify the saved-history **Adjust saved actual time / Start again** buttons
and **Manage pinned activities** popup. Saved-entry actions now have smaller, rounded, separated
controls: neutral time adjustment and a softly themed repeat action. Their labels, sibling positions,
click handlers, correction identity/revision and task-only repeat payload remain unchanged. Disabled
states still belong to task metadata and shared timer freshness/pending/receipt guards.

The pin manager adopts the shared app-dialog shell with an explicit title/description, initially
focused search, separate current-pins area, useful search-first empty state and footer Close. Pin/
unpin and paginated navigation remain browser-local, never task or recorded-work mutations. Escape
uses the existing shared modal shield; native cancellation advances the read generation without a
delayed close-event owner. Search and lookup responses retain their generation/open checks. Rows
render titles as text, not HTML. Styles remain scoped and asset versions advance for serving pages.

New public-entry regressions reproduced the unstyled history actions and old dialog composition
before production edits. Focused **71 Node cases passed**, including correction/repeat payloads,
disabled repeat guards, footer/search focus, local pin/unpin,21-pin pagination and old-search fencing.
Full gates, native checks and bounded independent follow-up review follow this checkpoint.

Verified code `fcfb5694`: **1282 Python passed/1696 warnings in191.14s;994 Node passed**, zero
failures/cancellations/skips. Scoped Ruff, changed JS/CJS syntax and whitespace pass; broad Ruff's17
inherited findings remain unchanged. Independent bounded review: **Standards0 / Spec0**.

Native checks used a new isolated browser profile, not the owner's review profile/pin storage.
Saved-entry labels/sibling order remain intact;36px controls,8px radii, separation and wrapping were
checked at1217/390/320 CSS pixels. The pin popup focuses search, displays the new empty state and
supports real keyboard search/Pin/Unpin, footer Close and Escape with focus returning to Manage pins.
The dialog fits all three widths without horizontal overflow, and both controls/dialog follow all
three light palettes and dark mode. The native probe observed **zero server mutation requests**;
history correction/repeat payloads were exercised only in the controlled public-caller regression,
not by starting real timers or applying corrections in this native check. The owner's pins, original
preview, saved work and running timers were not changed. No raster/AT/touch/other-engine or owner
visual acceptance is claimed. These commits remain local; no merge, push or deployment.

## Follow-up: separate launcher, activity filter and history search

The owner agreed to remove the duplicated launcher role: keep **Task to time** at the top, replace
Agenda's lower field with **Filter activities** and put **Search history & plans** beside the ledger.
The shared launcher retains its ordinary/fuzzy keyboard selection and task-only Start. The local
activity filter has no implicit selected row or Arrow/Enter start and excludes close-match guesses;
literal matches remain in priority groups. Explicit row Start still uses the same guarded writer and
retains the filter after ACK. Collapsed-group eligibility applies to filtered rows too. Pinned view
hides the priority-only filter rather than displaying an unrelated control.

The existing `agenda-search` field moves to history, preserving its ledger/export title semantics,
200-character bound and export read-generation invalidation. Activity filtering neither changes
history nor invalidates an export preview. Shared tag/note filters keep their existing semantics.
Alt+Shift+F focuses Task to time, not either local filter. Serving cache versions and help/launcher
maintenance documentation reflect the explicit owner-approved change from the original #70 UI.

Three new/extended Node entry cases and the root-HTTP composition case failed first. Focused checks
then passed **88 Node /29 Python** (including independent export criteria, shared keyboard defaults,
explicit filter-row task-only Start, hidden-row refusal, retained filter and pinned-view controls).
Full gates, native checks and bounded independent review follow this checkpoint.
