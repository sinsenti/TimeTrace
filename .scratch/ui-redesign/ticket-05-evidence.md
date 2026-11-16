# Ticket 05 — uncommitted implementation checkpoint

Spec: **Approved, not Built**. Ticket status/criteria are unchanged. Base/branch:
`118bb9d14c99e06da96199e9ea574e9afdf4e91e`, `feat/ui-redesign-05-task-details-accounting`.
No staged files, commit, push, PR or integration update. This is **not ready for acceptance**.

## Implemented slice

- Both dedicated detail aliases remain in the unchanged router. Inline Revision inspector shows
  separate logged/scheduled/remaining/unscheduled/ratio values and a dedicated-details link.
- Dedicated properties retain explicit Save/Cancel, unknown/custom status and empty category,
  pending/double-activation guards, current-owner/read generations and refresh-only retry.
- Child creation/editing retains title parsing and saved parent metadata; Quick Edit uses the real
  shared human Task modal. Session edit/schedule uses the actual shared Session modal/controller,
  with detail-owned history/read-refresh hooks and persistent history-heading return focus.
- Canonical receipts checkpoint only submitted persisted fields using a detached same-id form
  snapshot through the existing draft guard. Unchanged fields adopt canonical values; concurrent
  inputs, including ABA edits, retain their draft against the canonical baseline. Child IDs are
  adopted before fallible follow-up reads. Pending child Save is visibly disabled without locking
  editable fields. Input, not delayed change-on-blur, records edit intent.
- Accounting remains unchanged in `TaskService.get_work_accounting` / `SessionService`; the existing
  AI insights caller still shares it. No new aggregate/domain/endpoint/schema/CLI policy.
- Scoped CSS changes only details/Revision task inspector. Parent explicitly authorized narrow
  additional shared changes: both tag HTML/inline-JS sinks now use text DOM/listeners; the estimate
  parser's four existing regexes accept optional minus. The canonical tag-reset test retains its
  original assertion/count with only two missing DOM mock methods supplied.

The parent corrected the launch brief's overly strict requirement to replace every existing writer
with TaskModal: approved B3 permits keeping these existing inline/child writers and strengthening
shared contracts/draft ownership. No hidden legacy form or new mutation protocol was added.

## Acceptance mapping / actual checks

| Criterion | Evidence / boundary |
| --- | --- |
| Details aliases/properties/tags/subtasks/session actions | Seven new HTTP characterizations, three owned native probes, existing Task/Session regressions. Native Save readbacks use actual public API rows. |
| One-instant accounting and own history | Existing 24 accounting tests plus seven new HTTP/alias tests: 31 focused pass. Fixed instant boundary rows/open retained durations/straddling/timer/recurrence/descendant exclusion; existing SQL/compiler/service contracts unchanged. |
| Negative balances, >100%, unbounded/per-occurrence | HTTP table includes positive/negative/zero/null/recurring; native 200%, negative balances, negative persisted estimate, zero and recurring unbounded labels. |
| Drafts/ACK/read failures | Caller RED/green, native held real ACKs, stats/metadata 503, concurrent title/estimate/tags, canonical ID/45m/ABA readbacks, disabled direct-deleted entry, no repeated POST/PUT on read-only retry. **Missing-tree child zero/null continuation remains unresolved below.** |
| Shared safety/appearance | Fresh private DB, fake provider catalog, no provider calls. Four appearances × four widths, 96 dedicated samples minimum 5.698586:1; bounds, not whole accessibility certification. |

Final automated execution on the frozen 15 source/test paths:

- `uv run python -P -m pytest -q`: **384 passed, 105 warnings**.
- `node --test tests/*.cjs tests/test_tags_engine.js`: **232 passed**, no failed/skipped tests.
- Explicit `node --check` paths: **76 passed**, including all source/test JS/CJS.
- New Python test scoped Ruff/format and `git diff --check`: pass.
- Full concise no-cache Ruff: **18 existing violations**, old invalid-noqa warning; stdout **and**
  stderr byte-identical to fixed baseline. Not globally lint-clean.
- Native Stats89 ran first, before domain fixtures. After final source changes: owned main65,
  edges23 and receipts15 all pass; all seven existing Session probes and all six Task probes pass.
  Task includes nested66, review-focus20, main, edges, reviewed external combined-decline and empty
  category. External edge copy changes only screenshot destinations; no assertion/source adoption.
- Fresh startup migrated through `0013_ai_data_scope`; foreign-key check empty. No schema change,
  disposable-existing-DB upgrade N/A (no personal DB/copy used).

## TDD and preserved failures

This is not an all-first-pass or strict one-test-per-cycle claim. Initial six caller regressions
were written/run together (all RED), then green; API accounting additions are explicitly
**characterizations**, not invented backend RED.

Raw evidence retains:

1. Initial caller six failures (double writes, stale read, navigation after read failure, mislabeled
   recorded count, child ID/concurrent draft, stale owner), then green.
2. Tag sink own RED2; canonical old tag test's missing DOM methods error is a mock gap, not security
   RED. New own suggestion fixture initially selected default `#progr`; corrected query to exact tag,
   no altered assertions/tag values. Native stored/typed hostile text and pointer/keyboard paths pass.
3. Initial full Node run exposed `allSessions` redeclaration with combined callers. Corrected owned
   page hook composition, no shared harness change; full suite passes.
