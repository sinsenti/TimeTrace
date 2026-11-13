# Ticket15 Day workspace — producer review checkpoint

Implementation source base: `83fb87fed68afcff6565da55efa18807b04cbd12`, branch
`codex/ui-redesign-15-day-workspace`. Approved B6/O5 and the external architect plan govern this
change. This is an uncommitted producer checkpoint, not ticket acceptance, integration or release.
No schema, service, router, API, aggregation, completion or recurrence policy changed.

## Files and behavior

- `day_review.js`: one mounted root per date; independent text, ratings, grouping, evidence filter,
  readiness and read generations. Hidden owners remain represented in Settings departure checks.
  Save snapshots all fields before its first request; day and per-rating known ACKs are separate
  checkpoints. Concurrent edits remain dirty. Save/Dismiss/Discard are date-scoped and pending Save
  reactivation is inert. Discard keeps saved rows and guards rating edits made during its reload.
- `day_history.js`: bottom Show/Hide history, existing filter predicates, at most one expanded
  non-main editor, main exclusion and promotion without replacing owners. List refreshes do not
  replace an expanded form. Historical text is inserted as text.
- `ratings_config.js`: optional compatible container scope; Day IDs include the date root and
  definition UUID. Root-scoped validation/submission, inert rendered names/descriptions, frozen
  score/dismissal payloads, per-entry acknowledged retry state, definition-read generation and
  target/container/input identity checks. Session/Task caller signatures and administration remain.
- `revision_nav.js`: default Day; existing hash aliases and optional Session Review/Task Inspector/
  rating administration remain reachable. `#overview` opens workspace history.
- `revision.html` / `day_workspace.css`: reusable editor template, no standalone KPI strip; one
  Activity/Tasks bar list with 13px labels, explicit hours, large native buttons and no percentage
  column. Full-day denominator, matching/total session counts, created-day done-task counts,
  scheduled-row/fan-out caveat and date/tag/task Calendar chip/handoff remain explicit.
- `test_day_workspace.cjs`: scoped same-definition IDs/inert labels, own required validation,
  frozen score/dismissal submission, retry checkpoints, late definition reads and rebound-target ACKs.
- `test_draft_ownership.cjs`: retained previous scenarios; adapted template fixtures and superseded
  A→B→A destruction assertions to retained-date ACK semantics. Added hide/switch/promote/group/filter,
  partial-retry, concurrent edits, stale reads and exact tag/task/direct-session handoff cases.
- `test_calendar_shell.cjs`: only the two Day fixtures and required shared fixture lookup changed.
  Preferences/departure scenarios and assertions retained. Failed Save now checks the displayed
  incomplete status rather than an uncaught promise rejection.
- `test_day_workspace_api.py`: real daemon-app fixture verifies reachable page entries, two-day
  same-definition score/dismissal separation, fan-out/full-day evidence/created-day task accounting
  and unchanged task/session data after reviews.
- `browser_day_workspace.js`: native probe prepared for actual disposable daemon/browser execution;
  real writes/readbacks and public controls, with only one deliberate second-rating HTTP400
  (`Controlled second-rating failure`) and held Day POST faked. Includes two-day Save/Dismiss/Discard, retained/promoted owners, Calendar tag chip,
  partial retry, full B persisted snapshots unchanged during both A attempts, concurrent/hidden
  drafts, duplicate Save and Enter/Ctrl+Enter. Retry asserts exactly one failed-definition POST
  with no acknowledged review/first-rating resend. No fake successful ACK is supplied.
- `docs/development.md`: narrow retained-Day ownership correction and current test/probe pointers.

## Actual verification

Every command used the parent-prepared strict private environment via
`/home/user/git/personal/TimeTrace/.scratch/codex-continuation/run-validation.py --config
/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-15/environment/allocation.json`.
Both stdout/stderr, full command/environment and result are exclusive artifacts under the external
`evidence/ticket-15/validation/` directory. No personal database or live provider was used.

