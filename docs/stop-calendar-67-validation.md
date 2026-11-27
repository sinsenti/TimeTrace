# Stop and Calendar delivery evidence — #67 / #68

## Delivery state

The implementation is complete on `feat/plan-links-stop-67`.
The final code revision is `9b615062410ac84b35eea5735db31155d727e165`.
This record adds documentation only after the checks below.

At this validation checkpoint, the feature branch had not yet been merged into root `dev`,
pushed, or installed in the personal app. Root `dev` was at `bfacc9d0`. Existing owner changes
were not overwritten. The earlier #72 publication and closure are separate from this delivery.

### Subsequent owner-authorized local deployment

The owner then explicitly requested installation in the normal app. Root `dev` was fast-forwarded
to `99bc6e0c`. Both existing tracked edits were merged without reset, stash or temporary clearing;
the resulting files matched independently computed overlays. All 29 backed-up untracked files
were unchanged. A private backup outside Git includes local edits, data, timer state and key.
The consistent SQLite backup passed its integrity check.

The full suites were repeated from root with those local edits present, using a separate synthetic
DB/HOME/TMPDIR: **1,355 Python passed / 1,700 warnings and 1,053 Node passed**. Scoped lint/format,
syntax, whitespace and unchanged-overlay checks passed. The 300-second command wrapper expired
after both suites and lint/format finished; the missing final checks were completed separately.
Passing suites were not repeated to conceal the timeout.

The normal daemon was already stopped. It was started from root on `127.0.0.1:8002` with the normal
data directory. Health, Calendar rendering and both new approval assets passed read-only checks.
Database table counts, timer-file bytes and encryption-key bytes were unchanged at startup.
No personal timer/record mutation or provider request was used as a test. The daemon is left running.
This follow-up changes documentation only. Nothing has been pushed; owner UI acceptance and the
previously deferred platform checks are still not claimed.

Contracts:

- [Owner-approved behavior](stop-calendar-67.md).
- [Backend endpoints, consent, receipts and eligibility](stop-calendar-backend-67.md).
- [Earlier plan-link visibility and Fit label slice](plan-links-67.md).
- [Recorded-work boundaries](adr/0001-explicit-recorded-work-boundaries.md).

## What is delivered

- Stop durably pauses the selected timer at the server cutoff. Save actual time, Continue,
  explicit fit/split and exact scheduled replacement use that review. Cancel leaves paused.
  Existing saved work, original plans, other timers and Entry-note guards are retained.
- Calendar Record time creates explicitly linked work. It does not complete the task or remove
  the plan. Past creation defaults to an explicit work draft, including + Session and external
  task drop. Future ends are rejected, not clipped. Existing plans remain plan edits.
- Remove schedule only keeps work and ratings. A virtual removal skips only the selected
  recurrence occurrence. Delete everything remains a separate guarded action.
- Unassigned time sums every saved interval in full, including overlap. Elapsed coverage and
  task-credit measures stay separate. Per-record tag attribution and filtering are covered.
- Unknown mutations retain their operation journals. Recovery reads receipts; it does not replay
  Stop, recording or removal writes. Pending approvals cannot be dismissed as if canceled.

## Final software checks

The source stayed clean and unchanged throughout the full gates at `9b615062`.
The environment used an external absolute DB, HOME and TMPDIR before imports. It used
`PYTHONSAFEPATH=1`, Python safe-path mode, four workers, disabled native notifications and tracing,
and an unset global idle flag for synthetic pytest cases. There were no personal/provider calls.

| Check | Result |
| --- | --- |
| `python -P -m pytest -q -n 4 --dist=worksteal tests/` | **1,355 passed**, 1,700 warnings |
| `node --test tests/*.cjs` | **1,053 passed**, no failures, skips or cancellations |
| Ruff on all 21 changed Python files | Passed |
| Ruff format check on those files | Passed |
| Syntax checks on every changed JS/CJS file | Passed |
| Whitespace and source-stability checks | Passed |
| Broad `ruff check .` | **17 inherited findings**; not repaired or reported as clean |

The first full integrated run at `b4f25a3a` is retained: 1,350 Python cases passed and two failed;
1,035 Node cases passed. One Python oracle pinned an obsolete serving token. The other expected
400 for the private `focus_evaluate` action, now rejected at the Literal path boundary with 422.
The repair requires an actual successful asset GET and exact single-controller/recovery
cardinality. It also requires exact `literal_error` rejection and unchanged timer, notice, file
and receipt state. It does not permit the private action or accept either error status loosely.

## Independent review and repairs

The initial independent Standards/Spec review found three P1 defects:

1. Stop reused a stale review after Cancel → ordinary Resume → Stop.
2. Calendar + Session did not pass Calendar intent, so it missed the past-work default.
3. Virtual-plan recording did not adopt the materialized UUID/revision into the open editor.

