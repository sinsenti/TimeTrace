# Ticket 10 — Compact Habit cards evidence

## Delivery boundary

This is an **unstaged, uncommitted implementation continuation**, not ticket closure, reviewer approval,
human acceptance or merge permission. The [issue](issues/10-compact-habits.md) remains ready-for-agent,
with its original criteria unchecked. The [spec](../../specs/ui-redesign.md) remains Approved, not Built.
Only 01/02/04/11 have recorded closure; no other ticket is completed by this receipt.

The preserved checkpoint began at `dd1399487172ab08516ace6ce6e88979ae1f63b1` on
`feat/ui-redesign-10-compact-habits`: four tracked modifications, six untracked owned paths, empty index.
Parent explicitly authorized a dirty-disjoint **fast-forward only** to reviewed
`118bb9d14c99e06da96199e9ea574e9afdf4e91e`. Fresh preflight confirmed exact branch/HEAD,
all ten checkpoint hashes, 37 incoming disjoint paths, ancestry, empty index and stopped old runtime.
The FF succeeded and **all ten hashes remained identical immediately afterward**. No reset, stash,
rebase, cherry-pick, merge commit, source copying or other-worktree edit was used. All nine code/test
files remain byte-identical to the checkpoint. Only this new portable receipt and an appended own-issue
comment add continuation content; the original issue/checkpoint history remains intact.

Raw proof is supplementary external evidence, not needed to understand this portable behavioral receipt:
`evidence/ticket-10/finalize/` under the parent's external redesign workspace. It contains preflight/FF
logs, new checks, first inspection failures, native JSON payloads, screenshots, environment/runtime
receipts, the exact owned-file manifest and full patch. Older evidence in `evidence/ticket-10/` was not
overwritten. These external logs are not bundled repository files and their absence in another clone
must not be mistaken for a fresh validation result.

## Implemented behavior and source trace

- `templates/habits.html` → page-scoped `static/css/habit_cards.css` and `static/js/habits.js` → shared
  `api_client.js` → existing `routers/habits.py`/`schemas.py` → `HabitService` → existing Habit,
  HabitLog and HabitGoalHistory models. Only the feature frontend and the approved service gap changed;
  routers, schemas, models, migrations, shared helpers and CLI are unchanged. The sole `log_progress`
  call site is the existing Habit HTTP router; existing service readers/AI read paths retain their policy.
- Compact cards have independent week/day/Today viewing state; navigation never logs data. No shared
  date cube or per-card Entry date row. Numeric entry and explicit Done/Failed/Skipped choices are drafts
  until Save. Cancel discards only the selected habit/date. Negative values visibly clamp to zero;
  native intermediate decimal/minus editing state is preserved without rebuilding the live input.
- Each initialized local date retains an actual hidden input registered with the existing Settings
  draft guard. Hidden/offscreen/date/view/theme drafts remain guarded. Canceled Settings departure
  performs no writes. A successful ACK checkpoints only submitted fields/date; concurrent edits stay
  dirty. No persisted draft store or shared Settings change was added.
- Save is single-flight per habit/date, captures its date/value, rejects duplicate pending actions,
  invalidates stale reads and retains failed/uncertain-write drafts. An acknowledged write followed by
  a failed GET offers **read-only refresh retry**, never automatic POST replay. Clear confirms only a
  known selected-date record; cancel writes nothing and changed date/editor/draft invalidates its
  continuation. Zero remains a recorded Pending result, distinct from no record or erase.
- Parent approved a demonstrated service boundary repair after four genuine RED assertions: numeric
  canonical zero now derives Pending **before any comparison with the current goal**, including zero
  and negative goals, on explicit log writes. Negative set/delta remains clamped by the existing service.
  No new target validation, historical-row rewrite, status-denominator change or policy expansion.
- Existing definition create/edit/cancel/delete, target/unit/color/freeform frequency/reminder settings,
  goal history, charts and inspector remain. Untouched null reminder/short-hex color metadata survives
  unrelated edits. Definition writes are single-flight; captured ownership prevents a late ACK from
  closing a newer editor and preserves concurrent fields. Deletion restores a reachable launcher.
  The local dialog keyboard trap defers to visible confirmation; it does not duplicate global Escape.