- `focused-api-10`: 3 passed; `final-python-23`: **535 passed, 214 warnings**.
- `final-node-27`: **384 passed, zero failed**, full suite with Node test isolation disabled.
  `canonical-node-29`: canonical default-isolation command also **384 passed, zero failed**.
- `final-syntax-28`: **114 JS/CJS files parsed**; updated native probe also passes `probe-syntax-31`; `final-whitespace-26`: pass.
- `scoped-ruff-format-16` / `scoped-ruff-17`: new Python file formatted and lint-clean.
- `full-ruff-19` and untouched archive-HEAD `baseline-ruff-20` each return 18 diagnostics;
  `ruff-comparison-30` proves exact relative-file/code/row/column/message equality: zero new violations.
- Focused ownership checkpoints pass; latest complete Node suite includes 61 ownership scenarios,
  19 Calendar shell scenarios and six new scoped rating/workspace seam scenarios.

## Retained failures and corrections

- First RED/early Node `--test` runs inside the sandbox returned opaque file failures; no assertion
  count was inferred. Direct-file execution exposed scenario details. The four original public-seam
  tests were also run against extracted untouched HEAD ratings/template files in
  `/tmp/day-workspace-red-15`; `reconstructed-baseline-red-13` records **four intended failures**.
  This reconstruction is labelled and does not rewrite the first receipts.
- `focused-day-direct-04`: initial ID assertion also matched the suffix of `data-rating-def-id`;
  corrected the regex to match actual `id` attributes. Other three cases passed on that checkpoint.
- Early ownership runs exposed obsolete single-editor fixtures and historical owner-destruction
  expectations; retained scenarios now use cloned date roots and assert ACKs never consume B.
- `focused-api-09`: 2 passed/1 failed because the SQLModel comparison snapshot was taken after
  commit had expired the row (`{}`). Explicitly refresh before the snapshot; focused/final suites pass.
- `full-node-12`: 373 passed/2 failed in the two obsolete Calendar shell Day fixtures. Narrow fixture
  compatibility repair retained original Preferences/departure assertions; subsequent full suite passes.
- `focused-owners-new-15`: one new promotion case found missing fake `window.history`; added the
  fake browser API, preserving the public promotion call. Production history code was not altered
  to accommodate the fixture.

## Acceptance and limits

Independent source reviews and native execution are pending at this producer checkpoint. The browser
probe being present is not proof of execution. Four widths, four appearance modes, contrast, live
isolated daemon `/health`, Session Review/Task Inspector/admin compatibility and reviewer disposition
remain parent-owned gates. No migration is required because models/schema are unchanged. Historical
single-editor browser probes use obsolete Day selectors and do not certify this workspace.

Partial saves are separate HTTP writes. Only known acknowledged payloads are skipped on retry; a lost
response may have persisted and remains uncertain. There is no atomicity, idempotency, exactly-once,
cross-tab or persisted-draft guarantee. No claim of human acceptance, physical-pointer/screen-reader/
all-engine coverage, paid-provider testing, whole25 completion, push, PR or dev merge is made.

## Explicit probe bridge after freeze33

Parent released only `tests/browser_day_workspace.js` and this evidence file after
`frozen-source-20261113-01.json` / `freeze-33`; all product, other tests, issue and development-doc
bytes remain pinned to that checkpoint. The amended probe installs browser isolation before any
navigation: `about:blank`, non-HTTP and other origins return before localStorage access; the exact
base HTTP origin merges `idleDetectorEnabled:false` and `enableVimMotions:false` into its private
preferences. It never enables the daemon idle detector.

