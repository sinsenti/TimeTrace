# Selected saved-history export (#65)

Contract: [issue and reviewed brief](https://github.com/sinsenti/TimeTrace/issues/65#issuecomment-7102498511).
Public seams: root HTTP/AnalyticsService, public JS controller interactions, isolated Orca browser.
No schema changes, durable export state, timer operations or new export backend. Existing Markdown
export/import callers remain unchanged. Independent review/publication remains the coordinator's step.

## Use

In Agenda choose **Export saved history**. The default range is the selected day. **Load eligible rows**
opens a clearly labeled start-day cohort with independent row/group checkboxes; it does not touch the
inspector or timer selection. **Preview checkbox selection** with no checks exports zero, never all.
**Preview ALL filtered matches** is the explicit alternative, independent of expanded history groups.
The current title/tag/note predicates apply to every matching saved row, not just expanded pages.
Load/reload of eligible rows clears checkbox selection; date/filter/legacy changes clear it as well.

Inspect counts, range, filters, effective zone, snapshot instant, raw intervals and both independently
labeled totals. Switch Markdown/CSV without rereading. Copy and Download require explicit clicks.
Clipboard/download exceptions retain accepted bytes and display failure; download success means
requested, not proof the user saved a file. Close discards the envelope and returns launcher focus.
Known timer/manual-save/note mutations disable output until explicit regeneration. Unknown concurrent
edits cannot change the already accepted dated artifacts.

## Read bounds and semantics

The inclusive range is at most 400 effective daemon-local start days. Another requested IANA zone
gets an explicit effective-zone warning, matching current analytics limits; invalid daemon zones
fall back explicitly to UTC. Whole overnight intervals are retained with independently offset-bearing
endpoints. Overlap-only carry-ins do not belong to this export's start-day view; choose their start day.
Calendar's overlap reads and existing progress semantics are unchanged.

At most 2,000 eligible rows/selected IDs and 4 MiB combined UTF-8 artifact bytes are accepted.
Filtered Unicode literal matching uses bounded scanning: more than 10,000 SQL candidates in the
selected range refuses with a narrowing diagnostic, never truncated success. Explicit-ID reads bind
only the bounded IDs via SQLite JSON membership in the same read snapshot. Selected IDs missing or
outside filters refuse rather than disappearing. Unsupported fields/combinations are rejected.

Saved taskless/manual/timer evidence is included. Uncertain legacy is opt-in, separately classified,
has unknown work duration/provenance where applicable and contributes zero to both recorded totals.
Plans, projections, live/private timer buffers are excluded. Reports are not lossless backups or
review/rating import formats. CSV uses RFC4180 escaping plus apostrophe protection for formula,
control, whitespace and BOM prefixes in every user string; spreadsheet display may change. Markdown
table text is escaped and preview uses textarea.value, never report HTML.

`summed_recorded_work` counts every physical interval's
end-minus-start, including same-task overlaps. Public structured analytics advertises hours, with
implemented non-tag dimensions/filters only; tag attribution is explicitly unavailable for this
measure. Internal exact-ID evidence uses seconds directly, avoiding a float hour round-trip. Export's
SUM and elapsed union both run through the shared compiler/query service against exactly the frozen
selected work IDs. Old task/elapsed/unassigned unions and estimate accounting are unchanged. #64
must reuse this measure; #65 adds no goals or weekly UI. #61's future committed fragments are normal
saved evidence; this slice consumes mutation invalidation and does not alter its protocol/lineage/UI.

## Acceptance and engineering matrix

| Contract | Evidence |
|---|---|
| Overlap-preserving SUM, existing union unchanged | Public HTTP 150m sum/105m union; same-task overlap and taskless fixture; query capability matrix |
| Exact selected IDs/same snapshot; empty never all | Public HTTP 120m sum/90m union excludes unselected 3h row; empty selection test |
| Shared literal Unicode title/tag/note, taskless label | Public HTTP literal Unicode conjunction and public visible JS predicate; browser title/tag/note + same-name UUID groups |
| Carry-in/start-day/overnight/DST/zone fallback | Public HTTP whole overnight, carry-in refusal, repeated NY hour with -04/-05 endpoints and explicit effective-zone warning; invalid daemon fallback |
| Plans/legacy/live distinction | Public HTTP plans excluded, uncertain opt-in separate/unknown/zero totals; no timer-buffer read path |
| Counts, complete bytes, safe text and no mutation | Public HTTP CSV decoding, Unicode/BOM/control/formula prefixes, Markdown HTML/table escaping, repeated original-note reads, per-artifact UTF-8 counts |
| Caps and stale selections | Public HTTP range/invalid combinations/stale IDs, 10,001-candidate refusal with bounded explicit-ID success, 2,001 eligible refusal, 4MiB combined refusal |
| Immutable artifacts/generation/invalidation | Public controller empty selection, late-read rejection, external/accepted-state mutation resistance, known mutation invalidation, clipboard failure retention |
| Browser selection/output | Real eligible group checkbox and selected preview; two identical task titles remain two UUID groups, first-group selection exports one row; all three filters applied |
| Actual clipboard/download | Trusted Orca Copy completed with pass-through captured text exactly equal to preview; typed Orca downloads saved both UTF-8 files and actual saved bytes equal pass-through browser Blob bytes |
| Narrow/focus/drafts/failures | Real browser 390px viewport/352px dialog, retained dirty saved-work editor, late mutation-read refusal, read and clipboard failure retention, subsequent-turn launcher-focus proof |
| Existing callers/full regressions | 848 Python and 869 Node passed; changed-JS syntax passed; full Ruff retains exactly 17 baseline findings |
| Migration/protocol boundaries | No model/schema change; no migration required; no #61 receipt/hash/lock/lineage changes |

### Bounded limitations

Orca headless screenshot failed with `Page.captureScreenshot: Screenshot timed out — the browser page
did not draw a frame`. Narrow DOM sizing/control/focus behavior passed, but screenshot-based visual
inspection and human/platform/accessibility certification remain unrun, not silently passed. Direct
clipboard readback also did not complete; actual write resolution and its exact argument were proved,
not OS clipboard readback. The raw agent-browser download transport refused CDP retrieval; the
supported **typed Orca download** succeeded and both files were read and byte-compared. Actual #61
correction workflow integration awaits that separate branch; no speculative correction implementation
or partial checkpoint was merged here.

## Red/green and verification receipts

Synthetic data only; absolute scratch DB plus isolated HOME/TMPDIR established before imports.
`uv run python -P -m pytest -q`: **848 passed**. `node --test tests/*.cjs`: **869 passed**.
Focused export/query HTTP: **35 passed**; new export HTTP file: **24 tests**. Public export controller:
**3 tests**. Changed JS and `tests/browser_history_export_65.js` pass `node --check`.
Full Ruff: **17 inherited findings**, compared by file/code/message multiset to an archive of baseline
`5958cd0`; no new findings. Scoped formatting was applied only to changed Python files.

Development first observed the new measure's HTTP422, missing preview endpoint, empty selected
snapshot, invalid request acceptance, mislabeled SUM basis, microsecond hour-roundtrip drift,
invalid daemon-zone failure, missing taskless-title match, absent controller/copy/predicate and mutable
nested envelope. Each behavior was followed by its minimum implementation and focused green run.
The candidate-scan tracer first refused explicit IDs along with filtered-all, then gained bound-ID SQL.
Existing Node harnesses gained browser CustomEvent/dispatch boundaries for the new ACK signal.

One early full Python run during development failed (18 failures: intentionally disabled idle detection
and source edits during that run); it is not the final result. The final complete run used the standard
test idle setting, with daemon idle detection separately disabled, and passed all 848 tests. An invalid
fixture with `recorded_work`/null provenance was rejected by the existing DB check constraint during
exploration and was removed, not presented as an export regression. See the worker report for exact
local command/output paths; the tracked browser probe is `tests/browser_history_export_65.js`.
