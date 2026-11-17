# Deepen five TimeTrace modules
Status: Built
Date: 2026-10-30
Approved: 2026-10-30
Reconciled: 2026-10-31 (implementation and automated verification; manual acceptance deferred)

## Problem
Task accounting and provider construction duplicate domain knowledge; chat modes repeat lifecycle
decisions. Model-facing read checks and browser task metadata require coordinated edits across
callers. Deepen these modules without redesigning shipped behavior, except the calendar corrections
explicitly agreed during the owner interview. Source baseline: `99e863a`.

## Behavior
1. MUST preserve existing HTTP routes, request/response shapes, errors, defaults, accounting meanings,
   and approval/audit behavior except the explicit calendar corrections below.
2. MUST give ordinary task statistics and AI task progress one authoritative work-accounting
   implementation, preserving rounding, negative balances, progress above 100%, and recurring/
   zero-estimate unbounded behavior. Count recorded sessions, not virtual projections or running timers:
   logged ends at/before the measurement instant; scheduled starts after it; straddling sessions
   count as neither. Remaining = estimate - logged; unscheduled = estimate - logged - scheduled.
3. MUST use the existing DB-free provider constructor for both chat and connectivity probes.
   Preserve provider routing, credential ownership, option precedence, caller-specific error handling,
   and the probe's smaller timeout/token caps. This intentionally replaces the duplication rationale
   in `core/ai/providers.py`; no new provider framework.
4. MUST share chat preparation, persistence, batch finalization and failure cleanup while preserving
   streaming tokens/event order and non-streaming results. Preserve eager batches, empty-batch cleanup,
   original-message intent gating, history ordering, retained draft behavior and sanitized errors;
   never execute a turn twice to produce both delivery forms.
5. MUST consolidate model-facing read context and its existing scope checks behind the existing
   gateway interface, without adding forwarding-only modules. Preserve per-tool short-lived DB
   sessions and effective permissions, including current cross-domain outputs: task-only progress
   exposes session aggregates; sessions-only listing/validation may expose linked task information.
   Characterize these exceptions; do not tighten checks, filter fields or claim stronger privacy.
   Human-local insight reads and PII redaction remain separate and unchanged.
6. MUST make a focused task-knowledge module own metadata loading, lookup, invalidation and refresh
   ordering. After successful same-page task changes, including AI accept/undo/reapply, update affected
   calendar, sidebar, task/kanban and attachment views present on that page through existing rendering
   paths. Do not overwrite unsaved form values or depend on draft-card refresh succeeding first.
7. MUST distinguish unloaded, successfully empty, stale and failed metadata; deduplicate overlapping
   loads and prevent older results from replacing newer post-mutation metadata. On failure, retain
   last-known display with a non-blocking stale/unavailable notice and retry. An already-saved mutation
   remains successful; retry refresh only, never replay its write.
8. MUST preserve a session's existing task ID when metadata is missing; detach only by explicit user
   action or authoritative daemon data. Retain ordinary stale/title-only drop and attachment fallbacks.
   Do not treat genuinely unknown recurrence status as nonrecurring: obtain that information or stop
   only the recurrence-sensitive action. A metadata miss is not proof that a task was deleted.

## Data
No schema changes, migrations, backfills or existing-row rewrites.

## Layers and ordered implementation
Each step is separately verified; no commits/merges are implied.
1. **Task accounting** — `services/task_service.py` owns task balances; reuse existing SQL totals in
   `services/session_service.py`; `services/ai_insights_service.py` consumes the same accounting
   capability without importing the task inspector's richer reviews/ratings/session composition.
2. **Provider construction** — `core/ai/providers.py` owns plain-value construction;
   `services/ai_provider_service.py` and `services/ai_chat_service.py` retain configuration extraction,
   decryption and caller-specific handling. Keep `core/` free of DB/framework-request dependencies.
