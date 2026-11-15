# Ticket 08 — current Tasks status management

Implementation candidate on `codex/ui-redesign-08-task-statuses`, based on
`564e25a51807c6809d191fa0f31e27d0d7bf6b6c`. Status remains **in-progress**.
No commit, merge, browser, daemon or provider execution is part of this candidate.

## Behavior and boundaries

- `kanban.js`: independent explicit row Save/Cancel drafts; canonical create acknowledgement;
  owner-scoped error/read-only recovery; confirmed deletion; keyboard ordering and one retained
  board/manager order journal. Acknowledged positions are never replayed. Current authoritative
  reads remove confirmed-absent IDs from remaining order work. Visible columns retain hidden slots.
- `tasks.html`: accessible status dialog controls, feedback/read-only retry and stylesheet include.
  Existing dispatcher, view selector, card navigation, Grouped engine, shared modal/controller
  includes and script ordering remain preserved.
- `status_management.css`: scoped neutral status labels, wrapped actions and narrow dialog layout.
  Editable raw color text is retained; optional board decoration accepts bounded hex values.
- Status choices refresh on Tasks for Task, property and child selects while retaining each exact
  live selected value, including unknown, renamed, deleted and empty values. Existing metadata and
  detail-tree refresh paths retain initialized properties and child drafts.
- API/backend/schema policy is unchanged. Existing deletion requires existence, with no seed/in-use
  prohibition; rename does not rewrite stored task status text and deletion clears the optional FK.
  The ticket's vague “deletion restrictions” wording is characterized against this actual policy,
  not interpreted as authorization for a new constraint.

## Tests and original failures

Owned `test_status_management.cjs` exercises real `api_client.js` handlers, the current Grouped
renderer, `taskKnowledge.changed()`, `loadTaskDetailTree(true)`, and the actual Sortable callback.
HTTP is faked at fetch; no live provider is used. The detail-retention VM composes the real
controllers with optional editor DOM: current two-view Tasks has no inline inspector, while the
dedicated page has no status manager. This checks their refresh contract, not a shipped same-page
UI or cross-tab synchronization. Cases cover explicit independent drafts,
concurrent input, canonical-ID/retry receipts, rejection and late ACK/confirmation ownership,
partial/all-ACK order recovery, dismissal/reopen, hidden slots, malformed reads and choices.
`test_status_management_api.py` characterizes real HTTP policy and public Tasks composition.
Three historical native probes were selectively ported; a fourth current-composition probe is
authored for Grouped, hidden-slot ordering and retained Task/detail drafts. Native preparation is
recorded in the external validation report. These are authored checks, not executed acceptance.

Observed RED before adoption: the first row Save/Cancel caller could not find status draft rows.
Hidden-slot ordering then reproduced two PUTs instead of the expected complete three; malformed
status refresh corrupted the last-known array. Public `/tasks` API composition reproduced the
missing new entry control (five policy tests passed, one new composition test failed).
The first canonical Node run retained one existing Add Status fixture failure; only its three
newly required controls were added with explicit parent release, preserving every assertion.

Preliminary review found four further defects; each has a caller-visible RED then GREEN:

1. A dirty row's canonical baseline advanced without its navigation-guard baseline (A→B, server C,
   then user A falsely appeared clean). Detached canonical field receipts now advance both.
2. A late standalone Add verification treated null manager equality as a live owner and wrote into
   a newer dialog. Feedback and controls now require captured writer identity.
3. Board GET coerced null/false metadata into an empty array. It now retains last-known snapshots.
4. Deleting an unacknowledged row stranded a partial order journal on repeated 404. A current
   authoritative read reconciles only confirmed-absent IDs without replaying acknowledged writes.

Two incidental VM fixture failures are retained in the work log: the actual Sortable callback
needed the real Grouped renderer/text helper, and the new failed-board-read path needed a DOM body
for the existing metadata notice. Both fixtures were corrected; neither required product changes.
The initial default-isolation sandbox Node invocation reported only a failed file unit; actual
case counts come from the later escalated canonical run, never from that diagnostic.

## Verification and remaining gates

