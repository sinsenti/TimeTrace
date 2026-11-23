# Timer focus and notifications (#63)

Implementation is ready for independent review, not published/closed or deployed. Authority:
[owner decisions and reviewed brief](https://github.com/sinsenti/TimeTrace/issues/63#issuecomment-7102493844).
This is the engineering/verification ledger, not a duplicate product specification.

## Implementation map and decisions

- `core/focus.py`: independent active clock, period snapshots, freeze/checkpoint and countdown.
  Corrections/claimed idle credit never become focus credit. Legacy Pomodoro mode/target maps to
  this same period; credited-work remaining is no longer a second focus clock.
- `MultipleTimerService`: original serialized process/advisory/SQLite receipt+file funnel owns
  defaults, initialization, settings, actions, automatic transitions and staged notification rows.
  New staging keys are explicitly excluded from `MutationOperation` construction. Old request
  schemas/defaults/hash construction and exact receipt/file replay remain unchanged.
- `timer_focus_service.py`: public `FocusEvaluator.evaluate()` takes trusted injectable UTC,
  monotonic and suspend-inclusive clocks, sampled again under serialization. First sample/restart,
  missing BOOTTIME, late dispatch, sleep or clock discontinuity cannot authorize a missed break.
  A live boundary must be bracketed, within one second, with unchanged prior generation/revision.
  An intervening Note/Pause/Stop wins. Signed UTC discontinuities with matching monotonic and
  BOOTTIME elapsed evidence rebase only the focus anchor; work intervals and immutable creation anchor never move. Due remains zero.
- Warning generation is constant zero, uniquely per unfinished identity. Old initialization uses
  a trustworthy retained creation receipt, otherwise explicitly labels a prospective unknown-history
  anchor. No UUID timestamp/corrected earliest-start reconstruction; GET never initializes/emits.
- Migration `0019_timer_focus`, parent `0018_work_corrections`, adds private local notification
  events/claims. No task/work FKs, external queue or second timer JSON store. Analytics SQL
  allowlist excludes the table. Claim credentials appear only in dedicated claim/result exchange,
  not ordinary notice reads, widgets or logs.
- `focus_runtime.py`: root lifespan evaluator loop independent of idle enablement, bounded native
  dispatch (16 pending notices/tick), no-op ticks write no receipt/file, cancellation awaits an
  in-flight threaded claim/send/result. Root shutdown cancels AND awaits idle and focus tasks.
- `notification_delivery.py`: argument-safe bounded `gdbus` protocol adapter; no new dependency,
  shell interpolation, installer, privileges, tray, wrapper, push or external infrastructure.
- `timer_focus.js`: exported controller and shared navbar/current-workspace UI, server countdown,
  default/override forms, next-period explanation, due actions, diagnostics and passive cards.
  All user settings/actions use the existing controller ACK-first mutation journal. Draft revisions
  remain captured until explicit reset; polling/selection preserve drafts. A best-effort selected
  identity session preference is display state, not another timer store or mutation journal.

### Public interfaces

| Interface | Contract |
| --- | --- |
| GET/POST `/timer-focus/defaults` | Strict bounded policy, expected settings revision and original operation receipt |
| POST `/timer-focus/initialize` | Explicit receipted retained-state initialization/replay |
| POST `/timers/{id}/focus-settings` | Strict targeted effective settings; subsequent periods, disable does not resume |
| POST `/timers/{id}/focus-action` | Identity/revision/generation checked Take break, Keep working, Resume work |
| GET `/timer-notifications` | Durable passive notice projection, no transitions or claim credentials |
| GET `/timer-notifications/capability` | Sanitized supported/unavailable diagnostics; capability probe does not notify |
| POST `/timer-notifications/{id}/claim` | Exclusive channel ownership; unknown persisted before external IO |
| POST `/timer-notifications/{id}/result` | accepted/failed/unknown/in_app_acknowledged, no work/revision mutation |
| POST `/timer-notifications/{id}/ack` | Idempotent passive-card dismissal without authorizing send |

Exact claim retry returns `send_authorized=false`. Lost claim ACK or a crash after send may miss
an intrusive alert rather than authorize a duplicate blast. Unknown claims are never automatically
leased/re-sent. Native acceptance means submitted, not seen. Failed/unknown notices retain honest
in-app fallback/status. Passive cards across views are not additional intrusive alerts. Browser
permission is requested only by explicit gesture; denied/default/unsupported uses in-app fallback.
Browser Notification sound is optional and OS-controlled, not a separate WebAudio beep. Native
sound hints are off unless the saved global preference is on and the server advertises sound.
Unsupported sound/failed delivery is visible and never changes recording or starts retry loops.

## Platform / launch matrix

| Environment | Supported result / limitations |
| --- | --- |
| Linux interactive user + `gdbus` + usable session bus + `org.freedesktop.Notifications` | Bounded capability and Notify submission; fake transport tested, real desktop visibility not certified |
| Root/system service, SSH, WSL, headless/no display/bus/binary/server | Explicit unavailable; durable in-app fallback |
| Windows/macOS | Native unavailable; optional permitted open-page browser fallback, otherwise in-app |
| Browser closed, daemon and supported desktop session still running | Daemon owns timing/submission; fake service/process proof, no real host OS visibility claim |
| Daemon stopped/sleep/system clock discontinuity | No exact-time guarantee; one catch-up, never retroactive breaks or automatic resume |

Launch as the normal interactive desktop user, with the existing session bus/display environment.
No service installation/escalation is needed or authorized. Capability is cached for the daemon
execution epoch; restart after repairing desktop-session prerequisites.
`TIMETRACE_NATIVE_NOTIFICATIONS_ENABLED=false` forces safe in-app fallback for scratch/testing.
Automated tests set only this native-delivery guard globally, not idle detection. OS/browser/DND
settings may silence opted-in sound; no human-seen/exactly-once promise is made.

## Acceptance matrix

| Cell | Actual evidence |
| --- | --- |
| Defaults off/25/5/notify-only/sound-off; persisted defaults and overrides | Public strict HTTP tests, process restart and real browser saved default/reload |
| Notify-only, independent timers, Take break/Keep working | Public fake clocks + real selected-workspace DOM controls |
| Live automatic break, fixed cutoff, other timer untouched | Public continuity tests, real fake-clock browser; unchanged revision token required |
| Break completion once, paused wait, explicit/early ordinary Resume | Public tests and actual browser |
| Manual pause/resume/split, corrections/idle independent focus | Focus/correction/idle/notes suites; actual correction leaves countdown/creation unchanged |
| Unresolved idle refusal and claimed-credit isolation | Public explicit refusal, byte-preserved gaps, frozen warning, Claim leaves focus unchanged |
| Immutable two-hour running/paused/frozen once; stopped suppression | Public fake clocks/restarts + actual browser two independent identities, stable event IDs |
| Late/suspend/restart/rollback, no fabricated intervals/backlog | Public continuity tests; live rollback regression preserves active focus via monotonic proof |
| Two evaluators/processes/tabs and exclusive delivery | Real concurrent processes, exported JS channel/permission tests, CAS/lock claims |
| Pre/post DB/file and send/result crash recovery | Real subprocess kills, repeated full lifespan startup, fixed event/interval IDs and finalized receipts |
| Migration0019 normal fresh + copied synthetic old DB/timer | Own old0018 pending creation receipt fixture and richer #61 lineage/rating/plan/query/export migration fixture, integrity/FK and exact old hash/result preservation |
| Strict settings, stale/tamper/replay, lost ACK/hung display | HTTP/controller suites; actual browser one POST each and read-only recovery, draft retained/reset explicitly |
| Capability/sound/permission/failure/unknown, no real OS effects | Fake transport/native runtime/process and exported browser boundary tests; actual denied/unavailable fallback |
| Narrow UI/drafts/reload/selection/Calendar/export | Actual isolated Orca browser, two taskless timers, 390px DOM bounds/wrapping, two inspected screenshots; existing Calendar and export preview usable |

## Exact verification

Final production source: `053485320745a2c50a83d78e46f6ab65c1d45b64`, already contains completed
#62 integration `5aabcba79ffec840b5a6feb719d9d7ff7f80723a`; no Calendar implementation duplicated.

- **Full Python:** `uv run python -P -m pytest -q`: **1148 passed**,4879 warnings,in354.98s.
- **Full Node:** `node --test tests/*.cjs`: **887 passed**,zero failed/skipped,in3963.01ms.
- Scoped Ruff across all23 changed Python files: pass. Scoped format check:23 already formatted.
  Changed-JS/browser-probe syntax and `git diff --check`: pass.
- Repository Ruff: exactly **17 inherited findings**, all in untouched migration0002, CLI commands
  and analytics service files (byte-unchanged against `e96497a`); no scoped failures.
- Last focused source checks:24 passed (clock ownership/idle/root lifespan); earlier expanded
  post-merge backend/correction/history/SQL/Calendar/migration group:284 passed. These are not
  substituted for the final complete suites above.
- Actual final-source browser: isolated profile and fake-clock/fake-delivery daemon18463,
  `tests/browser_timer_focus_63.js` main/more/fault probes pass. Both policies, controls, dirty
  note/focus drafts, correction independence, saved defaults, once warnings and one-POST lost ACK/
  hung display recoveries passed. Selected B and defaults4 survive final reload. Two subsequent
  actual full lifespans also preserve defaults4, timer creation/generation/state and notice IDs. Earlier same-UI
  390px check: panel302px/right346px, flex-wrap enabled; two actual PNGs inspected. Native OS
  visibility/permission prompts/sound were never triggered. Navigation assertions split across loads.
- Public protocol source checked: freedesktop notification protocol (GetCapabilities/Notify/sound
  hints), not evidence that this host's desktop displays notifications.

### Red/green and failed attempts (retained, not hidden)

Initial defaults GET404 ->1 green. Focus settings422 ->2 green. Ordinary Resume retained break
phase -> fixed and observed-idle checkpoint green. Evaluator/adapter/exported-controller imports
initially missing -> corresponding public/fake boundary greens. Due countdown could become positive
after rollback -> latched zero. Dirty settings silently rebased revision5 instead of captured4 ->
draft revision retained. Live pre-due wall rollback returned50s instead of29s -> monotonic reanchor
regression green. First complete Python candidate:1143 passed/1 failed,in357.26s, solely the old
page test cache-tag assertion (`idle5`); updated it to require exactly one controller/focus include
on all thirteen pages/aliases. Final full pass above follows all production fixes. Initial Ruff
style findings were scoped-formatted; the final inherited17 remain untouched.

Historical partial checkpoints `4274e58`/`531b1e6`/`e7d8310` and events checkpoint `c3e202f`
were explicitly incomplete. Their1114Python/878Node or284-focused results were never full #63
acceptance. Final scheduler/UI checkpoint `f1dd0c6` plus clock ownership repair `0534853` supersede
those incomplete status statements.

## Independent review repair — signed UTC adjustment

Independent Standards review reported **zero findings**; independent Spec review reported **one P2**:
forward UTC jumps prematurely exhausted active focus. This is a verified repair of that finding,
not a new zero-finding full Spec review. Matching monotonic/BOOTTIME elapsed now compensates
both signs of UTC discontinuity under the existing generation/anchor ownership check. The
transition continuity guard remains false on adjustment; later real deadlines work normally.
No interval, schedule, warning origin, schema, request hash or receipt protocol changed.

Public root-HTTP/service regression first failed both policies (`work_due` instead of `work` after
UTC +3600s/runtime +1s). After repair it proves 1499s remaining for a 25-minute focus, wall-warning
crossing without focus expiry, once-only warning and subsequent real boundary for both policies.
Additional suspend/missing-clock contrasts catch up once without automatic pause; due stays latched
on rollback. Existing backward, ownership, pause, break, restart and crash tests remain green.

Final repair checks (isolated external DB/HOME/TMPDIR, safe-path Python, native delivery disabled):
- Full Python: **1152 passed**, 4879 warnings, 372.07s.
- Full Node (`node --test tests/*.cjs`): **887 passed**, zero failures/skips, 4938.15ms.
- Focused focus/events/recovery/delivery/send-recovery: **38 passed**, 3 warnings, 61.75s.
- Scoped Ruff and format: pass (2 files); `git diff --check`: pass.
- Repository Ruff: **17 inherited findings**; migration0002, CLI commands and analytics service
  remain byte-unchanged against `e96497a`. No new scoped findings.
- Two focused command attempts named nonexistent delivery globs/files and collected no tests;
  corrected explicit file list produced the 38-test pass above.

Frontend unchanged: prior actual-browser normal-flow evidence above is reused, not rerun or claimed
as new proof. Targeted fake-clock browser rerun, actual OS alerts/sound and platform certification
are unrun; the public-service regression and complete suites supply this repair's evidence.

## Remaining review / certification limits

Coordinator owns fresh integration merger, independent Standards/Spec review/repair and publication/
closure. No independent review or delivery/deployment is claimed here. Real Linux desktop visible
notifications, Windows/macOS native support, OS permission UI/sound/DND/device behavior, broad pixel/
accessibility certification and personal-daemon deployment are unrun/unsupported as stated above,
not fictitiously passed. Synthetic processes/transport prove durable attempts, not human visibility.
No personal database/key/provider, actual OS alert/sound, paid calls, port8002 or broad cleanup was
used. Only exact owned scratch daemons were terminated; no other tree/process was touched.