3. **Chat lifecycle** — shared internal implementation in `services/ai_chat_service.py`;
   keep existing turn entry points and JSON/SSE adapters, using `core/ai/agent.py` and fake models.
4. **Scoped reads** — `services/ai_tool_gateway.py` owns the model-facing read seam and scope/session
   execution responsibility; deterministic facts remain reusable from `ai_insights_service.py`.
   Preserve `core/ai/spec.py` and tool-facing contracts; no generic authorization framework.
5. **Task knowledge** — `static/js/task_attach.js` and its consumers in `calendar.js`, `dashboard.js`,
   `task_modal.js`, `session_modal.js`, `sidebar_totals.js`, task/kanban code, recurrence controls,
   and `ai_drafts.js`/`ai_draft_overlay.js`. Replace direct mutable-cache coupling where affected;
   use the shared HTTP adapter. Check every affected template include; there is no common base.
Routers, schemas and CLI: no new routes, fields or commands; existing callers retain their contracts.

## Time and ids
Preserve naive UTC storage and existing UTC normalization/local-calendar conversion.
Use a consistent measurement instant within an accounting result and deterministic cutoffs in tests.
Preserve UUIDv7 strings, suffix display IDs, synthetic `virt:` occurrence IDs and materialized-ID handling.

## Edge cases
Characterize exact-now cutoffs, open/straddling sessions, no sessions, recurring/zero estimates,
overspend and AI/ordinary-accounting parity before consolidation. Preserve both chat modes'
initialization/tool/provider failures, empty replies, proposals and partial/retained draft batches.
Cover missing/deleted tasks, incomplete fallback metadata, cold/empty caches, failed refreshes,
out-of-order requests, AI accept/undo/reapply and repeated refreshes. Never infer deletion from absence.
If characterization reveals incompatible existing contracts, stop rather than silently standardize them.

## Out of scope
Stricter AI scope policy; new providers; semantic memory; recurring-series/accounting redesign;
new dependencies, externally exposed HTTP/CLI contracts or DB changes; cross-tab/CLI auto-refresh,
polling or sync;
a universal frontend state/refresh framework; unrelated fixes, user prototypes, commits and merges.
Preserve draft-only tools, explicit approval, conflict-safe undo/reapply, completion-policy prompts,
task-title restoration rules, SQL statistics and recurrence history.

## Verification
- Add characterization/regression tests through caller-visible interfaces with fake models/gateways,
  existing in-memory SQLite and Node VM tests; no personal data or live/provider calls.
- Verify accounting parity, provider routing/probe caps, chat-mode persistence/event parity,
  unchanged scope allow/deny and mixed-scope outputs, and all calendar corrections/fallbacks above.
- Keep existing tests unless equivalent behavioral coverage replaces implementation-coupled assertions.
- Run focused tests per step; full `uv run python -P -m pytest -q`, applicable Node tests,
  `uv run ruff check .`, `node --check` for each changed JS file, and `git diff --check` before completion.
- Exercise affected pages and failure/retry flows on an isolated scratch daemon/browser, not port 8002
  or the personal DB. Report exactly what passed, failed or remained unverified.
- Update relevant maintenance/development documentation and the provider duplication rationale.
  No migration test is needed unless scope changes; such a change requires renewed approval.

## Approval and execution
The owner approved this written spec on 2026-10-30, including the exceptions recorded above and
sequential execution, and selected splitting calendar work into metadata-freshness and task-link/
recurrence-safeguard tickets. Six implementation tickets in `.scratch/module-deepening/issues/`
deliver the five logical steps in order, without another routine approval between them. Stop for new
ambiguity, scope changes or conflicts with settled owner decisions. Ticket publication was not code
implementation and did not authorize commits or merges. Existing implementation commits are recorded
below; this reconciliation authorizes no further commit, publication or merge.

### Follow-up owner approval (2026-10-31)