Exact commands, argv/environment, stdout/stderr and exit receipts are outside the worktree at
`.scratch/codex-continuation/evidence/ticket-08/validation/`; the separate allocation JSON points
to a new private0700 runtime with isolated HOME/TMP/XDG, DB/timer/key siblings, exact24 environment,
offline frozen Python3.14.6 and fake providers. The test client avoids daemon lifespan startup.

Final post-review product: Python568 passed/215 warnings; canonical Node491 passed including27
owned status cases. Initial candidate Python568/Node484 receipts remain separately retained. Full Ruff retained18 inherited findings, both streams byte-identical to the ticket24 baseline.
API scoped Ruff/format, all eight changed-JS syntax checks and diff checks passed. Preliminary review amendments add four owned regressions. Freeze01 fresh reviews then found two
more defects, each reproduced RED/GREEN: the scoped desktop grid outranked its narrow media rule,
and a during-write GET could unlock a rejected/uncertain Save before post-result verification.
The media selectors now match the base specificity; uncertain results advance read/metadata
generations before any owner-local handling. The authored native probe also checks the computed
390px grid, full-span Name/Color and row/panel/control bounds without executing a browser.
Freeze02 Standards was clean; Spec found nested Delete confirmation focus/Tab/Cancel-return missing.
The status action now owns those focus/Tab transitions. Parent explicitly released only the already
reviewed ticket16 shared `showCustomConfirm` Enter-on-current-Cancel bugfix: Cancel Enter cancels,
Confirm/default Enter and Escape keep their existing behavior. Exact one-hunk reconstruction proves
all other utils bytes (including current Export/AI work) unchanged. A real utils+status caller test
failed before focus entry and now passes Cancel/Tab/Enter/Escape/return plus Confirm/default checks;
the authored native Delete probe mirrors those assertions without browser execution.
Final post-review checks cover the 27-case status suite; final post-amendment results and immutable source/hash manifests are in the
external frozen report. Initial receipts remain retained and do not certify amended bytes.

Browser/daemon/native behavior, visual appearance, physical keyboard/touch/accessibility and human
acceptance are **unrun**. Outline is absent on this actual two-view base: real Outline selected-ID,
collapsed-state and retained inline-editor/status/order checks remain **pending combined-source
verification after authorized integration**. Existing accepted APIs remain separate writes; a lost
response can leave an uncertain persisted result. No atomic, idempotent, exactly-once or cross-tab
refresh guarantee is claimed. Preliminary forked-context reviews are historical diagnostics; the
qualifying independent Standards and Spec reviews must inspect the final byte-frozen candidate in
fresh contexts. Shared aggregate documentation and ticket closure remain parent-owned.


## Current reconciliation — verification incomplete (2026-11-15)

This section supersedes the initial two-view candidate's current-state and blanket unrun claims
above; their original failures, counts and boundaries remain historical evidence. Current frozen
software is HEAD `72129a1a456fa4b66b9f962fb3e0bdf1be9568ad`, combined with Outline and ticket18.
Ticket08 remains **in-progress**: the new native run is a narrow real workflow pass, with
`featureAcceptance:false` and `humanAcceptance:false`, and does not complete its native matrix.
The authoritative continuation count remains 15 software-completed / 10 open. No issue criteria,
issue status, aggregate tracker, spec status or acceptance gate is changed by this reconciliation.

Evidence root: `/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-08/`.
`integrated-after18/report.md` records the current 578 Python passes/218 warnings, 610 actual
canonical Node passes, 137 syntax passes and unchanged 18 inherited full-Ruff findings (both
streams identical to integration18). Scoped Ruff/format and whitespace passed. These already-run
checks certify frozen source; this metadata-only reconciliation does not repeat them. Earlier
568/491 and after07 receipts remain historical, not current counts.

