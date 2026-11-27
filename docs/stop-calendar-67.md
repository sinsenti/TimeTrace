# Stop review and Calendar recording — implementation contract

Canonical tracker: [#67](https://github.com/sinsenti/TimeTrace/issues/67). Related independent
accounting correction: [#68](https://github.com/sinsenti/TimeTrace/issues/68).
The owner requested building the whole agreed flow, including after Orca restarts. The prior
visibility/label slice and its retained evidence are in `docs/plan-links-67.md`.

## Scope and agreed behavior

1. Pressing Stop opens an app-owned review and durably pauses only that timer, capturing its
   actual-work cutoff. Decision time must not count. Preserve other timers and unsaved Entry-note
   guards. Frozen timers/unresolved inactivity gaps must be reviewed by the existing flow first.
2. Primary **Save actual time** saves actual positive unsaved segments and stops, with existing
   association unchanged and no schedule edit. Already-saved segments must not be recreated.
3. Explicit **Continue timing** resumes from the click, excluding review time, only if this review
   paused a previously running timer. For a timer that was already paused, Back/Cancel leaves it
   paused. Escape/dismiss leaves paused; it never silently resumes or discards tracked work.
4. Optional **Save work and fit/split schedule** previews the exact changes. Without pauses, fit
   the selected schedule to actual work. With separated work parts, suggest splitting into those
   parts; do not replace them with a continuous interval counting pauses as work. The split is
   opt-in and must preserve original-plan comparison, saved work and recurrence history.
   The existing standalone Fit action remains all-linked-work outer bounds; do not redefine it.
5. Secondary **Record as scheduled** previews the selected plan's exact current start/end, not
   its duration anchored around actual time. It replaces only the approved unsaved timer result,
   never appends a duplicate or silently edits/deletes previous saved work. Future ends are
   ineligible. Explanatory disabled states are preferable to unsafe partial implementation.
6. Plan choices are explicit and same-task. Keep an existing timer link unless an explicit supported
   reassociation is approved; initially use that existing link for optional Stop actions. For an
   unlinked timer offer same-task plans overlapping actual work, requiring explicit selection.
   No candidate is selected by overlap alone. Taskless timers still save normally, with no implicit
   task assignment. Multiple candidates require a choice, not an arbitrary first result.
7. For already-saved/split timer history or existing matching saved work, refuse a replacement that
   would duplicate or rewrite it and direct the user to existing correction/review tools. Split/fit
   must not move earlier saved work or another unfinished timer's plan. Preserve signed correction,
   pending-write, expected-revision, original-plan, partial-save and unknown-result protections.
8. Clicking a scheduled block on **Calendar `/dashboard`** opens its editor with a new **Record
   time** action. Open an editable manual-recording confirmation initialized from current plan
   times. Saving explicitly creates linked recorded work for that task; keep the plan and task
   status unchanged. Show existing linked/matching work and a duplicate warning before adding.
   Do not silently reuse overlap as ownership, convert elapsed plans, or create two records on retry.
9. Creating a new interval entirely in the past defaults to **Record actual work** with a clearly
   named save action; Schedule time remains an explicit alternative. Future intervals default to
   scheduling. Recording with a future end is rejected, not silently clipped. Editing existing
   plans is still plan editing; past position alone must never convert one to worked time.
10. Calendar plan removal must not bypass history protection: explicit removal means remove the
    schedule while keeping recorded work, with an app-owned exact preview/confirmation and guarded
    operation recovery. Existing destructive Delete everything stays separately explicit. Keep
    unresolved/unfinished timer, draft, ratings and recurrence constraints where required. Do not
    make Scheduled → To do automatically delete plans; that behavior was investigated, not approved.

## Backend and representation constraints

- Routers stay thin; compose business operations under the durable timer/DB receipt funnel. New
  Stop policy actions must be atomic and recoverable, never browser Stop→discard→create sequences.
  Continue/commit must reject stale timer, selected plan and preview context. A lost response
  recovers by reads, not blind mutation replay. Repeat operation IDs must not duplicate work/parts.
- Prefer existing saved scheduled-session rows and service staging where adequate. A split must
  return stable part IDs for Calendar/Agenda, retain the original plan as evidence, and preserve
  same-task singular work associations. Never encode business ownership by notes/title text.
  If schema changes are necessary, add Alembic migration and test fresh plus disposable synthetic
  existing-DB upgrade; never stamp away a failed migration.
- Reuse the recorded-work creation/journal and explicit plan association API for Calendar recording.
  Tighten reviewed duplicate protection at that public boundary where necessary, without globally
  banning legitimate overlapping work. No automatic task completion or estimate rewriting.
- Keep recurrence writes on SessionService, only the explicitly chosen occurrence by default;
  no bulk generation or series/history erasure. UUIDv7 and `virt:` support, naive UTC storage,
  browser-local display/date navigation and source-bound provenance remain unchanged.

## Independent #68 slice

Count each unassigned saved interval's duration in full, including overlap. Two unassigned
10:00–10:20 records yield40 minutes unassigned and20 minutes elapsed coverage. Assigned task time,
other union measures, historical rows and goals/estimates must not be reclassified. Trace all
query/UI/report consumers and attribution/filter contracts; label overlapping totals honestly.
Update GLOSSARY and ADR0001 for this expressly approved metric change, preserving original history.

Implemented #68 accounting path: the structured compiler sums untagged unassigned records and
uses per-record SQL attribution domains for tagged reads. Fan-out counts matching record IDs
once in the scalar; tag rows may overlap. Split-evenly divides each record among its distinct
tags before filtering, without renormalization. `QueryService` reports `unassigned_recorded_sum`;
its physical-cohort seconds are summed matching durations, not elapsed coverage. Local start-day
selection, whole intervals, raw-record filters, limits and legacy/live exclusions stay unchanged.
The shared Agenda summary and Statistics widget/preview labels explain the new basis. Weekly
review consumes the same query response but displays its existing separate taskless SUM; goal
evidence and history/CSV/Markdown exports retain their existing summed-work and elapsed-union
paths. No timer, SessionService, task estimate, goal target or export-row mutation is involved.
Public compiler/service/root-HTTP regressions are in `tests/test_unassigned_recorded_time.py`;
mounted summary, saved-widget and builder-preview regressions cover the changed presentation.

## Verification and execution

Use the established public root-HTTP/service and mounted JS controller/presenter seams, red/green
vertical slices, read-only recovery/fault tests and independent Standards/Spec review. Critical
cases: running/paused/cancel/continue cutoff, multi-part gaps, repeated/uncertain operations, stale
plan/timer, saved-history replacement refusal, unrelated timers/plans, taskless work, recurrence,
Calendar plan/manual intent separation, future ends and duplicate recording. Full suite at final
integration; scoped lint/format/syntax; native synthetic browser checks for actual UI entry points,
keyboard ownership, cache versions and narrow layout. Do not weaken old assertions for new code.

Never use personal DB/timer/key state, actual provider/paid calls or OS idle/audio experiments.
Before imports use an external absolute DB/HOME/TMPDIR and disable native notifications/tracing.
For pytest use PYTHONSAFEPATH=1 plus python -P and four workers; unset the global idle flag for
synthetic idle tests (false is for scratch daemons, not the whole test suite). Keep inherited17
Ruff findings separate. No personal-daemon restart, root user-change overwrite or automatic push.
