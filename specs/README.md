# Feature specifications

GitHub spec/parent issues are the default specification surface used by Matt Pocock's skills.
`to-spec` synthesizes settled discussion, agrees testing seams and publishes with `ready-for-agent`.
Follow the invoked skill's process without an additional local spec-file or owner-signoff gate.

Existing `specs/<feature>.md` documents retain supporting contracts and historical decisions. Their
`Draft` / `Approved` / `Built` headings describe those records; they do not impose a second workflow.
Keep new behavior code-grounded, explicit about time/identity semantics and testable at public seams.

## Specifications

GitHub Issues holds live spec/parent issues and tickets; see the
[historical migration mapping](../docs/agents/github-migration.md). Preserve settled feature
requirements and concrete unresolved questions while using the default skill readiness process.

- [Deepen five TimeTrace modules](module-deepening.md) — Built; all six implementation tickets
  completed. Automated evidence and deferred manual acceptance are recorded in the
  [delivery reconciliation](module-deepening.md#delivery-reconciliation-2026-10-31).

- [Whole-UI redesign](ui-redesign.md) — Built; all 25 tickets delivered, owner-accepted and merged
  into `dev` at `2992d96`. Deferred verification remains separate from completed implementation.
- [SQL widget Settings departure](sql-widget-settings-departure.md) — Built; included in that UI delivery.
- [Agenda, scheduled sessions and recorded work](agenda-plan-record.md) — Approved product behavior
  and nine-ticket graph; implementation not started. Concrete technical/product contracts require
  review before coding. Google Calendar planning remains blocked on its complete-flow release gate.

Use Matt Pocock's `to-spec` skill to synthesize a spec when requested. Follow `AGENTS.md` and
`docs/agents/workflow.md` for default skill execution and project technical safeguards.