`native-execution03-amendment01/REPORT.md`, `execution-result.json` and
`receipt-files.sha256.json` record the separately authorized real-browser/controller exit0:
17 genuine mutation ACKs (4 fixture + 13 UI: 3 saves, 1 create, 8 position PUTs, 1 delete),
9 exact action budgets and 27 checks. Cancel and read-only Retry wrote nothing. The original
ACK with newer typing and one declared failed GET preserved the draft. Exact Outline inspector
node, description, search and selection were retained; all three view entries and 1440/390 manager
geometry passed. Delete Cancel/Tab/reverse-Tab/Enter/Escape/focus handback and public deletion
readback passed. There were 125 settled callbacks, zero guard failures, exact-handler removal
with pending0, two expected error diagnostics and one retained Tailwind warning.

Protected storage and nullable status IDs matched exactly; owned source closure preceded the
read-only backup-to-memory FTS check. Physical main-DB SHA256 remained
`cdb41c02f5bb24723205aad7e9e6c88c1550a1f0c2530f20c1cfe27c49254549`.
Browser/context cleanup passed; one owned pidfd TERM produced actual exit−15, reap, process
absence and port refusal with after-stop storage equality. Full 519-source/34-helper binding
passed before and after execution. Original02 crash/offending URL/counts remain UNKNOWN and
unchanged. No fabricated valid ACK, personal DB, provider, timer or SQL write is claimed.

### Unchanged criteria against current evidence

| Issue criterion | Established evidence | Outstanding verification |
| --- | --- | --- |
| 1. Existing APIs: creation/editing/order/colors/flags | Real API policy tests; current Node explicit draft, literal/raw value, flag and hidden-slot order regressions; native create/save/order/delete/public reads | Native flag/color behavior across approved appearance states and hidden-slot/partial-order variants remain unverified. |
| 2. Confirmation/deletion/task sync/completion prompts | API loose text/FK and nullable-deletion characterization; Node rejection/stale confirmation; native confirmation keys, cancellation/no write and public deletion | Actual task status move through scheduled/recurring keep/clear prompts remains unrun in this ticket's native matrix; existing semantic suites do not supply that browser evidence. |
| 3. Refresh retains drafts; successful write differs from failed refresh | Current Node real Grouped/detail-tree callers and status choices; native held original ACK/failed GET/read-only Retry plus retained exact Outline editor/search/selection | Native dirty Grouped/Kanban quick editor, child/nested drafts and combined-source Outline partial-order/stale-read verification remain incomplete. Native view entry alone does not prove draft retention in each view. |
| 4. Failure/order/keyboard/focus/readable colors | Current Node create/update/delete rejection, partial/all-ACK journal and stale-read regressions; native keyboard order, save/focus, nested confirmation and narrow/wide bounds | Native response-loss/dismiss-reopen/late-owner and partial-order matrix; applicable measured enabled text/control/focus contrast and approved light/dark/zoom presentation remain unrun. Geometry does not establish contrast. |
| 5. Shared acceptance/regression/evidence/privacy | Current full suites and syntax; scoped lint and explicit inherited full-lint baseline; isolated genuine native receipts, storage/FTS/source binding and owned shutdown | Required per-ticket native integration cases above remain open. Fresh closure-metadata Standards/Spec reviews and parent disposition remain pending. |

The concrete software verification gap is the plan's minimal native matrix items2–4: retained
editors in each view and nested owners, partial/stale/non-atomic order recovery including the
combined-source Outline gate, plus actual completion/recurrence prompt behavior. Item1/shared
acceptance also require applicable measured contrast and broader appearance coverage; these are
not replaced by the two geometry samples. Four authored native probes remain unexecuted. This
record does not require blindly running their old absolute paths; any future execution needs
current-source reconciliation and its own authorization. Existing Node/API coverage remains
valid at its stated seams and is not promoted to real-browser proof.

Physical touch/drag, screen readers, other browser engines, broad shared Rating/Export/dialog
priority, human visual acceptance, whole25 fixed-base whole-delivery review and explicit dev-merge
approval remain separate open limits. None is waived or represented as software acceptance.
The two stale development autosave statements are corrected in this candidate only. No source,
test, backend policy, migration, spec or root user documentation was edited; no new runtime,
suite, commit, merge, push or PR was performed. The external closure-reconciliation01 report
and bridge bind these exact metadata changes to freeze06.