After the whole-delivery review, the owner explicitly approved **Option A**: non-positive or
missing estimates return `null` progress in both ordinary statistics and AI task progress.
This is an approved exception to behavior preservation above: the old AI result for a negative
estimate could be a negative percentage, while the inspector already returned no progress.
Keep stored estimates, existing `is_unbounded` flags, remaining/unscheduled work, negative balances
from overspending, and progress above 100% unchanged. Do not reject or rewrite negative estimates.
The existing negative-estimate regression in `tests/test_task_work_accounting.py` matches this decision.
The owner also approved caller-visible automated regressions for the four review repairs; browser
acceptance, commits, publication and merges remain excluded.

## Delivery reconciliation (2026-10-31)

All six implementation tickets are `completed`; this spec is `Built`. Checked acceptance criteria
record implementation/test evidence, not a claim that every possible manual gesture was exercised.
The owner requested reconciliation and non-manual checks, excluding further manual acceptance.
This pass inspected the approved contract, implementation diffs, current source/test seams and the
existing browser receipts; it is not a new independent acceptance audit or the merge-review gate.

| Ticket | Implementation | Ownership and regression evidence |
| --- | --- | --- |
| [01](https://github.com/sinsenti/TimeTrace/issues/46) | `3efc345` | `TaskService.get_work_accounting` supplies inspector and AI progress via SQL totals; `tests/test_task_work_accounting.py` covers cutoffs, balances, rounding, timers/projections and inspector separation. |
| [02](https://github.com/sinsenti/TimeTrace/issues/47) | `83d8cee` | `core.ai.providers.get_chat_model` supplies chat/probes; `tests/test_ai_provider_construction.py` covers routing, options, credentials, caps and caller-specific errors using fakes. |
| [03](https://github.com/sinsenti/TimeTrace/issues/48) | `b2174da` | `AIChatService._run_turn` owns JSON/SSE lifecycle; `tests/test_ai_chat_lifecycle.py` plus `tests/test_ai_instruction_chat.py` cover one execution, event/transcript persistence, instructions, failures and batch cleanup/retention. |
| [04](https://github.com/sinsenti/TimeTrace/issues/49) | `788e47e` | `DbAIToolGateway._read_context` owns scoped read sessions; `tests/test_ai_read_context.py` covers ordered scope checks, mixed-domain outputs, bounds and concurrent connection cleanup. |
| [05](https://github.com/sinsenti/TimeTrace/issues/50) | `39dc248` | `task_knowledge.js` owns metadata/refresh; `tests/test_task_knowledge.cjs` and calendar/tag regressions cover ordering, retry-only refresh, unsaved fields and ordinary/AI mutations. |
| [06](https://github.com/sinsenti/TimeTrace/issues/51) | `5599ade` | Public session/attachment/calendar Node workflows cover retained links, explicit/authoritative detach, unknown recurrence, cancellation and materialized IDs; existing Python recurrence regressions cover scope/history safeguards. |

### Automated verification rerun at `5599ade`

- `uv run python -P -m pytest -q`: **341 passed**, 85 SQLite datetime-adapter deprecation warnings.
- Focused accounting/provider/lifecycle/read-context files: **149 passed**.
- Focused `test_session_service.py`, `test_recurrence_service.py`, `test_tasks_api.py`: **42 passed**.
- `node --test tests/*.cjs tests/test_tags_engine.js`: **48 passed**.
- `node --check`: passed for all **15 JS and 2 CJS** files changed from `5792df9` through `5599ade`.
- `uv run ruff check .`: **18 pre-existing violations**, confined to
  `0002_add_task_statuses_and_subtasks.py`, `interfaces/cli/commands.py` and
  `services/analytics_service.py`; all three files are unchanged from `5792df9`.
  Ruff passed for all Python files changed by the six implementation commits. No unrelated lint fixes.
- Implementation-range and working-tree `git diff --check`: passed.
- Fresh isolated daemon `/health` and an ORM-backed `/api/tasks?status=all` read passed on port
  **43473**, with a new temporary DB directory; daemon stopped afterward. No personal DB/provider use.
- No schema, migration, dependency, router/schema or tool-interface files changed in the delivery
  range. Existing-DB migration testing is not applicable to this scope; no personal DB copy used.
- Typechecking not run: none is configured/installed. No new browser/manual checks performed.

### Whole-delivery review repairs (2026-10-31)

The subsequent independent whole-delivery review required four repairs before owner manual testing.
Caller-visible regressions first reproduced unsafe accepted-task markup, keyboard deletion bypassing
recurrence checks, lost unsaved timer selection, and interrupted selection retaining another task's
review. These paths are now repaired in the working tree (no new commit):

- Context-safe text rendering in refreshed task cards, suggestions, revision chips, task-tree labels,
  histories, calendar event labels and breakdowns. Existing malformed target-date fallback badges are
  escaped at the same card-rendering boundaries. Kanban descriptions are literal previews, not Markdown/HTML; Marked is no
  longer included. Dynamic tag/status values use data attributes rather than JavaScript string interpolation.
- Keyboard Delete delegates to the same guarded recurrence-aware path as mouse deletion, including
  missing metadata, virtual/materialized identities and explicit scope selection.
- Timer option refresh retains the selected task when completed, filtered out or absent from metadata;
  Start still sends that task ID, and explicit detach still sends null.
- Review fields have an initialized task owner independent of selection. Interrupted selection initializes
  the correct review/rating inputs before Save is allowed. Request tokens also protect against late
  statistics/rating-definition responses, including multiple requests for the same task.

`tests/test_task_knowledge.cjs` adds 25 public workflow regressions. The timer tests use a bounded
native-select-semantics double; text-safety tests inspect renderer output. Neither is browser execution.
Fresh read-only independent repair review and date-badge/calendar delta rechecks found no introduced
defects. These reviewed the repair diff, not the entire delivery again, and executed no tests.
Actual keyboard event dispatch, real-DOM rating submissions and automated template include-order
regressions remain unverified; current template order was inspected. This is not human approval.

Automated verification after the repairs:

- Full Python suite: **341 passed**, **85** existing SQLite datetime-adapter warnings.
- Full Node suite: **73 passed** (previously 48).
- Syntax: all **9 changed JS files and 1 CJS file** passed `node --check`; `git diff --check` passed.
- Global Ruff still reports **18 baseline violations** in the same three files listed above, all
  unchanged versus `5792df9`; all **11 Python files** in the original implementation range pass Ruff.
- Fresh isolated daemon `/health` and ORM task-list read passed on port **43879**, DB
  `/tmp/tt-repair-daemon.bltSDL/timetrace.db`; HTTP template reads for dashboard/tasks/revision and
  changed utility/deletion/inspector asset reads passed. The daemon was stopped afterward.
- No Python implementation, schema, migration, Python dependency or HTTP contract changes in the repair.
  No existing-DB migration check was needed or run. No personal data or provider calls were used.
- No browser/manual acceptance or configured typechecker run. Prior browser evidence is inherited
  only; the deferred manual checks below remain unverified.

### Deferred manual acceptance

Prior isolated-browser coverage and its exact limits remain authoritative in
[Same-page task metadata](../docs/development.md#same-page-task-metadata). Existing receipts include
all seven page includes, synthetic AI accept/undo/reapply, metadata failure/retry and task-link/
recurrence workflows; they were not repeated in this reconciliation.

The remaining manual checks are deliberately **unverified**, not failed or silently waived:

- Physical calendar drag/drop/resize and status-manager gestures.
- Series deletion/history behavior in the browser (server-side scope/history regressions pass).
- Completion-policy prompt interaction.
- Multi-item AI draft batches in the browser.

These do not represent missing implementation tickets. No release/merge approval is implied;
any future merge still requires the project's full merge-review and explicit human approval.
