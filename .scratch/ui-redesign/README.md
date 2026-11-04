# Whole-UI redesign — implementation backlog

**Publication:** Approved 25-ticket breakdown, published 2026-11-01.
**Implementation spec:** [Whole-UI redesign](../../specs/ui-redesign.md) — Approved 2026-11-01; O1–O8 resolved.
**Current frontier:** 03, 05, 06, 08, 09, 10, 12, 13, 14, 15, 18, 19, 21, 24 after bounded tickets **01 + 02 + 04 + 11 completed**. Other21 tickets remain pending (`ready-for-agent`) subject to the unchanged graph;07/17 blocked05,16 blocked15,20 blocked19,22 blocked05/15/21,23 blocked21;25 is not done. Reservation **11 → 02 → 04** reached reviewed04 F150 by clean FF-only; fresh parent Standards/Spec review of its five-doc closure is required before next checkpoint release.03/10/12/19 dirty uncommitted checkpoints remain STOPPED/read-only, not completed.10 still needs disjoint latest-base preflight.12's unrelated shared ownership-test Widget fixture overlap needs later parent-coordinated fresh reviewed-base own-patch replay/disjoint-hunk reconciliation, not blind dirty FF or touching12 now.13/14 remain technically unblocked but resource-locked by12, not a new DAG edge. Quick Add04 is distinct from Assistant21–23; Grouped/Outline layouts remain06/07 and Settings currently stays `/settings/ai` until19. The spec remains **Approved, not Built**; no human acceptance or dev merge is implied.
**Execution record:** [Implementation and review gates](implementation.md), including the fixed base and external reference evidence.

## Approval record and readiness

The owner first approved the 25-ticket breakdown/dependency graph and local publication with
“everything feels right, approved”. At that point the spec remained Draft and tickets used needs-info;
that approval alone did not choose product policies.

On 2026-11-01, after the full eight-part questionnaire, the owner explicitly answered
“yes to all answer. and final approve as well”. This accepts every recommendation, resolves O1–O8
and approves the final production spec and verification plan. Tickets are now **ready-for-agent**.
This status means specified work, not completed work or permission to ignore technical blockers.
At that historical approval checkpoint, ticket **01** was the sole unblocked frontier. The current
frontier above follows local integration/recorded implementation completion of01,02,04 and11; other blockers remain.

