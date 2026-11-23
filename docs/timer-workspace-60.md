# Timer workspace (#60)

## Engineering contract (before implementation)

Confirmed seams: public HTTP/service interfaces, public JS controller interactions, and an isolated real browser. Controller checks are not browser acceptance.

Pins will use device-local localStorage key `timetrace.workspace.pins.v1`, an ordered unique array of task UUIDs, in explicit pin insertion order. Unpin/re-pin appends. Resolve titles and availability from fresh task knowledge; unavailable/deleted tasks cannot start. Storage failure must be visible rather than claiming persistence. No tasks or work are created by pinning.

Keyboard proposal: Alt+Shift+Digit1 through Digit9 select the corresponding visible unfinished timer; Alt+Shift+P pauses/resumes the selected timer; Alt+Shift+S stops and records the selected timer; Alt+Shift+F focuses activity search. These require collision review against existing handlers before wiring. Ignore inputs, textareas, selects, contenteditable and open modal contexts. Never fall back to all timers.

Selection uses timer identity, independently of running/paused/frozen state. A Start acknowledgement selects its returned timer before status refresh; stale reads cannot restore pre-write selection. Selection alone sends no mutation. No automatic focus transfer from asynchronous status reads.

## Correction boundary (#61)

The current card will reserve an integration point beside the clock for reviewed circular five-minute controls and within its single wrapping action row for Adjust time. No enabled correction controls until #61 supplies revision-checked durable operation receipts, previews and explicit refusal semantics. Original/current plans are not correction targets.

## Delivery status

Partial implementation only; this document does not claim full #60 acceptance or browser verification.

Delivered here: the existing public timer controller exposes `select(id)` and `snapshot().selectedTimerId`. Selection is local and rejects absent IDs. Start ACK/recovered ACK selects its returned unfinished timer before display reads. Fresh lists retain an existing selection or fall back to their first unfinished timer. This is not yet wired to a current-timer card.

Red/green: `node --test tests/test_timer_workspace.cjs` first failed with `control.select is not a function`; after implementation the focused workspace + controller run passed 7/7.

Verification on this partial branch: full Python `uv run python -P -m pytest -q` with isolated external DB/HOME/TMPDIR passed **815 tests** (4326 warnings); full Node `node --test tests/*.cjs` passed **854 tests**; changed `multiple_timers.js` passed `node --check`. No Python source/model change; migration acceptance is not applicable to this partial change. Browser acceptance and additional HTTP behavior tests were not run. No JS lint configuration was invoked.

Still required for #60: current-card UI/focus and dirty-editor integration, pinned activity persistence and availability, grouped stable-ID/local-start-day history, Start-again without association, bounded discovery/filter UI, full task-editor/work-note integration, keyboard collision review/wiring, real browser desktop/narrow flows, and public HTTP regressions/evidence. Existing union totals remain unchanged. The engineering proposals above are not claims of implemented behavior; keyboard collision review is incomplete. No #61 correction controls have been enabled.
