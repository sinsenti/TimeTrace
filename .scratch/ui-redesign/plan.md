# Whole-UI redesign — coverage and candidate issue plan

Status: Historical Draft planning document — superseded for execution
Date: 2026-11-01

This is the preserved pre-approval exploration plan, not the current readiness record. Its open
questions/no-start prose and 22 candidate IDs are historical. The [Approved specification](../../specs/ui-redesign.md)
and [25 published tickets](README.md) are authoritative; implementation is now requested under
[the execution record](implementation.md). No production ticket is completed by this seed.
Prototype/checkpoint references below point into the read-only owner checkout and are currently
external/untracked, not portable assets included in this commit.

## Goal and approval boundary

Finish the synthetic UI exploration, then synthesize one production specification and a dependency-ordered implementation backlog. This plan is not an approved spec, ticket publication, permission to change production, or a claim that the frontend has shipped.

The tracker is local Markdown. After the owner approves the spec and breakdown, publish **one ticket per file** under `.scratch/ui-redesign/issues/`, linked to the actual spec. No tickets are ready for implementation yet. Candidate numbers below are planning identifiers, not published issue IDs.

## Settled directions — do not restart discovery

- Calendar: Aligned tool strip; 88px/hour Spacious default; independently collapsible totals initially closed; secondary timer; task drag/drop and keyboard/touch scheduling; no permanent session inspector.
- Tasks: **Kanban default**, **Grouped list optional**, **Outline + inspector optional**. Quick-edit subtasks below the title are approved. The production view selector belongs in the page, not the prototype comparison bar.
- Statistics: Widget canvas; editable queries and comparisons; selected performed-time widget/preset. Original Logged definitions must not silently acquire performed-only filtering.
- Habits: Compact cards and small independent day strips; no large date cube or per-card Entry date row. Previous Habits-only palettes were rejected.
- Revision: Day workspace; bottom history initially closed; independent main/history drafts and evidence filters; one full-width Activity/Tasks breakdown with the switch beside the heading. No standalone day-summary strip or duplicate editable day.
- Settings: Tabbed page selected. Browser preferences, AI settings, and provider editor retain separate ownership/save boundaries.
- These selections do not approve a global palette, persistence/migration policy, or new backend semantics.

## Current parallel exploration

Read current copied prototypes, not a clean checkout: the main prototype is untracked.

| Lane | Ownership and preview | Required result |
| --- | --- | --- |
| Theme | `/home/user/git/personal/TimeTrace/.scratch/ui-redesign-lanes.3zT4LG/theme/`; port 18004 | Whole-app light/dark candidates, including top bar, all pages and dialogs; preserve geometry and drafts; measured contrast and explicit limits |
| Assistant + Export | `/home/user/git/personal/TimeTrace/.scratch/ui-redesign-lanes.3zT4LG/assistant-export/`; port 18005 | Synthetic shared Assistant workflow and production-grounded Markdown export; no real APIs/providers/storage |
| Parent | Coverage, decisions, integration and issue synthesis; baseline port 18003 | Reconcile the lanes, preserve existing work, present choices and draft dependencies |

The owner explicitly resumed the previously deferred **whole-app** theme exploration in this request. Both agents have completed their copies. The three round-2 light options are now acceptable to the owner; final Assistant/Export presentation still needs the cleanup and choices below. They did not publish tickets or alter production. Independent browser contexts avoided shared-page interference.

### Current light-theme follow-up

The owner did not select any first-round theme. Paper & ink was promising on Calendar but not
Statistics; Cobalt was disliked. The owner explicitly clarified that **all three light-only options are acceptable for now**:
**Refined Archive**, **Soft Stone**, **Porcelain**. This is not a choice of Porcelain alone or a request
for more theme exploration. Default/availability/persistence details remain for the written spec. Review them on port 18006
at `/stats?appTheme=refined|stone|porcelain&theme=light` (substitute one key).

Dark modes are not redesigned. New light choices use the existing Archive Dark reference in Dark
and restore the selected light proposal on return to Light. Older dark modes remain accessible.
This is preservation of the preferred appearance, not a new production/persistence approval.

