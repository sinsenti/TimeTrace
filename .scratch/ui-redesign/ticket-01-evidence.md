# Ticket 01 — implementation evidence, review pending

Status remains **ready-for-agent**. Implementation and bounded browser verification are delivered;
independent per-commit Standards/Spec review and parent integration/closure are still required.
This is not completion of the graph, whole-app accessibility certification or permission to merge to dev.

## Scope and adoption

Start/base: `2f978dcf4a3aef21f0d4a5438ba026db1b2e0fe2`; verified ancestor on
`feat/ui-redesign-01-calendar-shell` before edits. Merging the latest local integration tip before
final validation returned **Already up to date**. Owner checkout was read-only throughout.

- Aligned planning strip over the existing FullCalendar and task panel; task search, explicit
  task-attached Schedule and Session actions; independent panel toggles, persistent filter chip
  outside Totals, URL date/view/tag/task context and same-page Back/Forward restoration.
- Spacious 88px/hour default, 56/72 alternatives; density remains independent of 15/30/45/60-minute
  slot intervals. Totals start closed only without a valid existing visibility preference.
- Shared Refined Archive/Soft Stone/Porcelain light treatments, manual light/dark switching and
  existing dark/color palettes. Existing `theme` retains its dark/auto-color ownership. Missing or
  invalid individual preferences default without resetting valid neighboring/unknown settings.
  Valid legacy right-sidebar preferences are adopted. New task-view preference adoption is present;
  additional task-view compositions/selectors remain owned by tickets 04/06/07.
- All seven templates include shared light adoption and navigation; aliases remain unchanged.
  Preferences remain a working modal, now also included on AI Settings. Full `/settings` page
  replacement remains ticket 19. Token-only appearance updates retain editor drafts/focus and
  running file timers. Chart neutral labels/grids update without data/query/config writes or
  rebuilding editor DOM. Five grade colors and explicit inline user paints remain distinct/preserved.
- Existing session/timer/recurrence components were reused, not replaced. No model, schema,
  service, JSON API, CLI, provider behavior, dependency or frontend build change.

## TDD and automated validation

Read `.pi/skills/tdd/{SKILL,tests,mocking}.md` completely and used the approved Settings/adoption,
real daemon/template and Calendar workflow seams. Red-before-green receipts remain under
`/tmp/timetrace-ui-implementation.rZwJP1/ticket-01-red-*.log`: fresh defaults, existing adoption,
invalid neighbors, appearance persistence, panel/density controls, HTTP includes, query/history,
Preferences trap, Vim activation guard, search empty state, real global Escape/restore interaction
and chart neutral styling. The HTTP slice first failed all 11 cases for missing shared controls;
focused JS failures include undefined new behavior and the actual null-focus regression, not
source snapshots. Browser failures below supplied additional rendered red evidence.

Final commands used the isolated environment **before any TimeTrace Python import/command**:
`source /tmp/timetrace-ui-implementation.rZwJP1/ticket-01.env`.

| Command/check | Final result |
| --- | --- |
| `uv run python -P -m pytest -q tests/test_calendar_shell.py` | exit 0; 11 passed |
| `node --test tests/test_calendar_shell.cjs` | exit 0; 12 passed |
| `uv run python -P -m pytest -q` | exit 0; 352 passed, 85 existing warnings |
| `node --test tests/test_calendar_shell.cjs tests/test_calendar_task_registry.cjs tests/test_task_knowledge.cjs tests/test_tags_engine.js` | exit 0; 85 passed (73 existing + 12 new) |
| `node --check` each changed production JS + four manual browser probes + CJS regression | all 13 files exit 0 |
| `uv run ruff check tests/test_calendar_shell.py` | exit 0 |
| `uv run ruff format --check tests/test_calendar_shell.py` | exit 0 |
| `uv run ruff check .` | exit 1; exactly 18 baseline diagnostics (16 E501, 2 E741), existing invalid-noqa warning |
| Concise Ruff output compared with supplied baseline via `cmp` | exit 0; identical |
| `git diff --check` | exit 0 |

Exact final logs/exit ledger: execution-directory `ticket-01-final-*` files. No schema changes:
existing-DB migration testing is not applicable and was not run. Scratch startup did apply the
existing migration chain to a genuinely fresh DB through `0013_ai_data_scope`; health and actual
ORM/API/template interactions passed. Final `PRAGMA foreign_key_check` was empty. No personal
database copy was made. After the parent browser gates, scratch PID 472929 was stopped with SIGINT;
port 18141 closed, the PID disappeared and logs confirmed application shutdown/finished server.
Final timer status was stopped with no pending idle gap. Health/DB/shutdown receipts are in the
execution-directory `ticket-01-final-{health,timer,db-state,shutdown}` artifacts.

