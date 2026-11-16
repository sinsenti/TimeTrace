# Ticket 12 — structured widget builder checkpoint

Implementation prepared on `feat/ui-redesign-12-structured-widget-builder`, base
`dd1399487172ab08516ace6ce6e88979ae1f63b1`. **Uncommitted; independent parent browser/review,
latest reviewed integration reservation/FF, and acceptance remain pending.** Ticket status and spec
status are unchanged. This is not ticket completion or merge permission.

## Scope and authorization

The launch brief explicitly released implementation after ticket 11 closure. Changes are confined to
builder JS/modal, new scoped CSS, the Statistics CSS include and dedicated tests/evidence. Parent
additionally authorized two bounded exceptions after actual failures:

- Widget-only DOM fixture repair in `tests/test_draft_ownership.cjs`: standard SELECT options/
  selectedness, HTML descendants and cloning. All existing assertions/names/failure fixtures remain.
- `core/query_compiler.py`: two projection-aware enum/column mappings. Tagged-session grouping
  incorrectly referenced original `s`/`t` aliases outside their CTE; the same confirmed defect affected
  estimation-bucket/category/status/priority grouping. Both actual API REDs preceded minimal repairs.
  No changes to measures, filters, parameters, time, attribution, API, schema or services.

Canvas, shared settings/client/appearance, query vocabulary/registry, seeds and SQL sandbox remain
unchanged. No performed preset, recorded-label adoption, SQL layout adoption, global date filter,
new dependencies or ticket 13/14 work.

## Criterion evidence

| Ticket criterion | Implemented / exercised |
| --- | --- |
| Published builder expressiveness | Capabilities-driven sources/measures/dimensions/filter fields; all 11 filter operators; up to 20 conjunctive filters; exact typed JSON-array values or comma-separated strings; both grouping dimensions; all six charts; explicit sort/limit/fill gaps. Title-only normalized queries roundtrip unchanged. |
| Independent ranges/baselines | Custom inclusive local dates and all existing presets; previous period/prior year/custom comparisons; real API leap-day/DST/week-start checks; Calendar comparisons align only on explicit interaction, not on saved hydration. |
| Attribution | Fan-out default with overlap explanation and response-driven warning; split evenly retained across edit/preview/save/reopen. Actual numeric query checks for both, including comparisons and null tasks. |
| Local context/warnings | Existing `getQueryContext()` request envelope; effective daemon zone/week-start/UTC bounds and warnings shown from response. No frontend bucketing/calendar arithmetic. |
| Compatibility/SQL/errors | Saved unsupported picker values remain explicit; unreadable specs cannot be overwritten; invalid date strings retained and locally validated. Optional SQL entry/mode/column/title ownership remains usable in explicitly HTTP-faked opt-in checks; real daemon flag remains false. No new sandbox claim. |
| Lifecycle/shared acceptance | Generation/selection/context/request ownership; failed/pending Save and no double activation; concurrent-field checkpoint preservation; ACK/read-failure Canvas recovery is refresh-only; Cancel/Escape no writes, focus restoration, native Tab/Shift+Tab trap, narrow/theme samples, inert long titles/errors. |

## Actual checks at frozen code/tests

External evidence root:
`/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-12/`.
Code/test manifest `review-code-tests.sha256`, manifest SHA256
`233b274ec709ef13063b4d0ebff28c16d18bce857cd95568353164e8e219e944`.
All manifest entries were rechecked after native runs.

- `uv run python -P -m pytest -q`: **414 passed, 198 warnings**. New dedicated API file:
  **58 tests**, 97 existing SQLite adapter warnings exposed by new synthetic executions.
- `node --test tests/*.cjs tests/test_tags_engine.js`: **167 passed**; no assertions removed/skipped.
- `node --check` every explicitly listed source/test JS/CJS: **64 passed** (`review-syntax.log`).
- Scoped Python Ruff passes. New API file format passes; both changed compiler ranges format-pass.
  Whole compiler format-check finds the pre-existing `_IS_DONE_SQL` wrapping at both HEAD and current
  source; unrelated formatting deliberately preserved. Whole-repo Ruff exits 1 with **18 baseline
  diagnostics**, stdout **and** stderr byte-identical to the shared recovered baseline.
- `git diff --check` passes; nothing staged.
- Native Chromium: seven dedicated probes **108 checks**, unchanged ticket-11 Canvas probe
  **89 checks**: **197 total, no pageerrors**. Read the `review-*.json` results, not just runner status.
  Real query/widget/session writes and public readbacks are distinguished from deliberate HTTP fakes.
- 24 bounded builder samples: 390/768/1024/1440 × three light options and dark counterparts.
  Minimum sampled label **12.0118:1**, primary **5.69859:1**, control border **3.62385:1**;
  no sampled dialog overflow. Screenshots: `builder-light-390.png`, `builder-dark-1440.png`.

## First failures and limitations

Retained first failures are not relabeled successful runs:

1. `vertical-red.json`: original first-filter truncation; first Green attempt then exposed missing
   Cancel focus restoration; `vertical-green.json` passes real full query/preview/save/reopen/ghost chart.
2. `lifecycle-red.json`: repeated pending Save allowed; `lifecycle-green.json` passes held real write,
   concurrent title/dirty state and ACK followed by failed Canvas read/refresh-only recovery.
3. `requests-red.json`: older preview replaced newer result; `requests-green.json` passes ownership.
4. `node-first.log`: 162/166 CJS passed, four standard-DOM fixture incompatibilities. Parent explicitly
   authorized widget-only helper correction; no production DOM guards or weakened assertions.
5. Controls probe first sampled before async modal hydration; parent notified, explicit readiness wait
   added. The next run exposed real **pre-existing** tagged-group SQL HTTP 500 (old daemon log retained).
   Original exact tag/task/typed-task-IN/duration/custom-baseline fixture was not recolored.
6. `tag-dimension-api-red.log`: eight initial alias failures. `expanded-alias-red.log`: 34 failures/
   two controls passed, including the six same-shaped estimation aliases. Minimal authorized maps fix
   them; `expanded-alias-green.log` and subsequent full/native checks pass. Compiler SQL before/after
   retained. Backend daemon was normally restarted so native Green uses new Python, not stale imports.
7. `final-widget_builder_controls.json`: background Settings pointer correctly blocked by modal.
   Parent authorized one explicitly scripted actual-anchor `el.click()` guard check. Corrected run
   preserves URL/exact draft/confirmation/no-write checks; this is not physical-pointer/keyboard
   departure proof. Tab/Shift+Tab/Escape checks use native keyboard events.
8. `context-red.json`: late capabilities opened old dashboard editor; `context-green.json` and final
   probes pass selection/context ownership and pre-write stale-editor blocking.