Current round: **1,971 browser assertions**, 42 unchanged dark-reference color comparisons,
72 new-light page states at four widths, bounded contrast sampling and **341 isolated Python tests
passed** (85 existing warnings; 18 existing global Ruff issues). See combined `README.md` for exact
scopes/limits and the earlier, separate 2,650-check round. These test receipts predate the owner's
acceptance of all three light options. Assistant composition, keyboard proposals and Export labels
are not approved by that theme acceptance; implementation tickets remain unpublished.

### Latest owner feedback — keep the final chat clean

The screenshot showed `Approval limitations`, `Sandbox audit`, `Data scope` and `Current sample
custom instructions` disclosures. They are prototype/testing aids, **not an approved final chat
composition**. Do not ship mock/sandbox labels, synthetic transition counts, workflow selectors or
raw debug/audit sections into the main conversation. Final presentation should focus on messages,
composer and relevant proposal/explicit approval cards; current scope/instructions belong in
Settings, while useful user-facing action history is available on demand. Explicit remembered-
instruction proposals still require their own Save/Dismiss card; do not remove that safety path.
The preview still contains those aids; no runtime cleanup or production implementation is claimed.

The owner also said the smaller existing surfaces are fine: **retain/re-skin idle recovery, status
management, advanced filters and recurrence prompts**, rather than restart their workflow design.
This preserves current policies and does not certify unrun backend behavior.

### Original lane results and parent review

The parent-created **combined review copy** is `/home/user/git/personal/TimeTrace/.scratch/ui-redesign-lanes.3zT4LG/combined/`, historically served on **18006**. Its [README.md](/home/user/git/personal/TimeTrace/.scratch/ui-redesign-lanes.3zT4LG/combined/README.md) is the review/verification receipt; no preview server is promised by this seed. The original baseline remains unchanged on 18003.

- Theme: Cobalt, Paper & ink, Mono; each light/dark across all pages. Original lane receipt: 29,064 assertions, bounded contrast checks, no provider requests/storage writes; not an accessibility certificate.
- Assistant: chat-first and review-first optional drawers, both closed first. Export demonstrates the six shipped agenda Markdown scopes plus a proposed legacy-session entry; no actual export API calls or personal data.
- Parent review corrected an impermissible collapse of Revision's five grade-color steps into three, and fixed Assistant URL/reload/Back/Forward composition retention. The combined copy shares theme tokens with both new surfaces.
- Combined parent checks: **2,650 browser assertions**, including 144 page states at four widths, 101 grade/history edge checks, and 45 selected-default checks. Fresh full isolated pytest **341 passed**, 85 existing warnings; scoped syntax/Ruff/whitespace pass, global Ruff retains 18 pre-existing issues.
- Remaining owner decisions: accepted-theme defaults/adoption, clean drawer composition, proposed keyboard changes, optional legacy Export entry/labels and UTC/local caveats. Do not mistake simulated approval/streaming/connection/clipboard behavior for backend certification.

The theme agent's suggested token/status/chart work is folded into candidate 01, each domain adoption slice and final acceptance, rather than creating a detached CSS-only project. Assistant insights/composer are covered by 19; proposal/history and explicit remembered-instruction approval by 20. Split those further before publication if they exceed one fresh context.

## Whole-UI coverage inventory

“Prototyped” means representative synthetic interactions, not certified production behavior. Theme and utility lanes do not automatically cover every existing dialog.

