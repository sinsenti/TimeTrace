# Search-first task launcher — #70

Implementation of [#70](https://github.com/sinsenti/TimeTrace/issues/70), following the owner's
completed grilling and explicit agreement. This is real application code, not the Quiet workspace
prototype. Parent #59 still owns broader visual adoption/integration. Statistics widgets are not
replaced or reseeded. Explanation-only #69 and deferred stop/link decisions #67 remain separate.

## Current presentation after #72

The owner subsequently split Agenda's duplicate search roles in #72. **Task to time** in the shared
strip remains the keyboard launcher below. Agenda's **Filter activities** uses the same controller
in `filterOnly` mode: literal title matches stay in priority groups, no implicit row selection,
Arrow/Enter start or close-match suggestions, and explicit row Start retains the filter. Pin view
hides that priority-only filter. **Search history & plans** now lives with the ledger; its existing
`agenda-search` identity also owns export title filtering. These title fields are independent;
shared tag/note semantics remain unchanged. Alt+Shift+F focuses the shared launcher.

## Original #70 contract

The following records the original presentation; the #72 role split above supersedes the local
Agenda search/Enter behavior, not the shared launcher's safety or backend contracts.

Both Agenda's A2 search-first activity field and the shared launcher on every page use the same
combobox/controller. Focus opens suggestions; the first ordinary result is highlighted. Arrows
select, Enter starts that explicit task, and Tab only moves focus. Click selects; the explicit Start
button can use a selection already shown before Tab. Escape closes the list. Composition and repeat
keys do not submit. No selected result means no implicit task creation or taskless fallback; the
shared strip retains an explicit Start unassigned button.

Empty-field order: current scheduled tasks, then starts within the next hour (earliest first), then
other tasks by high/medium/low/unset priority and recorded task time over30 local calendar days.
Same-task occurrences are deduplicated. Pins do not affect this ordering. Typed titles use
case-insensitive exact/prefix/contains tiers, then priority/time and stable title/ID ties. Deterministic
close matches follow normal results and are never auto-selected. They require an arrow/click or an
explicit card Start. Completed tasks use configured completion flags with existing fallback names;
Include completed opts in without editing statuses or changing the backend's general Start policy.

The suggestion's scheduled time is only context. Starting sends the captured task identity and
captured idle preference—not a plan ID, old note, timestamp or recurrence capture. Existing explicit
Start working from a scheduled session is unchanged. Existing same-task paused/frozen timers are
selected without resetting/resuming them; other timers remain independent. Start stays on the
current page and names the returned state. Only the acknowledged original search can clear; newer
input, read errors and selections survive late reads/ACKs. Unknown writes retain the original timer
journal and block a new Start. Finalized recovery is read-only and updates only its owning launcher.

## Implementation boundaries

- Root `GET /api/tasks/launcher` is a thin route over exported `TaskLauncherService.suggestions`.
  Query text/tag length200, result default20/max50. Responses contain task metadata, match kind,
  scheduled hints and recorded hours; they intentionally contain no scheduled-session ID.
- `core/task_search.py` contains deterministic title matching only, with no framework/DB/provider
  imports. Literal substring matching is not SQL wildcard matching. Unicode casefold is explicit.
  Typo matching uses bounded edit distance (short input and long input safeguards), no AI/FTS provider.
- The service reads one SQLite snapshot, using SessionService merged current planning reads including
  virtual occurrences and exceptions. It never materializes a projection on a suggestion read.
  Priority and configured completion flags are metadata, not new task status synchronization.
- Task metadata is streamed in200-row batches; only ID/title/priority/parent/completion are selected.
  Each batch's recorded-task-time evidence comes from QueryService/compiler. Raw work rows are
  never aggregated in Python. A bounded top-N heap ranks the full eligible stream before the output
  limit, avoiding both UUID-before-rank loss and the analytics2000-group truncation problem. Existing
  analytics vocabulary, union/cohort rules and public limits are not altered. Custom local start-date
  bounds are derived from the same captured measurement instant used for the scheduling window,
  in QueryService's effective daemon timezone (not a potentially different browser calendar day).
  The response exposes that effective zone and warns when the requested browser zone differs.
- `createTaskLauncher` is the public JS behavior seam. Its DOM adapter renders text nodes and ARIA
  combobox/listbox state, validates fresh task metadata before Start and delegates to the existing
  timer writer. Results are fenced by request/query generation; Start owns a fixed task/idle intent.
- The existing timer controller's Start gains an optional own-ACK callback and `preservePage` option.
  Its private journal stores `preserve_page` outside the fixed server payload; the captured timer
  selection generation also fences result selection across metadata preflight. Retry/receipt hashes
  and server protocols are unchanged. ACK releases the UI before display refresh; replay remains
  the existing explicit exact-operation action, never an automatic new request.
- Agenda retains existing date/history/plan/inspector/manual-work/correction/export/ratings/note and
  recovery controllers. The title/tag activity discovery is bounded through the new launcher;
  saved-work-note filtering still applies only to history. Pins are a secondary tab, not all tasks.
- Pin/Unpin lives in the real task editor and Manage pins dialog. Preferences remain device-local
  ordered UUIDs in the existing key, never task DB fields. Pin management searches bounded suggestions
  and pages saved pins20 at a time. Storage failures retain data; storage events refresh the action
  label without touching task-editor drafts. Full descriptions/estimates remain normal task fields.

No schema/migration, paid/provider call, sync infrastructure, real OS idle/sound experiment or
personal database/daemon operation is part of this feature. Taskless accounting, plan association,
recurrence history and independent focus clocks retain their existing authority.

## Verification ledger (candidate)

Public HTTP/service tests currently cover ranking before bounds, configured completion opt-in,
casefold/literal/close matches, literal tag filters, scheduled/priority/union-time ordering,
more than200 eligible metadata rows, and moved virtual occurrences without read materialization.
Public JS tests cover normal/fuzzy keyboard behavior, Tab/composition/repeat refusal, stale responses,
newer typing/read messages, own ACK before a hung read, private page-preservation metadata, original
idle-choice capture, exact read-only recovery and cross-browser pin-state refresh.

Real isolated app checks before the Orca restart exercised native Agenda Enter, explicit fuzzy
selection, Statistics shared Enter without navigation, task-only payloads, paused selection and pin
placement/full editor fields. An initial raw/GET `JSON.stringify` geometry comparison was overly
strict about object key order; equivalent public GET-before/GET-after objects showed no field change.
This was not hidden as a passing raw-string comparison.

The Orca restart cleared scratch processes, venv and synthetic databases; tracked/uncommitted source
and issues survived. No interrupted verification result existed and no old mutation was replayed.
A fresh external venv/synthetic daemon was created and reseeded once through guarded HTTP. Both
tracked `tests/browser_task_launcher_70.js` cases then passed: delayed actual Start ACK preserved newer
query text; a deliberately lost actual Start response recovered with exactly1POST and1operation GET,
without a repeat mutation. Provider routes/native sends/actual OS idle observation were disabled.
Screenshot capture timed out before and after restart; DOM/native interaction evidence is not raster,
OS/audio/accessibility certification. No screenshots are claimed for this candidate.

## Independent review and repairs

Initial review of `09260d1...c2a560f`: Standards **3 P1 documented-contract findings**, plus **1 P2
judgement smell**; Spec **2 P1 and1 P2 findings**. Counts stay separate rather than being rewritten
as zero after repair. Shared findings concern late-ACK ownership and browser/daemon calendar bounds;
Standards also found keyboard access to Include completed, and Spec found the metadata-preflight
window before the timer writer captured a newer timer selection.

Red/green public regressions now fence query, request and suggestion-selection generations before
ACK clearing; carry the timer-selection generation captured before metadata validation into the
existing writer; and derive recorded-time dates in the canonical daemon zone. Include completed
is outside the dismissible list, visible while interacting or enabled; native Tab access failed
before the fix and passed after it. The first post-fix reload still used cached old bundles; cache
versions were advanced before claiming the native repair. The tracked browser probe includes this
keyboard check. Availability policy is now one public predicate shared by both presentations.

Independent recheck of `2b7e250`: Standards verified all originals/smell resolved and found no new
issue. Spec verified its originals resolved and found one new P2: the legacy `[data-workspace-start]`
disabling loop overrode the repaired Agenda card policy after an ACK with a hung display read.
Launcher-owned cards are now explicitly marked and excluded from that legacy loop; pin/history
starts retain their original guards. The tracked `hung_display` real-app case failed before the
fix and passed afterward with one actual Start and the next card available before a status GET.
This additional finding remains recorded separately from the initial inventory.

## Final gates

Code candidate `c6788cb` (implementation `c2a560f`, ownership/timezone repairs `2b7e250`, card
availability repair `c6788cb`): **1250 Python passed,1695 warnings;944 Node passed**, zero failed or
skipped. Python ran with safe path, external HOME/TMPDIR and native notifications disabled; the
synthetic idle-observation suite remained enabled. Changed Python Ruff, all changed JS/CJS syntax
and whitespace checks passed. Broad Ruff retains17 inherited findings in unchanged files.

After restarting only the disposable app against its existing synthetic dataset, final native
runs passed delayed ACK/newer typing (1POST), lost ACK/read-only recovery (1POST+1operationGET),
hung display/next-card availability (1POST), native Tab/Space completion opt-in, and shared native
Enter on Statistics without navigation. Effective daemon-zone metadata was also read back.
Raster capture remains unavailable; no broad visual/accessibility/OS/audio certification is claimed.

The fresh isolated preview remains on port18131; the earlier18128 preview was lost at the Orca
restart. The wider selected Quiet Statistics/Focus presentation and explanation-only #69 remain
separate from #70. Earlier #59 gates are historical, not this feature's gate. Commits remain local,
unpushed and unmerged; no personal daemon restart, personal DB/provider access or deployment occurred.