The API additions are supplemental characterization except the documented alias REDs; not every
existing supported behavior was newly developed by TDD. Native invalid-saved-detail fixtures also
exercise an intentionally malformed primary date against existing backend reads; the builder retains
and locally rejects the malformed date before Save. No service-validation semantics were broadened.

No physical touch, screen reader, other engine, exhaustive query cross-product, zoom/reduced-motion,
whole-app contrast/accessibility, real enabled SQL sandbox, or human visual acceptance is claimed.
Existing three light 4.33:1 task-title/four dark AI 3.98986:1 observations are neither fixed nor waived.
No blind lost-response exactly-once/idempotency guarantee.

## Isolation and handoff state

Own `.venv` and source were verified. NEW private scratch directory was created before app imports;
DB `/tmp/timetrace-ticket12.Heb8Cz/timetrace.db`, loopback **18173**, idle/tracing off, credential env
unset; browser contexts use fresh preferences and fake provider catalogs. No personal DB/key/data,
real provider, paid call, provider activation or inference was used.

Original own PID **378216** stopped normally before backend reload; socket checked closed. Current own
PID **402060** intentionally remains active for the parent's independent native gate until directed
normal shutdown. Health matches DB/port, migration `0013_ai_data_scope`, FK check empty. Latest
`/timer/status`: inactive, not frozen, no pending gap, idle false, null task, empty tags/notes. All
synthetic fixtures removed: task/session/habit/review/rating/provider/conversation/draft/audit counts
zero; Overview/nine unchanged seeds, default statuses/settings/FTS bookkeeping remain.

No stage, commit, push, PR, integration write, merge or cleanup of another process/worktree. Parent
owns genuine browser gate, independent Standards/Spec reviews, latest reviewed disjoint FF reservation,
commit and later closure. Shared documentation changes for the future serial merger: development map
should describe the full builder/preview and projection-alias repair after acceptance; no shared docs
were edited here.

## Fresh reviewed-F7 replay and verification — 2026-11-04

This continuation supersedes only the current-source/runtime pointers above, not the retained DD
history, REDs, grants or limitations. The later parent shutdown receipt confirms old PID402060 absent
and18173 closed after its independent initial197 gate. That old gate is not final F7 evidence.

Fresh worktree `/home/user/.local/state/timetrace-ui-redesign/ticket-12-builder-finalize`, branch
`feat/ui-redesign-12-builder-finalize`, started clean at exact reviewed parent
`f7c40c0233bfc98c81bab3921a4f95c253f314db` after ticket10 closure Standards/Spec passed. Only
01/02/04/10/11 are complete; this ticket remains pending. No unreviewed checkpoint dependency was
adopted. The original same-ticket DD worktree remains read-only with all16 hashes/status/index
unchanged. Parent's preserved patch/archive/manifest SHA256 values are respectively
`50a1e3951291a22e5e046bc9018845ab3020ed82ca52468e13ee10ab836155b0`,
`17631a987b44fd328a1abcc5703972d9dbc4d9febfda45a3f2a11f753ceb2e22`,
`f4687225ef1fadc1d81ed2cc82fdc0a29b200f3b0d5212789e7a8c0191d76602`.

All16 paths were preflighted in memory before writing:6 existing files/29 exact unique nonoverlap
hunks and10 absent new files, safe paths and predicted hashes. Because the worker had no dynamic
payload-to-tool facility, it prepared external byte-preserving JSON payloads and suspended source
ownership. During the explicit exclusive handoff, parent independently validated them and invoked
literal edit/write tools; no shell source writes, source retranscription, full-existing-file archive
overwrite, git apply/3way, staging or other-lane copying. Source ownership then returned to worker.
Initial shared test SHA is
`a9b502cbecb00b2229a2b0d60cc774167d22552ce9b64d79e71cb553df42abab`: reviewed04 Task ACK-before-
metadata timing and own Widget fixture both survive. Other15 paths initially match the checkpoint
exactly. All14 code/test paths remain those replay bytes; only this document and own issue append
current history. Payload index SHA:
`a8bfd8aac68347260ba9615bd02cf77e41142803338e110ce231f48416012c02`.

### Actual fresh checks and raw receipts

External root: `/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-12/finalize/`.
Parent replay preflight/tool/postflight receipts and initial/new/old hashes are preserved there.

- Own NEW `.venv` editable source points to this fresh worktree. NEW private0700 directory
  `/tmp/timetrace-ticket12-finalize.uh2t2xsb` was created before any app import/test; exact DB is its
  `timetrace.db`. Own actual `main:daemon_app` PID310294 on loopback18211 was checked free before
  startup; health matches DB/port, migration0013 and FK empty. Idle and tracing off, credential
  environment unset including Google ADC/Ollama; all native contexts fake provider catalogs.
- Focused API:58 passed/97 SQLite adapter warnings. Full safe-path pytest:449 passed/202 warnings,
  including existing SQLite deprecations and existing Pydantic datetime serializer warnings; not
  falsely described as SQLite-only. Node all CJS plus tags:214 passed. All explicit source/test
  JS/CJS syntax:82 passed. Logs: `python-{focused,full}.*`, `node-full.*`, `syntax.*`.
- Both changed Python files pass Ruff; new test and compiler ranges438–455/650–667 format-pass.
  Whole compiler formatting still fails only the old `_IS_DONE_SQL` wrap, independently reproduced
  from F7 and current source. Full Ruff exits1/18 baseline diagnostics, stdout AND stderr byte-match
  the fixed shared baseline; invalid-noqa warning remains. No unrelated cleanup. Whitespace passes.
- Unchanged Canvas89 ran FIRST, then all7 builder probes14+7+9+56+10+8+4=108:197 inspected checks,
  no pageerrors. Real query/widget/session writes, full saved roundtrip, primary+ghost charts,
  original typed-task/tag/custom-baseline Save, stale owners/context/preview, concurrent dirty fields,
  pending Save, ACK/read-only Retry, compatibility, native Tab/Shift+Tab/Escape and Cancel/focus pass.
  Seven external probe copies differ only at two screenshot destinations; original probe hashes
  remain unchanged. `native-summary.json` records every label, with complete `native-*.json`.
- 24 builder theme/width samples fit; minima label12.0118007, primary5.6985862, border3.6238540.
  New screenshots are in this finalize root, not overwritten old evidence. Sampling is not palette
  or accessibility certification. The Settings departure case remains a scripted actual-anchor click,
  not physical background-pointer proof. Optional SQL opt-in/schema/preview are explicit HTTP fakes;
  actual SQL flag stays false, no sandbox certification.

### Preserved new evidence-helper misses, not product REDs

