# Ticket 24: Markdown export evidence

Status: bounded software-completed candidate; closure metadata review and parent integration pending.
Earlier sections retain their historical candidate status; the current closure section below supersedes
their pending software/native statements without rewriting failed receipts or manual acceptance.

## Local source reconciliation

Fixed source base: `563a7838a3fa52c6b7a31925ae860559ea79645f`. The eight repaired freeze02 candidate paths were verified against the external SHA-256 manifest and checkpointed as `fa0e714` (`feat(calendar): add Markdown export workflow [ui-redesign/24]`). The exact incoming ticket 15 integration `1671f9fecc677c64fc806b3f2160a17179771101` was merged locally without conflicts. All eight ticket 24 source files retain their freeze02 bytes; incoming ticket 15 source and tests retain their incoming commit bytes. External freeze03 records the resulting full source manifest and reconciliation proof. No dev merge, push or PR was performed.

The candidate adds the existing six-scope real API Markdown preview, explicit Copy/Download, current-selection guards, UTC caveats and shared Escape/focus behavior. It changes no export backend/service/schema contract.

## Existing pre-incoming15 validation receipts

These results belong to the repaired freeze02 candidate before incoming ticket 15. They were inspected as existing receipts, not rerun during reconciliation and do not establish combined integration status.

- Full safe-path Python: **545 passed, 214 warnings, 31.39s**. This run followed the production repair; later final changes were JS guards/tests.
- Final canonical Node: **391 passed**, zero failed/cancelled/skipped, including 15 Export cases.
- Scoped Python Ruff and format checks passed. Full Ruff has **18 inherited errors** in three unchanged files; four-path SHA/HEAD baseline proof, including models, is retained externally.
- Five changed JS/CJS syntax checks and final whitespace check passed.

Original candidate receipts remain available separately: 545 Python, 387 canonical Node, 119 focused Node and 47 focused Python. They must not be substituted for final repaired or combined results.

## Confirmed review repair and test-first evidence

Original independent Standards and Spec reviews both reported the same P2: delayed real sidebar Edit task lookup could reveal/focus Task beneath Export and restore focus behind Export on Escape. The repaired candidate uses Export base z49 and focused z60; the focused newer Task/Session retains z50. Shared Escape hands focus back only after a real close, while preserving declined discard, other resumed editors, completion/deletion and recovery priorities.

The real-caller simulated-boundary Node regression was RED at **11 pass / 1 assertion failure** (obscured sidebar focus after Task close), then GREEN at **12 pass**, with final focused **14 pass** and canonical 391 pass. This is not a native browser stacking demonstration. The original review findings are repaired in source but fresh independent two-axis review of that repair and reconciled result is still pending.

## Remaining gates and scope limits

Native probes are authored and syntax checked only: **native execution UNRUN**. No daemon/browser lifecycle, actual download, OS clipboard, live layout/contrast or empirical pointer hit-testing is claimed here. Physical touch, other engines, screen reader and human acceptance remain unrun. No personal database/provider calls occurred during this reconciliation.

Fresh full combined integration checks, independent Standards/Spec review after reconciliation, guarded native lifecycle and hit-testing, human acceptance, and the fixed-base whole-delivery review for all 25 tickets remain pending. There are no waivers. Shared README, implementation and development notes were not independently edited in this ticket; incoming documentation was preserved.

External receipts: `.scratch/codex-continuation/evidence/ticket-24/worker-report.md`, `freeze02/worker-report.md`, `freeze02/candidate-source-sha256.json`, `standards-review01.md`, `spec-review01.md`, and `freeze03/` in the main workspace.

## Native probe origin initialization repair (freeze05)

This section updates the earlier native-unrun statement for the retained later receipts. The original `native-run-v2` remains **FAILED**: its probes returned 553 and 61 results and six actual download files matched original response bytes, but three about:blank localStorage SecurityErrors remained. This amendment does not reclassify that run or claim a native pass.

Only the two browser probe init callbacks changed. Each receives the passed private loopback base URL's exact origin and returns before touching storage or installing mocks on opaque/about:blank or foreign origins. The existing preferences, clipboard success/deny/hold fake, scenarios and assertions remain intact. Production, transport policy and sealed native tools are unchanged; a separate guard-range issue remains outside this amendment.

