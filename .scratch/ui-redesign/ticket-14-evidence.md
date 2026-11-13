# Ticket 14 implementation checkpoint — 2026-11-13

Original source base: `e4ad345b6761b40b5d2e634a6f3c28e3c8deb0f7`.
Current review base after required fast-forward: `653012aca42b21446fdf5848a02f6964ba4f9493`
(reviewed ticket05 local integration; its changes do not overlap ticket14).
Worktree: `.scratch/codex-continuation/worktrees/ticket-14-performed-time`.
Branch: `codex/ui-redesign-14-performed-time`. No commit, integration merge, push or PR yet.
This is implementation evidence awaiting independent review/native verification, not human acceptance.

## Change and adoption contract

- `core/dashboard_seeds.py`: reusable performed-time seed, added to fresh Overview (ten widgets),
  last14 days/session duration/day/line, ascending/gap-filled, `session_time_relative eq past`,
  previous-period comparison, fan-out. Original total-time/session queries remain unchanged;
  their fresh default titles become Recorded session time / Recorded sessions.
- `routers/web.py`: `/stats` supplies the pure preset through template context; no DB query or new endpoint.
- `templates/stats.html`: recreation launcher and `tojson` payload.
- `static/js/widget_builder.js`: reusable structured hydration after guarded capability loading;
  preset is an editable unsaved draft, with no automatic query preview or write. Existing saved
  structured queries and SQL controls retain their entry paths.
- `static/js/dashboards.js`: presentation-only aliases require the matching seed key and exact old
  default title; custom titles and stored rows remain unchanged. Recorded tiles explain inclusion
  of past/future recorded rows only for the original session source/measure, all-time range and empty
  filters/grouping. Canvas headings/legends/control labels use the same alias. Customized scopes
  retain their saved definitions without the original-scope claim.
- `tests/test_performed_time_widget.py`: public dashboard/page/query-service regressions for fresh
  seeds, old/deleted/empty dashboard preservation, recreation/edit/reopen, local start-day buckets,
  performed-versus-scheduled/open/straddling rows and previous-period alignment.
- `tests/test_performed_time_widget.cjs`: seven DOM/API-adapter scenarios cover hydration, Cancel,
  save/edit/reopen, capability error, canceled/stale selection, aliases/custom names and SQL control.
- `tests/browser_performed_time_widget.js`: real-daemon probe prepared for the parent's native phase;
  fresh10, existing9 (nine original query definitions/custom name survive reload), confirmed performed
  deletion without resurrection, unsaved recreation, no auto-preview, Escape/focus, real save/edit/reopen,
  nonzero90/30min comparison series versus8 recorded hours (future/open/straddling controls), literal
  title and390px overflow assertions. The first native attempt returned all37 product checks,
  but the passive observer caught an opaque-origin fixture error; see the amendment below.
- `tests/test_dashboards_api.py` and `tests/test_dashboard_canvas.py`: only necessary fresh/reset/delete
  count expectations change from9 to10 (and8 to9 after one deletion).

`DashboardService.ensure_seeded` and explicit reset implementation are unchanged. An existing
nine-widget/empty/custom dashboard is never backfilled; deleted performed widgets stay deleted.
No API/model/schema/migration/provider change. The authorized narrow compiler bind-format
correction below restores existing exact-boundary semantics without changing SQL predicates.

## Fresh isolated validation

External receipts: `/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-14/`.
`environment/allocation.json` records NEW0700 HOME/TMP/XDG/data/runtime, absolute DB and sibling
key/timer isolation, strict24 sanitized environment, offline editable Python3.14.6, idle/tracing
and SQL disabled. No personal DB, credential or live provider call was used. Python TestClient
commands ran escalated because this environment's sandbox hangs even on `/health`.
Each command retains stdout, stderr and exit metadata; earlier failed attempts remain preserved.

- `red-seed`: intended missing-fresh-preset assertion fails before implementation (1 failed).
- `red-preset`: Node runner exits1 before preset implementation; file-level reporter hides child
  diagnostics. `red-preset-baseline-replay` runs the same tests directly against an archived
  original source, showing missing `openPerformedTimePreset` and old-label assertions.
- `green-seed`:9 passed. `green-preset`: Node file-level pass.
- `focused-python` through `focused-python-3`: retained test-fixture corrections (SQLite rejects
  datetime subclasses; grouped responses expose values in rows, not scalar totals; exact-second
  edge described below). `focused-python-4`:12 passed,64 warnings.
- `full-python`: `uv run --offline python -P -m pytest -q`:510 passed,274 warnings,22.25s.
- `focused-node-direct`:6 passed. `full-node-tap`: canonical
  `node --test --test-reporter=tap tests/*.cjs tests/test_tags_engine.js`:18 files passed.
- `scoped-ruff-3`: all five changed Python files pass. Scoped formatter ran on changed implementation
  Python/new test; unrelated legacy formatting in `web.py` was preserved instead of rewritten.
  Earlier sandbox uv cache-lock errors and an import-order correction are retained in receipts.
