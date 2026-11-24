# THROWAWAY: less permanent text in the timer workspace

Question: how should Calendar and Agenda expose optional focus/goals, timer discovery and help without permanent settings blocks or developer-oriented copy?

Owner feedback: focus/goals consume excessive space on both pages; focus should be a settings button; timer task selection feels awkward; shortcuts should be a popup; explanatory paragraphs should not dominate; activity display IDs should disappear.

Run from repository root:

```bash
uv run --no-sync python -P src/timetrace/interfaces/api/prototypes/timer_density/serve.py
```

Open `http://127.0.0.1:18126/agenda-view?variant=B` or `/dashboard?variant=B`.

- A — current layout, using actual current templates and production focus/goals renderers, with synthetic fixtures. This is NOT a screenshot of the owner's app; the calendar/task/history fill is a stand-in and other app JS is deliberately not booted.
- B — compact toolbar with separate Focus, Goals and Shortcuts dialogs. Current work note and advanced filters collapse; no activity IDs or permanent explanatory paragraphs.
- C — workspace navigation rail, keeping secondary tools outside the content column.
- D — settings-first: a single Workspace settings entry; optional progress appears only when enabled in preview options.

Use the bottom arrows or left/right keys outside editors/dialogs; URLs preserve the variant across page switches. Synthetic state/options expands from the bottom bar; focus/goals start off and example progress can be toggled. Sample targets are NOT product defaults. All variants reuse existing plan/actual separation and correction controls without proposing backend changes.

Safety: no timetrace imports, database, live-daemon reads, provider calls, OS permissions, notification/sound sends, persisted state, or server mutation handlers. Focus/goal adapters are fakes, browser storage identifiers are memory-only, fetch APIs are blocked and CSP disallows network connections/form submits. The Tailwind CDN is the existing styling dependency. Real saves/recording/corrections are not implemented by this visual experiment.

Bounded verification: JS syntax; both HTTP pages; actual Orca DOM smoke of all eight route/variant combinations; open Focus dialog; optional panels hidden by default outside A; activity IDs absent outside A; B Agenda at390px has no document horizontal overflow. No raster screenshot or human visual approval claimed. No formal prototype test suite or full application suite run (production code unchanged).

Verdict: OWNER REJECTED ALL AGENDA OPTIONS. The synthetic task-card stand-ins were not sufficiently faithful. Owner wants a dedicated Focus & Goals page and accurate real-app rendering. Superseded by `../timer_workspace_real/`, which runs actual task cards/Calendar/controllers against disposable sample state. Preserve this rejected experiment as source history until the prototype round is archived; do not implement its variants.
