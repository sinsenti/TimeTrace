# UI redesign Draft — independent review and reconciliation
Status: Review complete; Draft corrected; subsequent owner decisions and final specification approved
Date: 2026-11-01

This review preserves the historical approval-only checkpoint and original planning IDs, not current
execution authorization. Implementation has since been requested; see [the execution record](implementation.md).
The spec remains Approved, not Built; no production ticket is completed by this documentation seed.
Historical prototype/checkpoint evidence is external/untracked in the read-only owner checkout,
not bundled here. This document is not the independent review of the seed commit.

## Scope and verdict

Reviewed the newly synthesized [production Draft](../../specs/ui-redesign.md), not an approved spec
or an implementation diff. The production spec was absent at session start. HEAD remained
`82fabdc652c59da87de0f57d7770d0aa32fb7f64`; reviewers read the actual dirty working tree, including
untracked plan/prototype records. Parent wrote only the new Draft and this findings document.
Existing changes and prototype runtime were preserved.

Two fresh read-only reviewers ran in parallel, without nested delegation:

| Axis | Result before reconciliation |
| --- | --- |
| Owner-decision fidelity | Selected page layouts, all three acceptable light options, retained dark appearance, clean-chat intention and open decisions match latest records. Two NITS: provider activation wording and omitted accepted breakdown readability details. |
| Current-code contracts, whole-UI coverage and dependencies | Important time/ID/accounting/recurrence/privacy/approval contracts retained. Two CHANGES: omitted task-modal AI Quick Add; missing slice-14 scoped-rating integration/gate. One NIT: Habit notes already have storage. |

Neither reviewer reported a BLOCK-level finding. Both supported continued Draft review only;
contract reviewer required changes before approval/publication. Parent source-checked and accepted
all five findings below. **Documentation corrections are incorporated; production issues are not
claimed fixed, and corrected text has not received a second independent review.**

## Accepted findings and smallest corrections

### C1 — CHANGES / P1: Preserve task-modal AI Quick Add separately

- **Spec:** B3, AI layer, slice 04, Task/session/timer verification seam.
- **Evidence:** `src/timetrace/interfaces/api/templates/components/task_modal.html:10–16`;
  `static/js/ai_quickadd.js:1–137`; `routers/ai.py:449–463`;
  `src/timetrace/services/ai_chat_service.py:665–704`. The optional strip is included on both
  Calendar (`templates/dashboard.html:283`) and Tasks (`templates/tasks.html:135`). Paths abbreviated
  with `static/`, `routers/`, `templates/` here are under `src/timetrace/interfaces/api/`.
- **Consequence:** Service title parsing and conversational proposals do not replace classify →
  explicit Parse → editable prefill → ordinary human Save. A modal redesign could otherwise drop it.
- **Correction:** Explicit retention in B3/slice 04 and layer map. Add fake-provider/API/browser checks
  for no inference during classify, no task/session creation during Parse, reviewable fields, routing,
  fallback/errors and keyboard handling. This read-only extraction path is distinct from chat drafts.
- **Owner question:** None unless removal is desired; preserve shipped functionality.

### C2 — CHANGES / P1: Scope day ratings in slice 14, not later

- **Spec:** B6, O5 gate, slice 14 and Habits/Revision/ratings verification seam.
- **Evidence:** `static/js/day_review.js` renders day ratings and validates/submits them during Save;
  `static/js/ratings_config.js:33–42,50–66,92–121` uses definition-only IDs and document-wide selectors.
  The accepted [Revision record](/home/user/git/personal/TimeTrace/src/timetrace/interfaces/api/prototypes/app_shell/README.md)
  requires independent simultaneous main/history editors with unique controls.
- **Consequence:** Two editors with the same rating definition would have duplicate IDs and can
  submit another day's values if existing binding is reused unchanged. Slice 14 cannot be a complete
  vertical day-review workflow while deferring this problem to scale administration in slice 16.
- **Correction:** Slice 14 owns unique per-editor identities, scoped validation/submission and
  independent load/dirty ownership; applicable O5 policy precedes it. Keep definition administration
  in 16 (dependent on 14), avoiding a reverse edge/cycle. Add two-day same-definition tests including
  dismissal and partial/failed saves without cross-day writes.
