# Explicit plan-link presentation and Stop-flow boundary

[Issue #67](https://github.com/sinsenti/TimeTrace/issues/67) is the live decision/delivery tracker.
This document describes the bounded first implementation, not a completed Stop or Calendar flow.

## Implemented first slice

- The current timer and shared strip distinguish **No linked plan** from a readable explicit
  **Linked plan**. Details show the browser-local current schedule and Open linked plan navigation.
- Only the selected timer's actual association is read. Selection does not attach, resume or
  retag anything. A missing/mismatched/stale plan is unavailable, not falsely unlinked.
- Plan-only detail reads update their own DOM instead of replacing unchanged timer controls.
  Selection/revision/read-generation/write/recovery and unsaved-note ownership stay independent.
- **Fit schedule to recorded work** is the clearer label for existing `squeeze`: outer bounds of
  all explicitly linked saved records, including gaps; original plan and recorded work unchanged.
- Leaving a scheduled task status says **Task status changed**, not Removed from calendar.
  Existing explicit choices and protected-plan clear limitations remain; no automatic deletion.
- All affected serving script URLs are versioned, including every completion-policy consumer.

## Not implemented here

No new Stop dialog, plan chooser, split-schedule operation, Record as scheduled replacement,
Calendar Record time action, past-create default change or new plan-removal capability is claimed.
The owner confirmed exact current plan endpoints for Record as scheduled and recorded-work defaults
for entirely-past Calendar creation. For the proposed Stop flow with pauses, the owner prefers an
explicit suggestion to split the schedule into actual timer work parts, rather than one continuous
outer-bound interval. That new operation does not silently redefine the existing Fit action.
Cancel/continue timing behavior is still being explained/settled in the live issue conversation.

## Verification checkpoints

Bounded implementation code is `43c19b7e`; menu-focus repair is `8d5675eb`, based on owner favicon
`bfacc9d0`. The single Agenda cherry-pick conflict was adjacent script versions; both the new
plan-removal and completion-policy versions were retained.

- Worker red-first controller/root/render coverage and parent title/cache regressions are retained.
- Initial worker full Python run with global idle=false:1280 passed/18 failed. Those synthetic idle
  observations were disabled by the test environment, not broken by source changes. All18 affected
  test/source seams were unchanged; no separate full baseline execution is claimed. After inspecting
  fakes and unsetting idle only for pytest,1299 Python/1010 Node passed. No OS idle experiment ran.
- First combined gates:1299 Python/1012 Node passed. Independent review nevertheless found1 Standards
  P2: periodic linked-plan loading/ready updates replaced focused timer-menu controls. Spec0.
- The mounted public-render regression failed before repair, then49 focused Node cases passed.
  Independent bounded recheck found no remaining Standards/Spec issues.
- Final combined code gates: **1299 Python passed/1696 warnings in177.36s;1013 Node passed**, zero
  failures/cancellations/skips. Scoped Ruff, changed JS/CJS syntax and whitespace pass. Broad Ruff
  retains17 inherited findings; no unrelated lint cleanup was included.

Native Chromium used an external synthetic DB/profile with real HTTP/controller boundaries. It
verified linked/unlinked text, local-date plan navigation targets, unchanged paused selection and
zero mutation requests during selection/plan refresh/layout checks at1217/768/390/320 CSS pixels.
The maintained display probe is `tests/browser_timer_plan_context_67.js`.

The initial native menu harness tried to focus a control inside closed details: initial focus was
not accepted, so that attempt is **not native proof of focus loss**. It did observe old control DOM
replacement; the mounted Node red proves the actual regression. After explicitly opening the real
menu, the repaired native loop verified initial focus and exact Resume DOM/focus retention through
both loading and ready publications. This harness correction is retained, not relabelled as a
second product defect. Initial multiline probe invocation also needed shell-quoting correction;
the maintained probe then passed against both real linked and unlinked displays.

These are bounded software/native-computed checks, not owner visual acceptance, raster, physical
touch, assistive-technology, other-engine or OS notification certification. Test-created timers
and status changes affected only synthetic state. No personal daemon/data/provider experiments,
push or final deployment is part of this checkpoint.

## Subsequent Stop / Calendar frontend

The “Not implemented here” section above describes only the historical visibility slice. The
subsequent foundation and frontend implementation are documented in
[Stop / Calendar #67](stop-calendar-67.md#frontend-implementation-checkpoint) and its
[backend API contract](stop-calendar-backend-67.md). Independent review and final integration
validation remain separate from that frontend software checkpoint; the original visibility/focus
receipts above are preserved unchanged.