4. First native main: ambiguous retry locator (own and shared notice both valid). Scoped to main.
   Source-inspected probe-only `applyTheme` typo corrected to actual `applyAppearance` before use.
   Next native main timed out because search Enter preceded async metadata readiness; parent-approved
   unique same-response title + actual rendered chip/suggestion synchronization, no sleeps/force click.
5. Native negative-estimate RED sent null for existing -60. Real-utils caller RED8 after fixing a
   missing `window.addEventListener` mock; optional-minus parser and unchanged estimate preservation
   fixed it. Actual native negative remains finite with null progress.
6. Deleted-entry oracle incorrectly used Playwright `FIELDSET.isDisabled()`. One authorized read-only
   diagnosis showed native fieldset.disabled/attribute true, descendant Save/title `:disabled` and
   Playwright disabled true, tree404 and zero task/session writes. Stronger descendant/property
   assertions replace only the wrong fieldset oracle. Original failed receipts retained.
7. Canonical child45 retention was initially unasserted: payload inspection found later estimate15
   loss under concurrent title. Genuine caller RED2, canonical detached-form reconciliation fixed it.
   First native ABA delta exposed delayed change-on-blur misclassified as new title input; caller RED
   and input-only revision observer fixed it. Next delta raced the still-pending read guard; separate
   visible pending-button caller RED/fix plus enabled-button synchronization, then full delta15 pass.
8. Initial scoped format check required formatting the new Python test. Startup's first health curl
   occurred before readiness (connection refused), then actual successful health. A late receipt-summary
   script assumed every probe result was an object, but one is a list; raw native receipts themselves
   remain successful. Neither inspection issue is a product/test pass or silently erased.

## Blocking source finding / gates

Final own inspection found a source-visible gap in the new unchanged-child-estimate expression:
if a child ACK has estimate null/zero, its input is `-`, and the follow-up tree is unavailable, a later
explicit child Save may dereference `findNodeInTree(...).estimated_minutes` when that node is absent.
Known source: `subtasks.js` child payload construction. The proposed minimal fix is an editor-owned
persisted child receipt initialized/reset on opening and updated on ACK, used for unchanged
zero/null/negative estimate and category when reads fail. **Not implemented or claimed RED-tested.**
Parent decision was requested twice; both contacts timed out. No speculative implementation followed.
This blocks acceptance even though the exercised final regression/native cases pass.

Serial reservation10→12→19→03 and exact-latest-parent release remain required. This checkpoint stays
uncommitted on118; no stale-base commit. Genuine independent parent browser gate and fresh two-axis
source/closure review have **not** occurred. Same-file Revision/other-lane utils coordination must use
parent-controlled own-patch replay, never blind FF/copy. Whole delivery82fabdc review, adversarial and
explicit human/manual/dev-merge gates remain mandatory. No status/criterion was marked complete.

## Isolation and reproducible artifacts

External authoritative report and raw logs:
`/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-05/worker-report.md` and siblings.
`safe-run.sh` uses a whitelist environment, private HOME, idle/tracing off and no credential variables
(including Google ADC/Ollama). Own editable source/venv; private0700 directory
`/tmp/timetrace-05.GO9j8g`, DB `timetrace.db`, loopback18197. Actual daemon PID163681 (uv launcher163677).
The exact source/test path list and SHA256s are in `frozen-paths.txt` /
`frozen-source-tests.sha256`; no source changes after those checks.

Boundaries: provider catalog and explicitly held/failed HTTP are fake; all ordinary writes/readbacks
are real synthetic SQLite rows. Stats SQL flag/schema/preview fakes are not sandbox certification;
backend SQL tests ran in the full suite. No provider credentials, inference or paid calls.
Known prior light task4.33/dark AI3.98986 contrast observations remain unwaived; selected dedicated
5.698586 samples do not establish exhaustive inline/shared-dialog/custom-palette accessibility.
Physical touch/drag, screen readers, other engines, zoom/reduced-motion and human visual acceptance
were not verified. Lost mutation responses remain uncertain; no new atomic/idempotency/exactly-once,
cross-tab or personal-data claim.

### Stopped cleanup / outstanding decision delivery

A third blocking parent contact also timed out. No source fix or additional test was made after the
freeze. The worker stopped the owned daemon normally (SIGTERM163681): PID absent, socket18197 closed,
post-stop health curl exits7. Timer HTTP and owned file inactive/unfrozen/null gap/idlefalse. Private
DB retained:146 synthetic tasks/47 sessions;0 providers/conversations/drafts/chat/audits/instruction
proposals/habits/reviews/ratings/recurrence exceptions; default settings/statuses/Overview9 widgets
and FTS bookkeeping remain. FK empty, revision0013. Logs/DB/timer retained; no unrelated cleanup.
Parent must restart the owned isolated runtime for any later genuine browser gate.

Separate unchanged shared-form limit: TaskModal still formats an existing zero estimate as `-` and
normalizes that unchanged value to null on Save. Both classify as unbounded, but storage preservation
for that shared writer is not established/fixed by this slice; the authorized signed parser fix is
not a fix to `formatMinutesToDuration` or TaskModal's unchanged-zero handling. Dedicated properties
preserve their actual zero. This remains disclosed, not waived or called all-forms preservation.
