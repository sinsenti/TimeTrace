# GitHub issue migration — 2026-11-17

GitHub Issues in [sinsenti/TimeTrace](https://github.com/sinsenti/TimeTrace/issues) is the live tracker.
This file is an immutable migration cross-reference, not a second lifecycle store: the states below
are the verified import dispositions; read GitHub for later changes.

## Scope and reconciliation

The owner approved public sanitized migration after read-only audits of all nine Agenda tickets,
all seven Google Calendar decisions, all 25 UI tickets, all six module tickets and other root/docs
plans. Completed tickets were explicitly requested as closed GitHub history rather than local-only
archives. Existing files, user edits and failed/unknown evidence remain preserved.

- Agenda: approved nine-ticket graph, no production implementation; shared technical-contract review
  stays inside the first ticket. Ownership, live-timer/destructive-operation, idle-resume, taskless
  totals, manual future work and accounting-transition policies remain questions, not new approvals.
- Google Calendar: provider research completed; six decision/prerequisite tickets remain open and
  planning stays deferred until Agenda's complete-flow gate and accepted-baseline evidence.
- UI: delivered, owner-accepted and merged into dev at `2992d96`; inherited final checks were
  614 Python / 801 Node, 34 changed-JS syntax checks, 18 inherited Ruff findings, independent reviews
  zero findings on both axes. No new UI test execution is implied by migration.
- Modules: all six implementation tickets built; original post-repair evidence was 341 Python /
  73 Node. Later UI evidence is not retroactive proof of each original manual gesture.
- SQL Settings departure/deferred-blur repair and AI remembered-instruction hardening are delivered.
- The NULL/empty comparison-key baseline collision is separate open bug triage. Deferred platform,
  accessibility and exact AI/module manual verification are coverage work, not alleged product bugs.
- Native clients, multi-user, automations, travel semantics and speculative infrastructure remain
  deferred roadmap context; no actionable implementation tickets were inferred for them.

The older Agenda generator wording was corrected to preserve the already-shipped RRULE projection
and exceptions. No recurrence rewrite or bulk pre-generation was approved. The other 291 original
Agenda/UI/module acceptance criteria were retained under whitespace/markup normalization.

Public bodies are self-contained reviewed summaries. Local-only specs, research, runtime receipts,
private transcripts and databases were not uploaded. Pinned links point to reachable tracked source;
local paths in the table below identify original records, not public attachments. Migrated local
tickets and old UI exploration files were subsequently archived outside the checkout; see below.

## Verified import

- **56 issues:** 36 closed historical records and 20 open issues (including parent/map issues).
- **48 native parent-child links** and **80 native blocking edges**, read back after writes.
- Issue titles, complete rendered bodies, labels, state/reason, native relationships and two durable triage brief comments were verified through GitHub.
- Eight offline migration-safety checks passed; all 79 upstream skill files match the pinned manifest, and 104 unique pinned source-link targets exist in the published dev commit.
- Application tests were not rerun: this delivery changes tracker/documentation only. No personal database, live provider, commit, push, PR or application restart was used.
- Imported manifest SHA-256: `2958c494b2d24f27fba44c44124b638539ca3515954dfc3a1b0c36b59698072d`.

## Main entries

- [Agenda: scheduled sessions, recorded work, and independent timers](https://github.com/sinsenti/TimeTrace/issues/1)
- [Google Calendar synchronization](https://github.com/sinsenti/TimeTrace/issues/11)
- [Whole-UI redesign — delivered historical parent](https://github.com/sinsenti/TimeTrace/issues/14)
- [Module deepening — delivered historical parent](https://github.com/sinsenti/TimeTrace/issues/45)
- [Comparison baseline identity collides for NULL and empty dimension keys](https://github.com/sinsenti/TimeTrace/issues/54)
- [Reconcile bounded UI platform and AI/module manual acceptance gaps](https://github.com/sinsenti/TimeTrace/issues/55)
- [Reconcile delivered status and stale references without overwriting owner edits](https://github.com/sinsenti/TimeTrace/issues/56)

## Original record → GitHub successor

| Original record / scope | GitHub issue | Import disposition |
| --- | --- | --- |
| `specs/agenda-plan-record.md` | [Agenda: scheduled sessions, recorded work, and independent timers](https://github.com/sinsenti/TimeTrace/issues/1) | Open |
| `.scratch/agenda-plan-record/issues/01-real-agenda-and-data-foundation.md` | [Agenda 01: Real Agenda and data foundation](https://github.com/sinsenti/TimeTrace/issues/2) | Open |
| `.scratch/agenda-plan-record/issues/02-manual-recorded-work.md` | [Agenda 02: Manual recorded work](https://github.com/sinsenti/TimeTrace/issues/3) | Open |
| `.scratch/agenda-plan-record/issues/03-multiple-running-timers.md` | [Agenda 03: Multiple running timers](https://github.com/sinsenti/TimeTrace/issues/4) | Open |
| `.scratch/agenda-plan-record/issues/04-per-timer-idle-review.md` | [Agenda 04: Per-timer idle review](https://github.com/sinsenti/TimeTrace/issues/5) | Open |
| `.scratch/agenda-plan-record/issues/05-explicit-session-extension.md` | [Agenda 05: Explicit scheduled-session extension](https://github.com/sinsenti/TimeTrace/issues/6) | Open |
| `.scratch/agenda-plan-record/issues/06-delete-or-squeeze.md` | [Agenda 06: Delete or squeeze a scheduled session](https://github.com/sinsenti/TimeTrace/issues/7) | Open |
| `.scratch/agenda-plan-record/issues/07-existing-calendar-integration.md` | [Agenda 07: Existing Calendar integration](https://github.com/sinsenti/TimeTrace/issues/8) | Open |
| `.scratch/agenda-plan-record/issues/08-statistics-and-comparisons.md` | [Agenda 08: Statistics and plan-versus-record comparisons](https://github.com/sinsenti/TimeTrace/issues/9) | Open |
| `.scratch/agenda-plan-record/issues/09-complete-flow-verification.md` | [Agenda 09: Complete-flow verification and release gate](https://github.com/sinsenti/TimeTrace/issues/10) | Open |
| `.scratch/google-calendar-sync/map.md` | [Google Calendar synchronization](https://github.com/sinsenti/TimeTrace/issues/11) | Open |
| `.scratch/google-calendar-sync/issues/01-google-api-constraints.md` | [Establish Google Calendar API constraints](https://github.com/sinsenti/TimeTrace/issues/12) | Closed: completed |
| `.scratch/google-calendar-sync/issues/02-imported-event-model.md` | [Choose how imported Google events relate to TimeTrace sessions](https://github.com/sinsenti/TimeTrace/issues/20) | Open |
| `.scratch/google-calendar-sync/issues/03-calendar-connection-lifecycle.md` | [Choose account connection and calendar selection behavior](https://github.com/sinsenti/TimeTrace/issues/21) | Open |
| `.scratch/google-calendar-sync/issues/04-polling-recovery.md` | [Choose polling, catch-up and import recovery behavior](https://github.com/sinsenti/TimeTrace/issues/22) | Open |
| `.scratch/google-calendar-sync/issues/05-source-change-lifecycle.md` | [Choose how Google edits, deletions and recurrence changes affect imported events](https://github.com/sinsenti/TimeTrace/issues/23) | Open |
| `.scratch/google-calendar-sync/issues/06-backend-contract-acceptance.md` | [Define backend operations and acceptance checks before frontend work](https://github.com/sinsenti/TimeTrace/issues/24) | Open |
| `.scratch/google-calendar-sync/issues/07-focus-time-refactor-prerequisite.md` | [Confirm the focus-time refactor is ready for calendar integration](https://github.com/sinsenti/TimeTrace/issues/13) | Open |
| `.scratch/ui-redesign/README.md` | [Whole-UI redesign — delivered historical parent](https://github.com/sinsenti/TimeTrace/issues/14) | Closed: completed |
| `.scratch/ui-redesign/issues/01-calendar-shell.md` | [UI 01: Calendar shell and shared appearance](https://github.com/sinsenti/TimeTrace/issues/15) | Closed: completed |
| `.scratch/ui-redesign/issues/02-session-editing.md` | [UI 02: Session editing and scheduling](https://github.com/sinsenti/TimeTrace/issues/16) | Closed: completed |
| `.scratch/ui-redesign/issues/03-timer-idle-recovery.md` | [UI 03: Timer and idle recovery](https://github.com/sinsenti/TimeTrace/issues/17) | Closed: completed |
| `.scratch/ui-redesign/issues/04-kanban-quick-edit.md` | [UI 04: Kanban and task quick editing](https://github.com/sinsenti/TimeTrace/issues/18) | Closed: completed |
| `.scratch/ui-redesign/issues/05-task-details-accounting.md` | [UI 05: Task details and work accounting](https://github.com/sinsenti/TimeTrace/issues/19) | Closed: completed |
| `.scratch/ui-redesign/issues/06-grouped-task-list.md` | [UI 06: Grouped task list](https://github.com/sinsenti/TimeTrace/issues/25) | Closed: completed |
| `.scratch/ui-redesign/issues/07-outline-inspector.md` | [UI 07: Outline and inline inspector](https://github.com/sinsenti/TimeTrace/issues/26) | Closed: completed |
| `.scratch/ui-redesign/issues/08-status-management.md` | [UI 08: Status management](https://github.com/sinsenti/TimeTrace/issues/27) | Closed: completed |
| `.scratch/ui-redesign/issues/09-filters-task-tabs.md` | [UI 09: Advanced filters and Calendar task tabs](https://github.com/sinsenti/TimeTrace/issues/28) | Closed: completed |
| `.scratch/ui-redesign/issues/10-compact-habits.md` | [UI 10: Compact Habit cards](https://github.com/sinsenti/TimeTrace/issues/29) | Closed: completed |
| `.scratch/ui-redesign/issues/11-dashboard-canvas.md` | [UI 11: Dashboard and widget canvas](https://github.com/sinsenti/TimeTrace/issues/30) | Closed: completed |
| `.scratch/ui-redesign/issues/12-structured-widget-builder.md` | [UI 12: Structured widget builder and comparisons](https://github.com/sinsenti/TimeTrace/issues/31) | Closed: completed |
| `.scratch/ui-redesign/issues/13-read-only-sql-widgets.md` | [UI 13: Optional read-only SQL widgets](https://github.com/sinsenti/TimeTrace/issues/32) | Closed: completed |
| `.scratch/ui-redesign/issues/14-performed-time-widget.md` | [UI 14: Performed-time widget and preset](https://github.com/sinsenti/TimeTrace/issues/33) | Closed: completed |
| `.scratch/ui-redesign/issues/15-day-workspace.md` | [UI 15: Day workspace and independent history editors](https://github.com/sinsenti/TimeTrace/issues/34) | Closed: completed |
| `.scratch/ui-redesign/issues/16-session-reviews.md` | [UI 16: Session reviews](https://github.com/sinsenti/TimeTrace/issues/35) | Closed: completed |
| `.scratch/ui-redesign/issues/17-task-post-mortems.md` | [UI 17: Task post-mortems](https://github.com/sinsenti/TimeTrace/issues/36) | Closed: completed |
| `.scratch/ui-redesign/issues/18-rating-administration.md` | [UI 18: Rating-definition administration](https://github.com/sinsenti/TimeTrace/issues/37) | Closed: completed |
| `.scratch/ui-redesign/issues/19-browser-preferences.md` | [UI 19: Tabbed browser preferences](https://github.com/sinsenti/TimeTrace/issues/38) | Closed: completed |
| `.scratch/ui-redesign/issues/20-ai-settings-providers.md` | [UI 20: AI settings and providers](https://github.com/sinsenti/TimeTrace/issues/39) | Closed: completed |
| `.scratch/ui-redesign/issues/21-clean-assistant.md` | [UI 21: Clean shared Assistant](https://github.com/sinsenti/TimeTrace/issues/40) | Closed: completed |
| `.scratch/ui-redesign/issues/22-proposal-approval.md` | [UI 22: Proposal approval and recovery](https://github.com/sinsenti/TimeTrace/issues/41) | Closed: completed |
| `.scratch/ui-redesign/issues/23-instruction-approval.md` | [UI 23: Remembered-instruction approval](https://github.com/sinsenti/TimeTrace/issues/42) | Closed: completed |
| `.scratch/ui-redesign/issues/24-markdown-export.md` | [UI 24: Markdown export workflow](https://github.com/sinsenti/TimeTrace/issues/43) | Closed: completed |
| `.scratch/ui-redesign/issues/25-whole-app-verification.md` | [UI 25: Whole-app adoption verification](https://github.com/sinsenti/TimeTrace/issues/44) | Closed: completed |
| `specs/module-deepening.md` | [Module deepening — delivered historical parent](https://github.com/sinsenti/TimeTrace/issues/45) | Closed: completed |
| `.scratch/module-deepening/issues/01-task-work-accounting.md` | [Modules 01: Deepen task work accounting](https://github.com/sinsenti/TimeTrace/issues/46) | Closed: completed |
| `.scratch/module-deepening/issues/02-provider-construction.md` | [Modules 02: Unify provider construction](https://github.com/sinsenti/TimeTrace/issues/47) | Closed: completed |
| `.scratch/module-deepening/issues/03-chat-turn-lifecycle.md` | [Modules 03: Deepen the chat-turn lifecycle](https://github.com/sinsenti/TimeTrace/issues/48) | Closed: completed |
| `.scratch/module-deepening/issues/04-scoped-ai-read-context.md` | [Modules 04: Deepen scoped AI read context without changing visibility](https://github.com/sinsenti/TimeTrace/issues/49) | Closed: completed |
| `.scratch/module-deepening/issues/05-task-metadata-freshness.md` | [Modules 05: Keep same-page task metadata fresh](https://github.com/sinsenti/TimeTrace/issues/50) | Closed: completed |
| `.scratch/module-deepening/issues/06-task-links-and-recurrence-safeguards.md` | [Modules 06: Preserve task links and verify unknown recurrence](https://github.com/sinsenti/TimeTrace/issues/51) | Closed: completed |
| `specs/sql-widget-settings-departure.md` | [SQL widget guarded Settings departure and deferred-blur repair — delivered](https://github.com/sinsenti/TimeTrace/issues/52) | Closed: completed |
| `docs/ai-release-hardening-plan.md` | [Remembered-instruction release hardening — implemented fake-first](https://github.com/sinsenti/TimeTrace/issues/53) | Closed: completed |
| `.scratch/ui-redesign/ticket-12-evidence.md` | [Comparison baseline identity collides for NULL and empty dimension keys](https://github.com/sinsenti/TimeTrace/issues/54) | Open |
| `docs/ai-release-hardening-plan.md` | [Reconcile bounded UI platform and AI/module manual acceptance gaps](https://github.com/sinsenti/TimeTrace/issues/55) | Open |
| `README.md` | [Reconcile delivered status and stale references without overwriting owner edits](https://github.com/sinsenti/TimeTrace/issues/56) | Open |

Initial publication/readback attempts encountered connection timeouts and one command deadline.
The journal and remote migration markers allowed resumption without duplicate creation. Final
independent readback verified all 56 records, 48 parent-child links, 80 blockers and both briefs;
earlier interrupted attempts are not represented as successful runs.

## Local archive cleanup

At the owner's request, the old UI exploration directory and migrated local ticket copies were
removed from the checkout after byte-for-byte archive verification on 2026-11-17.

Local recovery directory: `~/.local/state/timetrace/archives/cleanup-20261117-175652/`.
It contains `historical-records.tar.gz`, a SHA-256 file manifest and `tracked-changes.patch`.
The archive preserves 253 files, including the pre-cleanup UI index, unique evidence and existing
user edits. All 223 files selected for removal matched their archived bytes before removal.
The archive is local/private, not a public attachment or a second live tracker.

Removed from the checkout:

- `.scratch/ui-redesign-lanes.3zT4LG/` — old UI previews, captures and verification artifacts.
- `.scratch/ui-redesign/issues/` — the 25 migrated UI tickets.
- `.scratch/agenda-plan-record/`, `.scratch/google-calendar-sync/`, `.scratch/module-deepening/` —
  migrated ticket copies and their historical indexes/maps.

Retained: repository specs, glossary, Google research, unfinished Agenda/design prototypes, the
migration mapping, and unique UI verification evidence in `.scratch/ui-redesign/`. Surviving ticket
links point to GitHub. Original paths in this mapping and dated notes now identify archive entries;
they are not required to exist in the checkout.

To recover material, extract the archive into a separate empty directory and inspect it before
copying anything back; do not overwrite current work blindly. Tracked removals remain unstaged
until a later commit; no reset, staging, commit, push or application change was performed.

## Ongoing workflow

After migration, the owner selected the installed Matt Pocock skills' defaults. Read the
[issue tracker](issue-tracker.md), [triage mapping](triage-labels.md) and
[default skill workflow](workflow.md#default-skill-workflow). The former local spec-signoff,
per-action commit/merge authorization and mandatory human/tuicr ceremonies no longer apply.
Follow each invoked skill's normal publication, readiness, implementation, review and delivery steps.

This changes procedural policy, not the historical import dispositions above or unresolved feature
requirements. Agenda's concrete ownership/timer/accounting questions and Google's prerequisite remain;
protect user edits, isolated development state and privacy. A new defect or verification gap normally
gets its own issue rather than reopening delivered history.
