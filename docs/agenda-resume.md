# Agenda #2 — user STOP checkpoint

Branch `agenda-02-contract`. Repairs saved at `aa79dfd7b573da30923a691109fd4e5dfa9b5949`
(timer) and `a8abbd6bd4cdddb4f9c7bb4d93b4d0fac95a1e18` (Agenda), after `f9ddee4`.
No new implementation after the stop request. Independent review and acceptance remain open.

1. AI: prospective legacy create/update/reapply checks normalized candidates and the inverse under
   the writer lock. Notes, move, create and reapply refusal regressions pass.
2. Recurrence: bounded UTC following cutoff handles 30/45-minute gap rules and duplicate anchors;
   impossible local UNTIL refuses atomically. Daily gap and first-fold regressions pass.
3. Calendar conflict: original anchor guards virtual, typed UUID and legacy UUID successors;
   read-only lookup resolves the actual linked row. Native typed successor guard passed.
4. Delayed drops: entry guard and recovery generation reject old gestures; held-metadata Node proof passed.
5. Calendar boundary: explicit one-snapshot legacy start cohort preserves an imported zero-length boundary
   row, without changing default overlap or legacy totals. HTTP and native verified.
6. Timer race: Start checks the task under lock; Split/Stop hold it through history commit; singleton
   timer mutations serialized. FK-on competing approval/Stop tests passed both orderings. Ordinary
   human task-delete behavior and non-atomic SQLite/timer-file crash behavior remain unchanged.

Verification before STOP: focused Python 131 passed; pre-final full Python 722 passed (331 warnings);
Node 817 passed; migration 8 passed; changed-file lint/format and JS syntax/whitespace passed;
full Ruff matches all 17 inherited findings byte-for-byte. Final Python replay was already running at STOP; do not wait or restart now. Check its .code/log before any rerun.
Private evidence directory: `/tmp/tt02-finalfix.VLqSuP6I` (final-python.log/.code, full-node.log,
migrations.log, native-review.json, native-boundary.json). Owned Orca tab/profile already removed;
scratch daemon port 18604 stopped with PID and health verified, FK check clean. Synthetic files retained.

Next after explicit resume: read final Python status and perform independent targeted review of the
six changes (then parent acceptance). No known unfinished code in the six, but no review signoff.
No push/merge, provider calls, schema change, or #55/#57 acceptance.