- **Owner question:** Only the existing O5 preserve-or-explicitly-change policy choice. Technical
  editor scoping does not need a new product decision.

### N1 — NITS / P2: Activation does not add confirmation

- **Spec:** B7.
- **Evidence:** Prototype README records “activation, confirmed deletion”; production
  `static/js/ai_settings_page.js:203–217` activates on the explicit button, while `227–234` confirms deletion.
- **Consequence:** “confirmed deletion/activation” could accidentally add a new confirmation step.
- **Correction:** Say “confirmed deletion and explicit activation”.
- **Owner question:** None.

### N2 — NITS / P2: Retain accepted breakdown readability details

- **Spec:** B6.
- **Evidence:** Prototype README:197–211 records 13px labels, explicit hours, larger clickable rows,
  no extra percentage column, aligned heading/switch on narrow cards with time/actions allowed to wrap.
- **Consequence:** Overall composition alone would not protect the details that motivated acceptance.
- **Correction:** Carry those constraints into B6; no redesign or extra approval implied.
- **Owner question:** None.

### N3 — NITS / P2: Habit notes do not inherently need a migration

- **Spec:** Data/API/layers and O3.
- **Evidence:** `src/timetrace/db/models.py:199–205` already has `HabitLog.notes`;
  migration `0001_initial_schema.py` creates it. `interfaces/api/schemas.py:273–277` does not expose
  notes in the browser log-write request. Parent verified model/schema and current log service.
- **Consequence:** A blanket metadata migration/backfill requirement could invent a duplicate column
  and obscure the actual unsupported browser/API-write contract.
- **Correction:** O3 metadata still needs approval and API/behavior reconciliation. Migration/backfill
  is conditional on actual storage/transformation needs; clock time and cardinality stay separately gated.
- **Owner question:** None to make this factual correction; optional metadata remains unapproved.

## Traceable coverage assessment

This is static sampling, not exhaustive service correctness or user-gesture certification. Current
source wins over historical snapshots. The reviewers read the complete Draft, plan and relevant
latest decision records; the fidelity reviewer also read the complete 680-line prototype README.

| Candidate slices | Contracts sampled / preserved assessment |
| --- | --- |
| 01 | `routers/web.py`, navbar and `settings.js`: aliases/direct entry, selected geometry, shared includes, existing preferences, O1/O2 before adoption. No common base template assumed. |
| 02–03 | Session popup/calendar/session router/service plus timer/idle: focus/keyboard, occurrence scopes/materialization/history, unknown recurrence guard, recovery and file state versus rows. |
| 04–09 | Task modal/API/service, details/subtasks, Kanban statuses, custom filters and sidebar preferences: quick-add/inheritance/status synchronization, partial child writes, same contracts across views, retained saved configuration. C1 closes the Quick Add omission. |
| 05 accounting | Shared `TaskService.get_work_accounting`, session SQL totals and work-accounting tests: own real rows, one cutoff, no virtual/timer/open/straddling time, negative balances, recurring budgets. Negative estimates have null progress but retain finite balances; plan's “non-positive unbounded” shorthand is not authoritative. |
| 10 | Habits template/router/service/schema/model: numeric clamping/status, upsert/erase, history/goal history and metadata limits. O3 remains gated; N3 avoids unnecessary storage assumptions. |
| 11–13 | Dashboards/builder/API/service, seeds, query compiler and SQL sandbox: localStorage handoff, named widgets, comparisons, full capabilities, attribution, opt-in SQL and no destructive reseeding. Existing builder can remain while 12 waits, so no mandatory 12→13 edge. |
| 14–16 | Day/session reviews, Revision/Rating services and rating binding: local created-day task counts, recorded-row caveat, handoff, independent flags and destructive writes. C2 fixes slice-14 prerequisite/integration ownership without a cycle. |
| 17–18 | Browser settings and idle toggle, provider editor/router and AI settings: distinct owners, masked keys, omit/replace/clear API contract, activation/deletion and safe probes. Key clearing is API-supported, not already a fully wired browser affordance; production adoption must verify it. |
| 19–20 | Assistant real Calendar reparenting/fullscreen, draft refresh/completion forwarding, draft service accept/audit/materialized IDs: existing Settings link permits 19 before 18. Keep proposals editable and safe refresh independent of batch-read failure. |
| 21 | Calendar export/download shortcut, analytics router/service: six modes, UTC session-start filtering, unfiltered tasks/habits, UTC Today/Tomorrow versus local display and future recurring projection. |
| 22 | All seven current page include lists, including AI Settings and task details: cross-page coexistence, no missing global components or postponed per-slice integration acceptance. |