The probe now includes a presentation phase before fixture-definition cleanup: main A and expanded B
at390/768/1024/1440 pixels across Refined Archive, Soft Stone, Porcelain, midnight, nord, dracula,
cyberpunk and monokai (32 combinations). It records document/editor/visible-descendant horizontal
bounds, dimensions of all visible editor controls, applicable44px larger-breakdown targets, and
six bounded first-visible opaque-RGB/resolved-background contrast samples per combination with4.5
threshold. Theme attributes, retained A/B drafts and zero domain/config writes are asserted.
These are prepared assertions, not execution results. The amended function contains seven result
groups, with individual `check()` calls not collected as a separate count. General buttons retain
36px minimum; focus/hover/disabled tracks, opacity/image/non-RGB sampled surfaces, all animation
frames, physical touch, screen-reader and other engines are not certified. Task/Session Inspector
native compatibility is still a gap; shared-rating unit callers alone have passed so far.

Both independent review axes subsequently confirmed a P2 at initialized Day rating hydration:
`loadDayEditor` only reads definitions while `ratingsReady` is false, so admin definition add/delete/
range changes are not reconciled on return/Refresh; deleted definitions can cause failing rating
writes after the day POST. The same-owner hydration regression did not prove entry into the second
definition GET, and failed Discard's Retry can similarly skip hydration. This is outstanding, not
waived or fixed. Parent will assign a separate fresh repair implementer after preserving this exact
checkpoint. No product edits were authorized in this probe bridge. Native acceptance remains unrun.

## Initialized-rating refresh repair after freeze02 (2026-11-13)

The outstanding P2 above is repaired in source, pending fresh independent reviews and native
acceptance. Only `day_review.js`, `ratings_config.js`, `test_draft_ownership.cjs` and this evidence
file changed relative to freeze02. All other feature/owner paths remain pinned; no Git mutation,
daemon, provider, native probe or personal data access was performed by this repair implementer.

- `day_review.js`: each valid date-owned load now awaits fresh rating definitions, including return
  from Custom Ratings and Refresh. Initialized dirty fields retain their owner. A failed fresh load
  cannot proceed to Save with stale definitions. Discard Retry actually retries rating hydration;
  newer rating edits instead receive preserving refresh, and newer text is not discarded by Retry.
- `ratings_config.js`: optional Day reconciliation preserves dirty input nodes, raw scores,
  disabled-as-dismissed state, departure baselines and known rating ACKs. Clean/new definitions adopt
  current metadata/entries; clean deleted definitions disappear. Dirty deleted/retargeted definitions
  remain visibly unavailable and block Save until explicit Discard or definition restoration/Refresh.
  Dirty scores outside a changed range remain visible as number controls (range controls would clamp)
  and block Save before the Day POST until explicitly corrected or dismissed. Updated bounds/input
  handlers use the fresh scale. Same-container and owner generations reject stale definition reads.
  Shared Session/Task rendering keeps its existing default behavior; no API/model/domain policy change.
- `test_draft_ownership.cjs`: the formerly vacuous delayed hydration test now asserts the second
  definitions GET started before editing/releasing it. Six additional handler-level regressions cover
  admin add/range/delete on Refresh, dirty A/B scores/dismissal, no pre-validation day POST, unavailable
  controls/explicit Discard, definition races, retained ACKs, failed Discard Retry and newer edits.
  A narrow synthetic rating-markup fixture exercises real renderer/Day handlers; it is not native DOM
  or browser acceptance evidence.

Actual strict-wrapper receipts (same exact private allocation/config as earlier):

- `repair-red-34`: intended second-GET assertion failure against unchanged product source.
- `repair-focused-35`: 64 pass/1 fail because the new fixture omitted `alert`; repaired only that
  fixture. `repair-focused-36`, `37`, and final `42` pass; final focused count **67 passed**.
- `repair-reconstructed-red-38` / final `repair-final-red-45`: **61 passed / 6 intended failures**
  against the exact pre-repair Day/ratings files reconstructed outside the worktree from read-only
  HEAD plus the saved pre-edit diff. This labels reconstructed RED evidence rather than replacing
  original receipts. Current tests remain unchanged in that run.
- `repair-python-39`: **535 passed, 214 warnings** in the isolated environment. No Python source
  changed during or after that full suite.
- `repair-canonical-node-40`: sandbox reports **22 opaque file-level passes**, not scenario counts.
  Elevated canonical `41` and final `repair-final-node-44` provide actual **390 passed, zero failed**.