External `freeze05/probe-init-regression.cjs` captures each actual callback with inert browser/context mocks. Under the retained strict24 `native-tools-v2/config.json` environment, the original two callback snapshots each fail by accessing opaque-origin storage. The repaired callbacks pass **14 inert cases**: five opaque/foreign-origin scenarios per probe, owned-origin exact preferences, and original clipboard fake behavior (success, rejection and held resolution). Both probe `node --check` commands pass. Raw command/result/stdout/stderr receipts use `validation/probe-init-freeze05-*`; original source bytes are preserved in external `freeze05/original-source/`.

No browser, daemon, HTTP, app/DB import or provider call was used for this test-only repair. Full Python/Node suites were not rerun: the prior **562 Python / 464 canonical Node** receipts remain product-code evidence for their recorded source. Freeze05 records the exact bridge from freeze04; only these two probes and this scoped evidence note change among all 493 frozen paths. Fresh native execution and remaining acceptance gates are still pending.


## Bounded software closure candidate (2026-11-13)

This candidate closes ticket24 as bounded software delivery under the local tracker convention.
It does not certify all manual acceptance. Source HEAD is
`d68ef23f9d8370b7daa88d864949105da5f26ad7`; incoming20 is locally reconciled. Actual integration
remains `4e75ef02` with twelve software-completed/thirteen open until parent integration. This
candidate adds24 to01/02/04/05/06/10/11/12/14/15/19/20: thirteen software-completed/twelve open.
Fresh independent closure metadata Standards/Spec reviews and parent disposition remain pending.

### Exact unchanged acceptance mapping

1. **Six real scopes:** `tests/test_markdown_export.py`, the15 exact Export canonical Node cases,
   and native-v3's real `/api/agenda/export` reads cover `sessions`, `tasks_short`, `tasks_full`,
   `habits`, `all`, `all_date_range`. Six actual browser download files match current previews
   and the independently captured original response bytes; no synthetic success export is used.
2. **Labels/actions/shortcut/legacy:** native-v3 verifies the six approved ordered labels,
   inert generated Markdown, explicit Copy/Download, honest pending/failure feedback, filenames
   and Ctrl+Enter ownership. Copy success/denial/hold is the source `navigator.writeText` fake,
   not OS clipboard evidence. The legacy session-export menu is omitted; existing endpoint/CLI
   contracts remain unchanged and covered by the API/service tests/source review.
3. **UTC semantics:** API/service and native fixtures cover inclusive midnight/last-microsecond
   UTC session-start bounds, excluding overlap/next-midnight starts while retaining long sessions
   and unfiltered task/habit definitions. Visible UTC Today/Tomorrow versus local-display caveats
   remain; browser ownership probes exercise New York and Kiritimati, with server-local policy
   separately characterized in pytest. No timezone policy was redesigned.
4. **Recurrence and scope:** native real merged reads retain projected upcoming recurrence and
   skip/move through an unrelated Task edit without pre-generation. The UI describes Markdown
   agenda export, not backup, Calendar image or another format/import workflow; source review
   confirms the distinct legacy contracts are preserved.
5. **Failures/stale previews/downloads:** retained test-first caller regression plus15 canonical
   Export cases and553+61 native assertions cover current503/empty bodies, held obsolete reads,
   closed/reopened owners, stale selections, clipboard late completion and real file downloads.
   Delayed real sidebar Task Edit receives keyboard/pointer ownership above unfocused Export;
   actual Escape handback preserves declined close, newer/resumed owners and underlying drafts.
6. **Shared acceptance and honest evidence:** full combined checks and fresh repaired source
   Standards/Spec reviews (both zero findings) are retained. Native Chromium covers16 width/theme
   combinations (390/768/1024/1440; refined/stone/porcelain/dark),288 sampled contrast elements,
  12 real elementFromPoint/click ownership checks and keyboard focus wrapping/handback. This is
   sampled Export evidence, not global accessibility acceptance. Task4.33/AI3.98986 inherited
   contrast limitations remain unwaived. Synthetic isolated storage only; no personal DB or real
   provider call. OS clipboard/save, physical touch, screen reader, other engines, broader zoom/
   motion/races and explicit owner acceptance remain pending.