After the unchanged suites passed, an external supplemental HTTP/compiled-SQL receipt helper passed
both real tag/task/typed-ID/custom-baseline attribution queries and saved/public readbacks. It captured
SQL plus bound UUID/`00123`/numeric60 values. Its added estimation query incorrectly used `task` as a
task-source filter; the registry does not publish that field, so API correctly400. Original script,
traffic, successful two-query proof, stdout/stderr and hashes remain unchanged (`supplement-first-
failure.sha256`). Parent approved one NEW estimation-only helper: remove the unsupported filter and
its now-inapplicable ID-binding assertion; preflight0tasks, retain strict row_count1/value1/accurate
keys for all6 category/status/priority orders, capture actual SQL/params, clean only own IDs. That
single corrected supplemental run passed6. The successful two session queries and suites were NOT
rerun. These helper results are not an all-first-pass claim or a new product/test change.

A first own-issue continuation edit was refused because its oldText was a paraphrase rather than the
actual paragraph; no file changed. All16 hashes were reverified, parent explicitly approved a re-read
and exact own-doc-only append. `doc-edit-refusal.txt` retains this inspection/edit miss separately.
Malformed saved-date compatibility still deliberately provokes the known backend read500
`ValueError: Invalid isoformat string: 'not-a-date'`; inputs are retained/locally rejected before Save.
It is not an alias500, accepted broad validation policy change or an uncaught browser pageerror.

Source is frozen unstaged for a genuine current parent browser gate, followed only by explicit release
for one coherent feature commit with exact F7 parent. Runtime intentionally remains healthy for that
gate; later external final report/cleanup receipt supplies final PID/socket/timer/row-count state.
No independent fresh review, commit, closure, human/whole25 acceptance, resource unlock, push, PR or
merge is implied here. All original manual, contrast, SQL, provider and transport-uncertainty limits
remain. Shared documentation/status closure is reserved for the later authorized merger.

### Subsequent genuine parent gate, explicit release and normal own cleanup

Parent independently executed Stats89 FIRST then all7 original builder probes108 on the frozen F7
source:197 inspected checks, all8 first-run exit0/zero pageerrors. All16 hashes remained identical
before/after; all14 code/test bytes match initial replay, including shared a9b identity. Parent verified
exact private DB18211/PID310294/cwd/env,0013/FKempty/inactive timer and all24 bounded samples. Only
its external Controls copy redirected two screenshot destinations. `parent-browser-gate.md`,
`parent-native-summary.json` and full `parent-browser/` receipts preserve independent proof.

Parent first tried parsing its153343-byte Canvas receipt through a50KB read and hit truncation; it
then read the complete file in20 ordered chunks. This is an inspection-only error, not a native
failure/rerun or weakened assertion. It remains distinct from worker supplemental400/doc-edit misses.

Parent explicitly released ONE coherent16-path feature commit with exact F7 parent. Only these two
owned docs may append this gate/cleanup chronology; code/tests remain gated bytes. Fresh independent
per-commit Standards/Spec and later reviewed integration/closure remain required. No human/whole25
acceptance, resource unlock, completion/spec Built, push/PR/dev merge follows from browser release.

Worker checked actual process identity/env/DB before signaling, canonical `/timer/status` and timer
file state, migration0013/FKempty and actual table counts. Synthetic task/session/habit/review/rating/
provider/conversation/draft/audit rows are all zero; one Overview/nine seeds, five default statuses,
AI settings and FTS bookkeeping remain. Own PID310294 only received normal SIGTERM through its
verified pidfd; exit event observed. Subsequent checks confirm PID absent,18211 closed and health
connection refused. The private DB/logs/venv are retained. `cleanup-before.json`/`cleanup-after.json`
are current; prior paragraphs describing a live gate-ready runtime are now historical. No other
process, timer, DB, worktree or source was modified during cleanup.

## Focused review repair on exact bc818e7 — pending parent gate

Fresh own worktree `ticket-12-review-fixes`, branch `feat/ui-redesign-12-review-fixes`, started clean at
`bc818e73ab08cd938465bc88adeb4fc586ef96fd`. Original feature and DD checkpoint remain read-only;
integration stays reviewed F7. No prior feature/gate history above is rewritten as current repair proof.
External raw receipts: `/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-12-review-fixes/`.

### Four product defects, genuine RED first, bounded repair

Original independent Spec review found exactly three unique blockers: stacked chart presentation P1,
unsupported multidimensional time gap fill P1, first-Remove stale preview P2. Parent separately found
weekday dimension-sort row loss: a fourth product defect, not another original-review finding.
Standards had zero hard breaches plus one possible caption-duplication P2 heuristic, non-blocking and
explicitly deferred; no optional extraction is bundled.

- Unchanged-bc actual API: two synthetic tasks sharing one local hour produce two control rows but
  filling returns only one survivor/24. Weekday control returns four rows but filling keeps two/7.
  Separately, fillfalse weekday dimension asc/desc with firstDay0/1 returns two instead of four.
  `api-red-{traffic,findings}.json` retains requests/responses. Parent reviewed these actual REDs and
  source before granting two precise QueryService hunks: analogous hour/weekday second-dimension
  rejection, preserving existing calendar messages; stable weekday rank ordering preserving all
  known-key rows and incoming secondary SQL order, retaining unknown-key exclusion. No aggregation,
  Cartesian fill, time/attribution/compiler/registry/schema/API/sandbox policy change.
- Unchanged-bc native Save/reopen really renders four repeated day bars in one dataset, with no stacked
  axes/legend. Corrected-oracle RED uses existing human day labels, not ISO keys. Renderer-only fix
  pivots unique typed primary keys and distinct secondary keys, never human-label grouping or sums.
  Missing cells are null, explicit zero/negative/null survive; baseline ghost uses a distinct stack.
  DatasetIndex/xIndex maps to the exact source QueryRow; missing cells have no forged click target.
  Actual populated two-day/category native Save/reopen now has two slots/two [1,1] series. A separate
  hour/task comparison has duplicate human task labels but four exact primary/ghost series. A physical
  native second-day edited-seed segment click requests day-summary for the correct raw 2024-02-26 key.
- Local builder validation blocks unsupported multi-time fill before Preview and Save, retaining
  checkbox/dimensions/exact typed filters/raw saved specs and dirty ownership. Direct API now returns
  useful400 instead of row loss; frontend-only success is not substituted for backend verification.
- First Remove explicitly calls the existing preview invalidator after synchronization. Completed
  preview clears immediately to outdated status; held pre-Remove reply cannot restore it. Existing
  snapshot-based held-table prevention was already a passing control, not claimed as a new defect.
  Both native row types produce no implicit query/widget write; other lifecycle/focus hooks survive.