- `repair-checks-43`: syntax **115 JS/CJS files**, whitespace and scoped Python Ruff/format passed;
  full Ruff JSON matched all 18 baseline diagnostics, but exact stderr equality failed because cached
  Ruff omitted the known invalid-noqa warning. `repair-checks-inspect-46` retained both actual streams.
  Final `repair-checks-final-47` runs full Ruff with `--no-cache` to require exact baseline JSON and
  stderr equality, alongside the syntax/whitespace/scoped checks. No unrelated source was reformatted.

No transport/atomicity/idempotency/cross-tab guarantees were added. Native acceptance, all earlier
visual/a11y/compatibility limits and the parent-owned fresh independent review gates remain open.

Final `repair-checks-final-47` **passed**: 115 JS/CJS syntax checks, whitespace, scoped Python lint/
format, and exact uncached full-Ruff baseline diagnostic/stderr equality. Source is frozen next as
`frozen-source-20261113-03.json` with `frozen-tracked-20261113-03.patch`; further source edits require
an explicit release of that freeze. No acceptance gate is represented as completed by this repair.

## Stale Discard / winning Refresh hydration repair after freeze03 (2026-11-13)

Fresh review identified a remaining P2 in the preceding repair: Discard's old summary response only
checked retained owner identity before starting another definition render. If Refresh had advanced
Day generation and was awaiting definitions, stale Discard advanced the container render generation
and invalidated Refresh's renderer. Refresh then marked ratings fresh despite no successful hydration.
This is now repaired in source, pending parent-owned independent review and native acceptance.

- `day_review.js`: reject a stale Discard summary before invoking the renderer; also reject stale
  post-render continuation. Both load and Discard now use the renderer's actual successful-hydration
  result before updating rating readiness/freshness or checkpoints. Current load with rejected
  hydration retains stale readiness and shows Retry rather than authorizing Save.
- `test_draft_ownership.cjs`: two regression scenarios exercise the real rating renderer. The first
  holds Discard summary G1, starts Refresh G2's actual definition GET, releases old G1, and verifies
  no third definition GET, changed definition bounds/identity win, and Save writes the new definition.
  The second supersedes a container renderer without advancing Day generation, verifies no false
  freshness, and proves Save reloads before any write. Existing dirty A/B, dismissal, known ACK,
  concurrent-edit and failed-Discard Retry scenarios remain and pass.
- `test_calendar_shell.cjs`: one test-local successful-render stub for the existing Save/Preferences
  ownership scenario, whose synthetic fixture has no mounted rating controls; preserves all existing
  assertions. No product fallback accepts an undefined renderer result. Parent explicitly extended
  ownership to this fixture after the full suite exposed it.
- This evidence file records the correction. `ratings_config.js` is unchanged from freeze03: it
  already returns true only when hydration completes. All other feature paths remain unchanged.

Strict private-environment receipts retain both streams, exact environment, argv and exit status:

- `repair2-red-48`: **67 passed / 2 intended failures** against unchanged freeze03 production JS:
  third definitions GET started, and rejected renderer incorrectly set freshness true. The pre-edit
  Day JS hash was checked against freeze03 before the production edit comparison.
- `repair2-focused-49`: **69 passed**, including both regressions and all preceding ownership cases.
- `repair2-python-50`: **535 passed, 214 warnings**. No Python source changed in this repair.
- `repair2-canonical-node-51`: **391 passed / 1 failed**; the synthetic Calendar Save fixture's
  unmounted rating container yielded undefined hydration and correctly blocked Save. The authorized
  test-local stub correction is recorded above; no assertion was removed or weakened.
- `repair2-calendar-focused-53`: **19 passed**. `repair2-final-node-54`: canonical default-isolation
  full suite **392 passed, zero failed** after that fixture correction.
- `repair2-checks-52` and post-fixture-change `repair2-final-checks-55`: **passed**; 115 JS/CJS syntax
  checks, whitespace, scoped Python Ruff/format, and uncached full Ruff JSON/stderr exactly equal to
  the retained 18-diagnostic baseline. No unrelated source formatting.

