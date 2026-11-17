# Agenda, scheduled sessions, and recorded work

Status: Approved — product behavior and nine-ticket breakdown approved; implementation-specific technical contracts require review before code changes

## Goal

Add the approved Folio (B) Agenda as a separate screen alongside the existing Calendar. Both screens use the same tasks, scheduled sessions, recorded work, and timers.

## Approved decisions

- Keep Calendar; add Agenda. Do not replace Calendar with Agenda or build a separate tracking system.
- Use B's approved visual design as the starting point. Keep useful prototype markup and CSS, but replace sample data, the sample clock, and in-memory mutations with reviewed application code.
- Do not use the rejected single-task Orbit (C) direction.
- Scheduled time is not recorded work. A scheduled session passing its end time must not by itself create recorded work.
- Recorded work can come from the timer or from an explicit manual entry.
- Only recorded work for the same task inside the scheduled time fills that scheduled block. Work outside that interval still counts toward the task.
- Show a message when starting work for an ended scheduled session. Do not infer a modal or a mobile feature from the earlier voice transcription.
- Never extend the schedule automatically. Offer an explicit extension action.
- Retain the original plan after an extension. Show the original plan, current schedule, and recorded work separately.
- Before deleting a scheduled session that has recorded work, warn the user and offer Delete everything, Squeeze, or cancel the action.
- Delete everything removes that scheduled session's original plan, current schedule, and associated recorded work only after explicit confirmation. It must not delete unrelated work for the same task or alter other scheduled sessions.
- Squeeze adjusts the current scheduled interval to cover the associated recorded work while retaining the original plan and all recorded work. For a 09:00–10:00 original plan with work recorded only 09:10–09:30, the current schedule becomes 09:10–09:30; the original plan remains 60 minutes.
- Label whether a comparison uses the original plan or the current schedule. Changing the current schedule must not rewrite the original comparison.
- Show both total recorded work and comparisons with scheduled time.
- Preserve existing history unchanged. Keep uncertain old entries out of the new plan-versus-record comparisons until they are classified; do not silently relabel them.
- Scheduled sessions may overlap. An explicit extension needs no overlap warning or second confirmation, and must not move or shorten another scheduled session.
- Recorded work for different tasks may overlap, including manual entries for parallel work, without an overlap warning.
- When manual recorded work overlaps existing recorded work for the same task, show a non-blocking warning and allow the entry to be saved. Do not require an extra confirmation, reject the entry, or silently merge, shorten, or overwrite either entry.
- Keep both overlapping same-task records, but count shared minutes only once toward recorded task time for that task. For one task recorded 09:00–10:00 and 09:30–10:30, recorded task time is 90 minutes. Different tasks continue to receive independent credit.
- Show both recorded task time and elapsed recorded time. For two different tasks recorded for 60 minutes each with a 30-minute overlap, show 120 minutes across tasks and 90 minutes of elapsed recorded time.
- Include multiple simultaneously running timers in the initial implementation plan. Give this a dedicated ticket group with explicit dependencies; it is not a deferred feature.
- Allow at most one running timer for a given task. Starting that task again selects its existing timer rather than creating a second running timer. Different tasks can run in parallel; taskless timers remain allowed.
- Give each timer its own Pause when idle setting, enabled by default. A timer can explicitly keep recording while another pauses for idle.
- Use one idle-review screen with separate decisions for each paused timer. A discard/claim choice affects only selected timers. Timers configured to keep recording are unaffected and do not need idle review.
- Approved idle example: Writing, Phone call, and Background processing all start at 10:00. At 10:10 the computer becomes idle until 10:30. Writing and Phone call pause at 10:10; Background processing keeps recording. Discarding Writing's 20-minute gap and claiming Phone call's 20-minute gap leaves 10, 30, and 30 minutes recorded respectively.

## Prototype reference

Run `uv run python src/timetrace/interfaces/api/prototype_dashboard.py`.

- Agenda: `http://127.0.0.1:8012/dashboard?variant=B&screen=agenda`
- Calendar preview: `http://127.0.0.1:8012/dashboard?variant=B&screen=calendar`
- Prototype rendering: `src/timetrace/interfaces/api/templates/prototype_dashboard.html`
- Prototype interactions: `src/timetrace/interfaces/api/static/js/prototype_dashboard.js`
- Prototype styles: `src/timetrace/interfaces/api/static/css/prototype_dashboard.css`

The preview is a design reference, not a production backend. Its Calendar preview does not authorize replacing the existing production Calendar's visual design.

## Interview outcome

The broad product interview and nine-ticket breakdown are approved; no further broad visual/product
interview is needed. The 2026-11-17 migration audit identified concrete unresolved ownership, timer,
and accounting policies within the technical-review gate; those questions remain open, not silently
approved. Review them before affected implementation begins.

