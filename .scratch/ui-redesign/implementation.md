# UI redesign — integration execution record

## Current authorization and frontier

The owner has now requested implementation of the Approved UI redesign, local ticket branches and
commits, integration merges, and fresh independent code-review subagents per commit. Previous
no-start/no-commit wording in approval records describes the earlier approval-only checkpoint, not
a current implementation blocker. Preserve that approval history; do not reopen O1–O8 or treat the
spec as Built. The parent owns the task graph, worktree orchestration and every review; seed workers
do not delegate. This seed is one authorized documentation-only planning commit, not production
implementation or completion of ticket 01.

- Fixed pre-delivery base: `82fabdc652c59da87de0f57d7770d0aa32fb7f64` (before this seed).
- Integration branch: `feat/ui-redesign-integration`.
- Integration worktree: `/tmp/timetrace-ui-implementation.rZwJP1/integration`.
- Contract: [specs/ui-redesign.md](../../specs/ui-redesign.md), **Approved**, not Built.
- Graph: [published backlog](README.md), 25 unchanged ticket identities/dependencies/criteria/history.
- Current frontier: **01**, Calendar shell and shared appearance; all others wait for technical
  predecessors. All 25 remain `ready-for-agent`; none is completed or claimed by this seed.
- No push, PR, release or merge into `dev` is authorized. Do not reset/stash or overwrite owner edits.

## Review and completion obligations

Every commit, including this seed, requires fresh independent **Standards** and **Spec** code-review
axes under `.pi/skills/code-review/SKILL.md`, with a pinned comparison base and exact final SHA.
The parent arranges both axes and handles confirmed findings/re-review before subsequent integration.
This record does not substitute for those reviews and claims no review pass.

After all 25 tickets are implemented, run the full integrated automated checks and independent
whole-delivery two-axis review against the fixed base above, covering **all tickets together**, tests
and delivery documentation. Per-ticket/per-commit review and ticket 25 do not replace that final
review. Trace affected callers, alternate entries, delayed/failed reads, interrupted initialization
and unsaved-input preservation. Fix confirmed findings, rerun checks and obtain independent re-review;
report blocked/verification incomplete rather than completion while findings or required checks remain.
Later feature merge review and explicit human approval remain separate gates.

The local Markdown tracker completion convention is `completed` only after implementation delivery
and recorded acceptance evidence. The owner checkout's
[triage lifecycle](/home/user/git/personal/TimeTrace/docs/agents/triage-labels.md#implementation-completion)
defines this state; it is not a triage role. That owner-only dirty documentation is not copied into
this seed. Record exact automated results and deferred manual acceptance separately in each ticket's
Comments; completion never claims unrun checks passed or grants publication/merge permission.

## Read-only reference root and portability

Owner checkout: `/home/user/git/personal/TimeTrace` — **read-only and dirty**. The only owner files
copied are `specs/ui-redesign.md` and `.scratch/ui-redesign/` (README, plan, spec-review and 25 tickets).
The clean base's spec index gets only a UI entry. No unrelated root dirty docs, GLOSSARY,
module-deepening work, production files or tests are copied or changed.

Historical reference artifacts remain **external and currently untracked** in the owner checkout:

- [Combined prototype checkpoint](/home/user/git/personal/TimeTrace/.scratch/ui-redesign-lanes.3zT4LG/combined/README.md).
- [Prototype decision history](/home/user/git/personal/TimeTrace/src/timetrace/interfaces/api/prototypes/app_shell/README.md).
- Theme and Assistant/Export lanes under `/home/user/git/personal/TimeTrace/.scratch/ui-redesign-lanes.3zT4LG/`.

These are read-only composition/evidence references, not production acceptance or newly run tests.
Screenshots, logs, validation receipts and prototype assets are intentionally not bundled. Copied
reference documents use honest absolute owner paths where a relative link would imply a bundled
artifact. External owner development/GLOSSARY/lifecycle references also remain external. Independent
local ticket worktrees can read them at this root; a clone on another machine cannot. Retain that
checkout unchanged for reviews; any future reference archive/relocation needs an explicit scoped
handoff, not silent copying. Historical preview ports/URLs do not promise a running server.

## Validation and safety

This seed runs static documentation checks only: internal and external Markdown file links, 25 IDs,
unchanged ticket content and dependency DAG, Approved status, intended file scope and whitespace.
It runs **no** app imports/commands, daemon/browser runtime or provider calls.

The fresh baseline is **unrun**: Python suite, Node regressions, changed-JS syntax, Ruff, daemon/browser
workflows and migration checks have not been executed by this seed. Historical 341-pass/85-warning
Python receipts and prototype counts are preserved history, not a new baseline. Future code tickets
must record focused/full checks and distinguish pre-existing failures from regressions as required by
the spec and AGENTS.md; no schema change is approved by this seed.

Before any future TimeTrace import or command, set `TIMETRACE_DB_FILE` to an absolute DB path in its
own temporary directory so timer/key siblings are isolated. Use a non-8002 scratch daemon port and
separate browser storage. Never access the personal DB, daemon or credentials for testing. Use
synthetic data and fake providers/agents only; no real/paid provider calls.

Manual acceptance is deferred: real-app scheduling/timer/recurrence, task editing/accounting, Habit
Save/Cancel/history, independent review/rating editors, dashboards/SQL, Settings draft ownership,
Assistant approval/recovery and actual exports; responsive light/dark, keyboard/focus, contrast,
physical touch, screen readers and browser-engine checks. Each ticket owns its applicable regression
and isolated workflow evidence; final whole-app verification cannot postpone basic per-ticket checks.
No human acceptance or accessibility certification is claimed.