This repair performed no Git mutation, daemon/native execution, provider call or personal-data
access. Native behavior, visual/a11y/compatibility acceptance and fresh independent source reviews
remain parent-owned and pending; previous limits and non-atomic/lost-ACK caveats still apply.
Source is frozen next as `frozen-source-20261113-04.json` with its tracked patch; no claim of ticket
acceptance, integration, release or completed native acceptance is made here.

## Native1 retained failure and Calendar fixture-readiness bridge after freeze04

The first actual native run is retained unchanged under the external
`evidence/ticket-15/native-run/` directory, including `browser.json`, both probe-return JSON files,
stdout/stderr, runtime log, initial/final storage records and `disposition.json`. Both probes
returned: seven Day result groups and three real definition-repair result groups. The Day return
contains32 layouts and192 measured RGB contrast samples, minimum6.443541189917267. The repair return
shows raw4 retained as a number input with min10/max20 and `rangeUnderflow:true`, blocked Save, real
correction12 readback, real deleted-definition unavailable handling, and explicit Discard. These
returned groups and samples do not change the overall run disposition.

Native1 browser exit was **1**, `disposition:FAILED`, `featureAcceptance:false`, with
`captureDisposition:REQUIRES_PARENT_INSPECTION`. Its sole response-capture error was a real read-only
Calendar AI-overlay GET whose CDP response body became unavailable after the page left Calendar:
`Network.getResponseBody: No resource with given identifier found`. That body remains UNKNOWN;
it has not been invented, reconstructed or replaced with a fake. Page errors, driver/source-pin
errors, guard violations, handler errors and request failures were empty. No successful ACK was
faked. The original receipt is not relabelled as a passing native run.

The parent controller recorded the owned daemon's sole SIGTERM, actual exit-15, reap, process absence,
connection refusal111, unchanged logical storage after stop, clean foreign keys, zero provider
execution, and absent key/timer files. This amendment starts no runtime or daemon and performs no
storage cleanup; the retained native1 artifacts remain the authoritative records.

Parent explicitly released freeze04 only for this evidence file and `tests/browser_day_workspace.js`.
Before editing, all476 source-file hashes matched `frozen-source-20261113-04.json`. The sole probe
change waits for `p.waitForLoadState('networkidle')` after the actual Calendar date/tag/chip proof and
before navigation back to Revision. This lets the existing real read-only overlay response capture
settle instead of racing navigation. Product code, guard policy, request routes, fake-response policy,
all other tests/docs and known successful assertions are unchanged. This is a fixture-readiness
amendment, not a claim that native1 passed or that a fresh native run has occurred.

Only scoped probe syntax and whitespace checks are required for this bridge; full Python/Node
regression suites are not rerun because all product and other test bytes remain pinned. A new
`frozen-source-20261113-05.json` and tracked patch preserve the exact two-path bridge from freeze04.
Further edits require another explicit release; native re-execution and acceptance remain parent-owned.

Scoped receipts `native1-calendar-readiness-syntax-56` and
`native1-calendar-readiness-whitespace-57` both passed (exit0), retaining exclusive command/environment,
stdout/stderr and result files. No full-suite rerun, daemon/browser execution or Git mutation occurred.

## Native2 bounded candidate and metadata bridge after freeze05

The second actual native run is retained at the exact external directory
`/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-15/native-run-v2/`.
Its original `browser.json`, both probe-return JSON files, `browser.stdout`, `browser.stderr`,
`daemon-runtime.log`, storage/health records and `disposition.json` are the authoritative receipts.
The parent controller reports **browser exit0** and `bounded native candidate passed`; both probes
returned normally: **seven Day result groups plus three real definition-repair groups**. These are
result groups, not assertion totals. The browser receipt deliberately retains `featureAcceptance:false`:
passing this bounded native candidate does not complete ticket acceptance or authorize integration.

