# Ticket 04 — Kanban and quick-edit evidence

Status: implemented locally, **ready for parent review/integration; not closed**.
Base: `7ed9bf330677fb317793aa4371c4f36f407a2595` on
`feat/ui-redesign-04-kanban-quick-edit`. No schema/API/domain-policy changes.

## Delivered slice

- Tasks has a normal persisted view selector, search and adopted wrapping tools above Kanban.
  Fresh/invalid preferences use the shared Kanban default. Valid Grouped/Outline preferences are
  retained with an explicit “Showing Kanban” availability notice; their actual layouts remain 06/07.
  Existing routes, details, custom filters, status administration and completion entries remain.
  Cards retain literal descriptions and now show parent context/tags and keyboard details entry.
- Task modal children sit immediately below the title. Enter/Add queues; Remove only affects
  unsaved children; Save includes an unsubmitted title. Cancel/Escape writes nothing before Save.
- Parent and children use separate existing HTTP writes. The parent receipt is captured before
  children or metadata reads; children use its effective tags/category, including title parsing.
  Each successful child receipt is retained. A rejected child leaves explicit saved/unsaved counts,
  locked saved-parent fields, removal, and **Retry unsaved subtasks**. Retry does not resend the
  parent or confirmed children. Explicit partial discard explains that persisted rows remain.
  Lost responses are still ambiguous: UI advises checking the task list after a connection loss;
  there is no atomic bulk operation, idempotency token or transport-level exactly-once guarantee.
- Metadata failure remains a refresh-only concern, never an invitation to repeat successful writes.
  Session → Task suspension remains guarded through partial writes and metadata refresh; successful
  finish or explicit partial discard attaches the saved parent while retaining Session fields.
- Quick Add remains classify → explicit Parse → editable prefill → human Save on both pages.
  Enter in its input cannot bubble into Save. Generation ownership rejects late classification and
  extraction after input changes, Cancel/reopen, another editor, or human Save. Concurrent form edits
  are preserved instead of overwritten. Parse errors are visible/retryable; model text stays literal.
  Ctrl+Enter saves from Description; ordinary Enter remains multiline. Title focus is immediate,
  stale edit loads are ignored, launcher restoration and Task-dialog Tab wrapping are retained.
- The scoped Parse button uses the existing purple action treatment, not shared AI accept styling;
  a real dark sample exposed 3.768 contrast in that old class. Save/Parse hover uses darker purple.
  Shared utilities/CSS, Session02 files and all backend production files were not edited.

## Tests and public seams

- `tests/test_task_quick_edit.cjs`: 13 caller workflows through real feature handlers and API client,
  with HTTP response fixtures: separate-write partial retry, unsubmitted child, queue/remove/Cancel,
  inert text, propagating Enter, editable extraction, late requests/new owners, concurrent input,
  double Save, saved-write/failed-read separation, completion-policy forwarding and preference/search.
- `tests/test_ai_quick_add_api.py`: 9 real-daemon API tests, faking model construction/invocation only.
  Classify invokes zero inference; tier-1/fallback/error routes; sanitized tier-2 extraction, fenced/
  malformed JSON and sanitized provider failure; unchanged Task/Session/AIDraftBatch/AIDraftItem counts
  until explicit human Task POST. No provider Test/Activate, credentials or real inference.
- `tests/test_task_quick_edit_api.py`: 3 preservation regressions: saved effective inheritance/title
  syntax/status synchronization, completion and leaving Scheduled, no implicit clear, independent
  own selection/subtree clearing and retained logged history.
- `tests/browser_task_quick_edit.js` and `tests/browser_task_quick_edit_edges.js`: native Chromium
  manual probe functions for the existing external runner, not a new dependency/framework.
  Browser Parse responses are **HTTP fakes**, separate from the actual fake-model API tests.

## Isolation and actual verification

Evidence directory: `/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-04/`.
`env.sh` was created before any app import/test. Own `.venv`/editable source verified in
`source-env.txt`. Scratch DB: `/tmp/timetrace-04.f5xt3S/timetrace.db`; daemon port **18163**,
initially checked free. Timer/key siblings stay in that directory. Idle/tracing disabled,
provider environment keys unset, synthetic fixtures only. Runner verifies exact health DB/port and
fakes the provider catalog in every browser context to avoid personal Pi discovery.

Fresh checks at the implementation gate:

