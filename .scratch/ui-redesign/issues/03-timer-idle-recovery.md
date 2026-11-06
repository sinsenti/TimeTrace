# 03: Timer and idle recovery

**What to build:** Track work with the secondary timer and recover running, frozen or idle state while navigating the redesigned app.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** ready-for-agent

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Keep the timer secondary and retain start, pause/freeze, resume, stop, attachment and retag behavior through existing contracts.
- [ ] Timers remain isolated file state rather than premature session rows; navigation and theme changes do not reset them.
- [ ] Retain/re-skin the existing idle dialog, recovery choices and confirmation policy rather than inventing new idle semantics.
- [ ] Show honest daemon/recovery failures and allow safe retries without duplicating logged sessions.
- [ ] Exercise running/frozen navigation and each recovery path against isolated timer state; verify keyboard/focus and shared-page integration.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- 2026-11-02: Authorized implementation checkpoint, uncommitted and awaiting parent review/reservation. Calendar keeps secondary Start/Stop; all seven current pages expose existing frozen recovery choices. There is no manual pause/resume API or previously rendered idle dialog: no replacement semantics or automatic resume was added. Pending/preflight guards include Session Timer Now. Same-tab recovery receipts retain uncertain/partial outcomes through navigation/reload; retries read status only, and explicit human verification clears only the client hold. This is not server idempotency or cross-tab protection. Parent separately authorized restoring already-persisted frozen context on file reload and consistently exposing existing target_minutes in status; frozen elapsed/remaining remain 0/null. Backend two-commit recovery policy is unchanged and characterized, not made atomic. Detailed checks, first failures and unrun gates are in the authoritative external report `/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-03/worker-report.md`. Acceptance boxes remain unchecked pending independent review, latest reviewed integration and the genuine parent browser gate; `/settings/ai` remains the current Settings entry until reviewed ticket19 integration.

- 2026-11-06: New latest15dc owner-B unit checkpoint, uncommitted/PENDING. Parent replay preserved original DFDA03 read-only and reviewed19 utils predicate; generic navbar now `/settings` with guarded departure, direct `/settings/ai` retained. Opening/navigation/presentation/status Retry never POST idle configuration; actual daemon status is authoritative, stored preferences/drafts remain independent until explicit Save. FIRST actual DCL regression RED14 → minimal-fix GREEN14; supplemental missing-boolean cases bring new tests to16. Actual focused Node218, full canonical Node263, full Python483/226warnings and allJS-CJSsyntax97 pass; scoped lint/format pass, full Ruff18 BOTH streams match fixed baseline. Two precisely approved obsolete auto-idle/generic-link oracle deltas and all first failures are retained externally. No daemon/browser/native check executed in this phase; original native RED history unchanged. All six criteria remain pending independent reviews, separate native authority/genuine parent gate and later acceptance. See [unit checkpoint](../ticket-03-evidence.md) and authoritative external `evidence/ticket-03/unit-B/worker-report.md`; no ticket completion or merge permission.

- 2026-11-06: Separate owner-B native producer checkpoint, still **PENDING** independent review/genuine parent LIVE gate and explicit later release. Added only the new startup browser probe; production and all prior unit/probe bytes stayed frozen. Fresh private Python3.14/daemon isolation: Stats89 FIRST; bounded startup64; running141; four cold frozen choices186/185/185/183; lost-response23; retained Session16; current19/caller controls and seven Session surfaces exercised. First setup/observer/oracle failures and precisely approved external-only adapters are preserved, not relabelled product failures. Startup response observer has16 unavailable GET bodies; original running capture lacks intermediate FILE/request bodies. A separate Workflow captured real running HTTP/12-key FILE/Start payload, not retrospective proof or a parent gate. No real OS idle/provider/SQL enable, no stage/commit/final cleanup. Final producer runtime is retained inactive/unfrozen/no gap/idlefalse on18229 with synthetic history intact. All six boxes remain unchecked; authoritative native report: `/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-03/native-B/worker-report.md`.