The Day return includes32 four-width/eight-theme layouts and192 bounded first-visible opaque-RGB/
resolved-background contrast samples, minimum **6.443541189917267**. Recorded bounds, independent
A/B scores and opposite dismissal states, retained/promoted owners, real Calendar date/tag chip,
partial Save and failed-only retry, untouched B persistence, held A ACK/concurrent drafts, duplicate
Save and Enter/Ctrl+Enter checks passed. The only fake response was the declared second-rating
HTTP400 once; successful ACKs and all readbacks were real. No guard policy or unknown body was faked.

The repair return confirms real definition creation/range-update/deletion via the existing APIs.
Raw4 stayed a number input with min10/max20 and `rangeUnderflow:true`; invalid Save produced zero
POSTs. Public correction12 persisted with actual readback for Day13. A real deleted definition kept
its dirty unavailable draft, blocked Save, and explicit Discard returned the editor to fresh state.
Those three real admin API fixture operations are not certification of the full rating-administration
UI. Page/driver/source-pin errors, guard violations, response-capture errors, handler errors and request
failures were all empty in the second run; source pinning passed.

The parent-owned controller sent exactly one SIGTERM to its own daemon, recorded actual exit-15,
reaped it, verified process absence and connection refusal111, and proved logical storage unchanged
after stop. Provider execution/configuration remained zero; key and timer files were absent and
foreign keys were clean. Remaining disposable storage comprises three synthetic day-review rows,
two synthetic sessions and the default AI settings/status/FTS state; fixture definitions and rating
entries were cleaned. These are retained scratch records, not personal data or a request for further
cleanup. This metadata bridge runs no daemon/browser, provider or storage operation.

The first native run remains **failed** with browser exit1 and its sole CDP read-only Calendar-overlay
response body UNKNOWN. Its original `native-run/` receipts are retained without relabelling or body
reconstruction. The sole readiness amendment between the runs waited for Calendar `networkidle`
after genuine date/tag/chip proof before leaving for Revision. Both the first failure and the second
bounded pass remain part of the evidence; the latter does not overwrite the former.

Product and test source remain byte-identical to freeze05. Their prior actual verification remains
**535 Python passed /214 warnings**, **392 canonical Node passed**,115 JS/CJS syntax checks, scoped
Python Ruff/format clean and uncached full-Ruff JSON/stderr exactly equal to the retained18-diagnostic
baseline. No tests are rerun for this narrative-only bridge and no new passing receipt is inferred.

Still pending or outside this bounded run: local Git approval and integration; full affected Task
Inspector/Session Review/rating-administration UI native compatibility; native interleaved Discard/
Refresh race and lost-ACK scenarios; unbounded contrast/all elements/states, focus/hover/disabled
tracks and all-frame transitions; physical touch, screen-reader and other engines; explicit human
review/acceptance; and whole25 delivery. Known partial-write/lost-response uncertainty remains:
no atomicity, idempotency, exactly-once, cross-tab or persisted-draft guarantee is added. API fixture
CRUD does not close the UI compatibility gap. The issue stays **in-progress**, with no blanket
acceptance check-off or claim of release, push, PR or dev merge.

Parent released freeze05 only for this evidence file and the ticket15 issue metadata. All476 source
hashes matched freeze05 before these edits. Final `frozen-source-20261113-06.json` and its tracked
patch pin the exact two-path metadata bridge; every product/probe/other-doc/test byte stays unchanged.
The reviewable next decision is explicit local Git approval/integration disposition of this frozen
candidate under the existing review gates. That decision remains with the owner/parent; this evidence
creates no approval or permission. Further edits require an explicit freeze release.


## Bounded software closure (2026-11-13)

Ticket15 is recorded as **completed** under the local tracker's bounded software-delivery convention.
This supersedes only the earlier candidate/pending-compatibility/local-authorization wording above.
It does not claim human acceptance, complete shared manual acceptance, whole25 completion or release.
The owner explicitly authorized local ticket updates, commits and integration; this editor performs
only metadata changes. Parent closure review and commit/integration disposition remain separate.