| Command | Actual result / receipt |
| --- | --- |
| `uv run python -P -m pytest -q` | **364 passed, 87 warnings**, `pytest-final.log`. 85 existing SQLite warnings plus two existing task-GET serializer-path warnings exposed by new readbacks. |
| `node --test tests/*.cjs tests/test_tags_engine.js` | **159 passed**, `node-final.log`. |
| `node --check` all 33 production JS, 5 CJS, tag regression and 2 new probes | **41 passed**, `syntax-final.log`; not a typechecker. |
| scoped Ruff + format check of 2 new Python files | Passed, `ruff-scoped.log`. |
| `uv run ruff check --no-cache .` | **Failed: 18 unchanged baseline violations** in migration 0002, CLI commands and analytics service; `ruff-final.log`. No changed Python file violation. |
| `git diff --check` | Passed. |
| both external browser probes on actual scratch daemon | Returned successfully, `browser-final.json`, `browser-edges-final.json`. |

Browser observations: actual Task writes and public-API readbacks establish one parent, one successful
first child, a rejected second then only its retry; native Enter/Add/remove/Escape; effective tags/
category; zero extraction-domain writes on both pages until edited human Save. Nested partial retry
with a deliberately failed metadata GET retains Session notes/tags/times/owner, attaches the saved
parent, and never POSTs a Session. Explicit partial discard keeps the parent/successful child and
Session draft. Late Parse after cancel/reopen and Parse error/retry are exercised. Preference reload,
board search/hierarchy and long literal text are observed. No unexpected pageerrors.

The edge probe samples **16** editor geometries (390/768/1024/1440 × three light treatments/dark),
no body horizontal overflow, and five selected task-editor text/control contrasts; minimum **5.3815**.
Screenshots `task-editor-*.png` and `kanban-*.png` are bounded presentation evidence, not certification.

## RED chronology and retained failures

- `queue-red.log`: first tracer failed because the child input/queue did not exist. Added the UI and
  separate-write receipt tracking; `queue-green.log` passed after the synthetic second-child reject.
- A shell editing attempt used unavailable `python`; it made no edits. Switched to installed
  `python3 -P` for file-only scripts. App/test commands always used the isolated `uv` environment.
- `quickadd-red.log`: late Parse overwrote the current form; generation ownership fixed it.
  The first Enter subtest had a DOM-harness missing `id` property; corrected the harness to model real
  DOM identity, exposing an unintended test Save in `lifecycle-first.log`. No assertion was weakened.
  Reruns use actual id/event propagation; browser independently validates native Enter behavior.
- `node-first.log`: old lifecycle caller reuse did not create a second task because the successful
  parent receipt survived completion. Clear completed editor state while retaining local completion
  identity. `node-second.log` additionally exposed an older minimal DOM lacking `querySelectorAll`;
  optional DOM access preserves that harness; full caller suite subsequently passed.
- `keyboard-red.log`: Ctrl+Enter in Description did not save; corrected the Task keyboard handler.
  `kanban-red.log`: selector behavior absent; added normal persisted selection/search behavior.
- `save-parse-red.log`: outstanding Parse replaced fields after human Save began; invalidate its owner
  at Save dispatch while retaining prompt text on a failed mutation. `save-parse-green.log` passes.
- New API preservation tests passed on their first execution; they are characterization, not claimed
  RED cycles or backend changes. Other newly added lifecycle cases also passed initially.
- `ruff-first.log`: one new long test decorator in addition to baseline; scoped formatting repaired it.
- `browser-edges-first.json`: failed dark Parse contrast **3.768**. Changed only the owned Task-modal
  button class (no palette/fixture/threshold changes); subsequent full samples pass. All first-failure
  receipts remain; later expanded successful runs are not replacements for the failed receipt.

## Limits / remaining gates

- Shared auto-ID blue foreground **4.33:1** in the three light themes remains a known task/final25
  follow-up. `utils.js` is Session02-owned/read-only; no foreground helper fix or palette-wide PASS is
  claimed here. Four known dark AI **3.98986** samples also remain outside this scoped Parse repair.
- No physical touch/drag, screen-reader, alternate engine, reduced-motion/zoom certification, exhaustive
  palette/custom-color, timer lifecycle or full destructive status-manager gesture acceptance performed.
  Completion semantics/forwarding have dedicated API/caller coverage, not a claimed complete browser
  gesture audit. Existing-DB migration testing is not applicable: no schema/migration change.
- Parent browser gate, integration reservation/latest-tip recheck, independent Standards/Spec review,
  fresh merger and serialized common-doc closure remain required. Ticket remains ready/unclosed.
  No push, PR, dev merge, delegation, provider calls or integration writes were performed.
