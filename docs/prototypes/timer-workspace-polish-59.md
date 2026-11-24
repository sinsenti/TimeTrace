# Approved timer-workspace UI polish — #59

## Verdict and authority

The owner approved revision6 after reviewing the real-app prototype and successive feedback rounds. This resolves the UI direction, not production implementation or platform certification. Production baseline is `bb899fc7095aeccce5b4eaa4bf5921f06dbad021`; all original #60–65 receipts remain valid history. Parent: https://github.com/sinsenti/TimeTrace/issues/59.

Archive branch: `prototype/timer-workspace-polish-59`. Source: `src/timetrace/interfaces/api/prototypes/timer_workspace_real/`; rejected initial mock: adjacent `timer_density/`. Do not merge either prototype directory or its overlays/fixtures/switcher into dev.

## Selected decisions

1. Preserve actual Calendar/task-card rendering. One compact timer strip contains the real task picker/Start controls, selected-timer status and expandable Other timers/recovery controls. Remove the redundant header timer presentation, not independent timer capabilities.
2. Focus/goals configuration belongs on a dedicated Focus & Goals page reachable from Calendar/Agenda. No always-visible disabled/unconfigured panels. Urgent notifications, due/break actions, stale writes and idle/operation recovery must remain discoverable outside settings.
3. Goal cards plainly identify the activity/group, target and cadence: e.g. Work · 2 hours per day. Edit changes2to3 directly. New goal form uses named activities, target hours and cadence, not IDs. Retain enable/disable, child inclusion, total-start date and historical settings semantics. The example Work is a parent task with child activities; no new tag/category-goal scope or sample target defaults.
4. Focus uses an On/Off routine card, work/break durations and readable ending behavior, with Edit routine. Future defaults versus selected-timer overrides stay explicit; global sound scope and notify-only/default-off/optional auto-break/never-auto-resume behavior are unchanged.
5. Agenda is a current-timer/activity/history workspace, not a permanently wordy editorial page. Keep current clock and chosen circular five-minute controls/action row, real pins/search, grouped history and contextual inspector. Discovery/history display IDs disappear. Help, filters and detailed accounting are secondary disclosures, not deleted capabilities.
6. Readable time summary (e.g.2h10m recorded time) uses elapsed union, never substitutes goal SUM. Distinct task credit/unassigned coverage and exact precision/local cohort/original-vs-current plan comparisons remain accessible; totals are not silently made additive.
7. Adjust recorded time uses readable interval/date/note selection, Change start time/Remove a break, date/time entry and before/after preview. IDs/API paths/revisions/exact timestamps/timezone offsets live in secondary technical details. Preserve exact microseconds until an explicit edit, DST offset choice/validation, pinned owner identity, initialization consent, stale/conflict checks, retained drafts, cutoff warnings and signed preview-before-apply. No inferred approval or automatic initialization/write.
8. Reporting preferences shows Week starts Monday and timezone, with Edit, styled weekday choices and Save changes/Cancel. Preserve effective contexts, exact uncertain retries and historical boundaries; no silent rebucketing, arbitrary timezone editing or automatic rebasing. An unchanged weekday should not create a fresh reporting context merely by clicking Save.
9. Current note has one primary Save: subdued/disabled when clean, highlighted when edited, Saving while pending, plus a non-colour state indicator. Discard my changes is secondary and restores the saved note, not a second save or a deletion. Keep own-ACK versus newer typing, per-timer revision/segment ownership, safe navigation, stale/read recovery and paused eligibility. Task description and work note stay distinct.

## Production handoff

Rewrite the selected UI in normal templates/components/controllers/CSS; do not ship MutationObservers, private DOM-order dependencies, demonstration goals, fake notifications, storage resets, blocked-AI routes or prototype databases. Trace shared-navbar callers across every page. Existing domain APIs/services/receipt hashes and accounting meanings are supporting contracts, not new scope. No migration is implied by this presentation-only approval.

Use the existing approved seams: public JS controller interactions, root HTTP/service boundaries where relevant, and isolated actual-browser interaction. Add regressions for note dirty/save/late ACK/discard/paused/recovery, focus default/override drafts and pending edits, goal creation/editing/no default or category expansion, reporting no-op/cancel/history/retry, correction exact precision/offsets/preview ownership/alerts, and timer strip independent-timer/idle/reconciliation access. Exercise real task cards, keyboard/narrow layout and critical notices. Run scoped syntax/lint and full Python/Node suites, distinguishing17 inherited Ruff findings. New product questions are not required for these selected decisions; technical implementation findings still need honest resolution.

Keep #59 open until the approved replacement UI is delivered and verified. The owner's prototype approval must not be relabeled as acceptance of unchanged production UI or real OS/sound/platform tests.

## Evidence and limitations

See each prototype README for bounded per-round evidence and preserved refinements/failures. Real prototype used the production app/controllers/renderers against a newly created external synthetic database. Browser proofs include actual Calendar cards/events; goal2→3→2; focus25→30→25 while OFF; reporting selection/cancel with server context unchanged; readonly signed correction preview with microseconds retained; note dirty/highlight/discard using original handlers. No personal DB/provider/notification calls. No full application suite or raster/platform certification was rerun for these throwaway presentation changes. The earlier full1222Python/904Node evidence belongs to the unchanged production baseline, not this unimplemented UI.

Run the archived experiment from this branch:

```bash
uv run python -P src/timetrace/interfaces/api/prototypes/timer_workspace_real/serve.py
```

Open `/dashboard?variant=B`, `/agenda-view?variant=B`, `/timer-settings?variant=B&tab=focus` or `/timer-settings?variant=B#report-settings` on `http://127.0.0.1:18127`. A remains the unchanged current/reference rendering. Every server start creates disposable sample state; saves affect that sample only. Stop only the owned preview server when finished.
