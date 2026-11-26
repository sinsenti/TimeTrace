# #72 dialogs / presentation lane

Baseline: `cacf0466df45cb72400c57c0f249f5bed025e853`. This is implementation evidence,
not owner visual acceptance, deployment, or a full-gate report.

## Delivered slice

- A0: retain every inspector action; prominent Start, spaced/wrapping secondary actions and
  a separate Calendar link.
- A1: `#history-export-dialog`, named fields, grouped scope/preview controls, contextual report
  details and bottom Close/Copy/Download. Exact preview/artifact bytes and selection scopes remain.
- A2: Agenda schedule endpoints and extension fields show seconds, not fractions. Existing endpoint
  baseline comparison still submits the original stored string when untouched (including microseconds).
  Calendar/Session's existing minute-only controls are unchanged; exact actual-time correction fields
  and exported timestamp precision are not rounded.
- A4/A8: named, themed Help/Filter dialogs with bottom Close. Help explains Entry note persistence.
- A5: Entry note copy on Agenda saved-history editors/disclosure/export; task descriptions and plan
  notes remain separate. `current_note_editor.js` belongs to the timer lane and is untouched here.
- T1/T2: semantic Kanban Edit/estimate hooks receive only light-appearance overrides; existing dark
  purple classes remain intact. All light palettes inherit the overrides.

## Shared decision boundary

`components/timer_workspace_bar.html` synchronously loads `app_dialogs.js` and its stylesheet before
served callers. `window.appDialogs.confirm({title,message,confirmLabel,cancelLabel,danger})` resolves
boolean; `alert(options)` is informational; `prompt({...options,value,label})` resolves text or null.
There is no global replacement of synchronous browser APIs. Text is inert. Cancel/Close receives
initial focus. Native modal focus/default keyboard behavior is retained; early window-capture shielding
keeps underlying page shortcuts from closing/saving editors. Explicit clicks, Escape and cancel events
settle immediately, without depending on the embedded browser's delayed close frame. Superseding requests
cancel prior decisions. Input/change outside an open decision invalidates its approval, including ABA
edits. Focus restoration is conditional on the old modal still owning focus.

Audited served JS/templates: all native application-controlled confirm/alert/prompt sites were converted.
The remaining lexically named `confirm` in `createQuickTimeAdjustments` is an injected, existing app-owned
consent presenter, not a browser call. Its remembered preference and validation/recovery guards remain.
Existing safe in-app manifest/scope/habit confirmations are retained. File pickers, OS permissions and
browser-mandated beforeunload warnings remain platform-owned.

Callers capture identities and recheck ownership/selection, pending state or recovery journals after
awaiting. Public guard changes propagated to callers: Task-detail departure/selection, Outline close,
Revision post-mortem `canLeave`/task selection and Agenda switching now await decisions. Inline
`followSettingsLink` still returns a synchronous false when dirty, prevents native navigation immediately,
and navigates only after approval. Modified links remain ordinary browser operations. No controller,
service, database, timer-card, launcher/ranking, dashboard layout or DND contract was redesigned.

## Supervisor-resolved source discrepancies

1. The existing Notes filter matches BOTH saved entry notes and scheduled-session plan notes, unlike
   the initial issue explanation. Preserve matching semantics: neutral **Notes contain**, contextual
   explanation naming both sources, and regression excluding task-description/live-timer-note text.
   An entry-only filter is not introduced in this presentation batch.
2. The old missing-recurring-scope-chooser fallback mapped browser Cancel/Escape to `only_this`.
   The actual Calendar's three-way chooser remains unchanged. If genuinely unavailable, show an app
   notice and return null/no resize; never infer consent. This fail-closed fallback was explicitly
   approved. Recurrence generation/service semantics are unchanged.

## Verification

New regressions use public app entry/controller/presenter or actual root HTTP composition, with fake
DOM/HTTP boundaries. New delayed decision paths execute real `appDialogs`, not private-method mocks.
Existing fixtures were updated for the asynchronous human-decision boundary and synchronous inline
false-return contract. The Session DOM adapter now models textContent clearing children accurately.

### Tracer red / green observations

- `node --test tests/test_ui72_app_dialogs.cjs`: initially 0 passed / 3 failed (missing module),
  then 3 passed; adding the Settings caller initially 3 passed / 1 failed, then 4 passed.
  Final keyboard-shield regression is included in the final focused run below.
- `TZ=UTC node --test --test-name-pattern='ui72 Agenda' tests/test_session_editing.cjs`:
  precision slice initially 0 passed / 1 failed, then 1 passed. Adding delayed Agenda departure
  separately failed 1, then the two Agenda regressions passed.
- `node --test --test-name-pattern='ui72' tests/test_dashboard_canvas.cjs`: 0 passed / 1 failed
  before conversion, then 1 passed (stale selection and Cancel send no mutation).
- `node --test tests/test_ui72_history_export.cjs`: 0 passed / 1 failed before presentation;
  after implementation/DOM-adapter corrections, this plus `test_history_export.cjs` passed 4.
