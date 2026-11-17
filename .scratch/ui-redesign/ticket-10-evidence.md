# Ticket 10 — Compact Habit cards evidence

## Delivery boundary

This is an **unstaged, uncommitted implementation continuation**, not ticket closure, reviewer approval,
human acceptance or merge permission. The [issue](https://github.com/sinsenti/TimeTrace/issues/29) remains ready-for-agent,
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

## Clear-focus Spec P2 repair — frozen pre-gate checkpoint

Parent accepted the single Spec P2 from the full independent initial5b review; Standards found0.
This bounded repair starts on clean branch `feat/ui-redesign-10-clear-focus`, exact
`5b022bad0167faec58e1be85bce1b678f59b68ce` (feature parent reviewed118). No FF or other-lane
source was needed. Only `habits.js`, own `test_habit_cards.cjs`, new
`browser_habit_clear_focus.js`, this evidence appendix and own issue comment change.
Shared utils/markup/settings/client, Python/backend/service/schema and domain policies are unchanged.

The pending card render disposed the Clear launcher and attempted focus on its disabled replacement;
the real confirmation helper supplied no initial focus/restoration and captured Enter as Proceed even
on Cancel. The local repair captures habit/date/action plus view, definition and Clear focus generations.
It focuses Cancel, contains Tab/Shift+Tab between the two existing buttons, and handles Clear-only Enter
at window capture before the helper's document capture (Cancel Enter cancels; Proceed Enter confirms).
Escape remains the actual shared helper's cancellation. Listeners are removed after confirmation or
focus supersession/finally; a new Definition focus cancels the old confirmation. After pending clears
and the final render, optional restoration finds the live Clear by logical action, or an enabled same-card
Amount/definition fallback when erased. New focus/date/definition/Clear owners cannot receive old focus.
These guards are independent of ACK receipt/baseline delivery and unconditional pending cleanup.
No generic focus framework, helper injection/replacement, global keyboard change or new domain rule.

### Actual first failures and fixture corrections

New raw receipts are under external `evidence/ticket-10-clear-focus/`; all old proof is immutable.
Before production edits, Stats89 passed and `native-red.json` genuinely failed the first assertion:
**keyboard Clear → Escape restores live enabled Clear after pending clears**. `caller-red.log`
independently failed body-versus-live-replacement focus. Its second ACK characterization initially
advanced the date before the cross-VM confirmation continuation had started the write; corrected
fixture waits for the actual request (`caller-red-corrected-fixture.log`):12 pass/1 genuine focus RED.
This was a fixture timing gap, not data loss or a second product defect.

First GREEN attempt retained two fixture gaps: CJS modeled no `querySelector`, and the native readback
used nonexistent stats `history.date_str` instead of actual `history.date` after passing the real focus
assertion. Added only the missing local DOM stub and corrected that response field; no weakened oracle.
Inspection also made the numeric fallback explicitly prefer Amount over the first card button.
Corrected caller13 and native passed. Additional pending-new-owner/lifetime cases were added before
final freeze; generation checks and prompt key-listener release prevent an older pending Clear from
handling/restoring a newer confirmation. Final all-probe sequence passed first run; no old helper,
source injection, forced/background click or manufactured post-edit native RED.
An interim progress message described27 new assertions; actual final inspected payload has31.

### Fresh final checks and native readbacks

- Focused API14 and caller13 pass. Full safe-path pytest: **391 passed,105 existing warnings**.
- Canonical `node --test tests/*.cjs tests/test_tags_engine.js`: **214 passed**,0 failed/skipped.
  Existing baseline212 plus2 new callers. All **75** explicit source/test JS/CJS syntax paths exit0
  (baseline74 plus the new native probe). Python production formatting is N/A: no Python edits.
- Full Ruff exit1 retains18 baseline violations and old invalid-noqa warning. **Both stdout and stderr
  separately byte-match exact5b and reviewed118**, freshly linted from own pinned Git archives without
  app imports; `ruff-comparison.json` records both comparisons. No unrelated cleanup.
- `git diff --check` passes. Index remains empty; no stage/commit authorized by these checks.
- Real native order: **Stats89 FIRST → unchanged Habits82 → edges14 → Definition confirmation8 →
  Clear-focus31**, all exit0, all0 pageerrors. Full assertions and actual API readbacks were inspected,
  not just runner status. Main external probe differs only at its two screenshot paths; old proof was
  not overwritten. New390 light/1440 dark screenshots were visually inspected. The16 existing
  width/theme samples retain no page overflow and sampled control-text contrast12.01–14.99:1;
  narrow navigation intentionally scrolls. This is not whole-palette/accessibility certification.

New31 checks cover keyboard Clear→Escape, initial Cancel focus, Tab/Shift+Tab cycling, Cancel Enter
and Space, mouse Cancel, accepted keyboard Proceed and disabled-Clear/Amount fallback, rejected erase
with retained dirty7/persisted zero, acknowledged erase despite failed GET and read-only Retry, new
Definition draft/focus during held post-ACK read, new Definition before confirmation (zero erase),
changed-date stale confirmation (zero erase), other-habit focus during held read, pending newer Clear
confirmation without older restoration/interception, and enabled boolean-card fallback after erase.
Real public stats readbacks verify zero Pending, selected-date erase, retained other habit and no replay;
ACK receipt and pending cleanup are explicitly asserted even after focus ownership changes.
The date/new pre-confirmation Definition transitions use public callers, not physical overlay clicks.
There is no Session editor on the Habits template; no synthetic Session/helper was injected to claim one.
Unchanged Definition confirmation8 proves its previous Escape/draft/launcher/pending/one-DELETE behavior.

HTTP fakes are explicit: catalog, one rejected Clear POST, one failed list GET and three held real list
GETs. Existing probes retain their disclosed failure/held-request/SQL-preview fakes. No personal data,
provider activation/test/inference or paid call. Existing zero-before-goal/history/draft/receipt/
metadata/one-record sequential-upsert boundaries are preserved, not re-approved or expanded here.

### Live isolated gate readiness / limits

A new private0700 `/tmp` directory was created before any app import/runtime/test. Own worktree venv
and imported source verified. Loopback18199 was free before launch; idle and tracing are false;
credential names including Google ADC/config and Ollama are unset. Catalog discovery is faked.
Actual-main health matches the private DB and port; normal migrations reach0013_ai_data_scope,
FK check is empty. Timer HTTP/file are inactive/unfrozen, no pending gap/task/tags/notes, idlefalse.
Actual synthetic habit/log/goal/task/session/provider/draft/audit/conversation/review/rating counts0
post-readbacks/cleanup; initialized AIsettings1, taskstatus5, Overview1/widgets9 remain. Exact DB URL,
PID/environment/command/source/counts and socket receipts are external `runtime-ready.json`.

Code/tests are frozen; staging/commit/runtime shutdown are held for **parent's blocking genuine browser
gate and explicit release**. Only after release may one scoped fix have exact parent5b, followed by
byte-identity/scope/clean verification and normal only-owned timer/DB/FK/PID/socket cleanup. Parent
must obtain fresh amendment5b…FIX and combined118…FIX Standards/Spec reviews and fresh merger closure
before12 release. This appendix does not close ticket10 or mark Approved spec Built.
Human/final whole25/fixed82 whole-delivery checks, physical touch/screen readers/other engines/exhaustive
contrast/zoom/reduced motion remain unrun. Known4.33 light and four3.98986 dark limitations remain
unwaived. No transport exactly-once/idempotency/cross-tab guarantee, push/PR/dev merge or source from
stopped/unreviewed lanes is implied.

### Clear-focus independent parent gate and explicit fix release

The preceding hold records the pre-gate snapshot. Parent independently passed **Stats89 FIRST →
Habits82 → edges14 → unchanged Definition8 → Clear31**, all0 pageerrors, on the frozen own18199/
PID165924/private DB. Parent read the full report/ready/env/production+CJS diff and entire new31 probe,
inspected the complete actual checklists/readbacks, and verified all five owned SHA values before and
after. Main external copy changed only two screenshot paths. Post-gate timer remained inactive,
unfrozen, no gap, idlefalse. Raw independent proof: external `parent-summary.json`,
`parent-frozen-before.json`, `parent-browser/*` and `parent-browser-gate.md`.

Parent explicitly released **one five-path fix with exact parent5b022bad0167faec58e1be85bce1b678f59b68ce**.
The three production/test bytes may not change after this gate; only these two own-document gate/history
appends are allowed. No gratuitous same-byte full-suite rerun is required. Writer must verify exact
commit parent/scope/gated source-test identity and clean index/tree, then normal only-owned165924
HTTP/file timer, FK/actual counts and PID/socket shutdown, retaining final external proof.
Fresh amendment5b…FIX and combined118…FIX Standards/Spec reviews and fresh merger closure still precede12
release. This native gate is not independent code review, human/whole25 acceptance or ticket completion;
all prior RED/fixture gaps, manual/contrast/transport uncertainties remain disclosed and unwaived.

## Local integration and bounded closure (2026-11-04)

All preceding hold/status/commit-release statements are retained historical checkpoints. The feature
was committed as `5b022bad0167faec58e1be85bce1b678f59b68ce` on exact reviewed118; the accepted
Clear-focus repair is `9848fe7e919558576b04b255876c659c72208f17`, sole parent5b. Initial5b Standards
found0; Spec found **ONE P2** (Clear loses keyboard focus), genuinely reproduced RED and **repaired,
not waived**. Fresh full independent reports cover BOTH amendment5b→9848 and combined118→9848:
Standards0 breaches/0 heuristics, Spec0 missing/partial/unasked/wrong, P0/P1/P2 all0. Their read-only
review limits are retained; these code verdicts do not review this later documentation commit.

Fresh merger verified clean expected integration `118bb9d14c99e06da96199e9ea574e9afdf4e91e`, clean
read-only source9848/ref/ancestry and exact reviewed diff bytes. `git merge --ff-only
feat/ui-redesign-10-clear-focus` reached EXACT9848, two commits/twelve paths, no merge commit/source
correction. Combined diff SHA256 `c7d2c5166c0d2f3a440614c2307765bcdb9b59d1a5c31104f6724b8ae94fad26`;
amendment SHA256 `741d31810dfec33b01ad1f3f6959030a4775e09d71b8391cbe6b94e265426958` matches supplied
review artifacts too. All216 tracked source/test/spec files match committed reviewed9848 and working
bytes before closure; the three repair source/test SHA values also match the prior genuine parent gate.
One FIVE-DOC-ONLY closure has exact parent9848; no source/test/spec/seed/other-issue change is authorized.
Parent fresh closure Standards/Spec review is **REQUIRED BEFORE12 continuation release**.

### Original criteria 1–7: bounded implementation and verification

1. **Compact cards/navigation:** `habits.html`, page-scoped `habit_cards.css`, `habits.js` card/view
   handlers and caller navigation tests implement independent strips without shared cube/Entry date.
   Fresh main82 verifies B's date unchanged, A's retained draft and zero viewing/theme/Cancel writes.
2. **Explicit entry policy/Clear/focus:** staged per-date owners and captured Save/Clear handlers,
   caller13 and real native main/edges/Clear31 verify Save/Cancel, explicit Failed/Done/Skipped,
   visible negative clamp, numeric0 Pending versus erase, stale-date rejection and retained hidden
   Settings drafts. Clear initially focuses Cancel, traps Tab/ShiftTab, and handles Cancel Enter at
   window capture before unchanged helper Proceed. Escape/Cancel Enter/Space/mouse write0; accepted
   keyboard Proceed erases once, then restores enabled same-card Amount/definition if Clear disables.
   New Definition/date/other-habit/new Clear owners revoke optional focus, **never acknowledged receipt,
   persisted-baseline delivery or unconditional pending cleanup**. Old unresolved prompt/listeners clean
   up; rejected erase retains dirty7/persisted0, ACK+failed GET retries reads only. Date/new Definition
   transitions use public callers, not physical overlay clicks. No shared keyboard/helper redesign.
3. **Retained definitions/history:** source definition/chart/inspector paths, API metadata/notes/goal
   test, caller races/null metadata and fresh main/edges actual readbacks retain CRUD/Cancel/deletion,
   target/unit/color/freeform frequency/reminder, null reminder/short-hex color, goal history and charts.
   Target changes do not rewrite historical status. Units/reminders retain existing storage/display;
   no new converter, scheduler or notification behavior is claimed.
4. **Pending/missing/denominator:** API14 includes six zero/clamp cases across goals0/-1/5, four
   unchanged nonzero cases, boolean/upsert and stored-history cases. Four genuine historical REDs
   justified the approved **explicit-write-only zero-before-goal** service repair; no historical rewrite
   or new target validation. Main real zero-at-zero-goal readback passes. Missing is not Failed;
   compliance remains completed/all recorded logs, not dates. Stats summary is all recorded logs;
   existing chart arithmetic/windows remain based on their loaded recorded logs.
5. **Local date/cardinality/metadata boundary:** API same-day ID reuse and selected-date erase preserve
   other dates/habits; main Pacific/Kiritimati date and real sequential upserts pass. Existing stored
   notes survive writes but are not editable. List lower bound remains daemon-local today minus365;
   absent dates outside conservative browser-local363 are Unknown, not proven absent. Explicit old
   Save uses existing upsert; card-only ACK receipts survive bounded GET omission without extending
   chart history/denominators. No DB uniqueness/cross-tab guarantee, new range endpoint, clock time,
   notes-write field or multiple-entry API/schema is introduced; those additions still need approval.
6. **Regression coverage:** fresh14 API/13 caller, full391 Python/214 Node/75 syntax; native
   Stats89 FIRST→main82→edges14→UNCHANGED Definition8→NEW Clear31 on integrated actual source.
   Empty/loading/error/retry, independent navigation, cancellation, decimal1.5/native keyboard,
   metadata/history, selected-date writes and public readbacks are actual checks, not runner-return
   assumptions. Old Definition8's genuine dd13994 RED now passes reviewed02 utils unchanged; it is
   **not** the new31 Clear-focus proof. No fake Session editor/shared-helper injection or force-click.
7. **Shared safety/limits:** private actual-main runtime, fake providers only, exact lint baseline,
   source identity, final timer/schema/count/FK/shutdown proof and bounded presentation checks below.
   Ticked criteria mean implementation delivered with recorded bounded evidence; manual/human/whole25
   acceptance is still deferred, not silently passed or waived.

### Fresh integrated checks and genuine native payloads

External report/raw receipts:
`/home/user/.local/state/timetrace-ui-redesign/evidence/integrated-ticket-10/merger-report.md`, with
sibling commands/stdout/stderr/exits, manifests, full native JSON, path-only diff, screenshots and audits.
These are machine-local supporting receipts, not portable runtime guarantees. Prior producer/parent
checks above remain prior runs; the merger executed the following fresh on own integration source:

- Focused14 API and13 caller pass. Full safe-path pytest **391 passed,105 warnings** (101 existing
  SQLite datetime-adapter and4 existing Task serializer warnings); canonical Node **214 passed**,
  zero failures/skips. Explicit `node --check` **75 src/test JS/CJS paths**, all exit0.
- Scoped Habit API/service Ruff, test format and **changed service range421–440 ONLY** format pass.
  Whole-service pre-existing formatting remains untouched. Full concise no-cache Ruff exits1 with
  **18 baseline violations plus old invalid-noqa warning**; BOTH stdout AND stderr byte-identical
  fixed `evidence/fresh-verification/run.zoEyTE/baseline-ruff.*`. No globally clean lint claim.
- **Stats89 FIRST**, before Habit fixtures: real canvas CRUD/query/persistence, independent retry,
  obsolete Retry/stale identity, acknowledged/uncertain legacy adoption and seeds/reset retained.
  SQL capability/schema/preview HTTP fakes are NOT sandbox certification; backend SQL tests ran in
  full Python. Full `result.results`, requests,16 measurements and errors inspected.
- **Main82:** real numeric0 Pending, clamp, explicit choices/one-row upserts, no navigation/Cancel
  writes, hidden-date Settings guard/nonUTC local date, selected-day erase/other habit retained;
  failed write retained, real ACK despite failed GET/read-only Retry; held Save captures5 while6 stays
  dirty, Cancel restores5; target/history/freeform metadata/chart inspector and older Unknown/ACK.
- **Edges14:** native1.5/CtrlEnter/Escape, retained hidden owner; actual definition create/editCancel/
  deleteCancel/confirmed delete/readbacks, reachable NewHabit fallback, shorthex/null retained,
  initial failed read/no editable unknown rows and held retry/loading.
- **Unchanged Definition8:** Escape dismisses only confirmation, retains same editor/draft/exact
  Delete launcher, pendingfalse,0 DELETE; next explicit confirmed Delete writes once. Actual reviewed02
  helper, no copied/injected/local global fix. **New Clear31** separately verifies all focus/keyboard,
  rejection/ACK/retry and superseding-owner/receipt/pending boundaries in criterion2 above.
- All five native probes exited0, **0 pageerrors**; every actual checklist/readback assertion inspected.
  Main external copy changes ONLY two screenshot destinations (path-only diff retained), no old proof
  overwritten. Existing duplicate-action test uses explicit dispatch on aria-disabled Save to challenge
  the guard, not a physical disabled-click claim; Settings anchor dispatch and old-date public view
  mutation remain disclosed. HTTP fakes: catalogs, explicit rejected write/failed GET/held real requests;
  Stats additionally disclosed query/detail/list/SQL fakes and real committed legacy POST response abort.
  No fixture recoloring, disabled CSS, weaker assertions, green hunting or source changes.

All substantive fresh checks passed on their first run; expected baseline Ruff failure is unchanged.
One read-only discovery command named nonexistent `shared-acceptance.md`; actual shared requirements
were read in README. An initial combined `wc` also named incoming evidence absent before FF, then read
it after FF. These are inspection-only path misses, not test/runtime/native failures or product REDs.
Original TDD/zero4RED/Definition8RED, fixture timeout/timing/querySelector/date-key gaps, decimal/nav/
focus/null-metadata repairs, overstrong geometry/weak BODY oracle, audit-table/timer-key mistakes,
initial Spec P2 and repair review history above remain preserved, never flattened to all-first-PASS.

Visually inspected new390 light/1440 dark screenshots: inert long text/units wrap, independent cards
and reachable controls; narrow navbar intentionally scrolls horizontally. All16 width/theme samples
390/768/1024/1440 × Refined/Stone/Porcelain/preserved dark show no page overflow and sampled card-button
text contrast **12.011800672744089–14.98723863306763:1**. Stats description minimum5.689:1. These are
bounded samples, NOT all controls/palettes/accessibility certification. Known three light task4.33:1
and four dark AI3.98986:1 observations remain unwaived and untouched.

### Actual runtime, cleanup and remaining gates

NEW mode0700 `/tmp/timetrace-integrated-10.lokdm2e0/timetrace.db` configured BEFORE imports/tests/runtime;
own integration `.venv`/source/engine verified. Free loopback18203 checked before launch; actual
`timetrace.main:daemon_app` served directly by own venv Uvicorn (no CLI/provider invocation), PID251018.
Health exact DB/port; startup normal migrations to0013_ai_data_scope, FK[]. Idle/tracing off, credential
variables including Google ADC/config and Ollama unset, verified in exact process environment. Fresh
contexts seed idlefalse/catalogfake; no personal DB/copy/keys/provider Test/Activate/inference/paid call.
No schema change: existing-DB migration-copy verification N/A; no stamp/create_all fallback.

Final HTTP/file timer: is_running=false,is_frozen_idle=false,idle_detection_enabled=false,
pending_idle_gap=null,task_id/task_title=null,tags/notes empty,elapsed0,flowtime; file start/target null.
Actual schema/table counts inspected: all synthetic Habit/log/goal/task/session/provider/conversation/
chat/draft/audit/instruction/review/rating/recurrence rows0. Ordinary initialized AIsettings1,
Overview1/widgets9,taskstatus5,migration1; FTS config1/data2, other FTS rows0. Counts are observations,
not assumed blanket0. After exact own PID/cwd/cmd/env revalidation, SIGTERM ONLY251018; PID absent,
18203 closed, health connection refused, normal Application shutdown complete recorded. Private DB,
timer/logs/fixtures/venv retained; no other PID/worktree/storage cleanup. Post-closure committed/source/
test/spec byte identity and clean index/tree are verified in external final receipts.

Only01+02+04+10+11 completed;20 pending; frontier **03,05,06,08,09,12,13,14,15,18,19,21,24**.
Fresh05/08 blocker repairs are own-worktree/read-only-to-merger/not dependencies; their independent
status can change legitimately.03/12/18/19/21 stopped checkpoints remain preserved, not integrated.
12's shared ownership-test Widget fixture needs parent-coordinated preservation then fresh latest-
reviewed-base SAME12 own-patch replay/disjoint-hunk reconciliation, not blind dirty FF/reset/stash/
source copy or touching12 now.13/14 lock is coordination, not a new DAG. Settings stays `/settings/ai`
until19; no source from05/08/18/21 is claimed integrated.

Parent fresh DOC Standards/Spec review of this ONE five-doc exact9848-parent closure is REQUIRED BEFORE
12 continuation release. Spec **Approved NOT Built**; final whole-app verification and whole-delivery
review against fixed `82fabdc652c59da87de0f57d7770d0aa32fb7f64`, later adversarial/manual/explicit human
and dev-merge gates remain separate. Physical touch/drag, screen readers, other engines, exhaustive
zoom/reduced-motion/custom colors/contrast/accessibility and human visuals unrun. Real lost-response
ambiguity remains: no atomic bulk/idempotency/exactly-once/DB-uniqueness/cross-tab guarantee.
No whole25/human acceptance, push/PR/release/dev merge is authorized by bounded ticket10 completion.
