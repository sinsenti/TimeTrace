# Feature specifications

Store approved, non-trivial feature contracts here as `specs/<feature>.md` before implementation.

A spec moves through `Draft` → `Approved` → `Built`. Show the draft and get explicit owner approval
before coding. Keep it code-grounded and concise: problem, observable behavior, affected layers/data/API,
time and identifier semantics, edge cases, exclusions, and verification. Small bug fixes, copy changes,
and behavior-preserving refactors do not need a spec.

## Active specifications

- [Whole-UI redesign](ui-redesign.md) — Approved; implementation is in progress. The
  [25-ticket backlog](../.scratch/ui-redesign/README.md) and
  [integration execution record](../.scratch/ui-redesign/implementation.md) track delivery.

Use Matt Pocock's `to-spec` skill to synthesize a spec when requested. Follow `AGENTS.md` and
`docs/agents/workflow.md` for approval, implementation, testing, and whole-delivery review.
