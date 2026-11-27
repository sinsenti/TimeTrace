# Stop / Calendar backend API (#67)

Root daemon HTTP only. Existing `/timers/{id}/stop`, standalone `squeeze` and legacy
sessions retain their old semantics. The new UI must use this review protocol, never
Stop → discard → manual-create. All operation IDs are caller-generated and retained
before dispatch. Timer operation IDs are unprefixed in `/operations/{id}`.

## Stop (implemented)

1. `POST /timers/{id}/stop-review {operation_id, expected_revision}` durably pauses
   only that timer at server cutoff. Standard result includes `timer.stop_review`:
   `{id: operation_id, cutoff, was_running, timer_revision}`. Use returned timer/revision.
   Frozen/unresolved gaps return409 `idle_gap_unresolved` before any pause/write.
   Reopening an active review uses GET timer/journal, not another preparation. Initial
   preparation uses server Stop time even for an already-paused timer, without changing
   its actual segments. An acknowledged Entry-note edit updates revision without changing cutoff
   or was_running; re-preview using the returned timer before committing.
2. `POST /timers/{id}/stop-preview {review_id, expected_revision,
   scheduled_session_id?: null, expected_plan_revision?: null}` is read-only.
   `candidates` are normal typed saved-plan reads (UTC timestamps), constrained to
   the existing link or, if unlinked, explicit same-task plans overlapping unsaved work.
   `selected_plan_id` remains null without explicit selection, including one candidate.
   Use candidate id/revision in a second preview to select; never infer ownership.
   `blocked` maps `actual|continue|fit|split|scheduled` to explanatory string arrays.
   `actual_parts` are contiguous actual work intervals, excluding pauses.
   `effects` describes schedule parts/current exact replacement and source plan.
   `unsaved_segments` shows the exact result being approved/replaced.
   `consent_token` binds full timer, selected plan, candidate/dependency snapshots.
   `manifest` contains internal snapshots; naive DB timestamp strings there are UTC,
   not browser-local timestamps. Prefer typed `candidates` and `effects` for display.
3. `POST /timers/{id}/stop-commit` takes that same selection/review/revision plus
   `{operation_id, consent_token, policy: actual|continue|fit|split|scheduled}`.
   `actual` saves only positive unsaved segments and stops, retaining associations.
   `continue` is eligible only when this review paused a running timer. It resumes
   at the new click cutoff, excluding decision time. Cancel/Escape/dismiss send no
   mutation and leave the timer paused. Already-paused reviews cannot Continue.
   Optional actions require explicit current plan selection, even with an existing link.
   Existing links cannot be reassociated through this flow. Taskless saves remain supported.
   Saved/split history or matching saved work blocks optional actions; use corrections.
   Scheduled replacement preserves a single consistent unsaved Entry-note/tag context
   exactly; differing segment metadata blocks it rather than merging or dropping notes.
   Actual/fit/split retain each original segment's metadata.
   Fit requires one contiguous part; Split requires separated parts and explicit consent.
   Scheduled replaces only approved unsaved work with exact current endpoints; its end
   must be at/before the ORIGINAL review cutoff, never later commit time. Waiting or
   refreshing cannot enable it: Continue timing then review again.

A successful fit/split returns `schedule`: `source_plan_id`, `source_plan_before`,
`original_start/end`, stable `part_ids`, and typed `parts` with FINAL revisions after
work linking. Adopt every row before fallible range refresh. Selected source plan is
first part and retains its immutable originals and recurrence override. Additional
parts are normal UUIDv7 scheduled rows, original=current at initial creation. Immutable
receipt/result preserves source→parts mapping and full source snapshot. Do not sum child
originals as a group original duration; per-plan comparisons remain non-additive.
No series edit or invented recurrence anchor is involved. Scheduled replacement returns
`replacement.unsaved_segments` and `plan_before` as immutable evidence, plus
`replacement.plan` with the FINAL post-association revision/endpoints.

Errors:409 `revision_stale`, `stop_review_stale`, `stop_preview_stale`,
`stop_plan_ineligible`, `stop_policy_blocked`, `stop_review_active`,
`operation_payload_mismatch`, `reconciliation_required`;404 missing resource;
422 invalid schema. No partial DB rows on rejection. Unknown writes stay blocked.

