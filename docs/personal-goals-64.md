# Personal goals and weekly review (#64)

Implementation and acceptance evidence for independent review. Canonical contract:
<https://github.com/sinsenti/TimeTrace/issues/64#issuecomment-7102449436>.
The prototype was inspected, not merged; production creates no sample targets.

## Interfaces and boundaries

`POST /goals`, `PUT /goals/{id}` and `GET /goals?period_start=YYYY-MM-DD`
provide optional global day/week and independent task day/week/total settings. Targets have no default.
Definitions have owner/cadence uniqueness; effective versions and DB-only operation receipts are
append-only. Omitted optional settings in a target edit are preserved; explicit null clears a total
start date. Receipts distinguish omitted fields from explicit changes and replay their original result.
Disabled goals retain settings/history without credit. Goal progress never changes task status or timers.

`GoalService` uses the existing structured `summed_recorded_work` compiler, not a separate SUM engine.
Its internal scalar mode supports genuinely all-time totals without widening public widget range limits.
Recursive descendant cohorts use bound SQL and UNION identity deduplication/cycle defense. Different
cadences and ancestor scopes overlap: never add goal rows to derive global work. Estimates and union
metrics retain their existing meanings. Exact-second SQLite bindings retain six fractional digits so
saved intervals ending exactly at the measurement cutoff remain eligible.

`GET/PUT /goal-reporting-context` expose append-only reporting epochs. Explicit changes CAS-increment
applicable definitions; complete prior periods retain their timezone/week start. Closed epochs cannot
extend into current/future periods, later epochs cannot report periods before their opening day/week,
and epochs must not be merged. The baseline context can describe history before goals were configured.
If SQLite cannot rebucket a captured zone different from the daemon, progress is unavailable with
context/warnings, not silently substituted.
Weekly composition uses one DB snapshot and measurement cutoff for its goal/query evidence.

`/weekly-review-view` opens overview A, optionally focused review C, retaining the selected week.
Daily links use the existing date-owned Revision view. Existing/current plan overlap and bounded
uncertain legacy history are separately labeled and never goal credit. No journal or automatic review
submission was added. The shared goal controls retain settings drafts, accepted settings checkpoints,
and exact uncertain requests; progress remains authoritative-read data, not persisted client counters.

Optional assignment follows an acknowledged Stop and lists only that Stop's explicit saved IDs and
revisions. `POST /recorded-work/assignment` uses the existing timer intent/receipt/reconciliation funnel.
Existing/new destination assignment is atomic; normal task staging retains quick-add syntax, tags,
parent inheritance and schedule parsing. Work identity, notes, tags, provenance, ratings/reviews and null
plan association survive. Recovery never repeats Stop or independently creates a task. Separate Stop
batches cannot replace or expand an active selection. Dismissal leaves saved work taskless. It may
cancel a pending target refresh without abandoning an uncertain write; a late read cannot edit the
promoted batch. Recurrence series changes protect an accepted assignment's destination task snapshot
under the SQLite writer reservation, without taking the timer lock.

## Acceptance evidence

The [#59 final repair ledger](timer-workspace-final-repair-59.md) records the later five repairs and
combined one-dataset acceptance replay. The implementation-era evidence below is retained separately.

Final full runs on this implementation, with an absolute temporary database and isolated HOME/TMPDIR:

- Python: **1217 passed**, 1694 warnings, 480.75s. Warnings are reported, not suppressed.
- Node: **900 passed**, zero failures. All changed JavaScript syntax checked separately.
- Repository Ruff: 17 inherited findings in unchanged migration0002, CLI commands and analytics service;
  those files are unchanged from integration `5e06de3`. No additional findings. Existing models.py
  invalid-noqa warning remains. Whitespace checked with `git diff --check`.
- Initial full runs exposed an outdated datetime-bind representation assertion and missing CustomEvent
  in legacy DOM harnesses. The assertion now verifies canonical SQLite precision, and the optional
  selection notification is feature-detected. The complete suites above were rerun after those fixes.

| Contract | Executed evidence |
| --- | --- |
| Optional positive finite targets, overlap and >100%, independent global/task cadences | Public HTTP tests, real DOM blank target → explicit save, disable/re-enable and task total creation |
| All-time beyond400 days and optional inclusive start; target-only edits preserve other settings | Public HTTP tests; real DOM total reports null unbounded period endpoints |
| Historical scope/target, reparenting, deleted tasks and corrupt hierarchy cycles | Public HTTP tests; recursive SQL membership and normal cycle refusal |
| DST spring/fall, overnight, three week starts, context epochs and unsupported zone | Public HTTP tests; real DOM epoch1 → epoch2 with explicit week-start change |
| Exact physical evidence, no live/paused/buffer/plan/legacy credit, correction lineage and reviews | Public HTTP worked examples; real Stop with two saved segments; unrelated running focus anchors preserved |
| DB-only settings durability | Actual subprocess lost ACK after commit, concurrent same-key edits, competing CAS writers, context/edit competition and two normal restarts |
| Assignment crash/recovery | Actual subprocess existing/new destinations at intent, DB commit, file installation and finalized phases; independent notes/ratings writers; two restarts |
| Assignment validation/staleness | Public HTTP boolean revision, unknown/blank/null draft, invalid status, stale multi-record atomic refusal and correction fragment selection tests |
| Migration preservation | Fresh full chain and rich copied0019 synthetic installation, stopped timer, old pre/postDB receipts, two starts, integrity/FK checks, append-only triggers and persisted target constraints |
| A/C, desktop/narrow and navigation | Actual Orca DOM at desktop and390×844; A→C→A, previous/next week, blank settings, explicit save and no horizontal overflow on narrow A/C/settings/assignment; real Enter toggled A→C and retained focus, real typing survived a read refresh and Enter saved its captured revision |
| Assignment UI and lost ACK | Actual taskless Start→Stop→new task with `#synthetic [45m]`; real committed assignment response dropped, receipt lookup recovered same task; second Stop assigned to existing task; separate dismissal left work taskless |
| Existing task/Calendar/focus/correction/export integration | Actual full task editor retained45m estimate and own work history; Calendar rendered; enabled25/5 focus remained running at8665.3% goal; signed five-minute saved correction refreshed goal from11.951556s to311.951556s; bounded four-row CSV preview and browser download |

### Browser scope and limitation

Owned Orca page: `d97bc22d-75a6-402a-a570-e567ceeff73d`, scratch port18064, database
`/tmp/timetrace64-final-browser/db.sqlite`, private HOME/TMPDIR, native delivery disabled and idle
pause off. No notification permission was granted and no provider calls were made. Synthetic task
`01a20c9e-3863-7306-89d5-1dadcefa9e62` was created once despite its lost assignment ACK.

Raster/manual visual certification is **UNRUN**, explicitly accepted by the coordinator after two
prior `Page.captureScreenshot` no-frame timeouts. No further screenshot attempts or alternate browser
backend were used. DOM/layout checks are not represented as raster certification. Independent review,
merge and publication remain coordinator-owned.

## Migration and operations

Migration `0020_personal_goals` follows `0019_timer_focus`, adds initially empty goal settings/context/
receipt tables, and never backfills targets or reclassifies work. Startup requires0020. Downgrade
permanently removes these settings and receipts: back up/export first. Existing work and timer receipt
tables are unchanged. A database downgrade is not an operational rollback: stop writers and reconcile
pending assignment intents before running an older binary, which cannot interpret the new assignment
action. Preserve a consistent database plus timer files; do not mask recovery failures by stamping or
`create_all`. Never test against the personal database; follow the isolated-development recipe.