- Shared documentation update for parent closure: add the Task queue/receipt/retry contract, incremental
  view availability and Quick Add generation/human-save boundaries to development/implementation maps;
  reconcile the known shared color-helper follow-up with ticket25. Shared docs intentionally untouched.

## Approved category-receipt repair (still uncommitted)

During source freeze, worker identified and parent source-confirmed that `savedTaskParent.category ||
'work'` changed an authoritative empty category into `work`. Parent authorized only this owned line,
caller/API regressions and proof. `empty-category-red.log` shows the real caller assertion **'work' !=
''** when the form category is `study` but the successful parent response category is empty. Exact
pass-through of the saved category fixes it; `empty-category-green.log` passes. A public-API fixture
also proves empty category is valid and remains empty through parent/child create/list. This is API/
authoritative-receipt reachability, **not** an invented blank choice in the current four-option GUI.
The older `t.category || 'work'` edit-prefill behavior is unchanged, not silently redesigned.

The first parameterized API execution retained an old literal `study` expected value and failed;
`empty-category-api.log` is kept. Corrected only that test expectation to its explicit category
parameter, without changing the API or weakening empty-category assertions.

Latest same-base checks: **365 Python passed/87 warnings**, **160 Node passed**, **41 syntax passed**,
scoped Ruff/format passed, full Ruff unchanged18 baseline, diff check passed.
Receipts: `pytest-category.log`, `node-category.log`, `syntax-category.log`, `ruff-category.log`.
Both genuine probes returned successfully again: `browser-category.json`, `browser-edges-category.json`.
Current dedicated counts are **14 caller** and **4 queue/completion API** tests, plus9 Quick Add API.
`source-hashes.txt` captures the new source; prior hashes remain in `source-hashes-before-category.txt`.

Parent independently confirmed declined partial-discard Escape focus moved to BODY while leaving the
modal/value intact and making zero writes (`parent-declined-escape.json`). The shared-capture fix is
assigned exclusively to02;04 does not edit utils. Reservation is now **11 → 02 → 04**. Source/tests
are refrozen pending reviewed integration and the required real combined declined-Escape recheck,
latest-tip/full checks, parent browser/commit gate and independent reviews. No commit or closure yet.

## Uncommitted checkpoint / normal runtime cleanup

Parent directed a checkpoint return, **not completion**, while11 repair/review and02 shared-focus
integration precede04's reservation. No further production/test edits, commits or merges authorized.
Latest checked04 source remains the approved category-repair snapshot on initial `7ed9bf3`.

Own timer status was not running/frozen and idle detection was false (`timer-before-stop.json`).
Sent normal TERM only to own server PID266783; its UV parent266780 exited. Both PIDs are absent,
port18163 has no listener, health is unavailable (`cleanup.log`). Synthetic scratch DB and logs remain
for the parent continuation; no personal/other-lane runtime/storage cleanup performed.

External `checkpoint/tracked.patch`, `checkpoint/untracked/`, status/base records and SHA-256 manifest
preserve the exact dirty tracked patch and untracked files without staging anything. Final required
continuation: reviewed11/02 integration → coordinated dirty-disjoint FF → own-env/runtime restart →
full checks + category and actual combined declined-Escape browser checks → parent final browser gate
and one authorized feature commit → independent reviews/fresh merger/serialized closure. Ticket is
still ready/unclosed; no final combined or commit acceptance is claimed.

## Fresh native continuation on reviewed DFDA (final parent gate pending)

Independently verified the entire original checkpoint manifest, all ten source/test hashes, all twelve
owned tracked/untracked bytes, empty index, exact starting7ed9bf3 and disjoint thirty incoming paths.
Authorized dirty `git merge --ff-only feat/ui-redesign-integration` advanced only this branch to exact
`dfda0aaa67e4014f7123fe5fd659d179c9576dd6`. All twelve owned bytes and tracked patch matched after FF;
no production/test repair was necessary. Shared helpers are the actual reviewed02 implementation.

New receipts are exclusively in external `evidence/ticket-04/finalize/`; historical receipts remain.
Before any app import/test/runtime, created private `/tmp/timetrace-04-finalize.ToEhH5/`, own venv/source,
port18163 checked free, isolated timer/key siblings, idle/tracing off and provider credentials unset.
Actual main daemon health identifies that DB/port; fresh migration is0013_ai_data_scope with no FK errors.
All browser contexts have idle disabled and the provider-catalog HTTP fake. No provider/model network,
personal database, credentials, source from unreviewed lanes or other-worktree edits were used.