Parent browser checks also found that both approval dialogs allowed Escape during a pending
write. An apparent cancellation could be followed by the original request saving successfully.
All these defects were repaired in `9b615062`. The repair retained a corrected baseline RED of
94 passed / 19 failed across 113 mounted cases. Its focused GREEN was 91 Python and 198 Node
cases. Initial test-seam corrections are recorded with that evidence, not called product fixes.

Fresh targeted rechecks found **no remaining issues**:

- **Standards:** OK with notes. The notes bound the review to the repair and leave full/native
  checks to the parent. Target, note, pending-write, focus and read-only recovery guards remain.
- **Spec:** OK. Actual Calendar callbacks, direct/recovered identity adoption, retained drafts and
  pending-dismissal semantics match the contract.

The original review findings remain historical. The reviewers read source and tests; they did
not independently run the full suites or perform browser checks.

## Native synthetic browser checks

All checks used one owned browser profile and an isolated daemon on non-personal port 37773.
Data and timers were synthetic. The following checks passed through actual UI/controller and
root-HTTP boundaries:

- Actual Stop entry, Cancel → Resume → Stop, and a new durable cutoff. The reopened timer really
  became paused, rather than merely displaying that claim. Escape left it paused and returned
  focus to Stop. Continue resumed from its click without changing earlier actual segments.
- Linked Stop split produced separate plan/work parts. Pause gaps stayed excluded. Original
  source bounds survived, and receipt part IDs/revisions matched later reads.
- Record as scheduled produced one 600-second record at the exact selected plan endpoints.
- Calendar Record time preserved plan endpoints and task status. A live virtual occurrence
  materialized to a UUID. The editor, hidden ID, cache and next Record preview adopted that UUID
  and final numeric revision, without an obsolete projection revision or duplicate cache row.
- Yesterday's actual + Session callback exposed the intent choice, defaulted to work, and saved
  an approved `recorded_work` row rather than a preliminary schedule.
- Persisted plan-only removal detached but kept recorded work unchanged. Virtual removal skipped
  only its selected occurrence; another materialized plan, its linked work, task status and a
  later virtual occurrence survived.
- Two overlapping 20-minute taskless records returned **40 unassigned minutes**, **20 elapsed
  minutes** and **0 task-credit minutes** through the structured query HTTP route.
- For each approval dialog, the original outgoing mutation was held before forwarding. Cancel
  was disabled and actual Escape did not close it. Releasing that original request exactly once
  produced an authoritative ACK, closed the dialog and cleared its journal.
- Both dialog rectangles fit 320, 390, 768 and 1,217 CSS-pixel widths without horizontal overflow.
  Native Tab/Shift+Tab stayed inside each open dialog. Escape worked when no mutation was pending.

### Evidence limits and harness corrections

These are DOM, computed-layout, keyboard and genuine API-result checks in one engine. They are
not raster, screen-reader, touch-device, other-engine or owner visual acceptance. New Stop Fit,
all duplicate/stale/newer-owner permutations, external-drop gestures and unknown-write faults
were not each repeated natively; their automatic public-seam regressions passed. Wider platform
checks remain deferred, not passed. Optional history ranking remains out of scope.

AI routes were deliberately blocked in the scratch harness. Its AI status/overlay 403s produced
a stale-information banner; this is not provider or paid-call evidence. Saved results were
checked independently through genuine typed HTTP reads.

Invalid harness attempts are retained separately from valid passes. These include an undefined
helper on a page that does not load it, awaiting an unretained browser promise, a guessed Stop
helper/signature with missing revision, a pre-approval click that never dispatched, a mistaken
record-response wrapper, and a legacy GET used for a typed row. After inspecting state, checks
used the actual controller signature, an explicit revision, readiness/dispatch checks, direct
record response, and typed read endpoints. No failed/uncertain start or recording was blindly
repeated. Only a confirmed held original request was released once.

## Evidence retention and cleanup

Local working evidence is under `~/.local/state/timetrace-agent-work/stop67/`:

- `validation.1CA09r/`: initial full run, including both failures.
- `validation.XNX3KP/`: final source hash, full logs, scoped/broad lint and gate status.
- `review-repairs.diff`, final review artifacts and retained child reports.
- `native-*-red.json` and corresponding valid green result/layout/keyboard files.
- `native-final-no-holds.json`: no synthetic timers or pending timer, recording or plan holds.

The repair RED/focused logs, commands and status files were copied to `repair-evidence/` in
that durable state directory (21 text files). Their original location was
`/tmp/timetrace-stop67-repair.p0e8lm`. The scoped review conclusions and final full/native results
are also recorded above; this document does not depend on temporary-directory survival.

Owned preview resources are closed after validation. The synthetic DB/evidence is retained
outside the repository. During that isolated validation stage, no personal daemon restart,
personal DB/key use, root reset/stash, provider call, push or deployment was performed.
The later owner-authorized local deployment is recorded separately above.