Candidate HEAD is `563a7838a3fa52c6b7a31925ae860559ea79645f` plus fourteen Day feature paths,
not HEAD alone. The integrated source manifest binds 482 files, all fourteen feature hashes unchanged
from freeze06, with exactly ten incoming Ticket06 paths. The parent reports clear independent
Standards and Spec source reviews; this closure edit is not a new source review. Product/probe/tests
and development documentation are unchanged. External source manifest and exact receipt links below
remain authoritative.

## Seven acceptance criteria reconciled

| Criterion | Evidence and bounded assessment |
| --- | --- |
| 1. Closed bottom history; one other-day editor; duplicate exclusion; retained hide/switch/promotion drafts | Supported by [native-v2 browser result](/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-15/native-run-v2/browser.json), Day groups 1–2, and canonical ownership regressions in the integrated run. Native group 2 exercises real B Save/Dismiss/Discard and retained promotion. Human interaction acceptance remains separate. |
| 2. Unique/scoped rating identities, load/dirty ownership and no same-definition cross-writes | Supported by native-v2 groups 2, 4–5 and actual B persistence snapshots; integrated ownership controls pass 69 cases, including stale definitions and rejected hydration. [Compatibility browser result](/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-15/compat-run/browser.json) adds actual Session/Task controls, writes/readbacks and cross-context preservation. No cross-tab or persisted-draft guarantee follows. |
| 3. Enter/Ctrl+Enter; existing policies; honest partial/failure recovery | Native-v2 group 6 exercises public keyboard behavior; groups 4–5 prove known day/first-rating ACKs are not resent and only the failed rating is retried, with held ACK/concurrent-draft ownership. Native-v2 repair groups prove changed-range raw 4 remains visible under 10..20, blocks writes, correction 12 persists, and dirty deleted definitions require explicit Discard. Compat proves real required Session/Task controls and valid saves. Full existing policy tests pass; native empty-required/dismissal/exemption/reset/delete policy coverage is explicitly incomplete. Lost-response uncertainty remains. |
| 4. Single full-width Activity/Tasks presentation, aligned switch, 13px labels, hours, large rows, no percent column | Supported by frozen implementation/producer evidence and native-v2 group 7: 32 width/theme combinations with descendant/control bounds and larger breakdown targets. This is sampled presentation evidence, not comprehensive accessibility acceptance. |
| 5. Recorded-session counts, created-day task counts, full-day denominator, caveats, independent filters | Supported by focused real-app Day API tests (3 passed), integrated ownership regressions and native-v2 group 3. Native handoff readbacks retain the unmodified day-summary/task/session data. Scheduled/fan-out labels do not claim performed-time accounting or disjoint totals. |
| 6. Real Calendar date/tag/task handoff and persistent chip, stale/partial/hide/switch tests, no completion/schedule mutation | Native-v2 group 3 proves actual date/tag/chip handoff. New [handoff browser result](/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-15/handoff-run/browser.json) proves actual Day Tasks task UUID → Calendar task-name chip with exactly linked recorded ID, followed by actual navigation back and Direct Session Log → `__none__` chip with exactly direct ID, excluding the other row and inherited cross-filter. Public API snapshots are unchanged; no task completion/session edit/delete/schedule write is allowed. Stale-load/partial/hide/switch coverage is separately supplied by native-v2 and integrated regressions, not inferred from these two handoff groups. |
| 7. Shared acceptance, focused evidence, honest gaps, isolated/fake-provider work | Automated candidate checks pass as bounded below; native receipts show source pinning, guarded disposable synthetic fixtures and owned daemon shutdown. Manual races, full accessibility, explicit human and whole-25 acceptance remain outstanding. Therefore this criterion supports bounded implementation delivery only; blanket shared/human acceptance must remain unclaimed. |

## Exact verification receipts