GitHub Issues is the live tracker; the [Agenda parent](https://github.com/sinsenti/TimeTrace/issues/1)
indexes its nine tickets. The [migration mapping](../docs/agents/github-migration.md) records the
original local paths and recoverable archive. No production implementation has started.

## Technical contracts to settle before implementation

- Represent scheduled sessions, original plans, and recorded work distinctly. Preserve existing rows without guessing whether they were plans or work; uncertain history stays outside the new comparisons.
- Define which recorded work belongs to a scheduled session before destructive actions ship. A shared task or time overlap is not, by itself, authorization to delete a record. Confirmation must identify the affected work and preserve unrelated intervals.
- Keep recorded timestamps unchanged during Squeeze. For separated recorded intervals, a single scheduled block must cover their outer bounds without compacting the gaps or moving the work. If there is no associated recorded work, do not invent a squeeze interval.
- Give timers independent identities and target operations to a timer. Starting a new task must not stop another task's timer; ambiguous operations must not silently act on all timers.
- Preserve running/pending-idle state across daemon restarts, and safely handle the existing single-timer state format. Keep running timers out of completed-work totals except through an explicitly labeled live view.
- Agree additive HTTP contracts and their CLI/API-client compatibility before replacing old callers. Keep business logic in services and pure interval calculations in core logic.
- Migrations, new models, and record associations need a reviewed design before application to any real database.

## Prototype differences to correct after the interview

- Remove the extension-overlap warning. Explicitly extending a session is enough authorization; other scheduled sessions stay unchanged.
- Remove manual-entry rejection based on overlap. Different-task overlaps need no warning; same-task overlaps get a non-blocking warning, with no extra confirmation. Preserve the approved once-per-task counting rule.
- Show both approved totals: recorded task time and elapsed recorded time.
- Replace the single-timer-only interaction with multiple running timers and the approved per-task and per-timer idle rules.
- Add the agreed Delete everything / Squeeze choice and the per-timer idle review. The current prototype does not yet demonstrate these workflows.

## Delivery boundaries

- Reuse useful approved B markup and CSS; remove sample controls, fixtures, fake clock, and in-memory mutation paths from the production screen.
- Add Agenda without replacing the existing Calendar design. Share data and timer state; do not build a second scheduling engine.
- Preserve the already-shipped RRULE projection/exception engine and task-completion prompts.
  Adapt their consumers to the new distinctions without an engine rewrite, bulk pre-generation,
  resurrected skipped/moved occurrences or erased logged history. This corrects the older source
  baseline's generator wording; it does not authorize a recurrence redesign.
- Preserve existing import/export, session review, rating, and task-statistics behavior through additive compatibility or an explicitly reviewed transition. No silent history reinterpretation.
- Existing editing workflows are not a separate redesign target. Corrections must update derived comparisons without rewriting original plans; normal plan changes must not move or delete recorded work.
- Historical classification tools, external integrations, teams, AI scheduling, mobile, and desktop wrappers are outside this effort.

## Verification

- Prefer service/HTTP integration tests using the existing isolated database and timer fixtures; assert visible behavior rather than private state layouts.
- Exercise Calendar → Agenda → recording → statistics against one shared dataset; navigation must not reset or duplicate a running timer.
- Verify same-task duplicate timer starts, simultaneous different-task timers, restart recovery, per-timer idle settings, and targeted idle resolutions.
- Verify original/current comparisons after extension and squeeze; explicit delete scope; warning-only same-task manual overlaps; silent acceptance of different-task overlaps.
- Verify two 60-minute different-task records with 30 minutes shared produce 120 minutes recorded task time and 90 minutes elapsed recorded time. The equivalent same-task records produce 90 minutes for that task while retaining both raw entries.
- Verify uncertain legacy rows remain unchanged and excluded from new comparisons; passing a scheduled end never creates recorded work.
- Apply every migration to a fresh scratch database and an isolated database copy. Preserve existing data counts and require an empty foreign-key check.
- Run the complete regression suite, changed-JS syntax checks, Ruff with no new violations, browser checks, and a scratch-daemon health check. Use the invoked skill's default review and delivery steps.

## Working constraints

- Preserve existing data. Do not guess that elapsed scheduled time is recorded work.
- Stay with FastAPI, SQLite, and vanilla JS; no new framework or runtime dependency.
- Any model change requires a migration, verified on a fresh scratch database and a database copy.
- Product scope, ticket granularity, and blocking edges are approved. Ticket publication does not authorize guessing unresolved technical contracts; review those contracts before production implementation.
