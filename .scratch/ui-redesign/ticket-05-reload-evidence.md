# Ticket 05 reload — STOPPED, uncommitted, NOT VERIFIED

This supplements rather than replaces [the prior checkpoint](ticket-05-evidence.md).
Spec remains **Approved, not Built**; ticket status/criteria remain unchanged. Base/branch:
`118bb9d14c99e06da96199e9ea574e9afdf4e91e`, `feat/ui-redesign-05-task-details-accounting`.
No stage, commit, FF, integration write, other-lane source adoption, delegation or provider call.

## Authorized bounded repair / observed RED

The reload brief explicitly authorized the previously blocked persisted-child-receipt fix.
Before editing production, `tests/test_task_detail_child_receipts.cjs` loaded the actual
`utils.js`, `settings.js` and `subtasks.js`. Zero and null ACKs followed by tree503 and a later
explicit Save both threw `Cannot read properties of null (reading 'estimated_minutes')` at
old `subtasks.js:707`. The negative -60 control passed; it is not claimed RED. Raw first run:
`reload/red-child-receipts.log` (2 failed, 1 passed).

Only `subtasks.js` production changed during reload: the private child editor resets its persisted
receipt on Create/close, initializes it on Edit, and updates it on current-owner ACK before fallible
reads. Unchanged estimate/category use that receipt rather than a display-tree lookup/default.
Zero/null/negative estimates and empty categories remain distinct; changed estimates still use the
existing parser. Existing owner/ABA/detached-canonical-baseline/pending/ID-before-read behavior stays.
Receipt metadata is the last ACK, not current DB authority; rejected PUT404 does not recreate a row.
No new backend/shared-helper/TaskModal production changes were made.

## Fresh checks

- Focused real-utils receipt + existing estimate/canonical callers: **41 passed**, including 12 new
  tests. The initial green run was32 before nine ownership/category/input/deletion characterizations
  were added. Those later characterizations are not claimed pre-fix REDs.
- Full safe-path pytest: **384 passed,105 warnings**.
- All canonical CJS plus tags: **244 passed,0 failed**, up12 from the preserved checkpoint.
- All explicitly listed source/test JS/CJS syntax: **78 passed**.
- Scoped Python Ruff/format, whitespace: pass. Full Ruff: **18 unchanged baseline findings**;
  stdout AND stderr byte-match fixed baseline; not globally lint-clean.
- Native Stats ran FIRST before domain fixtures: **89 assertions passed**, zero pageerrors.
- New bounded native receipt workflow: **FAILED**. The zero case passed real POST ACK, tree503,
  concurrent draft retention, read-only failed/successful Retry, canonical-ID PUT, preserved zero/
  empty category/parent and no duplicate CREATE. The following null case failed the real-row ACK
  preservation assertion. Partial results/writes/zero public row are retained; zero pageerrors.
  **No native RED-before-fix claim. No diagnosis, correction or rerun after this unexpected failure.**
- Because the brief requires STOP at the first unexpected failure, the old3 owned, all7 Session and
  all6 Task native reruns were **NOT RUN in this reload**. Their earlier passing reports remain prior
  evidence only. The negative case in the new native workflow was not reached. No fresh acceptance
  claim is made from the earlier native reports or current automated passes.

## Isolation / shutdown / checkpoint

New private0700 `/tmp/timetrace-05-reload.4AYU7f`, DB `timetrace.db`, own new editable-source venv and
private HOME; whitelist environment before all tests/imports/runtime, idle/tracing off, all provider
credentials including Google ADC/Ollama absent. Old private DB/runtime were not reused or modified.
Actual `timetrace.main:daemon_app` on free loopback18207, PID255708, health exact DB/port, migrations
through0013, FK empty. Browser catalog discovery was faked. Held ACK delivery and tree503 are explicit
HTTP faults; ordinary mutations and public row readbacks use real synthetic SQLite data. Stats SQL
preview fakes are not sandbox certification; backend suite ran separately. No personal/paid calls.

After STOP, only required read-only health/timer/FK/count/public-row audit and normal own-PID shutdown
were performed. Final timer HTTP AND file: inactive, unfrozen, null pending gap/task, idlefalse.
Actual final DB:3 synthetic tasks,0 sessions,0 providers/conversations/drafts/audits/reviews/ratings/
habits/recurrence exceptions; defaults1 AI settings/1 Overview/9 widgets/5 statuses and FTS remain.
FK[], revision0013. SIGTERM255708: PID absent,18207 closed, health curl7. DB/logs/venv/timer retained.

