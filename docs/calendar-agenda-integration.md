# Existing Calendar and Agenda

Calendar (`/dashboard`) retains its FullCalendar layout and task sidebar. Agenda (`/agenda-view`)
and Calendar use the same `/agenda` range read and `/scheduled-sessions` writer. Calendar's
legacy `/sessions` read remains the input for existing totals; it is not the planning display.
Neither range reads nor navigation record work or materialize projections.

Selecting a Calendar interval defaults to **Scheduled session**, including in the past. Choose
**Record actual past work (manual)** to use `/recorded-work` instead. Manual recording does not
implicitly attach work to the displayed plan. Agenda retains its explicit association checkbox.
Typed recorded work is read-only in Calendar; its modal never falls back to legacy PUT. Existing
legacy history remains visibly uncertain and keeps its existing compatibility route.

Calendar labels projected schedules, persisted schedules, recorded work and uncertain history.
Plan details show immutable originals separately from editable current endpoints. The inspector's
Agenda link preserves the local day and exact entry; Agenda links back to Calendar's day/task
context. Shared task metadata refreshes labels, not dirty form fields.

Both pages consume the shared multiple-timer controller and its durable operation journal.
Starting a saved assigned plan from Calendar uses its plan revision/projection token. Timer ACKs
adopt captured UUIDs and revisions before refreshing; subsequent range-read failure cannot revert
writer identity. Starting another plan for an unfinished task selects that existing timer rather
than reassociating/resuming it. Navigation does not replay timer operations. Retargeting is not
available. Independent extension/removal/idle interfaces remain owned by their respective slices;
this integration does not add speculative routes or bypass their consent contracts.

Manual recordings share a separate sessionStorage uncertainty journal through `ApiClient` on both
pages. It is written before POST and cleared after authoritative typed ACK, not after a display
GET. A lost response blocks another manual recording across modal reopen, page navigation and
reload in that tab. The shared recovery notice reads saved work and requires explicit review to
release the attempt without replay. A missing range match is not proof of failure. The journal
is not server idempotency and is not a cross-tab lock. Timer recovery uses timer receipts instead,
never this manual journal. Storage failure blocks manual recording.

Calendar schedule conflicts retain attempted times in the shared review panel and block modal,
drag/resize and timer-start callers until explicit review. Pending modal writes similarly guard
other writers for that occurrence. Recurrence anchors, scopes and existing completion choices
remain unchanged; this slice introduces no schema or accounting migration.

Verification uses real-root HTTP tests in `tests/test_calendar_agenda_integration.py` plus the
shipped controller seam in `tests/test_session_editing.cjs`. Native coverage and exact complete
suite results are recorded with the delivery report; these tests are not physical idle, touch,
zoom, assistive-technology or other-engine certification.