| Surface | Current prototype / decision | Production evidence and remaining coverage |
| --- | --- | --- |
| Shared navigation and shell | Main page layouts selected | Shared navbar and each page template; there is no common base template. Audit every page include, legacy aliases, Back/Forward and safe opt-in adoption |
| Theme / semantic colors | Refined Archive, Soft Stone and Porcelain acceptable for now; dark unchanged | Existing settings/theme application, tag auto-colors and chart colors. Include selected, disabled, warning, failed, focused and empty states in light/dark |
| Calendar scheduling | Aligned strip selected; representative interactions | Calendar/router/SessionService: local dates, overlaps, overnight sessions, views, query-param filtering and recurrence projections remain real integration checks |
| Session popup and task attachment | Core fields/actions/shortcuts represented | Existing session modal and attachment code: full timestamps, Notes focus, task-search focus, Ctrl+Enter, Escape, plain Enter in Notes, UUID and `virt:` IDs |
| Recurrence and completion policy | Sample controls/prompts, not an engine demonstration | Calendar/session modal, completion-policy component, task/session services and settled recurrence decisions. Preserve logged history, occurrence scopes, skipped/moved exceptions and independent own/subtree schedule choices |
| Timer and idle recovery | Small sample timer; owner accepts retaining existing workflow | Timer control and idle-resolution UI: preserve running/frozen state, task selection, recovery/retag options and errors |
| Kanban and quick edit | Selected default; subtasks approved | Task API/service, Kanban/task-modal/subtasks code; preserve quick-add parsing, parent inheritance and status synchronization |
| Dedicated task details/accounting | Represented | Task inspector and work-accounting API; own recorded sessions, no virtual/timer inclusion, negative balances retained, zero/missing/non-positive and recurring budgets unbounded |
| Grouped list | Selected optional view | New production rendering over the same task contracts, not a separate task model |
| Outline + inspector | Selected optional view | Shared edit/accounting contracts; inline inspector does not authorize a permanent Calendar session pane |
| Status management | Owner accepts retaining/re-skinning existing workflow; not fully prototyped | Existing Kanban status manager includes ordering, flags, colors and deletion. Preserve current service policy rather than silently replacing it |
| Advanced filters / Calendar task tabs | Basic filters represented; owner accepts retaining existing workflow | Existing custom-filter dialog/state and Calendar sidebar configuration; preserve query/status/category/estimate/priority filters and client-owned preferences |
| Habits tracking / definition / history | Compact cards selected | Habit API/service and history/goal charts. Optional per-entry time/notes are proposals, not approved data/model changes; metadata/timezone policy remains open |
| Statistics canvas / dashboard CRUD | Selected; synthetic dashboards | Dashboard API/service: persisted named dashboards, editable widgets, reorder, delete, errors and empty states |
| Widget builder / comparisons / optional SQL | Represented | Existing structured-query capabilities and SQL sandbox. Preserve fan-out labels, split-evenly, local start-day/week context, per-widget baselines and disabled-by-default SQL |
| Performed-time default widget | Prototype selection accepted | Default seed rollout is unresolved: never restore user-deleted widgets or narrow original Logged queries silently |
| Revision day / history / breakdown | Selected | Review services and Calendar tag/task handoff; main/history save/dismiss/filter ownership must remain independent |
| Session and task post-mortems | Represented | Existing review/ratings contracts. Exemption and review state are independent; review writes do not complete tasks or clear schedules |
| Rating scale configuration | Represented | Existing rating service/range/context policies must be preserved or explicitly approved, not inferred from sample controls |
| Tabbed browser settings | Selected | Browser-owned preferences and idle-toggle side effect; no new unified DB settings store or implicit atomic save |
| AI scheduling/privacy/provider settings | Synthetic forms represented | Shipped AI settings/provider services. Credentials, masked keep/replace/clear, Pi-owned auth, catalogs, probe caps and privacy enforcement still need production verification with fakes |
| Shared Assistant | New lane | Chat/history/SSE/insights, draft batches, calendar overlays, audit, undo/reapply and explicit instruction-proposal approval already ship. Redesign UI, do not rebuild or bypass domain services |
| Export | New lane | Calendar export modal and agenda export route: six existing Markdown modes. Do not invent CSV/ICS/PDF or turn range selection into new data semantics |
| Keyboard / focus / accessibility / feedback | Representative checks, not app-wide certification | Preserve Calendar Vim mode and global shortcuts without intercepting form/drawer/dialog typing; touch scheduling; semantic focus, live/error state, responsive layouts and reduced-motion handling |
| Import / CLI / native / integrations | Not new UI scope | Markdown import exists as an API/CLI capability, not a newly requested browser importer. No TUI, native clients, sync, OAuth, accounts, queues or infrastructure groundwork |

### Code evidence