## Parent real-browser bridge — round 3 PASS

The implementer had no browser tool; the parent actually executed the supplied async probes via
existing Playwright MCP in fresh isolated Chromium contexts. This is runtime evidence, not an
inference from Node syntax or HTTP template strings. Contexts were closed after each run.

Scratch: `http://127.0.0.1:18141`, DB `/tmp/timetrace-ui01.3q5GhC/timetrace.db`; isolated timer/key
siblings. Imports resolved this worktree's source/venv. Only synthetic tasks/sessions/timer state;
no personal storage, credentials or provider calls. The parent's synthetic running timers were
stopped and its extra saved scheduling row was deleted in finally.

| Separate probe | Observed result |
| --- | --- |
| `tests/browser_calendar_density.js` | 12 density/slot cases; all eight sampled interior rows exactly 14/28/42/56, 18/36/54/72, 22/44/66/88px respectively |
| `tests/browser_calendar_shell_layout.js` | 12 width/theme cases; 390/768 horizontal navigation and secondary timer do not collapse/overlap; minimum sampled Vim contrast 10.079 |
| `tests/browser_shared_appearance.js` | 21 page/theme cases, 1,122 visible text/control observations; zero below sampled normal 4.5 / large 3 contrast thresholds; zero page errors |
| `tests/browser_chart_appearance.js` | Three light choices plus dark restoration; unchanged chart data/widget title; zero non-GET requests during appearance changes |
| Original fresh/palette/reload probe | 80 checks passed, zero page errors |
| Corrected scoped workflow probe | 18 checks passed, including history/query, Schedule attachment, Notes draft/focus, Preferences keyboard/trap/restoration and file timer retention; zero page errors |
| Original full adoption/aliases probe | 116 checks passed across four widths; existing/invalid/missing adoption and nine aliases/pages; zero page errors |
| Parent extra session Save/Cancel | Cancel: zero session writes. Ctrl+Enter Save: exactly one write, correct task UUID/literal notes and actual Calendar rendering; saved row cleaned up |
| Parent Calendar/Preferences sampling and 390px screenshot | All three light samples passed; screenshot visually confirmed useful viewport and separate navigation/timer rows |

Do not sum these overlapping suites into an invented unique assertion total. Authoritative parent
receipt: `/tmp/timetrace-ui-implementation.rZwJP1/ticket-01-parent-browser-receipt.md`.
Raw receipts: `ticket-01-browser-round3-{density,layout,shared-appearance,chart-appearance,fresh,workflow,adoption}-result.json`,
`ticket-01-browser-scheduling-round3-result.json`, `ticket-01-contrast-round3.json` in that directory.
Parent screenshot: `/tmp/pi-codemode-cac9fd3b6636613a.png`. External runtime artifacts are ephemeral;
the four reusable manual probes are committed under `tests/` and install no browser framework.

### Browser red evidence and repairs

- Initial Spacious rendered 99.5px/hour despite a 22px setting: inherited line height forced rows.
  First repair fixed Spacious; all-density probe then caught Compact's empty lane minimum (17 vs
  14px). Scoped line-box constraints now pass all twelve real combinations; labels/events remain intact.
- Capture-phase global Escape blurred the launcher after Preferences restored it. Node reproduced
  null focus; the global path now only blurs unchanged hidden focus. Full browser workflow passes.
- Narrow navigation shared an unshrinkable timer's row and collapsed; responsive full-width
  horizontal navigation plus secondary timer row now passes geometry and visual checks.
- Light adoption exposed unreadable dark fixed badges/cards and Stone header headings. Scoped
  bridges now include legacy surfaces, five grade families, readable neutral/blue labels and
  explicit `background` shorthand exclusions. Light Vim badge and cross-page samples pass.
- Original workflow helper expected a literal newline in the **pre-existing single-line Notes
  input**. Browser normalization happened before theme switching: actual before/after drafts
  matched. The corrected probe captures that actual value. Multiline Notes/ordinary Enter remains
  ticket 02; ticket 01 did not silently replace the popup or claim that requirement passed.

## Limits and gates

No confirmed browser issue remains in the sampled ticket-01 seams. Physical touch, screen readers,
other engines, unsampled zoom/reduced-motion, exhaustive user colors/data states and physical drag,
overlap/overnight gestures are not certified. Existing recurrence/move/resize tests passed, but are
not a substitute for every gesture. The bounded DOM scan excludes pixel-canvas text; chart neutral
configuration was checked through Chart's real public interface. Later tickets and final whole-app
verification still apply. Parent independent Standards/Spec review, integration and ticket closure
remain pending; no push, PR, release or dev merge was performed.