Authoritative report/raw artifacts:
`/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-05/reload/worker-report.md` and siblings.
`checkpoint/` contains ALL20 owned dirty paths (original17 plus two new tests and this portable
receipt), full binary patch including untracked files, archive, owned/full-working-tree SHA manifests,
source HEAD/index status, reload delta and protected-scope verification against the parent's original
17-path archive. Raw previous failures/three decision timeouts and old evidence were not overwritten.

## Outstanding gates / limits

**NOT VERIFIED / not acceptance-ready** after the new native failure. Future authorized investigation
must classify that failure without weakening assertions or retrying until green, then rerun the
unexecuted native matrix. No latest-base/stage/commit/final parent browser gate is authorized now.
Serial10→12→19→03, fresh latest-reviewed own-patch replay (Revision/utils overlap), genuine independent
browser and two-axis reviewer gates remain parent-owned. No completion/status/spec-Built claim.
Separate unchanged shared TaskModal zero→null normalization remains unwaived. Physical touch/drag,
screen reader/other engines/zoom/reduced-motion/human acceptance and exhaustive contrast remain unrun;
prior light4.33/darkAI3.98986 observations are unwaived. Lost response/idempotency limitations unchanged.

## Authorized NULL characterization follow-up — STOPPED UNCOMMITTED, not final acceptance

The subsequent bounded parent direction authorized **tests/fixtures only**. Source-only diagnosis
(`evidence/ticket-05/null-diagnosis/report.md`) explains the original native fixture mismatch with
high confidence: explicit null CREATE follows the existing mapped INSERT default. The historical
nine-check failure/“undiagnosed at STOP” ledger and absent historical POST ACK remain unchanged.
This append records new evidence, not a retroactive ACK capture or observed SQL claim.

New private real-daemon characterization captures exact request/status/raw mutation response and
separate GET bodies for neutral CREATE omitted/zero/null/negative: **15/0/15/−60**, respectively.
All four explicit PUT-null ACKs and GETs are null; later omitted-estimate UPDATE ACKs/GETs retain null.
Four parametrized HTTP characterizations were added to `tests/test_task_details.py`; no backend,
model, schema, formatter, parser, shared fixture or production source changed in this follow-up.

The owned native child probe now distinguishes requested-null CREATE from actual-null storage:
CREATE raw ACK/GET15 and canonical `15m` are asserted. Through the SAME still-open private child
editor, an intentional real PUT with `-`, held ACK and concurrent title establishes genuine null
ACK/GET despite tree503; later explicit canonical-ID PUT with unchanged `-` stays **strictly null**.
Zero/negative/empty category/exact parent/pending/no duplicate/read-only failed and recovered Retry
assertions remain. No null-or15 oracle, helper injection, forced click or backend rewrite. Counts:
1 fixture parent CREATE;3 intentional child CREATEs;4 intentional child UPDATEs (2 in genuine-null
path);0 replayed CREATEs. Synthetic null-ACK CJS coverage is retained as transport-seam evidence.

Fresh checks on this follow-up: focused Python11 (4 serialization warnings), focused Node41,
full Python**388/109 warnings**, all canonical Node**244**, all JS/CJS syntax**78**, scoped Ruff/format
and whitespace pass. Full Ruff remains**18** baseline findings plus old invalid-noqa warning;
BOTH stdout/stderr byte-match fixed baseline. Stats**89** ran FIRST before daemon domain fixtures;
new bounded native**32** passed once; then prior owned main65/edges23/receipts15 passed (canonical45,
concurrent/ABA/delayed-change retained), all7 Session and all6 Task probes passed, including nested66
and review-focus20. Every raw result and explicit fake boundary is retained, not inferred from old
passes. Existing cross-controller TaskModal zero→null limitation remains separate and unwaived.

During the final read-only shutdown audit, the worker guessed `/api/timer/status` and received404.
**STOP** recorded once; no workflow tests or source corrections/reruns followed. Source confirms the
actual `/timer/status`; only mandatory read-only cleanup/audit and durable checkpoint continued.
This is an audit-command path error, not a task/null failure, and is not hidden as a clean first pass.
New raw receipts: `/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-05/null-verification/`;
authoritative `worker-report.md` there lists all commands, counts, preservation and remaining gates.