### First failures and authorized bounded oracle/fixture corrections

Every first failure remains external, separate from product RED and final success:

1. Initial shell used absent `python`, then attempted to source an uncreated env file; `uv sync` created
   only the new own venv. No app import/test/runtime occurred before the new0700 DB directory. Corrected
   setup uses `python3`/`set -e`; the first3s health request preceded migration readiness and refused.
   Actual daemon subsequently completed0013 normally. No personal DB/key/env was reused.
2. First native oracle expected ISO day labels instead of existing human Feb25/26. Parent approved one
   label-only correction and splitting held no-repopulation control from missing outdated-status RED.
   Original probe/hash/raw and exact correction diff remain; corrected unchanged-bc RED was recorded
   before production edits. Runner exit0 with verdictRED was never called passing.
3. First own API green attempt:71 passed/4 failed because the test incorrectly reversed secondary task
   order for dimension_desc. Protected compiler only orders dimension1. Parent approved one correction
   comparing complete ordered keys to real incoming compiled-SQL order within literal weekday buckets,
   retaining exact four-row/keyset/value/count/label/weekstart/comparison assertions. No product/compiler
   change forced the bad expectation. Original10failed/7passed RED and failed green attempt remain.
4. New native legacy-fixture POST correctly400 after validation repair; parent approved one fixture-only
   correction. External helper verifies exact own PID/cwd/env/health/privateDB, creates two valid
   fillfalse widgets by real API, then parameterized CAS updates only those captured spec_json rows to
   legacy filltrue (exactly2 rows). All other fields/rows/tables are unchanged; ACKs/raw before-after
   specs/ownership manifest/public readback retained. Corrected native uses exact nonce-owned IDs via
   real GET/DOM; cleanup deletes only its fixtures. This is explicit legacy simulation, not an invalid
   HTTP Save, a response fake or production bypass. Comparison/physical-click assertions are unchanged.

Earlier original500/34RED+controls, supplemental helper400/correction, no-write doc-refusal and parent
truncated-JSON inspection history remain above and in original external receipts, never erased or
relabeled all-first-pass.

### Current checks, isolation and pending gate

