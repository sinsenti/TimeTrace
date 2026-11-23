# Timer workspace (#60)

## Engineering contract (before implementation)

Confirmed seams: public HTTP/service interfaces, public JS controller interactions, and an isolated real browser. Controller checks are not browser acceptance.

Pins will use device-local localStorage key `timetrace.workspace.pins.v1`, an ordered unique array of task UUIDs, in explicit pin insertion order. Unpin/re-pin appends. Resolve titles and availability from fresh task knowledge; unavailable/deleted tasks cannot start. Storage failure must be visible rather than claiming persistence. No tasks or work are created by pinning.

Keyboard proposal: Alt+Shift+Digit1 through Digit9 select the corresponding visible unfinished timer; Alt+Shift+P pauses/resumes the selected timer; Alt+Shift+S stops and records the selected timer; Alt+Shift+F focuses activity search. Alt+Shift+Enter starts the task selected in the shared Timer task picker (empty means taskless). Collision review completed before wiring: Agenda includes utils (Escape modal dismissal), timer_control (Escape idle review), task_modal (Tab/Escape trap), settings (typing/modifier guards), and AI assistant (Ctrl+Shift+A); none claims these Alt+Shift chords. vim_engine is not included on Agenda. Browser/OS-reserved bindings may still intercept a chord, so visible controls remain primary. Ignore inputs, textareas, selects, contenteditable and open modal contexts. Never fall back to all timers.

Selection uses timer identity, independently of running/paused/frozen state. A Start acknowledgement selects its returned timer before status refresh; stale reads cannot restore pre-write selection. Selection alone sends no mutation. No automatic focus transfer from asynchronous status reads.

## Correction boundary (#61)

The current card will reserve an integration point beside the clock for reviewed circular five-minute controls and within its single wrapping action row for Adjust time. No enabled correction controls until #61 supplies revision-checked durable operation receipts, previews and explicit refusal semantics. Original/current plans are not correction targets.

## Acceptance matrix (live)

| Criterion | Implementation | Focused verification | Browser |
| --- | --- | --- | --- |
| Current card / independent selection | Card and selected timer controls mounted in Agenda; existing unfinished list adds explicit selection | Card interaction red (missing renderer) → green; selected pause does not target parallel timer; frozen buttons disabled | Synthetic taskless Start shows prominent running card and moves focus there |
| Guarded Start focus | Captured interaction token and Agenda dirty/pending draft guard; no async focus after newer input | Missing focus guard → green; typing/new interaction and dirty draft suppress focus | Still needs delayed-response/dirty scenario |
| Pin identity/order/persistence | Ordered device-local storage module and above-history Start/Pin/Unpin UI; fresh metadata gate | Missing module → green; reload/dedup/re-pin/storage failure | Synthetic same-title tasks: correct identity pinned and started; reload/rename/delete scenarios still pending |
| Discovery above history | Bounded task title/tag API reads (50 UI / max 200 API), selected-day task/tag/note filters and explicit limits/unsupported scope text | Public HTTP initially returned both tasks despite filters → green; invalid limits rejected | Same-title task discovery rendered; late/failure scenarios pending |
| Stable-ID/local-day expandable history and Start-again | Presentation-only grouping; retained source rows, descriptions, provenance, times; Start-again sends only task identity | Missing grouping module → green: same-title identities, local start date and legacy separation | Stop showed expandable recorded history/provenance and Start-again; gap/association checks pending |
| Union totals/original/current labels | Existing endpoint/UI retained | Baseline only | Seen empty-day labeled totals |
| Full task editor / work notes | Existing full task modal included; card action uses task UUID. Saved work notes have a revision-checked note-only PATCH, independent dirty draft and read-only recovery | Card initially lacked Edit task → green; note PATCH initially 404 → green; stale note revision 409; note ACK/display-failure test green | Full modal opened with description/priority/due-date fields. Saved note browser scenario pending; unfinished-buffer note scope needs clarification |
| Keyboard / correction boundary | Reviewed chords wired on Agenda only; no correction actions enabled | Missing shortcut module → green; typing/modal/composition/modifier guards | Typed shortcut did not stop timer; selected shortcut resumed paused timer; unsupported correction actions absent |

## Delivery status

Partial implementation only; this document does not claim full #60 acceptance or browser verification.

### Original selection checkpoint (6bf17f4)

Delivered at the original checkpoint: the existing public timer controller exposes `select(id)` and `snapshot().selectedTimerId`. Selection is local and rejects absent IDs. Start ACK/recovered ACK selects its returned unfinished timer before display reads. Fresh lists retain an existing selection or fall back to their first unfinished timer. This is not yet wired to a current-timer card.

Red/green: `node --test tests/test_timer_workspace.cjs` first failed with `control.select is not a function`; after implementation the focused workspace + controller run passed 7/7.

Verification on this partial branch: full Python `uv run python -P -m pytest -q` with isolated external DB/HOME/TMPDIR passed **815 tests** (4326 warnings); full Node `node --test tests/*.cjs` passed **854 tests**; changed `multiple_timers.js` passed `node --check`. No Python source/model change; migration acceptance is not applicable to this partial change. Browser acceptance and additional HTTP behavior tests were not run. No JS lint configuration was invoked.

### Continuation checkpoint

The live matrix above supersedes the original missing-implementation list. Focused Node workspace/controller coverage now passes **14 tests**. Focused root HTTP discovery/note tests pass **2 tests**. Scoped Ruff checks and all six changed-JS syntax checks pass. The recorded browser probe ran in a separate Orca isolated profile against a synthetic external DB on port 18060 and returned ten passing assertions: stable-ID pin, visible focused Start, paused same-task selection, reused full task editor, typing shortcut guard, targeted resume, grouped provenance, Start-again entry, unavailable correction controls and labeled elapsed union total.

This is still not delivery: remaining matrix browser cells and HTTP history/gap/metadata regressions, narrow viewport, failure/late-read/dirty-editor cases and final complete suites are pending. No new full-suite run has been claimed after the original partial baseline. Saved-note editing never changes work timestamps, task metadata, association, review/rating identity or timer state; it increments the saved work revision and refuses stale writes. Whether #60 also requires editing an unfinished timer's buffered note independently of the existing split operation is being clarified before inventing that mutation contract. No #61 correction controls have been enabled.
