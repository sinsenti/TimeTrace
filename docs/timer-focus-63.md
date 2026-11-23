# Focus implementation ledger (#63)

Authority: [reviewed owner brief](https://github.com/sinsenti/TimeTrace/issues/63#issuecomment-7102493844).
This is an engineering/evidence ledger, not a replacement specification or delivery receipt.

## Confirmed seams and decisions

Public root HTTP/service, public JS controller, isolated real browser. Existing receipt funnel
serializes writes; legacy request models and digest construction remain untouched. Defaults live in
the existing versioned timer file and use the existing SQLite operation receipt, not another store.
New timer identities capture creation independently of editable credited intervals. Period settings
are snapshots; later defaults affect future timers only. Validation is strict and bounded 1–1440
whole minutes. No external adapter or live notification has been invoked.

## Acceptance matrix (in progress, not delivered)

| Cell | Evidence |
| --- | --- |
| Initial defaults, future timer snapshot, exact replay, invalid boolean length | Public HTTP red 404 then green 1 passed (`tests/test_timer_focus.py`) |
| Overrides, next-period settings and disable | HTTP routes and period snapshots implemented; bounded evidence only |
| Independent active clock, pause/idle/correction and actions | Public fake-clock pause/Take break/early Resume/replay/observed-idle test passes; correction/race matrix not yet proved |
| Automatic boundary continuity and catch-up | Public evaluator with wall/monotonic/BOOTTIME continuity inputs; on-time and late/sleep/restart/rollback tests pass |
| Immutable warning evaluation | Durable unique generation-zero warning; paused wall-clock/restart tests pass; old creation-receipt/prospective initialization is serialized |
| Durable event claims, adapters and bounded daemon lifecycle | SQLite events and exclusive conservative-unknown claims implemented; adapters and daemon loop pending |
| Browser settings, countdown, actions, drafts and narrow layout | Not implemented |
| Migration 0019 fresh/copied-synthetic/fault acceptance | Normal fresh chain, copied old pending creation receipt and repeated restart pass; related #61 migration suite passes |
| Final Python/Node/scoped lint/browser | Events milestone post-merge focused Python284/Node25 pass; scoped Ruff and merged-JS syntax pass; full-ticket suites/browser deferred |

## Exact initial red/green

Second slice: settings POST initially 422 (legacy generic mutation rejected extra fields), then
2 focused tests passed in 0.26s. Third red: ordinary Resume retained break phase; minimal green
adds explicit break-to-work restart and idle checkpoint at observation onset. The focused pair
then passed in 0.33s with idle enabled explicitly in the idle test (not globally disabled).
A preliminary full Python run after slice two passed 1114 tests in 339.43s, with 4877 warnings;
this predates the last idle/ordinary-resume change and is not final-source acceptance.


## Final partial-source checks (not ticket delivery)

At production tip `531b1e6`, full `uv run python -P -m pytest -q`: **1114 passed**, 4877 warnings,
314.95s. `node --test tests/*.cjs`: **878 passed**, zero failures/skips, 3.94s. Scoped Ruff passes.
Repository Ruff reports the inherited **17** findings; every offending file (migration0002,
CLI commands, analytics service) and the models noqa warning is unchanged versus `e96497a`.
No JS was changed. No schema change or migration0019 was made; migration acceptance, native delivery,
real browser, clock discontinuity, external-send and focus-specific fault matrices remain unrun.
No daemon or real OS notification/sound was started. `git merge timer-workspace-integration`
reported already up to date at `e96497a`; this does not integrate the partial feature elsewhere.

## Durable events/evaluator milestone (continuation)

Actual public red: new evaluator service import failed (`ModuleNotFoundError`), then minimal
notify-only due event/paused two-hour HTTP proof passed (3 focused tests). Expanded fake-clock
checks cover automatic break at an observed live boundary, other-timer independence, break wait,
unknown claim before send, duplicate tabs/replay suppression, correction-independent elapsed and
non-staling delivery claims, missed/suspended/restarted/rollback catch-up, stopped suppression.
Real-process fault tests kill after pending JSON replacement (pre-DB) and before final JSON
replacement (post-DB), recover twice, and verify stable event/interval identities and finalized
receipts. They exposed a real red: work_due countdown could become positive after wall rollback;
minimal green latches due countdown to zero. Normal fresh migration and a consistent synthetic
copied old0018 DB/timer with pending old creation receipt upgrade to0019 twice without changing
old result/hash, recovering honest creation-receipt provenance. Related existing #61 full-startup
migration fixtures cover ratings/lineages/plans/query/export preservation. Combined focused run:
26 passed in89.39s initially. Expanded focused correction/idle/note/receipt/history/migration
run: **253 passed**,133 warnings,in212.84s. After final acknowledgement route addition:
focus/recovery/SQL-sandbox APIs **35 passed** in36.70s; related existing Node controller/correction/
workspace/export **21 passed**. Scoped Ruff passes. Full suites intentionally deferred until
complete-ticket delivery; prior1114Python/878Node checks are historical partial-source evidence.

Public backend entrypoint `FocusEvaluator.evaluate()` accepts injectable trusted clocks, not an
HTTP future cutoff. First sample/no suspend clock/lost continuity cannot auto-pause. Subsequent
samples compare UTC, monotonic and suspend-inclusive BOOTTIME deltas; a boundary must be bracketed
by observations and dispatched within one second. Samples are taken again under the shared serialization lock, not before waiting for it.
No-op evaluations do not create receipt/file generations. No adapter or scheduling loop exists yet.
Timer transitions and notification staging share the original fixed-intent DB/file receipt funnel;
new staging keys are explicitly excluded from `MutationOperation`. Delivery claims use the same
process/advisory/SQLite lock order, reconcile first, but do not create timer mutation receipts or
change timer revisions. Claim state is `unknown` before external IO, so crash/retry cannot authorize
a second alert. Exact same claim operation returns `send_authorized=false`; clients must obey it.
Definite failure/unknown exposes durable passive fallback status, not a second native attempt.
POST `/timer-notifications/{id}/ack` independently dismisses a passive card, idempotently,
without authorizing any send or losing an already accepted/unknown delivery result. Concurrent
real processes prove one due event and one successful exclusive claim (200/409). Claim
tokens/operation IDs are omitted from notice reads; the table is outside SQL-widget allowlist
and has no work/task FK, so deleting history cannot cascade/block notification recovery.

### Events milestone final-source evidence

Committed events backend checkpoint `c3e202f`; merged completed #62 integration tip `5aabcba`
without conflict at `9af55e4`, preserving its volatile display-only `observed_at`. Post-merge
focused regression: **284 Python passed**,231 warnings,in202.43s; related public JS controller/
correction/workspace/history/Calendar tests: **25 passed**,zero failures/skips,in98.34ms.
Final additional public proofs explicitly verify next-period settings snapshots (no silent retiming),
unresolved-idle action refusal, frozen wall warning, byte-preserved unresolved gaps and unchanged focus
credit after Claim idle. Focus/evaluator/process-recovery group: **16 passed** in35.62s.
Scoped Ruff on every changed Python file and `git diff --check` pass. Syntax checks pass for
all four JS files brought by the #62 merge; no #63 JS was changed. Full Python/Node are deliberately
not rerun/claimed for this backend milestone; they remain required after final #63 production work.

Own recovery tests now use actual daemon lifespan startup in each subprocess, including both
pre-DB and post-DB automatic-break crash cases. They assert one retained closed interval and event,
fixed IDs through two restarts, all accepted receipts finalized, normal fresh0019 chain and copied
old0018 pending receipt integrity/FK/result/hash/creation-provenance preservation. Concurrent actual
process evaluators/claimants prove one event/one claim winner. Existing copied #61 migration fixture
also passes under0019, retaining its plans/work lineage/ratings/query/export evidence. Native OS,
real browser, scheduler lifecycle, permission/sound and external-send adapter fault cells are not
implemented or claimed at this milestone. No personal data or external notification was used.

**Incomplete: do not publish/close #63 or describe these checkpoints as the whole implementation.**
## Final implementation continuation

The root lifespan now schedules focus independently of idle enablement and cancels/awaits both
loops; an in-flight threaded claim/send/result is awaited before shutdown completes. Linux uses
bounded argument-safe `gdbus` calls (2s), capability-only probe, suppress-sound by default, fixed
non-sensitive text and accepted/failed/unknown results. Other platforms, WSL/SSH, missing bus,
binary or desktop report unavailable. Native submission is supported only from an interactive
Linux user's session with `org.freedesktop.Notifications`; no service installation or privileges.
Capabilities are cached for the daemon epoch: restart after changing desktop/session prerequisites.
`TIMETRACE_NATIVE_NOTIFICATIONS_ENABLED=false` forces in-app fallback for scratch/testing; tests
set only that flag globally, not idle detection. No OS send or sound was invoked for acceptance.

Shared exported controller now journals defaults/initialization/settings/actions without changing
legacy payloads. Focus drafts retain their initial revision and survive polling/selection;
Use current saved focus settings is explicit reset after a stale edit. Selected identity is a
best-effort session display preference, independent of the mutation journal. Focus UI uses server
remaining only, default/override editors, next-period explanation, generation-checked break actions,
passive durable cards and explicit browser-permission gesture. Browser fallback is open-page only;
permission default/denied means in-app. Native acceptance/unknown never fans out a browser alert.
One selected notification channel owns optional sound; OS/browser settings may silence it.
Legacy Pomodoro target maps to the same independent focus period, not credited-work countdown.

Actual red/green: missing native adapter module -> fake transport green; missing exported JS module
-> selected identity/generation/draft green; stale editor test exposed silently rebased revision5
instead of captured4 -> minimal draft-revision retention green. Fake delivery/root-lifespan/process
fault and migration group passed32; actual root startup and in-flight cancellation are tested.
Complete candidate Node run:887 passed,0 failures/skips,in3.50s. First full Python candidate:
1143 passed/1 failed (357.26s); the sole failure was the existing page-include assertion still
expecting the old `?v=idle5` asset tag. Updated it to require exactly one new-version shared
controller and focus include on all thirteen pages/aliases; focused page proof passes.

Final clock proof exposed a real red before due: a live UTC rollback rewound remaining time
50s instead of29s. The evaluator now compares suspend-aware monotonic/UTC deltas and reanchors
only the independent focus clock when the prior identity/generation/recording-state token still
matches; immutable creation and work intervals remain untouched. Automatic boundary proof also
requires the prior timer revision, so an intervening Note/Pause/Stop wins rather than an old
sample forcing an autonomous pause. Focus/root-lifespan/page group:22 passed after the first fix;
final full-source suites follow below. No-op steady ticks still write no receipt/file.


Actual isolated Orca browser with synthetic profile/fake-clock daemon18463: both policies,
Take break/break wait/Resume, independent taskless timers, dirty note and focus editor retention,
correction-independent focus/warning anchors, once warnings for paused/running identities, saved
defaults and selected identity across reload, native-unavailable/denied fallback, lost ACK and hung
display (one POST each, read-only recovery) passed. At390px viewport focus panel302px/right346px,
flex-wrap enabled; two real screenshots inspected (current card and settings), no no-frame failure.
This is bounded rendering evidence, not broad visual/accessibility or native OS visibility certification.
Tracked probe: `tests/browser_timer_focus_63.js`; navigation assertions were split around reload.


2026-11-23: isolated external HOME/TMPDIR/DB; `uv run python -P -m pytest tests/test_timer_focus.py -q`.
Red: 1 failed, GET `/timer-focus/defaults` returned 404. Green after minimal defaults slice: 1 passed
in 0.17s. This single slice is not acceptance of the full ticket.
