# Agenda priority discovery (#72 A7)

Agenda defaults to **By priority**: High → Medium → Low → No priority, with compact
rows and a server-side priority filter. The list is bounded to 20 results, not an
exhaustive task browser. Use the priority filter or title search to reach low/unset
tasks even when more than 20 higher-priority tasks exist. Pins and Manage pins remain
secondary access. Completed tasks remain an explicit opt-in.

`GET /api/tasks/launcher` and `TaskLauncherService.suggestions` accept:

- `view=suggested|priority` (default `suggested`, preserving other shared-launcher callers).
- `priority=all|high|medium|low|none` (default `all`; `none` includes unset/unrecognized values).

Both selectors are validated. Title, tag, completion and priority eligibility apply
to the full metadata stream before ranking and the final bounded limit (1–50 at the
API/service seam). Priority view never promotes a scheduled low-priority task above a
high-priority task. Schedule badges remain informational. Equal priorities retain the
canonical **recorded task time · last 30 daemon-local calendar days** tie-break.

Typed search still ranks exact → prefix → literal contains → explicitly selected close
matches. Agenda presents those match tiers first, with priority groups inside each tier.
Its persistent result list uses the shared `createTaskLauncher` / `mountTaskLauncher`
model and the existing timer controller, not a separate Start writer. Search-field
arrows/Enter/Tab, composition/repeat guards and explicit fuzzy selection are unchanged;
the shared strip retains its Suggested popup. Agenda uses a normal search field and
live selected-task status with persistent, independently focusable Start/details buttons.
Priority/view changes invalidate old reads and prevent an old Start ACK from consuming
a newer query or choice. Start is task-only; schedule badges never attach a plan.

No schema, historical-start reconstruction, prospective start counter or frequency
mode is included. Frequency semantics remain pending the owner. Existing recurrence
reads stay non-materializing, with badges based on the current schedule rather than an
unchanged original interval. History, Entry notes, plans, other timers, export and the
in-app dialogs retain their existing controllers.

## Verification boundary

Public root-HTTP/service tests cover >20 high-priority tasks with low/unset filtering,
search/tag/completion eligibility, title ranks and literal/casefold matching, cross-batch
recorded-time ranking, bounds/selector validation, recurrence badge readbacks and served
page hooks. Node tests exercise the shared model, mounted DOM presenters and actual
Agenda mount/Start path with controlled HTTP/browser boundaries, including late reads
and ACKs. They do not establish native layout, physical keyboard/screen-reader behavior
or owner visual acceptance. Parent integration owns the full suite, independent review
and native browser gate.