Those approval records did not themselves authorize implementation or commits. The owner has since
requested implementation with local branches/commits and integration merges, as recorded in
[implementation.md](implementation.md). Later review gates remain required; no push, PR or `dev`
merge is authorized. No production code, app runtime or provider calls were part of the historical seed.
Ticket 01 is now integrated at reviewed code `2f3024a701ac1ee0a9e79fdc77abdba868baf998`;
[closure evidence](ticket-01-evidence.md#local-integration-and-bounded-closure-2026-11-02)
records fresh integrated checks, retained failures and deferred manual acceptance. Ticket11 is now integrated at reviewed code `9cf076cc5297cc10e6b157257a35362f18893a20`;
[closure evidence](ticket-11-evidence.md#local-integration-and-bounded-closure-2026-11-02)
records fresh integrated checks, criterion mapping, retained first failures and manual limits.
Ticket02 is integrated at reviewed code `abd7a6da11a9f9589371a8f876ebf38b45fb4d96`;
[closure evidence](ticket-02-evidence.md#local-integration-and-bounded-closure-2026-11-02)
records fresh integrated checks, criterion mapping, preserved first failures and deferred manual acceptance.
Ticket04 is integrated at reviewed code `f15003b821ee60383a7baf4344de3d74b732c1a9`;
[closure evidence](ticket-04-evidence.md#local-integration-and-bounded-closure-2026-11-04)
records fresh377 Python/201 Node/70 syntax, Stats89→all7 Session→all6 Task probes, criterion mapping,
repaired original2P2/new1P2 and retained failures/manual/contrast/transport limits. Prior11 and02 closure
reviews released their next reservations; fresh parent independent04 closure-doc review is now required.
`completed` means delivered implementation with bounded evidence, not all manual/human acceptance.
Ticket approval paragraphs and Comments retain their historical checkpoint wording; the execution
record supplies current authorization without rewriting ticket identities, criteria or history.

## Published tickets and blocking edges

The numbers below are **published ticket IDs**, not the earlier 22 planning IDs. O8 final-spec
approval is resolved for all tickets. Decision references are approved requirements, not outstanding
gates; predecessor decisions still apply to dependent workflows.

| Ticket | Technical blockers | Approved decision references |
| --- | --- | --- |
| [01: Calendar shell and shared appearance](issues/01-calendar-shell.md) | None technically | O1, O2 |
| [02: Session editing and scheduling](issues/02-session-editing.md) | 01 | Inherited; O8 |
| [03: Timer and idle recovery](issues/03-timer-idle-recovery.md) | 01 | Inherited; O8 |
| [04: Kanban and task quick editing](issues/04-kanban-quick-edit.md) | 01 | Inherited; O8 |
| [05: Task details and work accounting](issues/05-task-details-accounting.md) | 04 | Inherited; O8 |
| [06: Grouped task list](issues/06-grouped-task-list.md) | 04 | O2 |
| [07: Outline and inline inspector](issues/07-outline-inspector.md) | 05 | O2 |
| [08: Status management](issues/08-status-management.md) | 04 | Inherited; O8 |
| [09: Advanced filters and Calendar task tabs](issues/09-filters-task-tabs.md) | 04 | Inherited; O8 |
| [10: Compact Habit cards](issues/10-compact-habits.md) | 01 | O3 |
| [11: Dashboard and widget canvas](issues/11-dashboard-canvas.md) | 01 | Inherited; O8 |
| [12: Structured widget builder and comparisons](issues/12-structured-widget-builder.md) | 11 | Inherited; O8 |
| [13: Optional read-only SQL widgets](issues/13-read-only-sql-widgets.md) | 11 | Inherited; O8 |
| [14: Performed-time widget and preset](issues/14-performed-time-widget.md) | 11 | O4 |
| [15: Day workspace and independent history editors](issues/15-day-workspace.md) | 01 | O5 |
| [16: Session reviews](issues/16-session-reviews.md) | 15 | O5 |
| [17: Task post-mortems](issues/17-task-post-mortems.md) | 05 | O5 |
| [18: Rating-definition administration](issues/18-rating-administration.md) | 01 | O5 |
| [19: Tabbed browser preferences](issues/19-browser-preferences.md) | 01 | O2 |
| [20: AI settings and providers](issues/20-ai-settings-providers.md) | 19 | Inherited; O8 |
| [21: Clean shared Assistant](issues/21-clean-assistant.md) | 01 | O6 |
| [22: Proposal approval and recovery](issues/22-proposal-approval.md) | 02, 05, 15, 21 | O6 |
| [23: Remembered-instruction approval](issues/23-instruction-approval.md) | 21 | O6 |
| [24: Markdown export workflow](issues/24-markdown-export.md) | 01 | O7 |
| [25: Whole-app adoption verification](issues/25-whole-app-verification.md) | 02–24 | O1, O2, O3, O4, O5, O6, O7 |

All edges point to earlier tickets; there is no cycle. The approved independent routes are intentional:
SQL adoption need not wait for structured-builder adoption; task post-mortems need task details, not
day reviews; rating administration need not wait for history editors; instruction approval can use the
existing Settings contract before the new Settings presentation lands. Existing working entry paths
must remain available while these independent tickets wait.

## Decision register — all approved

The owner's final approval accepts the following recommendations. The spec is authoritative; update
it before implementation if new ambiguity or a conflict with a settled owner decision is discovered.

| Decision | Approved outcome | Applies to |
| --- | --- | --- |
| O1 | Expose Refined Archive, Soft Stone and Porcelain. Brand-new browsers start Refined Archive/light. Preserve existing appearance/color choices; all light options share the existing dark appearance through manual light/dark switching. No new automatic OS switching. | 01 |
| O2 | Persist theme, task view, Calendar density and totals visibility per browser across reloads. Preserve valid existing settings; apply defaults only to missing/invalid individual settings without resetting others. Use `/settings`; retain `/settings/ai` opening AI. Keep tab drafts, warn before leaving unsaved changes and keep browser/AI/provider saves separate. | 01, 06–07, 19 |
| O3 | Explicit Save/Cancel for entry edits; explicit Done/Failed/Skipped choices, not click-cycling. Clear confirms deletion of only the selected day's record, distinct from numeric zero. Clamp negative numeric values to zero with visible feedback. One record per habit/local date; defer entry clock time, editable notes and multiple daily entries. Leave unit-conversion and reminder behavior unchanged. | 10 |
| O4 | Add Performed time by day only to fresh default dashboards plus a recreation preset; never automatically insert into existing dashboards or restore deleted widgets. Keep original queries unchanged; labels become Recorded session time / Recorded sessions, explaining past and future recorded rows rather than performed work. Preserve user-custom widget names/configurations. | 14 |
| O5 | Preserve shipped required-rating, dismissal, range-edit, context and exemption policies. Independent day-editor rating scoping, five-grade colors and Calendar filter handoff remain required; no new domain policy. | 15–18 |
| O6 | Chat-first Assistant; proposal review and action history on demand, explicit approval cards retained. Keep Enter-send and Shift+Enter-newline. Preserve all existing capabilities and separate remembered-instruction approval. | 21–23 |
| O7 | Six labels: Sessions; Tasks—compact; Tasks—detailed; Habit definitions; Everything; Everything—with session date range. Generated Markdown preview with explicit Copy/Download; no separate legacy session-export menu entry. Keep Ctrl+Enter-download and existing UTC filtering/Today–Tomorrow anchors with visible caveats. | 24 |
| O8 | Production specification and per-ticket regression/isolated real-app workflow checks plus final whole-app verification approved, alongside the already approved 25-ticket graph/publication. At this historical approval checkpoint, no implementation start, commit or merge was requested; the subsequent execution request is recorded separately. | All tickets |

Ticket 25 verifies implementation of these policies. It does not postpone or re-open earlier choices.

## Shared acceptance and safety

These requirements apply to **each ticket**, not just final ticket 25. Read the spec's behavior,
contracts, edge cases and verification matrix in addition to the ticket; resolve conflicts with current
source/settled owner decisions rather than copying historical snapshots.

- Deliver a complete usable workflow through existing presentation/API/service contracts. Reuse the
  real daemon app and shared API client; no new frontend framework/build step or horizontal CSS-only,
  schema-only or test-only delivery. No separate speculative prefactor was identified as a prerequisite.
- Preserve existing routes/aliases, reachable old entries and incremental old/new coexistence.
  Cover empty/loading/error states, dirty Save/Discard/Cancel, late responses, long/untrusted text,
  keyboard/focus restoration, touch alternatives and narrow layout. Global/Vim shortcuts must not
  consume editor typing. Theme/navigation changes must not discard drafts.
- Preserve UUID-string and virtual recurrence identities, naive UTC storage and boundary normalization,
  local session-start-day statistics/week context, distinct UTC export semantics and timer file state.
  No numeric ID parsing, implicit task completion, silently cleared schedules or erased logged history.
- Keep task work accounting, recurrence, query/SQL sandbox and AI approval in their existing domain
  services. Tools propose only; human accept/undo/reapply retains conflict checks and audit. Quick Add
  is read-only extraction into a human-saved form, not conversational draft approval.
- Metadata refresh must preserve drafts/selection and distinguish failed writes from successful writes
  followed by failed reads. Retry only failed work, never duplicate successful session/child/AI writes.
- No approved schema change or new API semantics is implied. Optional Habit clock time/notes/cardinality
  needs separate approval; notes already have storage but lack the current browser log-write contract.
  Any actual schema amendment needs migration and fresh/disposable-existing DB verification without
  stamping or create-all fallback. Do not rewrite stored data/colors or dashboard seeds for appearance.
- **Before any TimeTrace import/command**, set an absolute temporary TIMETRACE_DB_FILE in its own
  directory, isolating DB/timer/key siblings. Use a non-8002 scratch daemon port and isolated browser
  storage. Never access personal data/credentials or real/paid providers; fake providers/agents only.
- Add and run focused behavior regressions within each slice, then the full Python suite in safe-path
  mode, existing relevant Node tests, syntax checks for changed JS, scoped formatting/lint plus a
  repository-wide report, and whitespace checks. Use existing seams, not a new test framework.
  Verify affected real-daemon/browser workflows; ticket 25 cannot substitute for per-ticket integration.
- Record exact passes/failures and unrun checks; separate baseline issues. Historical prototype/Python
  receipts are not fresh validation. Measure applicable contrast and disclose physical-touch,
  screen-reader or browser-engine gaps instead of claiming accessibility certification.
- The later execution request authorizes local implementation branches/commits and integration merges,
  subject to per-commit independent two-axis review managed by the parent. No push, PR or `dev` merge
  is authorized. Later feature merge review still needs automated checks, independent adversarial
  review and explicit human approval. Completion is not merge permission.

## Mapping from historical planning IDs

The [coverage plan](plan.md) and [independent review](spec-review.md) retain historical planning IDs.
The published graph above is the approved execution breakdown; don't mix the two number systems.

| Original candidate | Published ticket(s) |
| --- | --- |
| 01–11 | 01–11, unchanged numbering |
| 12: builder/comparisons/SQL | 12 structured builder/comparisons; 13 optional SQL |
| 13: performed preset | 14 |
| 14: day workspace | 15 |
| 15: session/task reviews | 16 session reviews; 17 task post-mortems |
| 16: rating administration | 18 |
| 17: browser Settings | 19 |
| 18: AI Settings/providers | 20 |
| 19: Assistant | 21 |
| 20: domain/instruction approval | 22 domain proposals; 23 remembered instructions |
| 21: Export | 24 |
| 22: whole-app acceptance | 25 |

The 09→01 edge was omitted as transitively satisfied through 04. Unnecessary day-review blockers
were removed from task post-mortems and rating administration as approved in the proposal. Tests
remain inside every ticket; 25 adds whole-app adoption verification.
