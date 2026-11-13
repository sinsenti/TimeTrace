# Ticket 24: Markdown export candidate evidence

Status: in-progress. This record describes an implementation candidate, not completion or acceptance.

## Local source reconciliation

Fixed source base: `563a7838a3fa52c6b7a31925ae860559ea79645f`. The eight repaired freeze02 candidate paths were verified against the external SHA-256 manifest and checkpointed as `fa0e714` (`feat(calendar): add Markdown export workflow [ui-redesign/24]`). The exact incoming ticket 15 integration `1671f9fecc677c64fc806b3f2160a17179771101` was merged locally without conflicts. All eight ticket 24 source files retain their freeze02 bytes; incoming ticket 15 source and tests retain their incoming commit bytes. External freeze03 records the resulting full source manifest and reconciliation proof. No dev merge, push or PR was performed.

The candidate adds the existing six-scope real API Markdown preview, explicit Copy/Download, current-selection guards, UTC caveats and shared Escape/focus behavior. It changes no export backend/service/schema contract.

## Existing pre-incoming15 validation receipts

These results belong to the repaired freeze02 candidate before incoming ticket 15. They were inspected as existing receipts, not rerun during reconciliation and do not establish combined integration status.

- Full safe-path Python: **545 passed, 214 warnings, 31.39s**. This run followed the production repair; later final changes were JS guards/tests.
- Final canonical Node: **391 passed**, zero failed/cancelled/skipped, including 15 Export cases.
- Scoped Python Ruff and format checks passed. Full Ruff has **18 inherited errors** in three unchanged files; four-path SHA/HEAD baseline proof, including models, is retained externally.
- Five changed JS/CJS syntax checks and final whitespace check passed.

Original candidate receipts remain available separately: 545 Python, 387 canonical Node, 119 focused Node and 47 focused Python. They must not be substituted for final repaired or combined results.

## Confirmed review repair and test-first evidence

Original independent Standards and Spec reviews both reported the same P2: delayed real sidebar Edit task lookup could reveal/focus Task beneath Export and restore focus behind Export on Escape. The repaired candidate uses Export base z49 and focused z60; the focused newer Task/Session retains z50. Shared Escape hands focus back only after a real close, while preserving declined discard, other resumed editors, completion/deletion and recovery priorities.

The real-caller simulated-boundary Node regression was RED at **11 pass / 1 assertion failure** (obscured sidebar focus after Task close), then GREEN at **12 pass**, with final focused **14 pass** and canonical 391 pass. This is not a native browser stacking demonstration. The original review findings are repaired in source but fresh independent two-axis review of that repair and reconciled result is still pending.

## Remaining gates and scope limits

Native probes are authored and syntax checked only: **native execution UNRUN**. No daemon/browser lifecycle, actual download, OS clipboard, live layout/contrast or empirical pointer hit-testing is claimed here. Physical touch, other engines, screen reader and human acceptance remain unrun. No personal database/provider calls occurred during this reconciliation.

Fresh full combined integration checks, independent Standards/Spec review after reconciliation, guarded native lifecycle and hit-testing, human acceptance, and the fixed-base whole-delivery review for all 25 tickets remain pending. There are no waivers. Shared README, implementation and development notes were not independently edited in this ticket; incoming documentation was preserved.

External receipts: `.scratch/codex-continuation/evidence/ticket-24/worker-report.md`, `freeze02/worker-report.md`, `freeze02/candidate-source-sha256.json`, `standards-review01.md`, `spec-review01.md`, and `freeze03/` in the main workspace.