Existing tests inspected include task work accounting, recurrence service, dashboards API, AI
reflection coverage and Node metadata regressions. `tests/conftest.py` isolates DB/timer state and
uses the real daemon app without lifespan; it is not migration or browser evidence. The Draft's
proposed higher-level real-daemon workflows plus focused existing API/service/Node seams remain
appropriate, with the two new C1/C2 checks. No new test framework is proposed.

## Owner checkpoint and delivery granularity

Settled layouts/light acceptance are not reopened. The Draft's O1–O7 hold remaining production
choices; recommendations are explicitly proposals, not defaults approved by a reviewer:

1. Theme default/availability/dark mapping and non-destructive existing preference adoption (O1–O2).
2. Habit entry interaction/policy versus optional metadata (O3); recommend defer time/notes/cardinality.
3. Performed-widget new/existing seed rollout and original Logged labels/scope (O4).
4. Preserve shipped Revision/rating policy or name explicit changes (O5), including slice-14 context.
5. Clean Assistant composition and Enter/Ctrl+Enter policy (O6); preserve all existing capabilities.
6. Export labels/preview/copy/legacy entry/shortcut, without silent UTC policy changes (O7).
7. Approve the corrected Draft, verification seams and final slice granularity/dependencies (O8).

The 22 candidates remain a proposed graph, not published tickets or a release commitment. C1 stays
inside 04; C2 stays inside 14; all slices carry regression tests. Consider splitting 12 (structured/
comparisons/SQL), 15 (session/task reviews) and 20 (domain draft approval/instruction approval) before
publication if too large for one fresh context. No horizontal CSS/API/database/test-only backlog.

## Validation and limits

- Both reviewers: read-only; no edits, tests, browsers, app/provider calls or personal DB/daemon access.
- Parent: source reads, Draft/findings edits, local Markdown-link/ID/graph/whitespace checks only.
  No production code or prototype runtime changes, no ticket publication or commit/push/merge.
- Historical 341 Python passes and prototype assertions were **not rerun**. Full Python/Node/Ruff/
  browser/migration checks are not claimed for this documentation-only task.
- Original review run: `dfd19cf1-a208-482a-943b-e3c24a95f3b2`; fresh children
  `cefd27cf-2f36-4f48-993b-9503405aa75b` (fidelity) and
  `53c58a19-db4b-462b-be65-e333ba3cf430` (contracts). Original detailed reports are retained in session
  subagent artifacts; this repo document consolidates their findings and the parent's disposition.

At review close, the next step was owner decisions and explicit Draft/breakdown approval, not production implementation.

## Subsequent ticket publication

The owner approved the later 25-ticket granularity/dependency proposal and local publication with
“everything feels right, approved”. The [published backlog](README.md) supersedes the historical
22-candidate graph for execution; its mapping preserves this review's original planning references.
Builder/SQL, session/task reviews and domain/instruction approval are split; unnecessary day-review
blockers are removed from task post-mortems and rating administration. Review findings C1/C2 remain
covered by published tickets 04 and 15 respectively. At publication, product questions were still open:
the spec stayed Draft and tickets used needs-info pending decisions and explicit implementation-spec
approval. No production implementation or runtime tests were performed.

## Subsequent final owner approval

On 2026-11-01 the owner answered “yes to all answer. and final approve as well” to the eight-part
questionnaire. All recommendations and O1–O8 are now approved, including the final spec and its
verification plan. The spec is Approved and all 25 tickets are ready-for-agent subject to unchanged
technical blockers; ticket 01 is the sole current frontier. The spec/backlog contain the exact approved
outcomes for themes/adoption, Habit entry interactions, Statistics rollout/labels, preserved rating
policies, Assistant composition/shortcuts and Export presentation/semantics.

This is owner approval, not a second independent review or implementation certification. Recording it
does not begin coding or authorize commit/merge. Only documentation/status updates and static document
checks were performed; no app tests, runtime, personal database or provider calls were used.