Fresh checks: **377 Python passed/105 warnings**, **195 Node passed**, **68 explicit source/test JS/CJS
syntax checks passed**. Focused13 Python and14 Node pass. Warning classes remain existing SQLite and
Task serializer warnings. Scoped Python Ruff/format pass. Full Ruff still fails with18 unchanged
baseline violations; concise stdout **and stderr** byte-match a relative-path, no-cache baseline at
exact reviewed integration. The first absolute-path comparison matched stdout but differed only in
stderr's filename prefix; its raw streams/mismatch exit remain, alongside the corrected relative check.
Whitespace check passes. No claim that global Ruff is clean.

Both full native probes pass after FF (`browser-full.json`, `browser-edges.json`); the latter runs an
external identical copy with only screenshot paths redirected into finalize so old images stay intact.
Its sixteen geometry/contrast samples have minimum5.3815, zero pageerrors. Original owned probes/source
bytes are unchanged. `empty-category-receipt.json` additionally checks the real child caller forwards an
authoritative category `''` while the form holds study: an explicitly intercepted parent POST supplies
that valid API fixture to the real daemon; receipt and both persisted rows are real. It asserts the GUI
has no blank option, not an invented category control. Existing caller/API regressions also pass.

`combined-declined-escape.json` asserts the critical Calendar nested workflow twice (native +Task button
and existing public handler from focused actual Notes textarea). Actual parent+first child persist;
next child POST is deliberately rejected. New child input receives literal text/focus. Native Escape
with declined discard retains exact input value, actual focus, modal and hidden Session attachment/
fields/owner with **zero extra writes**. Accepted discard resumes the same Session/textarea DOM,
retains Notes, tags, unsubmitted tag text and both timestamps, restores button/textarea focus, and
intentionally attaches the already saved parent per the existing contract. No Session autosave or
parent/confirmed-child recreation occurs. Both confirmations explain saved rows; transport-uncertainty
warning remains. No helper is injected, replaced or simulated. Historical parent diagnostic/False
receipt is untouched and not relabeled PASS.

The new combined probe's first run failed before Escape because `#parent-tags` used unsupported
hyphenated title-tag grammar: real parser retained `-tags` in parent title. Retained script/JSON/raw
streams show that fixture assertion failure. Changed only the external synthetic fixture to supported
`#parent_tags`, not the source/parser/assertions; current combined assertions pass. This is a probe
correction/characterization of already repaired02 behavior, **not a new04 product RED/GREEN**. An initial
`python -m timetrace.main` launched bare CLI/status and exited “Daemon Offline”; retained first log/PID,
then started the actual daemon app via own venv Uvicorn. No runtime was misrepresented as healthy.

Code/tests remain frozen at preserved hashes. Parent's final independent genuine-browser gate and
explicit commit release are still required; nothing staged/committed and ticket remains unclosed.
Fresh per-commit two-axis review, fresh merger and serialized common documentation/closure are parent
owned. All prior manual, known4.33/3.98986 contrast and lost-response limits remain unwaived.

## Final independent parent native gate and commit release

Parent independently executed all four current probes against the frozen DFDA app: both full04
workflows, combined declined/accepted Escape (two Calendar launcher/textarea cases) and empty-category
API fixture. All actual assertions/readbacks passed, zero pageerrors; sixteen selected samples minimum
5.3815. Parent verified all twelve file hashes before/after, exact patch0b7ed18e3bf1a6914251b8135ef4b8f8b105f525872998a384508330a07a6b58,
actual own runtime identity and inactive/unfrozen/no-gap/idle-false timer. External receipts:
`finalize/parent-browser-gate.md`, `finalize/parent-gate-verification.json` and parent native receipts.
No helper injection, blank GUI choice, source change or baseline/manual waiver occurred.

Parent explicitly released ONE owned12 feature commit on exact parentDFDA, allowing only this bounded
owned-documentation gate appendix; source/test bytes remain exactly gated. The native supervisor tool
reported timeout and parent later reported no pending reply; explicit authorization arrived through
same-live-writer steering. This is coordination/transport receipt irregularity, not a product failure;
no explanation for expiry is assumed. Earlier “pending gate” paragraphs are historical checkpoints.
Fresh per-commit Standards/Spec review, fresh merger, serialized closure and later human/dev-merge gates
remain parent-owned and mandatory. Ticket remains ready/unclosed; global documentation untouched.