- History remains incremental and bounded: `/habits` returns dates at/after daemon-local today minus
  365 days; `/stats` supplies all-log summary, last 30 recorded rows and goal history. Missing dates are
  not failures. Outside a conservative browser-local **363-day** known window, an absent date is
  explicitly **Unknown / outside loaded history; a record may exist**, not authoritatively absent.
  Viewing is unrestricted. Explicit Save still uses the existing upsert; card-only ACK receipts preserve
  a known older row omitted by the bounded list. They do not expand chart history/denominators.
- Compliance remains completed/all recorded logs, including Pending/Failed/Skipped in the denominator,
  not all calendar dates. Target edits do not rewrite prior statuses; date-effective goal curves remain.
  Stored notes are preserved, not editable. Units/reminders retain storage/display behavior, not a new
  conversion/scheduler/notification promise. No clock fields, multiple daily entries or new API semantics.
- Sequential writes reuse one habit/local-date row and UI pending actions are guarded. There is **no**
  new DB uniqueness constraint, cross-tab concurrency certification or lost-response idempotency claim.
  UUID strings, local date components, inert text rendering and existing shared appearance remain.

## Criterion-linked verification

| Original criterion | Evidence, with boundaries |
| --- | --- |
| Compact independent day strips; viewing never writes | `test_habit_cards.cjs` navigation/independence case; native card probe checks B's date unchanged, retained A draft and zero writes during navigation/theme/canceled Settings departure. |
| Explicit Save/Cancel/choices, selected-date confirmed Clear, visible clamp | Caller tests exercise captured Save, double submission, failed writes, concurrent edits and stale Clear; native probe saves numeric zero and all three checkmark states, cancels/accepts Clear and reads actual rows. Native edge probe types `1.5`, saves with Ctrl+Enter and cancels with Escape. |
| Retained definitions/metadata/history/inspector/charts | API metadata/notes/goal-history test, caller definition races/null metadata, native freeform metadata/target-history/goal chart and create/edit/cancel/delete readbacks. Older stored status is not rewritten. |
| Missing is not Failed; zero Pending; recorded denominator | Six parameterized API zero/clamp cases across goals 0/-1/5, four unchanged-nonzero cases; API historic notes/summary test and native zero at goal zero. Existing chart arithmetic remains completed/all loaded recorded rows; stats summary remains all recorded rows. |
| One record/local date; preserve existing metadata; defer extra fields | API same-day ID reuse and selected-date erase with other habit/date intact; native Pacific/Kiritimati local date and sequential checkmark upserts. Notes preservation verified through existing row/API seam. No schema/cardinality infrastructure added; cross-tab guarantee not claimed. |
| API/service/browser coverage including empty/cancel/history/navigation | 14 API cases, 11 caller cases, native 82 main + 14 edges + 8 confirmation checks. Initial empty/loading/error/retry and historical unknown/ACK receipt workflows covered. |
| Shared safety and honest limits | Fresh private real daemon/DB, no providers/personal data, scoped/full checks, fresh Stats compatibility first, current reviewed shared helpers, bounded contrast/focus evidence and explicit unrun gates below. |

## Preserved TDD and first-failure chronology

These are historical execution receipts, not new RED claims. Raw old failures remain unchanged.

1. `red-entry.log`: typing immediately POSTed (`1 !== 0`); minimal explicit entry staging passed
   `green-entry.log`. `red-cards.log` lacked explicit controls; `green-cards.log` passed.
2. `red-races.log` exposed missing refresh-error/Clear-continuation safeguards; `green-races.log`
   passed held/double Save, concurrent input, changed-date confirmation and refresh-only retry.
3. `red-zero.log`: **4 failed / 2 passed** at nonpositive goals. Parent approved zero-before-goal
   repair; `green-zero.log`: six passed. Later API cases characterize unchanged behavior, not RED.
4. `red-definitions.log` opened zero target as one; repaired. The first definition-race probe timed out
   awaiting its own held duplicate; corrected probe then genuinely exposed two submissions. Single-flight
   ownership repair passed. The fixture timeout was not a test assertion or product failure.
5. Initial native click timed out on aria-disabled Saving. Probe uses explicit `dispatchEvent('click')`
   to challenge the guard, without weakening disabled state. Decimal typing then genuinely failed and
   was repaired by preserving the live number input.