[Integrated validation](/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-15/integrated-validation/report.md), with [status](/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-15/integrated-validation/status.json):
537 Python passed / 214 warnings; 397 canonical default-isolation Node cases passed;
3 focused Day API, 69 ownership and 19 Calendar controls passed (overlapping, not additive).
All 118 JS/CJS files parse. Scoped Python Ruff/format and whitespace checks pass.
Full Ruff exits 1 with exactly the eighteen inherited diagnostics and zero new diagnostics;
retained output comparisons distinguish that baseline from a clean full-Ruff pass.
The report preserves the initial setup and two evidence-helper failures and their corrections.
No native rerun was performed by this integrated tester.

[Native-v2](/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-15/native-run-v2/browser.json) and [controller disposition](/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-15/native-run-v2/disposition.json):
actual browser exit 0, seven Day groups plus three real API definition-repair groups, not assertion
totals; 32 layouts / 192 first-visible opaque-RGB text samples, minimum contrast
6.443541189917267. Only the declared one-time second-rating HTTP 400 was fake; no successful ACK
or readback was faked. Page/driver/source-pin/guard/handler/capture/request errors are empty.

[Compatibility](/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-15/compat-run/browser.json) and [controller disposition](/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-15/compat-run/disposition.json):
actual browser exit 0, three groups: Session Review note/score Save and readback; Task Inspector
review/rating Save and readback; actual Custom Ratings add/range-edit/confirmed-delete and retained
Day Refresh. No fake replies. There are 69 browser responses and 99 original API capture records;
no guard, capture, handler, request, page, driver or pin errors. These bounded existing-caller checks
do not claim Ticket 16/17/18 redesign delivery or exhaustive administration-policy coverage.

[Handoff](/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-15/handoff-run/browser.json) and [controller disposition](/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-15/handoff-run/disposition.json):
actual browser exit 0, two new task/direct-session handoff groups; 136 browser responses and
160 original API captures, zero guard/capture/handler/request/page/driver/source-pin errors,
no fake replies. This closes the previously disclosed actual task/direct handoff evidence gap;
it does not repeat or expand the prior tag, Day, repair or compatibility matrices.

Each of these three passing native controllers records one SIGTERM to its own daemon, actual
exit -15, reap, process absence, connection refusal 111, logical storage equality after shutdown,
and absent key/timer files. Browser receipts retain `featureAcceptance:false`; controller success
is bounded execution evidence, not a substitute for the owner's acceptance.

## Preserved limits and remaining gates

The original [native run](/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-15/native-run/browser.json) remains failed (browser exit 1), with its one
read-only Calendar-overlay CDP response body UNKNOWN. The second run changed only the probe's
Calendar readiness wait before leaving the page; it did not repair product bytes or reconstruct
the missing body. Both receipts stay authoritative for their respective runs.

The two identified source defects—initialized rating refresh and stale Discard invalidating a
winning Refresh—have regression coverage and the reported clear independent review disposition.
Native interleaved Discard/Refresh races, delayed definition/summary reads during retained draft
edits, lost acknowledgement recovery and broader failed-refresh timing remain manual/native
coverage gaps, not newly confirmed defects. Partial writes remain separate HTTP writes: a lost
response may have persisted, and no atomicity, idempotency or exactly-once guarantee exists.

Remaining human/presentation work includes complete focus/trap/Escape/restoration and editor
shortcut checks across relevant flows, touch alternatives, long text, zoom/reduced motion,
focus/hover/disabled/error states, all elements/backgrounds/animation frames, physical touch,
screen readers and other browser engines. The sampled contrast measurements cannot certify these.
Explicit human review/acceptance and final whole-25 integrated checks plus independent review
against `82fabdc652c59da87de0f57d7770d0aa32fb7f64` remain mandatory before whole-delivery completion.

Disposable native runtime/storage evidence is legitimately retained. The integrated tester alone
removed its newly allocated private venv/runtime with an empty data directory, as disclosed in
its status record; this does not imply other retained runtimes were cleaned or authorize cleanup.
No personal data, paid/live provider testing, acceptance waiver or release authorization is inferred.