### Current check and source provenance

External `integrated-after20/report.md` and raw receipts record clean freeze04 combined product
checks: **562 Python passed,214 warnings,100.03s;464 canonical Node passed with no failures,
 cancellations, skips or todos;123 JS/CJS syntax checks passed**. The15 Export cases are an exact
subset extraction of canonical output, not an extra run. Scoped Ruff/format and changed-line
whitespace pass. Full Ruff exits1 with18 inherited findings; both stdout/stderr match the same
executable's complete fixed-base Python/config baseline. Existing full-file whitespace is separately
attributed to baseline lines, not hidden. Earlier548Python/412Node/121syntax after incoming15 and
545Python/391Node before it are historical receipts, not current combined counts.

Freeze05 bridges freeze04 at `cdad695` to current `d68ef23`: only the two browser init callbacks
and their own evidence note changed among493 pinned paths (490 unchanged). Production is unchanged;
14 inert opaque/foreign/exact-origin cases and two probe syntax checks pass. Full suites were not
rerun after that probe-only amendment. Current native execution binds all493 pins, including284
source/test paths. This closure edit releases only five metadata paths; all source/test bytes must
remain identical to freeze05. No new runtime/test execution accompanies these metadata edits.

### Guarded native-v3 disposition and retained failures

External `native-run-v3/browser.json` records browser exit0,553+61 assertions, zero page/probe,
driver/source-pin, guard, capture, handler, request-failure or emergency errors, with all bounded
teardown phases returned. Audit retains153 requests/responses, six actual download byte captures
and original APIResponse bodies captured before unchanged fulfillment. Provider catalog appears in
probe-declared fake metadata but is not registered; provider/catalog backend access is denied by
the guard. Actual clipboard success/deny/hold and read-failure/stale/metadata boundary fakes remain
explicit in the audit; no provider call or paid model test is inferred.

`native-run-v3/disposition.json` records FTS rank1 copied integrity PASS; sole retained-pidfd
SIGTERM; actual exit-15, reaped, process absent, socket refused111; logical storage and private
files equal after stop. Scratch fixtures remain retained at `/tmp/timetrace-codex-24-473585d0/data`.
The first sealed controller failed before application launch because Python3.14.6 lacked
`signal.pidfd_send_signal`; no signal fallback or first-launch pass is claimed. Native-v2 remains
**FAILED** (browser exit1):553+61 returned results and six original-byte-matched downloads did not
override three about:blank localStorage SecurityErrors and nine denied legitimate Calendar/overlay
requests. Its lifecycle/storage proof is retained separately, not relabeled overall PASS.

Freeze05's exact-origin callback guards resolve the opaque-origin error. Native-v3's separate
sealed harness corrects the sole Calendar range per zone using captured FullCalendar duration-first
source, not extra request permissions; its37 pure policy cases pass. It uses the system3.12 pidfd
controller and the configured3.14.6 app runtime. These corrections and successful v3 do not erase
original failures or certify OS clipboard/save. `featureAcceptance:false` in native receipts is
preserved: bounded software completion is a tracker decision, not native-tool human acceptance.

### Remaining gates

Two fresh independent closure metadata reviews and parent disposition/local integration are pending.
Manual OS clipboard and OS save, physical accessibility/other-engine acceptance, explicit owner
review, fixed-base whole-delivery review for all25 tickets and the dev pre-merge gate remain open.
There are no waivers; spec remains **Approved, not Built**. No commit, merge, push, PR, provider,
personal database action or cleanup is performed by this metadata preparation.

Current external pointers (main workspace): `.scratch/codex-continuation/evidence/ticket-24/`:
`integrated-after20/`, `standards-review02.md`, `spec-review02.md`, `freeze05/`,
`native-harness-revision05-v3.md`, `native-run-v3/{browser,disposition,fts-integrity-proof}.json`;
original `native-run-v2/` and earlier controller failure receipts remain unchanged. Closure before/
after hashes and proposed patch are in `closure-metadata/`.