6. Narrow navbar geometry genuinely failed; page-scoped full navigation row repaired it. A later desktop
   oracle incorrectly demanded a naturally 407px nav be 600px; corrected to actual clipping/available-width
   checks, without changing contrast thresholds or CSS. Final geometry passed.
7. Definition Tab escaped; local topmost trap repaired it. Unrelated rename rewrote null reminder;
   captured stored/displayed metadata fixed it. Initial delete-focus oracle accepted BODY text; a corrected
   exact BUTTON oracle exposed the real lost focus, repaired with reachable New Habit fallback.
8. New-test Ruff initially found two long lines, scoped formatting fixed them. Whole-service formatting
   differences were pre-existing on the exact base; only service lines 421–440 were checked/formatted.
   Original runtime audit used nonexistent `aiprovider`; actual table `aiproviderconfig` passed.
9. Old `browser-confirmation-old-base-red.json` genuinely failed: Escape closed the underlying definition.
   No shared-helper copy, injected fix, capture-phase guess or waiver was used. After exact reviewed118 FF,
   **the unchanged native confirmation probe passes all 8 assertions against actual current utils.js**:
   editor/draft retained, confirmation dismissed, pending Delete resolved false, launcher focus retained,
   zero DELETE, subsequent explicit confirmation deletes once, no pageerrors.

### New continuation first failures (inspection only)

All four new native probes and both full suites passed their **first** continuation run. The initial
preflight shell used unavailable `python`; no git/app operation occurred. Identical standard-library
preflight under `python3 -P` passed. Initial runtime audit guessed `is_frozen`, while actual timer JSON
uses `is_frozen_idle`; the next audit guessed `aiauditlog`, while actual schema uses `aiaudit`.
Both inspection errors were retained, actual response/schema inspected, and the audit corrected without
source/probe/assertion changes. Corrected audit passes. These are not product/native failures.

## Fresh checked continuation results on reviewed118 plus preserved feature

| Command / observable check | Actual result |
| --- | --- |
| `uv run python -P -m pytest -q tests/test_habit_cards_api.py` | 14 passed, exit 0 |
| `node --test tests/test_habit_cards.cjs` | 11 passed, exit 0 |
| `uv run python -P -m pytest -q` | **391 passed, 105 warnings**, exit 0 (reviewed base 377 + 14) |
| `node --test tests/*.cjs tests/test_tags_engine.js` | **212 passed**, zero failed/skipped, exit 0 (reviewed base 201 + 11) |
| Explicit `node --check` for every source/test JS/CJS path | **74 paths**, all exit 0; exact paths/exits in `syntax.log` |
| `uv run ruff check tests/test_habit_cards_api.py src/timetrace/services/habit_service.py --no-cache` | passed |
| `uv run ruff format --check tests/test_habit_cards_api.py` | passed |
| `uv run ruff format --check --range=421-440 src/timetrace/services/habit_service.py` | passed; unrelated whole-file baseline formatting not changed |
| `uv run ruff check . --no-cache --output-format concise` | exit 1: **18 existing violations and invalid-noqa warning**; stdout and stderr each byte-identical to reviewed04 baseline; combined output also identical to original ticket10 baseline |
| `git diff --check` and unchanged checkpoint source/test SHA checks | passed; index empty before independent gate |
| Native `browser_dashboard_canvas.js` **first** | **89 asserted checks**, no pageerrors |
| Native `browser_habit_cards.js` (external screenshot-path-only copy) | **82 asserted checks**, no pageerrors |
| Native `browser_habit_cards_edges.js` | **14 asserted checks**, no pageerrors |
| Native `browser_habit_cards_confirmation.js` | **8 asserted checks**, no pageerrors; genuine old RED resolved by reviewed shared source |

Native payloads were inspected, not inferred from runner return status. They include real saved-row
API readbacks, request receipts and explicit HTTP fakes: provider catalog, deliberately rejected/held
writes and failed/held reads. Stats additionally fakes bounded query/detail/list errors, an actually
committed legacy POST with aborted browser response, and SQL capability/schema/preview; this does not
certify SQL sandbox/provider execution. No real activation, provider test, inference or paid call.
All browser contexts seed idle detection false. The two main screenshots were redirected only in an
external byte-identical probe copy; retained `probe-path-only.diff` proves only those destinations differ.
Screenshots were visually inspected: readable wrapped inert long text, independent cards and reachable
controls at 390 light and 1440 dark. At 390, the shared navigation intentionally scrolls horizontally;
page/card overflow is absent. Sampled 16 width/theme combinations cover 390/768/1024/1440 × Refined,
Stone, Porcelain/preserved dark; control text contrast **12.01–14.99:1**. This is not all-control, all-frame
contrast or whole-app accessibility certification.

