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
