# 12: Structured widget builder and comparisons

**What to build:** Build and edit fully expressive structured widgets with independent ranges, attribution and comparison baselines.

**Blocked by:** [11: Dashboard and widget canvas](11-dashboard-canvas.md)

**Status:** ready-for-agent

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Preserve the full published capabilities/query builder, not reduced sample pickers, including edit/reopen and useful validation.
- [ ] Retain per-widget date ranges and previous-period/prior-year/custom baselines without adding a global dashboard filter.
- [ ] Preserve default multi-tag fan-out with overlapping-total labels and the split-evenly alternative.
- [ ] Keep local session-start-day bucketing, explicit timezone/week-start context and existing fallback/warning semantics.
- [ ] Keep the existing optional SQL entry usable independently; verify structured round trips, comparison boundaries, errors and saved widget compatibility through compiler/API and browser tests.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- Implementation-authorized checkpoint at reviewed base `dd1399487172ab08516ace6ce6e88979ae1f63b1`: full capabilities-driven structured builder, exact saved-query hydration/roundtrip, filter arrays/typed values, custom primary ranges and comparisons, explicit ordering/limits/fill gaps, real preview/context/warnings and guarded Save/Cancel/async ownership prepared uncommitted. Parent separately authorized a widget-only standard-DOM test-fixture update and minimal confirmed projection-alias fixes in the tagged-session and task-estimation compiler paths after actual real-API REDs. See [ticket 12 evidence](../ticket-12-evidence.md) for scope grants, retained first failures, source manifest and limits. Latest checks: 414 Python passed/198 warnings; 167 Node passed; 64 syntax passes; seven owned native probes 108 checks plus unchanged Canvas 89 checks/zero pageerrors. Full Ruff retains 18 byte-matched baseline diagnostics; compiler whole-file formatting has an independently verified pre-existing wrapping difference, while changed ranges and the new API test format-pass. Independent parent browser/Standards/Spec reviews, latest reviewed integration reservation/FF, commit and closure remain pending. Status/acceptance boxes intentionally remain unchanged; no ticket/spec completion, human acceptance or merge permission is claimed.

- 2026-11-04: Preserved same-ticket checkpoint replayed onto exact reviewed `f7c40c0233bfc98c81bab3921a4f95c253f314db` in fresh `feat/ui-redesign-12-builder-finalize`. Parent executed literal tool edits/writes during an exclusive handoff after all-file preflight; original worktree remains read-only/unchanged. Reviewed04 ACK-before-metadata timing and own Widget fixture coexist at shared SHA `a9b502cbecb00b2229a2b0d60cc774167d22552ce9b64d79e71cb553df42abab`; all other15 initial replay hashes match the archive. Fresh private-DB checks: focused58 API; full449 Python/202 warnings;214 Node;82 syntax; Stats89 first plus all7 builder108, no pageerrors. Scoped lint/range formatting pass; full Ruff retains18 byte-identical baseline diagnostics. Own evidence continuation records the supplemental evidence-helper400/correction and refused no-write doc edit separately from passing unchanged native/API suites. Source is held unstaged for a genuine current parent browser gate and explicit commit release; required independent reviews/closure/manual limits remain, not completion.

- 2026-11-04, subsequent gate/release: Parent independently passed current-source Stats89 FIRST plus all7 builder108 (197 inspected assertions/zero pageerrors, all8 first-run exit0), verifying all16 hashes before/after, original checkpoint identity, actual private DB/process/environment and24 samples. Parent's initial truncated Canvas-JSON inspection error was resolved by complete ordered reads, not native rerun or source changes. Parent explicitly released one16-path feature commit with exact F7 parent; this is not review/closure/human acceptance. Worker verified canonical `/timer/status`, timer file, migration0013/FKempty and actual zero synthetic domain/AI counts, then normally SIGTERM-stopped only own verified PID310294. PID absent,18211 closed and health connection refused; private DB/logs/venv retained. All14 code/test bytes remain gated identity; only own docs append this chronology. Fresh per-commit independent Standards/Spec review and later reviewed merger closure remain pending; ticket status/criteria/spec/global status unchanged.
