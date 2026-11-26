# Search-first task launcher — #70

Implementation of [#70](https://github.com/sinsenti/TimeTrace/issues/70), following the owner's
completed grilling and explicit agreement. This is real application code, not the Quiet workspace
prototype. Parent #59 still owns broader visual adoption/integration. Statistics widgets are not
replaced or reseeded. Explanation-only #69 and deferred stop/link decisions #67 remain separate.

## Contract

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
  bounds are derived from the same captured measurement instant used for the scheduling window.
- `createTaskLauncher` is the public JS behavior seam. Its DOM adapter renders text nodes and ARIA
  combobox/listbox state, validates fresh task metadata before Start and delegates to the existing
  timer writer. Results are fenced by request/query generation; Start owns a fixed task/idle intent.
- The existing timer controller's Start gains an optional own-ACK callback and `preservePage` option.
  Its private journal stores `preserve_page` outside the fixed server payload; retry/receipt hashes
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

Full suites, final lint/syntax checks and independent Standards/Spec review are pending. Earlier
#59 gates are historical and not a claim about this new feature. No commit is merged/deployed into
the personal app; work remains on the local implementation branch.