Isolation: new0700 `/tmp/timetrace-05-null.DTkG4D`, new own venv/private HOME/whitelist before imports,
idle/tracing off, credentials absent, fake provider catalog. Actual main daemon PID297474 on free
18209, health exact DB/port, migration0013/FK[]. No old/personal DB reuse or provider/paid calls.
Final DB75 Tasks/20 Sessions, zero provider/conversation/draft/audit/review/rating/habit/exception rows;
default5 statuses/1 AI settings/1 Overview9 widgets and FTS bookkeeping remain. Timer HTTP AND file
inactive/unfrozen/null task/gap/idlefalse. Normal SIGTERM only297474: PID absent/18209 closed/health
curl7; DB/logs/venv retained. All20 dirty paths, complete binary patch/archive/full-tree SHA and
protected-source comparison retained. Only this portable append, issue comment and two tests changed
this run. No FF/stage/commit/final parent gate, ticket/spec completion or other-lane adoption.

Bounded NULL verification passed; **NOT final feature acceptance**. Required independent reviewer,
latest-reviewed controlled own-patch replay, genuine parent browser and fresh Standards/Spec/human
merge gates remain parent-owned. Physical touch/drag/other engines/screen readers/zoom/reduced-motion
and exhaustive contrast remain unrun; earlier4.33/3.98986 contrast findings remain unwaived.

## Latest-base continuation adoption — 2026-11-13

This section supersedes the old stopped-checkpoint restriction only for the owner-authorized
continuation. Historical reports, failures, missing receipts and acceptance limits above remain
unchanged. Current worktree is `.scratch/codex-continuation/worktrees/ticket-05-task-details`, branch
`codex/ui-redesign-05-task-details`, base `e4ad345b6761b40b5d2e634a6f3c28e3c8deb0f7`.
The preserved 20-path delta was replayed as hunks; owned untracked bytes were copied separately.
Only utils differed at the latest base: its Timer recovery and Settings focus protections were
preserved, adding only Ticket 05 signed-duration parsing. No backend/API/schema/accounting change.

Fresh independent Standards/Spec review found four bounded gaps. Amendments isolate own history
from Timer global hints while supplying explicit recorded rows to the shared Session editor and
explicit own-history tag suggestions; guard parent/child/card/inline-inspector departure; trap private
child Tab focus and restore a persistent launcher before refresh, respecting newer focus owners;
and preserve empty category through the newly reached shared Task editor. Follow-up review caught
and repaired duplicate Settings confirmation, missing stored-tag suggestions after cache isolation,
and nested-launcher disposal after clean child Save. These are part of the same approved shared
acceptance scope, not accounting-policy changes. Existing shared TaskModal zero-to-null behavior is
unchanged and unwaived.

Regression receipts are under `.scratch/codex-continuation/evidence/ticket-05/validation/`.
`review-red-details` records three actual assertion failures; `review-red-category` records empty
category becoming work. Corresponding green receipts pass. `review-red-focus-owner` exposes focus
theft from a newer editor; `review-red-own-tags` exposes absent stored-tag suggestions;
`review-red-refresh-departure` exposes discarded nested-launcher focus. The initial Settings test
had an invalid mock URL; its failure remains. With the fixture corrected, the guard was removed
briefly to obtain genuine `2 !== 1` RED in `review-red-settings-confirm-corrected-fixture`, then
restored and green in `review-green-final-details`. Explicit-row Session and inline Revision link
checks are additional characterizations, not claimed pre-fix RED.

Python sandbox runs hung at TestClient and were stopped by the parent through verified owned pidfds
(exit -15). A bounded diagnostic reproduced the hang on `/health`; imports succeeded. The same
strict private environment outside the sandbox passed `/health`, then sequential focused tests
**35 passed / 4 warnings** and full pytest **517 passed / 242 warnings**. These environment aborts
are preserved separately from product/test failures. New private HOME/TMP/XDG/data, offline editable
Python3.14.6, absolute scratch DB/key/timer siblings and sanitized environment are recorded in the
parent allocation/preflight; no personal/provider material or historical runtime was used.

Final canonical Node, explicit JS/CJS syntax and full Ruff receipts use the `frozen-` prefix.
Node24 reports file-level totals under `--test` (21 files), including TAP; direct focused runs expose
actual subtest totals. Do not substitute the historical 244 assertion count. Scoped Python Ruff and
format checks pass. Repository Ruff retains 18 baseline findings plus the old warning; stdout and
stderr match the preserved baseline. `git diff --check` passes. Python source was unchanged after
its passing full run; later amendments are JS/template/CJS only.

Source/tests are frozen for parent-owned genuine native probes and independent amendment review.
No staged files or commit, integration update, issue completion, spec-Built claim, push, PR or dev
merge is part of this worker checkpoint. Current native outcomes and final reviewer disposition
remain parent-owned. Physical touch/drag, screen readers, other engines, zoom/reduced motion,
exhaustive contrast and human visual acceptance remain unverified; prior contrast and transport
limits remain unwaived.
