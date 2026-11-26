# Calendar task-status feedback

Changing a task from a scheduled-trigger status to another status does not itself remove its
scheduled sessions. `TaskService` returns a completion-policy choice. Its heading is **Task status
changed**, not a claim that Calendar removal has already happened. The completed-task heading
remains **Task completed**. Opening either choice makes no removal request.

## Current limitation

The existing clear flow supports legacy future sessions but rejects explicit scheduled plans;
the Calendar editor also hides Delete for persisted explicit plans. These are current limitations,
not new owner-approved deletion rules. A safe future removal flow must not silently erase recorded
work, bypass unfinished-timer/conflict guards, or combine independent own-session/subtree choices.
See [#59](https://github.com/sinsenti/TimeTrace/issues/59) and
[#67](https://github.com/sinsenti/TimeTrace/issues/67) for the related review and Stop-flow work.

`tests/test_completion_policy.cjs` protects the truthful heading and no-write behavior, alongside
the existing selection and protected-plan guards. The title regression failed against the old
wording, then all four focused cases passed. A separate synthetic native Calendar investigation
confirmed that the explicit plan survives Scheduled → To do unchanged; ordinary existing-block
mouse dragging succeeded. That does not establish the owner's as-yet-unidentified failing drag
scenario or claim that plan removal is implemented.

The first native reload retained the old unversioned script despite the server serving the new
bytes. Versioning the asset in all four Calendar/task consumers resolved that cache case; an added
regression failed before those URL updates. All five focused Node cases then passed, and native
Scheduled → To do displayed **Task status changed** with the plan still saved and unchanged.
Broader combined gates and review are recorded separately at delivery; these focused checks alone
are not a claim that the new Stop dialog or plan-removal flow has shipped.