Recovery: `GET /operations/{operation_id}` returns `finalized` + original result or
`pending_reconciliation` + null result. GET is inspection only; never blind mutation
replay after timeout/lost ACK. Pending intent is reconciled by daemon barrier/startup;
keep polling/retain ID and do not dispatch another gesture. Same-ID exact replay is
server-idempotent as defense, not the UI recovery strategy. Do not overwrite receipts.

## Frontend entry-point requirements

New entirely-past Calendar creation includes selection/+Session AND external sidebar
task drop. Past drop opens explicit recording confirmation: neither silently POST work
nor first create a plan. Future drops may keep scheduling. Recording never runs the old
best-effort Scheduled task-status update. Existing plan edits never auto-convert.
A plan without an assigned task cannot acquire a same-task link magically; explain the
assignment/eligibility limitation, never implicitly retag it. No automatic status-change
plan deletion is approved.

## Reviewed manual/Calendar recording (implemented)

`POST /recorded-work/preview` takes existing `RecordedWorkCreate` fields:
`{task_id?:null,start_time,end_time,tags?:"",notes?:null,scheduled_session_id?:null,
expected_plan_revision?:null,expected_projection_revision?:null}`. No writes.
For Calendar plan Record, initialize editable endpoints from current plan; explicitly
send same task + plan id + last revision. Response `{consent_token, plan, start_time,
end_time, existing_work, duplicate_warning}`. Existing work includes same-task interval
overlaps and all explicitly linked work, so never infer attachment from a match.
Taskless manual recording is allowed; linking a taskless plan is409
`association_task_conflict`. Future ends are400 `future_recorded_end`, never clipped.

`POST /recorded-work` with those SAME fields plus `{operation_id,consent_token,
acknowledge_existing_work?:false}` commits atomically with a DB-only receipt. Keep the
operation ID before dispatch. Existing work requires explicit acknowledgement; otherwise
409 `recording_overlap_unacknowledged`. A changed preview is409 `recording_preview_stale`.
Changed interval/note/task/selection needs a new preview. No status/estimate/schedule-endpoint
change. Linking increments the plan revision as before; the receipted result includes
`linked_plan` with its final typed revision/endpoints. Adopt it before another edit or
fallible refresh. Result otherwise remains RecordedWorkCreated; read-only recovery via
`GET /operations/recorded-work:{operation_id}` returns that exact result. Idempotent exact
replay is defensive; lost ACK recovery is GET-only. Legacy non-journaled manual callers
without these additive fields retain their existing warning-only behavior.

## Plan-only removal (implemented)

Existing `GET /scheduled-sessions/{id}/removal-preview` now includes
`blocked.remove_schedule`. Existing `POST /scheduled-sessions/{id}/removal` accepts
`{operation_id,consent_token,action:"remove_schedule"}` alongside separately guarded
`delete_everything` and `squeeze`. Show exact manifest plan/work before consent.
Remove schedule detaches explicitly linked records (revision +1) and deletes only the
plan; preserves work times/task/notes/ratings, correction/audit history, unrelated work,
and task status. The selected recurrence override becomes a skip; unrelated work anchors
remain. Plan ratings, draft restoration dependencies, unsupported work metadata and
unfinished associated timers (including paused/gapped) block it before any effects.

Result includes `removed_plan`, `work_before`, `preserved_work_ids`, empty
`deleted_work_ids`, and namespaced `operation_id`. Recover by
`GET /operations/plan-removal:{operation_id}`. Exact same-ID replay returns the original
result even though the plan is gone; changed payload409. Stale dependencies409
`stale_plan_manifest`; ineligible409 `plan_removal_blocked`. Plan-only removal never calls
Delete everything, silently removes work, or dispatches a timer mutation.

The same preview/removal endpoints accept a live `virt:` identity for
`remove_schedule` only: consent binds its exact projection identity/revision/context.
Apply transactionally writes a skip for ONLY that selected occurrence and its receipt;
no plan/work is materialized, no series rule or other occurrence is changed. An accepted
pending timer capture blocks removal. A changed, materialized, moved, skipped or unavailable
projection rejects409 `stale_plan_manifest`, never follows an inferred replacement.
Virtual Delete everything / squeeze are blocked here; there is no fallback to legacy
all/following deletion. Read-only recovery and same-operation receipts work identically.

No schema change is required by this representation; Alembic remains unchanged.
