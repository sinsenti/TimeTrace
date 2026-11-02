# Ticket 11 — Widget canvas implementation evidence

Status: feature review found one unique P1; scoped repair delivered and **parent repair browser gate passed; fresh independent repair/combined review, integration and closure pending**.
Base: `7ed9bf330677fb317793aa4371c4f36f407a2595`, branch `feat/ui-redesign-11-dashboard-canvas`.
This is ticket 11 only, not whole-spec completion, manual acceptance or merge permission.

## Scope and preserved contracts

- Adopted the selected Widget canvas: named dashboard controls/tabs, editable cards, explicit earlier/later/remove controls, responsive stacked cards and scoped styling. Native keyboard activation and focus recovery remain usable.
- Dashboard detail supplies saved specs; each card independently uses existing `/analytics/query` or `/analytics/sql`. No new endpoint, schema, service, aggregation or execution infrastructure. Context is captured per canvas; selection/canvas/widget/request/context ownership rejects late results. Charts are disposed on replacement/removal/reset/departure. Retry reads only the failed card, not healthy siblings.
- `getCurrentDashboardId`, `getWidgetById`, `reloadCurrentDashboard` remain builder entry interfaces. Structured builder/optional SQL implementation and partials, shared settings, query/SQL services and core seeds were not edited. No ticket 12/13/14 implementation or performed/recorded-label changes.
- Acknowledged dashboard writes remain **Saved** if subsequent list/detail reads fail; recovery retries reads only. Pending writes are guarded. Reset/create/delete invalidate obsolete canvas identities immediately; remove/reorder preserve healthy query results and refresh after an overlapping read when necessary.
- Legacy source and index-level acknowledged imports are retained in browser recovery progress. Pending/unacknowledged items are never automatically replayed; the UI names the uncertain item/target and offers explicit retry (duplicate warning) or user-verified acknowledgement. Malformed/invalid source remains intact. Successful source is archived before removal; an existing different archive is preserved. This does **not** add transport idempotency or cross-tab synchronization.
- Existing seed rules remain authoritative: nine fresh defaults; routine visits never restore deleted widgets/custom titles; empty named dashboards remain empty; only explicit reset restores defaults; deleting Overview with another dashboard does not recreate it; deleting the last dashboard permits seeding on next list.

## Approved seam/TDD chronology

Approved caller/HTTP/API seams from the launch/common/spec were used; no new harness dependency.
Raw receipts: `/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-11/`.

1. `red-independent.log`: real `api_client.js` + canvas caller, failed at missing independent Loading presentation; detail/per-card implementation made it pass.
2. `red-saved-refresh.log`: acknowledged create followed by failed list read incorrectly alerted Offline; separated acknowledged mutation/refresh and added read-only recovery.
3. `red-legacy.log`: partial import deleted original source; journaled acknowledgement/uncertain recovery made it pass.
4. `red-create-identity.log`: old widget still reachable after acknowledged create plus failed list read; immediate invalidation fixed it.
5. `red-remove-refresh-race.log`: a read racing pending remove retained the deleted widget; acknowledgement now refreshes a newer same-dashboard read without replaying the delete.
6. `red-reset-identity.log`: reset followed by failed read allowed old seed results; reset now invalidates the removed identities immediately.

Additional regressions characterize stale selection/same-widget reload/context, SQL payload isolation, chart renderer failure/disposal, mutation guards, malformed/successful/partial legacy adoption and explicit retry. Not every additional test had a separate failing run; the six named RED receipts are the actual recorded red/green slices.

## Checks on implementation

- Full safe-path pytest: **356 passed, 101 warnings** (`full-python-final.log`). Baseline was 352/85; the four new API tests account for 16 additional existing SQLite adapter warnings.
- Focused dashboard/query/SQL pytest: **17 passed, 30 warnings** (`focused-python-final.log`). No real provider calls.
- Full Node callers plus tags: **162 passed** (`full-node-final.log`); includes **16** dedicated canvas caller regressions.
- **57** source/test JS/CJS syntax checks passed (`syntax-final.log`). Scoped new Python Ruff and format check passed.
- Full `ruff check --no-cache .`: **fails at the same 18 baseline findings**, all in unchanged `0002_add_task_statuses_and_subtasks.py`, `interfaces/cli/commands.py`, `services/analytics_service.py`; `git diff --quiet HEAD --` those paths passed. No global lint cleanup.
- `git diff --check` passed; no staged files at the pre-commit checkpoints.
- Exact concise Ruff baseline comparison: `ruff-concise.stdout` and `.stderr` each `cmp` equal recovered `evidence/fresh-verification/run.zoEyTE/baseline-ruff.{stdout,stderr}` (both exit0). Full Ruff still exits1; no claim that rich-format output is byte-identical.
- New API test first failed because its comparison fixture omitted required `sort=dimension_asc`; second failed because equality included per-execution `elapsed_ms`. Both initial outputs retained (`focused-python.log`, `focused-python-corrected.log`). Fixture corrections use the existing valid comparison contract and require all semantic fields equal, while separately checking both elapsed values nonnegative. No service change or weakened semantic assertion.