Paths are repository-relative; ticket prose will describe contracts rather than copy brittle implementation lists.

- Page entry points: `src/timetrace/interfaces/api/routers/web.py`; actual application `src/timetrace/main.py:create_daemon_app`.
- Shared/current UI: `src/timetrace/interfaces/api/templates/` and `templates/components/`; JS lives under `src/timetrace/interfaces/api/static/js/`.
- Smaller surfaces: `timer_control.js`, `kanban.js`, `custom_filter.js`, `vim_engine.js`, `calendar.js`, `session_modal.js`, `completion_policy.js`, `dashboard.html` sidebar configuration.
- Export: `routers/analytics.py` (`/api/agenda/export`, six Markdown modes); legacy `/markdown/export` and `/markdown/import` are not new requested export formats/import UI.
- Approval/accounting: `docs/ai-maintenance.md`, external [owner GLOSSARY](/home/user/git/personal/TimeTrace/GLOSSARY.md), external [owner development reference](/home/user/git/personal/TimeTrace/docs/development.md), `CLAUDE.md` Statistics decisions, `docs/recurrence-engine-plan.md` final owner decisions. The unrelated owner dirty docs are not copied here.
- Historical prototype source: [app shell README](/home/user/git/personal/TimeTrace/src/timetrace/interfaces/api/prototypes/app_shell/README.md).

## Candidate production slices

Every item below is globally gated on an **explicitly approved production spec and issue breakdown**. “Depends on” identifies technical predecessors only; “none” never means permission to implement now. Include focused regression tests in each slice, not only in the final acceptance item. Existing APIs/services should remain unless the approved spec requires a change.

| Candidate | User-visible delivery | Depends on |
| --- | --- | --- |
| 01 | Plan a day in the selected Calendar shell with shared selected theme/navigation, preserved task controls, collapsed totals and query-filter chip | Theme selection |
| 02 | Create/edit/move/resize/delete sessions with task attachment, Notes/shortcuts and existing recurrence/completion prompts preserved | 01 |
| 03 | Use the secondary timer and resolve idle/frozen state safely across pages | 01 |
| 04 | Manage Kanban tasks and quick-edit queued subtasks with correct save/cancel and completion-policy prompts | 01 |
| 05 | Inspect/edit a task and its own history/accounting without losing drafts or changing budget semantics | 04 |
| 06 | Switch to the optional Grouped list and perform the same task operations | 04 |
| 07 | Use Outline + inspector over the shared task details/editing behavior | 05 |
| 08 | Manage custom statuses/order/colors/flags without changing existing deletion or completion policy | 04 |
| 09 | Apply advanced task filters and Calendar task-tab preferences without losing existing saved configuration | 01, 04 |
| 10 | Track habits through Compact cards and edit definitions/history with explicit date/result/save behavior | 01; optional entry-metadata decision |
| 11 | Use persisted named dashboards and the selected widget canvas with add/remove/reorder and isolated loading/errors | 01 |
| 12 | Build/edit structured widgets, baselines and optional SQL widgets while preserving capabilities/sandbox/attribution contracts | 11 |
| 13 | Deliver the selected performed-time widget and recreation preset without destructive default reseeding | 11; rollout-policy approval |
| 14 | Review a day with optional bottom history, readable Activity/Tasks breakdown, independent drafts/filters and Calendar handoff | 01 |
| 15 | Review sessions and task post-mortems with separate reviewed/exempt/dismissed states and retained accounting | 14, 05 |
| 16 | Configure rating scales with the settled required/dismissal/range/context policy | 14; policy confirmation |
| 17 | Use tabbed browser preferences with non-destructive preference adoption, clear Save/Discard and correct idle-toggle ownership | 01 |
| 18 | Configure AI privacy/scheduling/instructions/providers in Settings while keeping masked credentials and save boundaries safe | 17 |
| 19 | Use the shared Assistant for chat/history/read-only insights with streaming/cancel/error handling, opt-in scope and settings entry | 01; Assistant composition/keyboard selection |
| 20 | Review/accept/reject AI drafts and explicit remembered-instruction proposals, undo/reapply safely, retain audit/overlays, and refresh metadata without overwriting edits | 19, 02, 04, 05 |
| 21 | Export the existing supported Markdown scopes/ranges with honest local-date context, preview and download feedback | 01; Export review |
| 22 | Verify cross-page migration, responsive/keyboard/contrast/accessibility and real-workflow acceptance; remove all prototype-only controls from production | 02–21 |