## Runtime isolation and remaining gates

Before any app import/test/runtime, a **new 0700 private `/tmp` directory** was created, with its own DB,
timer/key siblings. Worktree `.venv` and imported `timetrace.__file__` resolve to this worktree, not another
lane. Loopback port **18195** was checked free. Provider/tracing credentials, Google ADC and Ollama
configuration variables were unset in the child environment; tracing and idle detection are off. No
personal DB/key/data, original-owner checkout, active18/21 source or stopped03/12/19 source was used.

Actual-main `/health` reports the matching scratch DB/18195. Startup migrated normally through
`0013_ai_data_scope`; foreign-key check is empty. Corrected readiness audit confirms running/frozen
false, pending idle gap null, no timer task/tags/notes, zero elapsed, flowtime in both HTTP/file state.
All synthetic Habit/log/goal/task/session/provider/draft/audit/conversation rows are zero after readbacks
and fixture cleanup. Stats intentionally leaves its ordinary seeded Overview with nine widgets; one
initialized AI settings row and five seeded task statuses are not provider activity or fixture leaks.
Exact PID/DB URL/environment/socket/readiness receipts are external, not portable runtime assumptions.

**Hold staging/commit** until parent independently exercises the live frozen runtime and explicitly
releases the exact eleven owned paths for one feature commit whose parent is reviewed118. Every commit
still needs fresh independent Standards/Spec review and fresh merger closure. This writer does not
mark criteria/status complete or modify global README/implementation/development. After release,
verify committed byte identity, clean worktree/index, timer/DB/FK and normal shutdown of only the owned
PID/socket. Parent's review/merger receipts must record those later facts rather than this frozen
pre-gate receipt predicting them.

Deferred: human manual acceptance; final whole-app verification and fixed-base
(`82fabdc652c59da87de0f57d7770d0aa32fb7f64`) whole-delivery review; physical touch, screen readers,
non-Chromium engines, exhaustive contrast/zoom/reduced-motion/a11y; cross-tab/DB concurrency and
lost-response ambiguity. Known task-light **4.33:1** and four dark-AI **3.98986:1** contrast limitations
remain unwaived and untouched. No whole-25 completion, human approval, push, PR or dev merge is claimed.

## Independent parent browser gate and explicit feature-commit release

The preceding delivery/hold statements record the **pre-gate frozen snapshot**, not a continuing
absence of authorization. Parent independently ran Stats89 first → Habits82 → edges14 → the unchanged
confirmation8 on the same isolated actual-main runtime, all with zero pageerrors. Parent read the three
Habit probes and native assertion/readback payloads, independently inspected all 16 geometry/contrast
samples and verified all eleven SHA values before and after. Main screenshot redirection remained
path-only in the parent's separate external copy. The nine source/test files remained checkpoint- and
gate-identical. Current reviewed shared utils genuinely resolved the old confirmation RED; no helper
injection, recoloring, assertion weakening or waiver. Parent's post-gate timer remained inactive,
unfrozen, idle disabled, with no pending gap.

Parent explicitly released **one feature commit on exact reviewed118**, limited to the eleven actual
manifest paths; allowed only own-issue/evidence gate-history additions and the precise fixed-base
verification wording correction above. Stage/commit is therefore authorized after that gate, not by
the writer's checks alone. Raw independent receipts are `finalize/parent-summary.json` and
`finalize/parent-browser/{stats,main,edges,confirmation}.json` in the external evidence directory.
Parent's initial attempt to read the not-yet-written final worker report returned ENOENT; this was an
inspection-only timing error, not a test/app failure. The writer also first looked for the summary
inside `parent-browser/`; its actual location is `finalize/parent-summary.json`, subsequently read.

Fresh per-commit independent Standards/Spec review and merger closure remain required after this
feature commit. Neither this gate nor the explicit commit release completes the issue or supplies
whole-delivery/human acceptance. Subsequent commit identity and owned-runtime cleanup are recorded
in the final external worker report, without another source/test edit.