## Genuine isolated browser workflow

Own worktree-local venv/source. Before any app import/test/runtime, exported new absolute DB `/tmp/timetrace-ticket11.J3CGdE/timetrace.db`, host `127.0.0.1`, port **18165** (verified free), isolated timer/key directory, idle detection/tracing off and provider credential environment unset. Browser contexts are isolated; runner verifies exact health DB/port and fakes provider catalog. No personal DB/provider/paid calls. Daemon startup migrated the new DB through `0013_ai_data_scope`; no schema changes.

`tests/browser_dashboard_canvas.js`, via the preinstalled external runner, latest receipt **`browser-gate-ready.json`: 83 assertions, zero uncaught page errors**. Real public API readbacks verify named create/rename/delete, structured builder create/edit, literal/long saved titles, per-widget comparison specs, reorder/remove and reload persistence, customized/deleted seed adoption, explicit reset, Overview/last-dashboard deletion rules. Native keyboard reorder/remove retains usable focus. Held sibling query and deliberate query 503 prove independent Loading/error/Retry without repeating healthy queries; held old detail cannot replace new selection. A successful create followed by deliberate list 503 remains Saved and recovers without another POST.

Legacy browser probe commits the second import through the real server, then aborts its response. Reload never repeats either acknowledged or uncertain item. Real readback verifies both rows; explicit user-verified acknowledgement archives source with no duplicate. Malformed source is preserved without writes. Optional SQL entry/schema/preview is an **explicit HTTP fake**, not SQL backend certification; sandbox semantics are separately covered by Python.

Four widths (390/768/1024/1440), all three light treatments plus retained dark: 16 bounded geometry/color samples, including a long literal title and immediate chart resize. No horizontal page overflow; sampled widget controls at least 32×32. Minimum sampled description text contrast **5.689:1**, sampled control text **12.011:1**. These are bounded samples, not whole-accessibility certification.

First browser failures are retained, not called passes:
- `browser-first.json`: test used nonexistent measure `total_duration`; corrected to source-named `sum_duration` (also corrected the HTTP-fake Node fixture spelling).
- `browser-second.json`: broad Rename locator also matched the retained Assistant control; scoped to canvas actions.
- `browser-third.json`: stale canvas ownership after create/list-read failure; strengthened caller regression exposed/fixed the product defect.
- `browser-fourth.json`: immediate desktop→phone Chart.js bitmap overflow. Diagnostics `layout-resize.json` observed scrollWidth 643 at width390; scoped canvas max-width fixes it (`layout-resize-fixed.json`). No delay/threshold weakening.
- `browser-fifth.json`: probe reset wait dereferenced null data; added identity/null guard, preserving the expected nine-widget assertion.
- `browser-sixth.json` passed the earlier 74-check version; `browser-final.json` passed strengthened 83 checks before the final uncertainty-message-only change; `browser-gate-ready.json` passes the exact current code. Scratch synthetic dashboards were removed through the scratch public API between failed attempts; no personal data or fixtures recolored to hide failures.

## Remaining gates and limits

Parent independently executed the exact frozen-source native probe: `parent-browser-gate.json/.stdout/.stderr`, **83 assertions passed, zero page errors**. Parent approved the browser gate and first commit/integration reservation. Source/tests stayed frozen after that gate; all six `gate-source-sha256.txt` hashes reverified. Own-branch `git merge-base --is-ancestor feat/ui-redesign-integration HEAD` passed; authorized `git merge --ff-only feat/ui-redesign-integration` returned **Already up to date** at `7ed9bf3`. One coherent `feat(stats)` ticket-11 feature commit is authorized. Independent two-axis review, fresh merger and closure remain parent-owned/pending; no integration write/push/PR/dev merge/closure is authorized here.

Own daemon stopped after the parent gate: app PID265894 and uv PID265890 absent, port18165 socket closed, scratch timer was not running and its state file removed (`cleanup-gate.txt`). Scratch DB is retained for evidence; migration head `0013_ai_data_scope`, `PRAGMA foreign_key_check` empty. Source hashes and final commit/check/clean-tree evidence are in the external worker report.

