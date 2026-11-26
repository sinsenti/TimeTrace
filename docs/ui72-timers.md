# Selected timer discard and parallel presence (#72)

Owner-approved scope: **Discard timer** removes only the selected unfinished timer's
not-yet-recorded time and timer-bound Entry note. Saved records (including partially saved
segments and their ratings), tasks, original/current plans and other timers are unchanged.

## Durable interface

`POST /timers/{full_timer_id}/discard` requires a strict body containing `operation_id` and
`expected_revision`. It uses `MultipleTimerService.mutate` and the existing durable
intent/receipt funnel, not Stop followed by deleting records. The terminal timer is a stopped
`discarded: true` tombstone: it has no running/buffered unsaved time or live notes/gaps, but
retains saved segment lineage. Finalized operation receipts and correction audit history are
not rewritten or deleted. A matching repeat returns its fixed receipt; an old Start or signed
correction receipt cannot resurrect the timer. Unused correction approvals become stale.

An unresolved gap is discarded with this unfinished timer, without claiming absence as work.
This is not ADR0001's plan removal: it does not remove a plan or any associated saved work.
The unfinished plan reservation is released only by the completed terminal transition; a pending
before-state remains conservatively reserved. A different pending intent/unfinalized receipt
blocks a new discard instead of implicitly completing another operation as consent.

No database schema change or migration is needed. Existing receipts retain the final transition.

## Browser ownership and recovery

The current-card action captures the exact selected ID, timer revision, local selection generation
and Entry note edit generation before requesting `window.appDialogs.confirm`. Cancel, unavailable
in-app confirmation, changed selection/revision or newer typing sends no discard. There is no
native-confirm fallback. Save and **Discard my changes** remain note-only actions.

After approval, only the target note becomes read-only while its discard is sent/uncertain. Its
text stays intact until its own direct or operation-status ACK; other timer drafts/selection stay
usable. A definitive refusal restores editability. Own removal ACK releases only its note owner,
even if display refresh fails, avoiding an invisible dirty owner blocking navigation. This
read-only target policy was explicitly approved by the supervising owner for the in-flight edge.

An uncertain discard keeps its exact browser journal. **Check saved operation** and **Check
discard status again** use GET only; they never replay the discard. Pending reconciliation may
need the daemon's normal startup/background reconciliation before operation status becomes final.
A mere status-list disappearance is not an ACK and does not consume a local note draft.

## Presence and integration hooks

The existing `data-current-display` presenter adds a compact right-side **Other timers** region.
Names, authoritative elapsed values, running/paused/frozen labels and frozen idle-review hints
are visible. Buttons call only the existing local `control.select(id)`: no resume, reassociation,
clock reset, navigation or draft discard. Clock-only refreshes retain the presence buttons.
`timer_presence.css` moves presence below current controls on narrow screens.

Parent/dialog-lane integration must include `/static/css/timer_presence.css` on Agenda and rename
its current-note disclosure to **Entry note**. The note editor itself is renamed in this lane.
The shared dialog provider remains owned by the dialog lane; absence fails closed visibly.

## Bounded verification

Public seams: root HTTP/service reconciliation, public JS controller and current-card/note
presenters. `tests/test_timer_discard.py` covers preserved saved work/ratings/plans/tasks,
partial saves, plan reservations, running/paused/frozen and migrated legacy states, exact revision,
operation mismatch, pending-operation refusal, four durable failure boundaries, immutable signed
receipts and no resurrection. `tests/test_timer_discard.cjs` covers confirmation fencing,
missing provider, note read-only/refusal/direct and GET ACK ownership, GET-only uncertainty,
other/newer drafts, presence selection and stable clock refreshes.

Final focused checks in the private Python 3.14 lane environment: 106 Python cases passed
(84 existing datetime-adapter/serializer warnings), 41 Node cases passed, scoped Ruff check and
format check passed, both changed JS modules and the new Node test passed syntax checks, and
`git diff --check` passed. The new discard coverage comprises 12 Python and 7 Node cases.
Full-suite, independent review, integrated native/browser layout checks and owner visual verdict
belong to the parent gate. Passing presenter tests are not native or visual acceptance.