- `node --test --test-name-pattern='ui72 task' tests/test_outline_tasks.cjs`: 0 passed / 1 failed,
  then 1 passed (retained action/dark classes with light-only hooks).
- `node --test --test-name-pattern='ui72 recurring' tests/test_session_editing.cjs`:
  0 passed / 1 failed, then 1 passed (missing chooser sends no resize).
- `node --test --test-name-pattern='ui72 manual recording labels' tests/test_session_editing.cjs`: 0 passed / 1 failed, then 1 passed (manual Entry note versus Plan notes).
- Export close/reopen tracer in `node --test tests/test_ui72_history_export.cjs`: 1 passed / 1 failed,
  then 2 passed; with `test_history_export.cjs`, 5 passed. A late preview cannot replace reopened status.
- Isolated Python `-P -m pytest -q tests/test_ui72_dialog_pages.py`: initially 8 passed / 1 failed
  for footer/naming; then 9 passed. Expanded route composition is in the final run below.

Intermediate broader focused runs exposed missing new dialog boundary adapters/old synchronous
assertions (and one stale legacy-import journal snapshot); these were repaired, not counted as passing
runs. Final combined source checks, after those repairs:

```bash
node --test tests/test_ui72_app_dialogs.cjs tests/test_ui72_history_export.cjs tests/test_session_editing.cjs tests/test_outline_tasks.cjs tests/test_dashboard_canvas.cjs tests/test_draft_ownership.cjs tests/test_ai_settings_page.cjs tests/test_task_postmortems.cjs tests/test_task_inspector_search.cjs tests/test_correction_presentation.cjs tests/test_timer_corrections.cjs tests/test_history_export.cjs tests/test_ai_instruction_approval.cjs tests/test_ai_proposal_recovery.cjs tests/test_browser_preferences.cjs tests/test_calendar_shell.cjs tests/test_calendar_task_registry.cjs tests/test_day_workspace.cjs tests/test_markdown_export.cjs tests/test_rating_administration.cjs tests/test_session_reviews.cjs tests/test_sql_widget_builder.cjs tests/test_status_management.cjs tests/test_task_detail_child_receipts.cjs tests/test_task_detail_estimates.cjs tests/test_task_details.cjs tests/test_task_detail_tags.cjs tests/test_task_quick_edit.cjs tests/test_timer_review_regressions.cjs tests/test_workspace_notes.cjs tests/test_timer_strip.cjs
# 646 passed; no failures/cancellations/skips

HOME=/tmp/timetrace-ui72-dialogs/home TMPDIR=/tmp/timetrace-ui72-dialogs/tmp TIMETRACE_DB_FILE=/tmp/timetrace-ui72-dialogs/dev.db TIMETRACE_NATIVE_NOTIFICATIONS_ENABLED=false /tmp/timetrace-ui72-dialogs/venv/bin/python -P -m pytest -q tests/test_ui72_dialog_pages.py tests/test_outline_tasks.py tests/test_history_export.py
# 39 passed

HOME=/tmp/timetrace-ui72-dialogs/home TMPDIR=/tmp/timetrace-ui72-dialogs/tmp TIMETRACE_DB_FILE=/tmp/timetrace-ui72-dialogs/dev.db TIMETRACE_NATIVE_NOTIFICATIONS_ENABLED=false /tmp/timetrace-ui72-dialogs/venv/bin/ruff check tests/test_ui72_dialog_pages.py
# All checks passed; scoped ruff format also completed

for f in $(git diff --name-only -- '*.js') src/timetrace/interfaces/api/static/js/app_dialogs.js; do node --check "$f" || exit; done
git diff --check
# Passed (25 production JS syntax checks, plus changed/new CJS syntax checks)
```

Python environment was synchronized with `UV_PROJECT_ENVIRONMENT=/tmp/timetrace-ui72-dialogs/venv`,
`UV_CACHE_DIR=/home/user/.cache/uv`, the required Python 3.14.6 interpreter, external HOME/TMPDIR,
absolute isolated DB path and native notifications false. Synthetic-idle unit behavior was not disabled.
Initial shell prefixes used the unused `TIMETRACE_NATIVE_NOTIFICATIONS=false` spelling;
`tests/conftest.py` already sets the correct `TIMETRACE_NATIVE_NOTIFICATIONS_ENABLED=false` before
imports, so every Python run still had native sends disabled. The final 39-test Python/lint/format
revalidation explicitly uses the correct shell flag shown above. No daemon, browser, personal database,
provider/key, OS notification/audio or live-model experiment ran.

## Remaining gates

Parent owns full Python/Node gates, integration conflict resolution, independent Standards/Spec review,
and actual-browser review. In particular verify keyboard defaults/focus through real browser event
propagation, all light appearances vs preserved dark controls, small-screen spacing and owner visual
verdict. This lane claims no whole-app accessibility, physical screen-reader, deployment or final
owner acceptance. Changes in `multiple_timers.js` are navigation only; `dashboards.js` edits are decision
handlers only and require narrow merge with the other lanes.