Physical touch, screen reader, non-Chromium engines, zoom/reduced-motion and comprehensive contrast are not certified. Existing reported light task-color 4.33:1 and four dark AI 3.98986 samples are not fixed or waived here. Cross-tab legacy import races/transport exactly-once are not promised; genuine uncertain outcomes need explicit user review. The retained existing builder/SQL editor is not redesigned or fully retested across every capability combination in this ticket. No existing-DB migration test was needed/run because no schema/migration changed.

Serialized common-doc follow-up for parent: development's statistics description should note detail + independent query/SQL card reads and the legacy recovery journal, rather than aggregate-only execution. Do not close ticket 11 or mark the whole spec Built from this receipt.

## Independent-review repair — obsolete detail Retry (2026-11-02)

Both independent reviews of `badbd787e4967c775d67e6da2d021c526d9a7394` reported the
**same unique P1**, not two defects: after failed A detail, the surviving Retry could erase
healthy B before rejecting A's response. Prior 83-check gates did not cover that sequence.
Repair branch `feat/ui-redesign-11-review-fixes` started clean at that exact commit.

- Reject non-selected dashboard loads before generation/data/chart/grid/heading initialization.
  Detail retries also validate their captured selection/generation, including queued old notice
  and grid handlers. Accepted new loads clear obsolete/recovered detail notices while restoring
  the underlying write/list notice, retaining Saving, Saved and read-only recovery.
- One minimal shared canvas-clearing helper replaces identical invalidation blocks; generation
  changes and selection decisions stay at callers. No builder/backend/seed/framework changes,
  tickets 12–14 work, new API or schema.
- Five added caller regressions cover obsolete handlers, legitimate same-dashboard recovery,
  same-dashboard supersession, held create/selection/Saving→Saved and unacknowledged-write
  read-only recovery. Actual RED: `red-stale-caller.log` loses healthy B. Actual native RED:
  `browser-red-stale.json` loses B's data/card/chart/focus, changes heading to Overview and
  leaves Loading. These are new executed failures; older failures remain historical.

New raw outputs only: `/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-11-repair/`.
Own source/venv and newly created `/tmp/timetrace-ticket11-repair.FR4133/timetrace.db` were configured
before any import/test/runtime; daemon PID334532, loopback18167 (verified free), idle/tracing off,
credential environment unset, separate timer/key directory. No personal DB/provider/paid calls.
The external runner health-checks exact DB/port and fakes provider catalog.

Checks: **356 Python passed / 101 existing warnings; 167 Node passed; 21 focused caller tests;
57 source/test syntax checks**. Full Ruff exits1 at the **same 18 baseline findings**; concise
stdout and stderr independently `cmp` equal `fresh-verification/run.zoEyTE/baseline-ruff.*`.
No Python edits; scoped Python formatting not applicable. `git diff --check` passed.
An initial mistaken `tests/test_tags.js` command failed (file absent), retained in
`tags-wrong-path.log`; corrected full command includes `tests/test_tags_engine.js` and passes.

`browser-gate-ready.json` and independently executed `parent-browser-gate.json` each report
**89 bounded assertions / zero pageerrors**: prior83 plus six new recovery assertions. The
native obsolete UI is absent after selecting B; captured old notice/grid callbacks issue zero
requests and preserve B's data/card/chart/focus/heading. Legitimate same-dashboard Retry performs
reads only, restores Overview and clears its error while retaining Saved. Query payload context
is checked. Deliberate detail503 joins the existing explicit holds/failures/SQL HTTP fake;
SQL preview remains **not sandbox certification**. Parent verified all three frozen hashes in
`gate-source-sha256.txt` and approved the browser/one-fix-commit gate. No source/tests changed after
that freeze. Own-branch latest-integration ancestry check passed at `7ed9bf3`; authorized
`--ff-only` recheck returned **Already up to date** (`integration-recheck.log`). Final check,
commit and owned daemon/socket/timer cleanup receipts are external; fresh independent amendment
and combined ticket11 Standards/Spec review, parent integration and closure remain mandatory.

Prior bounded/manual limits remain: no physical touch/screen-reader/non-Chromium certification,
comprehensive contrast, cross-tab detection or transport idempotency. Known light4.33:1 and four
dark AI3.98986 samples are not fixed or waived. No schema/migration or existing-DB migration test.
This receipt does not close ticket11, mark the spec Built or authorize integration/dev merge.
