# Feature specifications

GitHub spec/parent issues are the default specification surface used by Matt Pocock's skills.
`to-spec` synthesizes settled discussion, agrees testing seams and publishes with `ready-for-agent`.
Follow the invoked skill's process without an additional local spec-file or owner-signoff gate.

Existing `specs/<feature>.md` documents retain supporting contracts and historical decisions. Their
`Draft` / `Approved` / `Built` headings describe those records; they do not impose a second workflow.
Keep new behavior code-grounded, explicit about time/identity semantics and testable at public seams.

## Delivery status and evidence

This is the shared delivery summary. Dated approval-only/in-progress checkpoints in design records
are historical; they do not reopen completed implementation. GitHub holds live issue lifecycle;
repository specs retain approved behavior. See the [migration mapping](../docs/agents/github-migration.md)
for original local IDs and their successors, not current issue states.

| Scope | Delivery authority and evidence | Limits |
| --- | --- | --- |
| Whole UI, all 25 tickets | [Delivered parent](https://github.com/sinsenti/TimeTrace/issues/14): owner-accepted, merged into `dev` at `2992d96`; inherited final **614 Python / 801 Node**, 34 changed-JS syntax checks, **18 inherited Ruff findings**, zero findings on each independent review axis. | Historical integrated results, not fresh checks or proof of every manual subcriterion. |
| Module deepening, all six tickets | [Delivered parent](https://github.com/sinsenti/TimeTrace/issues/45) and [post-repair receipt](module-deepening.md#whole-delivery-review-repairs-2026-10-31): **341 Python / 73 Node**. | Original browser/gesture exclusions remain separate; later UI counts are not retroactive module acceptance. |
| SQL Settings departure/deferred blur | [Delivered amendment](https://github.com/sinsenti/TimeTrace/issues/52); [Settings link](../src/timetrace/interfaces/api/templates/components/widget_builder_modal.html) and [focus/changed-input invalidation](../src/timetrace/interfaces/api/static/js/widget_builder.js). | Later bounded Cancel/accepted-departure evidence does not pass old UNRUN/failure records or supply missing captures. |
| Remembered-instruction hardening | [Delivered fake-first hardening](https://github.com/sinsenti/TimeTrace/issues/53), [maintenance contract](../docs/ai-maintenance.md), [chat regressions](../tests/test_ai_instruction_chat.py) and [native approval probe](../tests/browser_instruction_approval.js). | Save/Dismiss/conflict/read-retry/inert-text browser evidence is bounded; request → card → later-conversation prompt and other original smoke cells need itemized reconciliation. No provider certification. |

**Latest recorded integrated checks (2026-11-17), separate from those histories:** comparison identity
[fix and serialization guard](https://github.com/sinsenti/TimeTrace/issues/54#issuecomment-6958336213)
were integrated locally into `dev` at `c7b3456` (implementation `59bd301`, guard `3db4b8b`).
The [post-integration receipt](https://github.com/sinsenti/TimeTrace/issues/54#issuecomment-6958551220)
records **637 Python / 800 Node**, 324 Python warnings, scoped Python lint/format passes and
**18 inherited Ruff findings** in the canonical checkout scan (not lint-clean). The guarded branch's
actual desktop/light/default Orca-engine browser check and fresh startup migration to
`0013_ai_data_scope` remain applicable by tree equality; neither was rerun during integration.
No schema/data transformation changed, so existing-data upgrade testing was not applicable.
These local commits were not pushed; GitHub comments are reachable evidence, not remote source links
for those SHAs. No runtime checks were rerun for this documentation reconciliation.

Remaining platform/manual acceptance is tracked separately in
[bounded verification](https://github.com/sinsenti/TimeTrace/issues/55): real 200% zoom/reflow,
physical touch, screen readers, other engines, native checkbox/color paint, legacy reduced-motion
contrast, and exact older AI/module checklist cells. Retain FAIL/UNKNOWN/UNRUN and missing
security/query/transport captures; source/probe presence and broad owner approval are not itemized
PASS. No configured typechecker or whole-app accessibility/provider certification is claimed.

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
