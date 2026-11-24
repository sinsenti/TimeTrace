# Timer workspace final review repairs and combined replay (#59)

Repair evidence against `feb27fa2cd51a62aed42e6b974064c4513bfa0ad`. The original independent
Standards axis reported **4** findings (3 on #64, 1 additional on #59), highest P1. The Spec
axis reported **3** findings (all on #64), highest P1, and an unverified combined replay criterion.
Two findings overlap for **five distinct defects**. This ledger records implementer repairs and tests,
not another independent review, a release, or human visual acceptance.

| Finding | Observed red and repaired contract |
| --- | --- |
| P1, both: recurrence edits strand an accepted assignment | Public subprocess tests killed the accepting writer after durable intent installation. All-future virtual resize returned 200, and all/following deletion returned 204 on the destination instead of refusal. With the guard, only the affected task mutation returns `409 assignment_pending`. Unrelated series operations and task edit still succeed even while the timer lock is held. Exact assignment retry finalizes once, with the same destination, work ID and receipt on startup replay. |
| P2, both: target refresh crosses queued Stops | A's held refresh left dismissal/promotion stuck pending; on the baseline a late success wrote A's rows into B's manifest. Dismissal now cancels only that prompt's read. Late success, error and completion cannot alter B's UI/storage/selection or release its pending request. Controller coverage checks reload and the exact selected B-only payload, and real DOM coverage checks unchanged A. |
| P2, Spec: context opens too early | HTTP explicitly requesting a pre-effective week of a later epoch incorrectly returned available. Later epochs now refuse pre-opening local periods; earlier admissible epochs keep their dates and targets, and the baseline still describes pre-goal history. A/C retain the selected week/context. Frozen foreign-zone limitations, total-goal and hierarchy semantics are unchanged. |
| P2, Standards: overflowed JSON number returns 500 | POST and PUT with raw `1e309` reached validation, then failed strict JSON serialization. Goal write validation reuses sanitized diagnostics, returning 422 for malformed/nonfinite/invalid targets without creating settings or reserving an operation key. An unchanged prior receipt still replays; valid tiny positive durations are not clamped. |
| P2, Standards (#59 only): delayed focus ACK drops newer input | Controller red: submitting 30 then typing 45 lost ownership at ACK. A focus ACK now advances only the submitted draft lineage's baseline; newer input/other timer and defaults drafts survive, and later polling does not silently replace the captured revision. No focus clock, delivery or receipt hash change. |

## One synthetic dataset, actual Orca DOM and public API

The same freshly migrated DB and isolated profile served the complete sequence, including navigation,
reload and a normal same-DB restart. Production routes were used, with native delivery and idle
capture off. The only transport interventions held a real target read and real focus ACK, and dropped
one actual committed assignment ACK. No alternate browser or raster screenshot was used.

1. **Plan → selected timer:** Agenda's Start working focused the visible card for the explicitly linked
   plan. The reused full task editor saved a changed description independently from the work note.
   The 25-minute notify-only default was inherited. While the 30-minute override ACK was held,
   Orca keyboard input typed 45. After the ACK the input/focus and dirty guard remained; explicitly
   saving 45 used the acknowledged revision (2 → 3), with the default still 25.
2. **Correction → Stop → Calendar:** An explicit signed +5-minute running correction preceded an
   Orca keyboard pause, signed paused start edit, and exact 60-second middle exclusion. Both retained
   pieces preserved their note; the earlier piece kept its segment ID. No correction resumed the
   timer or changed focus generation/settings. Stop saved the two exact IDs once; its exact retry
   returned the original receipt. Existing Calendar rendered the same saved fragments, the live
   history-repeat timer separately, and unchanged original/current plans. The live timer did not
   credit the saved-work total.
3. **Pin, history and taskless:** Pin Start used the independent task/defaults, then Stop saved it.
   Start again from grouped history did not carry older note, date or plan association; the old
   row was unchanged. The pin survived navigation, and the current card came before the unfinished
   list at 390 px without document overflow. Taskless Stops A/B queued; while A's exact GET was held,
   Leave taskless promoted B. Late A completion and reload left B's exact selection/draft intact.
   B created one parsed task once. The dropped ACK survived reload and recovered by read-only
   receipt lookup. C attached to the existing task once. A stayed taskless, B's ID/metadata/rating
   survived, neither assignment changed global SUM, and the destination gained task goal credit.
4. **Weekly A/C → downloads:** Keyboard Enter opened C and focused Back to overview on the same
   week/epoch. Two overlapping old one-hour records yielded final SUM **2.109896553888889 h** vs
   existing elapsed union **1.109896553888889 h**. Goal and estimate accounting remained separate;
   original/current plans and uncertain legacy were separate and existing review, rating and older
   work were unchanged. The Monday-to-Sunday context change retained A/C ownership; the explicit
   later epoch refused an earlier period while automatic baseline selection returned Jan 3–9, 2000.
   Actual typed downloads matched selected Markdown and CSV previews (CSV uses CRLF, normalized by
   the textarea): exactly two corrected rows, one old work row and one separately labeled uncertain
   row, no plan/live or unselected work. Verified UTF-8 notes and saved file bytes, not just previews.

## Automated verification

Frozen production: **1222 Python passed** (1694 warnings) and **904 Node passed**, independently of
prior implementation/merger counts. Focused recurrence/goals/receipt/recovery/migration coverage:
**141 Python passed** (1 warning); the subsequent explicit held-advisory-lock variant passed all
**3** series-writer cases. Focused controller checks: **27 Node passed**. Real copied synthetic
`0019` with old receipts upgraded to `0020` and passed repeated starts, integrity/FK/preservation
checks; the same combined browser dataset also passed fresh migration and a normal restart. No
schema change or receipt format/hash change. Changed-file JavaScript syntax and scoped Python Ruff
and format checks pass; the **17** repository-wide Ruff findings and existing invalid-`noqa`
warning match the immutable baseline. `git diff --check` passes.

Human visual/platform, physical pointer, and real OS alert/sound certification remain unrun. The
accepted no-frame raster exception was not reattempted. Earlier per-ticket results are retained in
[workspace](timer-workspace-60.md), [correction](timer-corrections-61.md), [Calendar](calendar-live-62.md),
[focus](timer-focus-63.md), [goals](personal-goals-64.md), and [export](timer-history-export-65.md) ledgers.