This is a starting granularity, not a final estimate. Item 12 may split structured/comparison/SQL editing if one fresh context is too large; 15 may split session versus task review. Do not split into a detached “CSS”, “API”, “database” and “tests” project: each item delivers a verifiable workflow. Item 01 introduces shared presentation through a real Calendar workflow; other pages adopt it incrementally. Existing Settings entry points stay usable until item 17, rather than shipping dead links during migration.

## Open decisions that must not silently become implementation

1. All three new light treatments are acceptable; settle production default, availability and mode/preference adoption in the spec. Retain existing user choices, dark appearance and task/tag auto-colors; do not reopen palette discovery implicitly. Old Habits-only palettes are not winners.
2. Assistant chat-first/review-first composition and keyboard proposal (production Enter-to-send versus sample Ctrl+Enter); Export Ctrl+Enter download versus preview-only. Existing production resize/fullscreen, overlays, conversation deletion and proposal editing remain preserved requirements even where the bounded mock omits them.
3. View/density/totals/theme persistence and migration, beyond explicit URL selection in the prototype.
4. Optional Habit entry time/notes, local date/timezone interpretation, units and entry cardinality. No new columns are approved by liking the cards.
5. Performed-widget seed rollout: original Logged accounting mismatch remains disclosed; do not resurrect deleted widgets.
6. Revision required/dismissal/range-edit/exemption rules and Calendar filter handoff: preserve shipped policy or seek an explicit change.
7. Smaller existing dialogs are accepted for retention/re-skinning, not new interaction design. Preserve timer idle recovery, statuses, filters and recurrence workflows; no new domain policy is implied. Revision's five-step red-to-green grade mapping must remain consistent across badges, heatmaps and slider contexts.
8. Export labels and optional legacy-session entry; current inclusive UTC session-start filtering leaves tasks/habits unfiltered. Agenda UTC Today/Tomorrow anchors versus daemon-local display is a separate policy issue, not silently fixed by cosmetic work.
9. Exact issue granularity/dependencies and test seams, then written spec approval and local ticket publication.

## Verification seams and guardrails

- Prefer browser-visible user workflows against the actual daemon with a disposable database, plus existing API/service pytest seams for contracts. Fake AI providers/gateways; no paid calls or personal data.
- All TimeTrace imports/commands require an absolute scratch `TIMETRACE_DB_FILE` before startup/import. Timer JSON and keys must be isolated in that directory. Do not experiment on the normal daemon.
- Preserve SQLModel/UUIDv7/`virt:` contracts, naive-UTC boundaries, local start-day bucketing, recurrence history and append-only AI audit.
- Validate accepted AI text in every refreshed renderer, not just draft cards. No markup execution, secrets, tracing or product-content logs.
- Each slice includes empty/loading/error/dirty/cancel/focus cases, keyboard/touch alternatives and appropriate narrow/desktop light/dark checks.
- Full pytest, scoped JS syntax/Ruff and `git diff --check` before reporting code changes. Record repository-wide pre-existing Ruff failures separately. Schema changes, if later approved, require migrations and fresh/disposable-existing DB tests.
- Prototype interaction checks are not evidence that the real timer, recurrence, privacy, provider authentication, SQL sandbox or migrations work.

## Next checkpoints

1. Done: received/reviewed the two lane artifacts and built/tested the combined copy. No baseline promotion.
2. Ready: show the owner the combined candidate URLs and choices; preserve all previously approved compositions.
3. Reconcile this coverage map and candidate dependencies with the lane findings.
4. Draft the production spec from the selected directions, confirm test seams and obtain explicit owner approval.
5. Ask the owner to approve issue size/dependencies, then publish one linked ticket per file. No commits, pushes or merges without separate instruction.