- 75 focused API pass/121 warnings;466 full Python pass/226 warnings (+17 vs449 baseline, +24 warnings).
- 220 all-CJS+tags pass (+6);85 all source/test JS/CJS syntax pass (+3), including final corrected probe.
- Scoped Ruff and both changed Python files' formatting pass; full concise `ruff check --no-cache
  --output-format concise .` exits1 with the same18 diagnostics AND identical stderr warning bytes
  against fixed finalize baseline. No unrelated formatting/compiler cleanup.
- Current-source Stats89 FIRST then all7 unchanged builder108 pass/zero pageerrors. New native repair13
  and controls20 pass/zero pageerrors. Raw labels/real payloads/charts retained;230 checks, not a whole
  query-cross-product certificate. Only two external Controls screenshot destinations differ from the
  original probe.24 theme-width samples fit, minima label12.0118/primary5.698586/border3.623854 unchanged.
- New private0700 `/tmp/timetrace-ticket12-review-fixes.30b614j9` existed before all app imports/tests;
  own fresh venv/editable source, loopback18217, idle/tracingOFF, all inherited credentials including
  Google ADC/Ollama unset, catalog fake, actual SQLfalse. Initial own335419 normally stopped after
  identity/timer/DB audit; service fix runs on new verified347616. Actual main0013/FKempty/health exactDB.
- Scope: only `dashboards.js` renderer, builder extraction validation, modal first-Remove, two granted
  QueryService hunks, four new regressions, two own docs append. Shared a9b fixture, compiler aliases,
  other helpers and original probes remain unchanged. No migration/dependency/other-lane adoption.

Source is held unstaged for a genuine independent current parent gate; no stage/commit until explicit
release of one exact-bc-parent repair. Fresh independent Standards/Spec on both bc→fix amendment and
F7→fix combined range, then separately authorized integration/closure remain mandatory. No completion,
spec Built, global docs,19 release,13–14 unlock, push/PR/dev merge or human acceptance is implied.
Physical touch, screen reader, other engines, exhaustive zoom/motion, whole-a11y, query cross-product,
real-enabled SQL/provider calls and transport/exactly-once/cross-tab claims remain unrun/unwaived;
known4.33/3.98986 observations remain limits. Runtime stays healthy for parent gate; subsequent external
report/cleanup receipt will supersede this live checkpoint, not rewrite it.

### Independent parent gate, recovery release and normal cleanup

Parent's genuine independent gate inspected Stats89 FIRST, seven builder108, populated repair13 and
controls20:230 passing labels, zero pageerrors; main result explicitly verdict PASS/failures empty.
Actual Chart cells/stacked axes/legend, duplicate-human-label primary/ghost stacks, physical second-day
seed-segment click/real inspector, both retained invalid saved combinations and both Remove controls
passed. Existing older-response no-repopulation behavior remains a control, not a newly fixed defect.
Parent receipts are `parent-browser-gate.md`, `parent-native-summary.json` and `parent-after.json` in the
external repair evidence root. This is supplied parent execution, not a finisher native rerun.

The first parent controls attempt failed its immediate hydration read. Async Edit clears/hides the
form until capabilities/hydration finish; no failed DOM snapshot proves exact timing. Explicit grant
allowed only six public readiness waits at three Edit sites: visible modal and enabled Submit. Every
original assertion and all production bytes remained unchanged. Parent reran ONLY corrected controls20
once with a fresh nonce-owned historical legacy fixture; other nine passing probes were NOT rerun.
Two real-API valid fillfalse widgets were parameterized-CAS seeded to legacy filltrue, exact IDs/specs
and unrelated rows checked, then own fixtures cleaned. This remains a labeled historical simulation,
not invalid HTTP Save, policy bypass or response fake. First parent failure/raw/probe SHA remain.

Prior worker60ae25fb-41b1-4053-a348-7c933c9cc51f terminated on provider `fetch failed` after an external
artifact reconstruction assertion dropped the original probe's final newline. The helper failure was
metadata-only; parent reconstructed the original exact hash with newline intact, preserved all10 paths
and archive, and proved only the six waits changed. Original worker-report.md was never produced and
is not invented/backfilled. Refreeze receipt and post-readiness manifest remain in `parent-recovery/`;
manifest SHA256 `43b2cac7a3b6ad08768e16dc6e848f3ba30a2cb981d47e35851b0a28705ac331`.
All prior setup/oracle/fixture failures and original500/helper400/doc-refusal/inspection errors above
remain historical evidence, not all-first-pass claims.

After operator continue and parent confirmation of no active writer, explicit exclusive release
permitted only two own-doc appendices, normal verified own cleanup and ONE coherent10-path repair
commit with exact single parent `bc818e73ab08cd938465bc88adeb4fc586ef96fd`. The fresh finisher verified
HEAD/branch/empty index/exact10 dirty paths and all10 manifest hashes before editing. All eight gated
code/test files remain byte-identical, including controls SHA256
`862951deb08e58002e4b1820d4ec74d6dd21879d30909144c2548eec9797c7f2`.
No implementation, fixture, assertion, harness, compiler, policy or global-doc change was made during
finishing. Producer checks75 focused API/121 warnings,466 full Python/226 warnings,220 canonical Node,
85 syntax, scoped lint/format and full concise Ruff18 stdout AND stderr fixed-baseline identity were
independently inspected by parent; these are retained producer receipts, NOT finisher reruns. No app
imports, tests, native probes, full checks, new venv/DB or daemon startup occurred during finishing.

Finisher verified existing PID347616's exact source cwd/cmd, executable/editable source, whitelist env,
credentials absent, idle/tracing/SQL false, health18217 and exact private0700
`/tmp/timetrace-ticket12-review-fixes.30b614j9/timetrace.db`. Canonical `/timer/status` AND
active_timer.json showed inactive timer, idle false, no frozen state/pending gap/task/tags/notes.
SQLite was opened mode=ro/query_only only: migration0013_ai_data_scope, FK check empty, actual every-table
counts matched parent-after. Synthetic domain/AI data are zero; Overview1/widgets9, default statuses5,
AI settings1, migration1 and FTS bookkeeping remain (data10/idx8/config1, other FTS counts0).
Only this identity-verified process received normal SIGTERM through its retained pidfd; exit event,
PID absence,18217 closed/connection errno111 and health connection refusal were proved. DB, logs and
venv retained; no other process/storage/worktree modified. External `finisher/cleanup-before.json` and
`cleanup-after.json` supersede the preceding live-runtime checkpoint without rewriting its history.

External `recovery-finisher-report.md` records actual final commit SHA, exact parent/path scope,
all10 tree/worktree identity, eight gated hashes, clean worktree/index and preserved DD16/status,
original clean bc feature, clean F7 integration and shared a9b fixture proofs. Fresh independent
Standards/Spec reviews must cover BOTH amendment bc→repair AND combined F7→repair, followed by
separately reviewed merger closure. Three original Spec defects plus one parent weekday-loss defect
remain four product repairs; zero hard Standards breaches plus ONE possible nonblocking P2 caption
heuristic is explicitly deferred, not zero overall findings or a policy waiver. Ticket remains pending,
status/criteria unchanged, spec Approved NOT Built. No downstream19 release/13–14 unlock, global or
whole25 completion, human acceptance, integration write, push/PR/dev merge is authorized here.
Known task4.33/four dark AI3.98986, physical touch/screen reader/other engines/exhaustive zoom-motion-
contrast/query cross-product, real enabled SQL/provider and transport-uncertainty limits remain unwaived.

## Duplicate serialized-key collision repair on exact a521 — pending independent gate

Fresh full Standards/Spec reports in `review-ticket-12-repair/summary.md` identify ONE new unique
Spec P1 applying to both amendment and combined ranges, not two findings: legitimate SQL NULL and
empty category groups both serialize to empty-string keys, and the new pivot overwrites one cell.
The earlier four product fixes remain distinct from this fifth historical product defect; Standards'
possible nonblocking caption-duplication P2 heuristic is still explicitly deferred, not zero findings.
No new product specification or backend serialization/comparison-policy change is authorized.

New clean worktree `ticket-12-stack-collision`, branch `feat/ui-redesign-12-stack-collision`, starts at
exact `a52157008379db0525bdca51dbc0f7cd41e6f59d`. Only production edit is inside dashboards.js
renderChartWidget: detect repeated actual typed primary/secondary pairs BEFORE pivot, explain the
fallback visibly using existing text/theme tokens, and show separate full-label/row-ordinal bars.
Every input row/value remains in source order, including null/zero/negative primary and supplied
baseline cells; click indices retain exact raw source objects. No sums/merging/dedup/new IDs/rekeying,
implicit Save/spec mutation, service/compiler/registry/API/schema/time/comparison policy changes,
new palette, or unrelated chart/lifecycle changes. Only new owned CJS/native regressions and these
two append-only owned documents accompany it; existing six stacked tests and shared a9b fixture
are byte-identical. All other production files remain unchanged from a521.

Evidence root: `/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-12-stack-collision/`.
`api-characterization.json` and full traffic characterize the unchanged real API: exactly two
same-day/category serialized-key rows, values1 and2, labels/order captured from actual API rather
than invented dates/secondary sort. `cjs-red.stdout` shows genuine actual[2] versus expected[1,2]
before production edits, consuming that real response. Native original attempt400 was a fixture
mistake: day/week/month comparison requires dense fill, while two-dimensional calendar fill is
unsupported. Original source/hash/raw400 are immutable. Parent approved ONE probe-only correction:
keep original day/category cell-loss assertions unchanged, use separate legal hour/category
comparison with fillfalse/custom ranges, derive every expectation from actual API response, keep
physical edited-seed day/date inspection, and correct only the previously unexecuted public Close
Inspector locator. Corrected unchanged-a521 native returns genuine RED with10 failures/11 passing
controls, actual primary[2] and one slot, not a mere runner-exit claim. Green after renderer edit:
22 checks, failures[], verdict PASS, zero pageerrors; no further oracle correction or test weakening.

New CJS4 plus unchanged stacked6 pass: captured API rows, repeated-cell null/zero/negative/order/
counts/source-object identity on primary AND baseline clicks, same labels/different keys normal
sparse stacks, no spec/result mutation, lifecycle disposal/live-theme registry. New native collision22
uses real query/widget/task/session APIs and actual Chart; inert untrusted title, visible explanation,
public Edit modal visible/Submit enabled before assertions, Cancel focus restoration, no render/
reopen/theme writes, primary[1,2] and all supplied baseline cells, physical second-row edited-seed
click/raw API-derived day/real2-session inspector. Four sampled theme notice contrasts range
12.0118–14.9873:1; not exhaustive palette/zoom/accessibility certification. The legal comparison API
itself supplies primary[1,2], baseline[2,2]: QueryService._apply_comparison's existing by-key baseline
map (query_service.py:484) collapses NULL/empty baseline identity. This repair preserves [2,2]
exactly and does NOT claim to repair that pre-existing backend ambiguity or invent a missing row.

Fresh current-source producer native sequence: Stats89 FIRST, all seven builder108, earlier review13,
controls20 =230 passing labels; plus collision22 =252 total, zero pageerrors. All first attempts in
that final old-probe sequence passed. Prior original failures above remain historical, not erased or
relabeled all-first-pass. Provider catalog is always faked; old probes explicitly fake held/failing
HTTP and optional SQL flag/schema/preview. Actual SQL flag stays false, no provider call. Controls
historical invalid specs are NOT invalid HTTP Saves: fresh unique valid API dashboard/two fillfalse
widgets followed by external parameterized exact two-row SQLite CAS false→true, all unrelated fields/
rows/tables unchanged, public readback and own-ID cleanup. External helpers derive only18217→18219,
old→new DB/source/runtime bindings; reversible path-only diffs and SHA receipt retain ALL original
identity/safety/CAS assertions. Producer manifest has a fresh UUID; parent must independently produce
a fresh manifest with TIMETRACE_REVIEW_LEGACY_MANIFEST, not reuse cleaned producer IDs.

Fresh full safe-path pytest:466 passed/226 existing SQLite warnings (no added Python test). Canonical
all-CJS plus tags:224 passed, no failures/cancelled/skipped/todo (+4). ALL src/test JS/CJS explicit
paths:87 syntax passes (+2). New tracked Python lint/format is not applicable; no Python source/test
edit. Full `ruff check --no-cache --output-format concise .` exits1 with18 existing diagnostics;
BOTH stdout and stderr byte-match the fixed finalize baseline, including existing invalid-noqa warning.
No schema/migration or personal/disposable-personal-copy test is involved. Scoped whitespace check
passes. Raw commands, exit statuses and counts are retained in external logs/report.

Before ANY application import/test/runtime, created new private0700 absolute
`/tmp/timetrace-ticket12-stack-collision.4l259qso/timetrace.db`, own new .venv with editable source
pointing only to this worktree, free loopback18219; idle/SQL/tracing off, credential/Google ADC/Ollama
environment absent, no personal DB/copy/key/provider/paid call. Actual daemon main migrated through
0013_ai_data_scope; FK check empty, health exact DB/port/source PID/env verified. After producer
fixtures, synthetic domain/AI rows zero; Overview1/widgets9/default statuses5/settings1 remain,
with actual FTS bookkeeping documented in producer-after.json. Runtime remains alive for the
BLOCKING genuine independent parent browser gate; nothing staged or committed. All actual owned
paths, complete patch, code/test hashes, commands and PID/URL/private DB/env are frozen externally
before requesting that gate. No source edits during freeze. Cleanup only verified own PID after
explicit gate/release through canonical timer/status+file/0013/FK/count checks, normal SIGTERM and
PID absence/port closed/health refusal, retaining DB/logs/venv. No commit release inferred from pass.
Fresh independent Standards/Spec must cover BOTH a521→new and F7→new; one shared defect counted
once and axes separate. Ticket remains pending/spec Approved NOT Built; no integration/19 release/
13–14 unlock/global status/human/dev-merge/push/PR/whole25 claim. Existing4.33/3.98986 contrast,
touch/screen reader/other engines/exhaustive zoom-motion/query cross-product/real SQL/providers/
transport limits remain unwaived. External worker-report.md is a durable checkpoint, not prior
missing-report backfill or independent review acceptance.

### Genuine independent collision gate and released normal finish

Parent independently executed all11 current frozen-source probes: Stats89 FIRST→seven builder108→
review13→controls20→collision22 =252 inspected labels, all first-run exit0/zero pageerrors; main and
collision explicitly verdict PASS/failures[]. `parent-browser-gate.md`, `parent-native-summary.json`,
`parent-after.json` and raw `parent-browser/` are the independent receipts, not worker-only claims.
All five frozen SHA values before/after, index empty/exacta521, shareda9b and original checkpoints
preserved. Parent's fresh independent nonce-valid API/two-widget/two-row-CAS legacy fixture retained
all other fields/rows/tables and was cleaned by owned IDs. Only two screenshot destinations changed
in an external controls copy; no source/probe fix, expected-value wait, forced click, recoloring or
native rerun. Actual fallback[1,2]/full labels+ordinal/inert explanation, unchanged saved stacked spec,
focus/no writes/all4 notice themes/minimum12.0118:1, physical second source row/raw date/real2-session
inspection and legal comparison's supplied[2,2] all passed. That existing backend alignment ambiguity
is not repaired or disguised. Producer first400/approved correction/genuineRED and all earlier
historical failures remain immutable; no whole-delivery all-first-pass claim.

Parent explicitly released ONE coherent five-path repair with exact single parent
`a52157008379db0525bdca51dbc0f7cd41e6f59d`, no three gated code/test changes; only these two owned
documents append gate/cleanup history. No completed test/native/full-check reruns after doc append.
Before staging, fresh normal own cleanup first stopped at os.pidfd_open: this own Python3.14 build
lacks that stdlib attribute. It failed BEFORE process/DB/HTTP audit or signal; raw cleanup.stderr,
unchanged cleanup script and capability proof are retained. This is a platform-helper setup failure,
not application RED. Parent approved ONE command-only correction: execute EXACT unchanged stdlib
script via `/usr/bin/python3 -P` under env-i with explicit private DB, not weaken assertions or use raw
PID signaling. Both system pidfd functions exist; application daemon/tests remain Python3.14.

Corrected cleanup verified only PID417887's exact source cwd/cmd/editable-source JSON, environment
credentials absent/idle-SQL-tracingfalse/private0700 exact DB/18219 health. Canonical `/timer/status`
AND active_timer.json inactive/idlefalse/not frozen/no gap/task/tags/notes; read-only SQLite URI
mode=ro/query_only verified0013_ai_data_scope/FKempty and actual ALL-table counts equal parent-after.
Counts: all synthetic task/session/review/rating/habit/recurrence/AI/provider/audit rows0; Overview1,
widgets9,statuses5,settings1,migration1; FTS data12/idx10/config1,otherFTS0. Only identity-verified
pidfd normal SIGTERM was sent; exit event, PID absence,18219 connect errno111 and health connection
refusal proved. Private DB/logs/venv retained. `cleanup-before.json`, `cleanup-after.json`,
`cleanup-system.stdout/.stderr`, interpreter capability/version and unchanged script SHA receipts
provide actual cleanup evidence. No other process/storage/worktree was touched.

External worker-report.md and final commit receipts identify actual commit, exact single parent,
exact five paths, unchanged three gated hashes, append-only docs, staged/committed patch identity and
clean final worktree/index. Original DD16/status, clean originala521/bc and integrationF7 remain
read-only/preserved. Fresh independent Standards/Spec BOTH amendmenta521→new and combinedF7→new,
then separately reviewed merger closure remain mandatory. No ticket closure/specBuilt/global status/
19 release/13–14 unlock/integration/human/dev-merge/push/PR permission is inferred. Caption heuristic
and old comparison ambiguity remain explicitly deferred/out of scope; all previous contrast/manual/
realSQL-provider/query-crossproduct/transport limitations stay unwaived.

## Local integration and bounded closure draft (2026-11-04)

**Code integrated; closure NOT committed/released.** Clean integration F7
`f7c40c0233bfc98c81bab3921a4f95c253f314db` fast-forwarded ONLY to exact reviewed
`c37c81b00c8f9928480942eb6bbb3d90638e7f9e`: three commits/24 paths, no merge commit/source copy.
Combined diff SHA256 `0b704681569681b5088aa38dc43a3e2c95567d84481db55153bc84f98e69849a`
matched the reviewed bytes. Fresh Standards and Spec reports on BOTH a521→c37 and F7→c37 were
fully read: Standards amendment0/combined0 hard breaches plus ONE possible nonblocking P2 caption
heuristic, explicitly deferred; Spec0 both ranges. Code acceptance is not whole-app/human acceptance.
Original three Spec defects + separate parent weekday defect + collision defect are five historical
product defects, not five original review findings. All history above remains chronological evidence.

### All six unchanged issue criteria — bounded evidence

| Criterion | Actual implementation and fresh evidence | Limits |
| --- | --- | --- |
| Full published builder/edit/validation | `widget_builder.js`/modal/scoped CSS expose all capabilities, 20 conjunctive filters/typed arrays, two dimensions/six charts, sort/limit/fill, faithful edit/reopen and inert preview/validation. Dedicated58 API tests plus review17, structured14/controls56/saved8 native checks passed. Two hardcoded compiler projection-alias loops retain tagged-session and task-estimation grouping; no capability removed to avoid their original500. | Not an exhaustive query cross-product or a claim every case began as TDD RED. |
| Independent ranges/baselines | Dedicated API covers leap/DST/week/custom boundaries; structured14 retains custom dates, all three typed filters, limit37/split/prior-year comparison through title-only Save; main/request/context native checks exclude stale reads/owners. Normal review stacks retain exact sparse cells, separate primary/ghost stacks and source-row clicks. | No global dashboard filter/arbitrary IANA bucketing. Collision comparison's supplied baseline ambiguity below is UNWAIVED. |
| Fan-out/split | API/compiler regressions check actual numeric fan-out/split and comparison values; controls56 keeps fan-out default/overlap explanation; structured14 retains split-evenly. | Overlapping fan-out totals are labeled, not conflated with performed work or summed into a new policy. |
| Local start day/context | Existing structured compiler/QueryService own local session-start bucketing; explicit timezone/week-start request context and effective response bounds/warnings appear in preview. Two narrow service repairs reject destructive hour/weekday multidimensional fill and stably order ALL secondary weekday rows; focused75 includes exact four-row/order/context tests. | Daemon-zone fallback/warning remains; no frontend rebucketing or time-policy change. |
| Compatibility/independent SQL/errors | Saved8 retains unavailable/invalid inputs, blocks unreadable overwrite; initialization10 keeps optional SQL entry separate. Review13 + fresh legacy controls20 retain historical invalid fill drafts, no Preview/Save requests or destructive rewrite, both Remove invalidations. Collision22 preserves every duplicate serialized-key source row/full labels/ordinal/inert explanation/physical clicked raw day and actual2-session readback, without aggregation/rekey/spec writes. | Actual SQL disabled; opt-in/schema/preview HTTP-faked, NOT sandbox certification. Malformed-date compatibility deliberately retains an old backend read500 before local rejection. |
| Shared acceptance/regressions/safety | Lifecycle7/requests9/context4 preserve pending/concurrent dirty ownership, captured ACK checkpoint and read-only Retry; native Cancel/Tab/Shift+Tab/Escape/focus, inert long text and bounded24 builder/16 Canvas/four notice theme samples passed. All full/focused checks below, isolated synthetic real API readbacks, no personal/provider calls. | Scripted Settings-anchor departure is NOT physical background-pointer proof; touch/screen-reader/other engines/exhaustive zoom-motion/custom colors/a11y/human visuals deferred. |

### Fresh actual integrated execution

External authoritative report:
`/home/user/.local/state/timetrace-ui-redesign/evidence/integrated-ticket-12/merger-report.md`;
raw run `run.vVXmFd/` under that evidence root. Results are this merger's runs, not reused producer gates:
**466 Python passed/226 warnings** (222 SQLite datetime adapter deprecations +4 Pydantic datetime
serializer UserWarnings); focused75 API/121 warnings; **224 canonical all-CJS+tags**, focused10
stack/collision callers; **87 explicitly enumerated source/test JS/CJS syntax**. Scoped four-file
Ruff, two tests/service format and ONLY compiler ranges438–455/650–667 format pass. Unrelated old
whole-compiler `_IS_DONE_SQL` wrap remains. Full concise no-cache Ruff exits1/18 baseline findings;
BOTH stdout and stderr byte-match fixed `fresh-verification/run.zoEyTE/baseline-ruff.*`, including
old invalid-noqa warning. Whitespace passes; no source/test/spec edits or format cleanup.

Stats89 ran FIRST before domain fixtures; then seven builder108 (14+4+56+10+7+9+8), review13,
controls20, collision22 = **252 inspected passing labels**, all11 first-run exits0/errors[], both
review/collision explicit PASS/failures[]. Full saved JSON, real payloads/charts/IDs and every check
were parsed/inspected, not merely function-return status. Original source probes remain unchanged;
ONLY two screenshot destinations changed in an external controls copy, with reversible exact diff.
Canvas samples min description5.68948/control12.0118; builder min label12.0118/primary5.69859/
border3.62385; notice min12.0118:1. These are bounded Chromium samples, not whole contrast/accessibility.

Fresh two-CAS legacy fixture used its OWN nonce Dashboard and two valid real-API fillfalse widgets;
external parameterized CAS changed ONLY their captured spec_json false→true, exactly2 rows, all
other fields/rows/tables unchanged, public readback and owned-ID cleanup verified. Original external
helpers were derived ONLY by approved DB/port/CWD/absolute NEW venv bindings, all assertions intact;
source/derived SHA, exact diffs and reverse-byte equality retained. This is historical SQLite
simulation, not invalid HTTP Save or bypass of production validation. Parent must use a separately
fresh nonce/manifest for the genuine independent integrated gate, not these cleaned IDs.

Actual collision API primary[1,2]/baseline[2,2] remains the pre-existing NULL/empty comparison-key
alignment ambiguity, explicitly UNFIXED/UNWAIVED. Renderer faithfulness is not baseline-correctness
certification. No service comparison/aggregation policy change. Catalog always faked; intentional
HTTP holds/failures and SQL flag/schema/preview fakes remain explicit. No provider Test/Activate,
inference, real SQL enablement, paid call, personal DB/copy/key or migration/schema change.

NEW private0700 `/tmp/timetrace-integrated-12.BPvYbyol` preceded EVERY app import/test/runtime;
NEW own editable `.venv` there points to integration, leaving its old `.venv` untouched. Whitelist
env-i/private HOME, absolute DB/timer/key siblings, idle/SQL/tracing off, credentials including Google
ADC/GCLOUD/Gemini/Ollama absent. Own PID452661 actual main:daemon_app on free loopback18221;
bounded30s captured readiness succeeded normally through0013_ai_data_scope, exact health/ORM/FK[].
No stamp/create_all fallback; existing-DB migration-copy test N/A (no schema change). Post-probe
all synthetic domain/AI rows0; Overview1/widgets9/statuses5/settings1/migration1, FTSdata12/idx10/
config1/otherFTS0. Timer HTTP inactive/unfrozen/idlefalse/nullgap/task/emptytags-notes; timer file absent.

One fresh INSPECTION-only failure: external inspector guessed `pageErrors` rather than actual
Canvas `errors` and overprinted request traffic. Raw KeyError/overbound stdout retained; stopped,
read source return contract, received parent approval for ONE complete saved-JSON inspection using
actual results/errors keys. Corrected89/errors[] metadata/labels/measurements passed. No native
rerun/source/assertion change. A later development-DOC exact edit refused an oldText missing its
same-line registry prefix; no write. Stopped, parent approved ONE exact-anchor DOC-only correction,
actual paragraph re-read and narrowly replaced; raw refusal retained. No application/test rerun or
source change. All earlier original RED/helper/oracle/readiness/provider-fetch/pidfd failures and
the missing original repair report remain retained, not backfilled or all-first-pass.

Before/after checks and before this draft, ALL231 tracked src/tests/specs paths+contents match
manifest SHA256 `903611d11eb4ca0240d6128e87725aaa95015b0c61431321a49ae454658c1c40`.
Original DD16/user dirty root and clean bc/a521/c37 checkpoints preserved read-only. Only five allowed
DOC drafts may differ. **No stage/commit until genuine parent LIVE integrated browser gate and
explicit release.** Runtime remains healthy/source frozen for that gate; no shutdown inferred from
producer passes. Subsequent release may permit ONE exact-c37-parent five-DOC closure; cleanup only
own identity-verified capable-stdlib pidfd normal SIGTERM after canonical timer/file/read-only0013/FK/
actual-count audit, retaining DB/logs/venv. Actual later receipts must supersede this live checkpoint.

Ticket remains pending in this draft: only01+02+04+10+11 completed/20pending. After genuine gate and
explicit one-commit closure, eventual01+02+04+10+11+12 =6completed/19pending; bounded delivered
implementation is NOT whole25/manual/human acceptance. Spec remains Approved NOT Built. Fresh DOC
Standards+Spec review and parent disposition are mandatory before19 continuation/13–14 resource
unlock; resource locks are not new DAG edges. No13 SQL-layout/sandbox adoption,14 performed preset/
recorded-label changes or seed reinsertion. Known three light4.33/four darkAI3.98986, caption heuristic,
comparison ambiguity, real SQL/providers, transport lost-response/atomicity/idempotency/exactly-once/
cross-tab and broader manual limits remain unwaived. Fixed82fabdc whole-delivery/adversarial/human/
dev-merge gates remain separate; no push/PR/dev/main write or other-ticket completion.

### Released bounded closure — supersedes the preceding draft/live checkpoint

Parent's genuine independent integrated gate passed on exact c37: Stats89 FIRST→seven builder108→
review13→fresh OWN legacy controls20→collision22 =252 inspected labels, all11 first-run exits0,
actual errors[] and review/collision PASS/actual failures[]. Complete parent gate/summary/before/after
receipts were read. Parent independently verified all231 source/test/spec bytes before/after,
empty index/five frozen DOCs, exact own source/env/DB/0013/FK and BOTH full concise Ruff streams
against fixed baseline18. Only two external screenshot paths changed; no probe/source fixes/reruns.
Parent's fresh nonce/two valid API widgets/exact2-CAS/all unrelated fields+rows+tables/public readback/
owned cleanup were independent of producer. These are two separate252 executions, not504 unique tests.
`evidence/integrated-ticket-12/parent-browser-gate.md` explicitly released ONE exact-single-parent
`c37c81b00c8f9928480942eb6bbb3d90638e7f9e` five-DOC closure, with231 immutable source bytes.

Actual normal cleanup: `/usr/bin/python3 -P` exposes BOTH os.pidfd_open/signal.pidfd_send_signal,
recorded BEFORE execution; application/tests remain own Python3.14. Exact PID452661/start/cwd/cmd/
executable/editable direct_url/whitelisted env/private0700 DB/health18221 verified through retained
pidfd. Canonical `/timer/status` AND active_timer.json now EXISTS inactive (producer's earlier absence
was true then): stopped/unfrozen/idlefalse/nullgap/nulltask/emptytags-notes/startnull. Explicit existing
DB SQLite URI mode=ro/query_only,0013_ai_data_scope/FK[], ALL actual counts equal parent-after:
all synthetic domain/AI/provider rows0, Overview1/widgets9/statuses5/settings1/migration1;
FTSdata7/idx5/config1/otherFTS0, not stale producer12/10. Normal SIGTERM ONLY through verified pidfd;
exit event then PIDabsent/18221connecterrno111/healthrefusal/normal shutdown. DB/timer/logs/venv retained;
no other process/storage cleanup. `cleanup-{before,after}.json`, `cleanup.*`/capability receipt record
actual success, no new cleanup correction/failure.

Exactly five DOCs finalize bounded12 completion:01+02+04+10+11+12 =6completed/19pending; no other issue
status/identity/criteria/history or graph changed. All six unchanged criteria above map to actual
source/regressions/real gates and disclosed limits; checks never mean exhaustive manual/human acceptance.
ALL231 source/test/spec path-content hashes remain903611d… before/after final docs/commit; external
final report supplies actual one closure SHA/exact c37 parent/five-path/tree/index/preservation proofs.
No tests/native/full suites rerun after DOC edits. Spec Approved NOT Built; fresh independent closure
DOC Standards+Spec and parent disposition STILL REQUIRED before19 continuation/13–14 resource unlock.
Known comparison ambiguity UNFIXED/UNWAIVED, caption heuristic deferred, contrast/manual/SQL/provider/
transport limits retained; no whole25/human/push/PR/dev-merge permission follows from this closure.