- `full-ruff`:18 pre-existing violations; `baseline-check.json` confirms byte-identical diagnostics
  on a fresh `git archive HEAD` baseline (no added violations).
- `final-syntax`: both production JS, new CJS and browser probe pass `node --check`.
- `whitespace`: `git diff --check` passes.

## Integrated checks after ticket05 fast-forward

The parent's independently reviewed local integration advanced ticket14 with `git merge --ff-only`
to `653012a`, preserving the uncommitted ticket14 delta without conflict. Earlier510-test receipts
remain untouched. New receipt labels are distinct:

- `integrated-full-python`:521 passed,278 warnings,22.59s.
- `integrated-full-node-tap`:22 test files passed.
- `integrated-full-ruff`:18 existing violations; `integrated-baseline-check.json` confirms identical
  diagnostics on an archive of current HEAD653012a. No new violations.
- `integrated-final-syntax`: two production JS files and both new JS/CJS tests pass.
- Full Python/Node source was stable; only the separately run browser probe and this evidence/issue
  checkpoint were extended afterwards. Native probe is syntax-checked and awaits parent execution.

## Independent-review amendment

The Spec reviewer identified a P2: using seed identity alone for the recorded-scope explanation
misdescribed customized past-only/future-only/other-source metrics. The caller-visible new Node
regression failed on the past-only case before the fix (`review-scope-red`). The repair displays
that explanation only with the original session measure, no filters/grouping and an all-time range.
Custom titles, queries and edit hydration remain unchanged. Seven direct Node scenarios now pass
(`review-scope-green`), including original/past-only/future-only/other-source/past-range/other-measure
controls. Independent re-review remains pending; this checkpoint does not self-certify the fix.

After this amendment: `review-final-python`521 passed/278 warnings/22.30s;
`review-final-node-tap`22 files passed; `review-final-syntax` and `review-final-scoped-ruff` pass.
`review-final-full-ruff` remains byte-identical to the18-error integrated baseline. Earlier frozen
manifest/receipts remain unchanged; `frozen-manifest-review-amendment.json` records this snapshot.

## Exact-timestamp and native-fixture amendment

The first native attempt (`native-adoption/`) returned all37 product checks, including actual
1.5h primary/0.5h baseline chart series, existing9 preservation, deletion without resurrection and
recreation Save/edit/reopen. The overall browser exit was1: the fixture's initScript attempted
localStorage on opaque `about:blank` before the probe registered its own pageerror listener.
The parent's passive observer caught this; the failed receipt is retained and is not described as
an overall pass. The fixture now guards its initializer to HTTP loopback documents. No product
check was removed or weakened. Fresh native execution remains pending.

The controller disposition records one pidfd TERM, actual daemon exit-15, reaping/process absence,
post-stop connection refusal111 and equal logical storage after shutdown. No personal DB/provider
calls were used. Parent owns the subsequent native run and its independent guard/controller review.

The previously reported whole-second edge was then explicitly authorized for a narrow repair,
replacing the relative-session-time `__now_utc` bind with a six-digit-microsecond ISO datetime
string matching SQLModel's SQLite storage. The existing indexed-column predicates, naiveUTC
context and past/future/ongoing policies are unchanged. No migration or wider datetime abstraction.
This supersedes the earlier unresolved boundary limitation; the repair awaits independent review.

`tests/test_analytics_query_service.py` drives real QueryService against stored SQLModel rows at
zero and123456 microseconds. Eight uniquely tagged rows cover end before/equal/after now, start
before/equal/after now, open/closed rows, +/-1us edges, individual past/ongoing/future, IN past+ongoing
and unfiltered controls. Genuine `boundary-red`:4 failed/6 passed/3 deselected, with only the
whole-second filtered cases failing. `boundary-green`:18 passed/14 warnings including the performed
widget regression now exercised at both0 and500000 microseconds, preserving local start-day buckets,
baseline alignment and original recorded totals (8h/6rows versus2 performed hours).

Final distinct receipts: `boundary-full-python`532 passed/214 warnings/23.39s;
`boundary-full-node`22 files passed; `boundary-final-syntax`, `boundary-scoped-ruff` and
`boundary-final-whitespace` pass. `boundary-full-ruff` remains byte-identical to the18-error baseline.
Scoped formatter ran on changed compiler/tests; unrelated pre-existing compiler formatting was
preserved. All earlier failed/green/native receipts and frozen manifests remain unchanged.
`frozen-manifest-boundary-amendment.json` records the new14-path snapshot.

## Unresolved/deferred verification

Independent review of the compiler/fixture amendment, fresh full native execution, rendered contrast,
physical touch, screen-reader/alternate-engine and human acceptance remain pending. The parent
coordinates these against the frozen source; no acceptance gate is waived. Arbitrary requested-zone
bucketing and the earlier comparison-key ambiguity remain existing limitations; this ticket retains
the settled local daemon-zone semantics.
