# Ticket20 implementation evidence — pending independent review and native execution

2026-11-13. Approved B7/O8 and issue20; adoption plan:
`/home/user/git/personal/TimeTrace/.scratch/codex-continuation/ticket20-plan.md`.
Source base: `563a7838a3fa52c6b7a31925ae860559ea79645f`, fresh branch
`codex/ui-redesign-20-ai-settings`. The builder made no commit, merge, push or PR.

## Scope and files

- `services/ai_provider_service.py`: stable safe SDK/extraction probe failures and service-owned
  response projection removing only the known extras `api_key`; storage/forwarding remain intact.
- `interfaces/api/routers/ai.py`: `_provider_response` delegates extras projection to the service.
- `static/js/ai_settings_page.js`: independent behavior Cancel/latest field baselines, submitted-field
  acknowledgements, pending mutation guards, provider-owner disposal and late-response protection,
  explicit key keep/replace/clear, read-only list/catalog retries and stale-read/probe protection.
- `static/js/api_client.js`: parent-approved narrow shared exception; static diagnostic only for
  `/api/ai/settings`, `/api/ai/providers` and provider descendants. Thrown errors and other logging
  are unchanged. Page handlers also display safe generic failure text.
- `templates/ai_settings.html`: explicit Cancel/Clear, tracked clear intent, retry/status areas,
  associated labels and truthful encryption/Pi help; field IDs/category roots/script order retained.
- New `static/css/ai_settings_page.css`: theme-based provider/behavior styling under their category
  roots, responsive cards/forms and focus/disabled states. Browser preference controls are excluded.
- New `tests/test_ai_settings_page.cjs`: frozen22 controls plus17 added ownership/privacy/read cases;
  the original22 cases/fixture assertions remain unchanged.
- New `tests/test_ai_settings_providers.py`: frozen10 controls plus activate response/actual DB
  activation-without-SDK and decrypt/JSON extraction failure controls (14 cases total).
- `tests/test_ai_provider_construction.py`: four raw fake SDK error oracles and one unsupported-provider
  returned-error oracle corrected to safe content; malformed-call/forwarding/cap/Pi controls retained.
- New `tests/browser_ai_settings_providers.js`: author-only guarded native workflow, not executed.
- `docs/ai-maintenance.md`: editor/credential/diagnostic behavior notes.
- Issue20 and implementation record: in-progress evidence and outstanding gates; no Built claim.

## Isolation and provenance

Durable external evidence root:
`/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-20/`.
`environment/allocation.json` records the NEW0700 `/tmp/timetrace-codex-20-emee2lg7` root,
private HOME/TMP/XDG/data and absolute DB/key/timer sibling isolation, editable offline Python3.14.6
and exact24-variable environment. Idle/SQL/tracing are disabled; credential/Pi/ADC environment is
absent. No previous private environment was reused. The offline uv cache lock needed sandbox
escalation; initial failure and successful retry streams are preserved. HTTP tests also required
escalation to avoid the known AnyIO sandbox hang. No app import preceded allocation.

All tests ran through `run-validation.py --config .../environment/allocation.json` with distinct
labels and separate command/stdout/stderr/result files. Python uses `-P -B`; SDK fakes are installed
before probe entry. No real provider, personal DB/credentials or Pi process was used.

The adopted files matched frozen SHA256:

- Node `55bef81e54d0a16d4b63a91f5a54599bce398c9f9bb413bcefd2a683379a2332`.
- Python `3cff855aaee93ae5393a5b1fe981ef6c8d3a3b3b69c2e6380132632fbd9fdb88`.

## Red, repairs and software verification

Latest-base RED confirms all32 frozen cases: Node10 pass/12 fail, Python3 pass/7 fail.
The first default Node runner emitted only one failed file with no case diagnostics; it is retained
as `red-node`. `red-node-base-detail` replays exact base files in the private root with the frozen
Node file and explicit TAP/no-isolation reporting, proving22 distinct outcomes. `red-python` is the
actual10-case HTTP run. This agrees with historical13 green/19 red but is measured on the current base.

Additional failure receipts remain preserved: `focused-python-01` exposed the fifth historical raw
returned-error oracle; parent explicitly approved that narrow correction. `added-node-01` exposed
shared API-client raw logging and led to the approved exact-boundary exception. `newer-instruction-red`
proved old submitted-field acknowledgement could replace a newer authoritative instruction baseline;
the page now applies each checkpoint only while that baseline is unchanged. `late-read-controls-red`
proved a concurrent-typing probe status bug. The first additional initial-GET instruction test assumed
`aiSyncCustomInstructions` runs before readiness, but that public handler intentionally returns before
initialization; the fixture was corrected to a held initialized refresh, with the initial-GET typing
control retained. The intervening failing receipt is retained, not relabeled as product evidence.

Focused Python `focused-python-02`: **167 passed**. It includes real ASGI create/update/list/activate
projection, actual active-row selection with a forbidden SDK stub, fake saved/inline construction/
invocation, cap/precedence/extra-key forwarding and primary mask/keep/null/replace/clear controls.
Saved decrypt and invalid stored-JSON probe failures are tested separately. This is bounded known-path
privacy evidence, not arbitrary-secret security certification.

Focused Node `late-read-controls-green-02`: **106 passed**, including39 AI page cases and67 shared
owner/browser controls. Only HTTP is faked; real page handlers, shared API client/draft helpers,
Assistant instruction reconciliation and source markup execute in the bounded VM fixture.

Final software gates:

- `final-python`: **548 passed, 214 warnings**, 41.65s. Earlier full run:548 passed/214 warnings.
- `final-node-canonical-escalated`: canonical default-isolation
  `node --test tests/*.cjs tests/test_tags_engine.js` under the same strict environment with sandbox
  escalation: **415 actual cases passed**, zero failed/skipped/canceled; stderr is empty.
- Earlier `final-node-default-02` inside the sandbox reported **24 file units passed**, zero failures.
  That receipt remains unchanged and is not relabeled as415 cases.
- `final-node-detail-02`: supplementary explicit TAP/no-isolation collection, **415 cases passed**,
  zero failed/skipped/canceled. This is separate from the default-isolation file-unit receipt.
- `final-js-syntax-02`: `node --check` passed for both changed production JS files, the new CJS
  regression and author-only native probe.
- `final-scoped-ruff`: changed Python files clean. Scoped formatting was run; range formatting
  preserves unrelated existing exception syntax in the service/router.
- `final-ruff`:18 pre-existing repository violations, identical byte-for-byte stdout AND stderr to
  `full-ruff-baseline`, built from exact base Python files and configuration in the private root.
- `git diff --check`: clean. No schema/model/API-shape change, migration or invented migration-copy
  experiment was introduced.

The final tightened refresh assertion also checks the immediate visible authoritative instructions
and clean state. `authoritative-refresh-visible-red` preserves that failure; the final Node runs
verify the page now preserves both the newer baseline and its current value. Final Python code was
unchanged by this last JS-only repair.

## Native and review limits

The NEW native probe is authored only. It installs deny-by-default browser routing before navigation;
Test/Activate HTTP and static catalog are explicitly fake. Synthetic CRUD/settings data use actual
private APIs and persisted readbacks. The fake Activate scenario explicitly checks the database is
still inactive; actual activation/probe service behavior is covered separately through ASGI/fake SDK.
The script blocks unexpected inference, live model discovery, Pi/provider/external network and records
only synthetic action metadata. Parent guard review and actual isolated daemon/browser lifecycle are
still required before any native execution.

The authored probe does not substitute for held-response/browser ownership, cross-category/history/
departure/Assistant compatibility, layout/theme/contrast/focus/reduced-motion/zoom or lifecycle/FK
proof. Existing native probes are compatibility prior art, not claimed runs. No touch/screen-reader/
all-engine or human/whole25 acceptance is claimed. No daemon or `/health` smoke check was executed by
the builder under the parent's explicit native/daemon hold.

Fresh independent Standards (including API-design review) and Spec axes, parent disposition,
post-integration checks and local Git integration remain pending. `docs/development.md` remains
untouched pending15 ownership release. Issue20 remains in-progress with its broad criteria unchecked.

## Freeze sequence

Provisional `frozen-source-20261113-01.json` / `frozen-evidence-20261113-01.json` crossed the parent's
request for the additional escalated canonical Node command. They and the prior evidence remain
preserved. The exact earlier version of this evidence document is archived externally as
`provisional-freeze01-ticket-evidence.md`; the source code itself did not change. Final freeze02
includes the additional415-case canonical receipt, this documentation update and the exact held
`development-note-held.md`. No native execution or daemon activity occurred between freezes.

## Confirmed review repair and authored-probe fidelity, freeze03 (2026-11-13)

The repair began by verifying all 482 freeze02 source hashes: zero mismatches. The confirmed
Standards P2 crossed the actual shared `refreshAiStatusBadge()` caller: it caught failed status
GETs and resolved, so the Settings catch never produced Retry; its target was also inside the
provider form hidden after a clean Save. The prior reviews otherwise cleared their scoped axes;
those prior findings are not re-review of the changed freeze03 source.

Changed files in this repair (all other feature/owner source preserved):

- `ai_settings_page.js`: use the shared read's observable boolean result, generation-guard the
  Provider notice, and offer a status-only GET Retry independently of provider-list refresh.
- `ai_settings.html`: permanent Provider section status area outside the closable editor.
- `ai_assistant.js`: return each status read's success/failure without throwing to ordinary callers;
  only the latest read may repaint the badge. Static failure diagnostics preserve private bodies.
- `api_client.js`: extend the existing exact AI-settings/provider diagnostics exception to the exact
  `/api/ai/status` path, preserving thrown errors and other endpoint diagnostics. Actual failed-status
  regressions proved this necessary before the addition; no generic detector or HTTP shape change.
- `test_ai_settings_page.cjs`: ten additional cases exercise real shared status GET failure after
  acknowledged Save/card Activate and successful list read, notice visibility after the editor closes,
  GET-only Retry without mutation replay, four old/new status outcome combinations and badge state,
  ordinary shared-caller interleaving, confirmed card Delete retaining drafts with list Retry,
  current catalog Retry retaining custom text, and the authored probe's exact Tailwind route policy.
- `browser_ai_settings_providers.js`: remove empty Tailwind JavaScript substitution; the exact template
  asset `GET https://cdn.tailwindcss.com/` uses `route.fallback()` to the mandatory parent guard.
  Other foreign URLs/methods abort. No fake utility CSS, foreign-network bypass or domain ACK proof.

Durable receipts are under continuation `evidence/ticket-20/validation/repair03-*`, always using the
existing strict24 `environment/allocation.json` and unique labels. Preserve every earlier failure:

- `repair03-red`: sandbox reduced Node to one file unit; this is not a meaningful case-level RED.
- `repair03-red-escalated`: 40 pass/5 fail, including one newly authored test's wrong instruction-field
  ID (fixture error, corrected without product changes).
- `repair03-red-corrected-escalated`: 41 pass/4 confirmed product failures on unchanged freeze02
  production bytes. Save/Activate notices are missing and stale outcomes unprotected.
- `repair03-status-privacy-red-escalated`: 43 pass/2 private-status diagnostic failures after the first
  status repair; this justified the exact API-client path addition.
- `repair03-green-escalated`: 45 pass; subsequent additive cases extended the matrix.
- `repair03-ordinary-shared-red-escalated`: 48 pass/1 failure: a newer ordinary badge callback left
  the Provider area stuck refreshing. Shared outcome observability now remains independent of badge
  paint freshness; the page guards its own notice generation.
- Final focused Node `repair03-ordinary-shared-green-escalated`:116 pass, no failures/skips.
- Focused Python `repair03-focused-python-escalated`:167 pass, all fake-provider/privacy controls retained.
- Required full Python `repair03-full-python-escalated`: actual `uv run python -P -m pytest -q`,
  548 pass/214 warnings. Python TestClient execution elevated with the strict private environment.
- Final canonical default-isolation Node `repair03-full-node-final-escalated`:425 actual pass,
  no failures/cancellations/skips; elevated default Node file isolation, not sandbox file-unit counts.
  This is the same canonical collection as freeze02 plus ten new cases, not an inferred count.
- Final five-file `node --check` passes; scoped Python Ruff passes. Whole-tree Ruff still exits 1
  with 18 baseline findings; BOTH stdout and stderr are byte-identical to `full-ruff-baseline`.
  No unrelated format/autofix. Diff whitespace check passes.

The authored-guard unit test invokes only synthetic route-policy objects and stops before any health
read. No browser, daemon, HTTP, provider, Pi, credential access or native acceptance ran. The native
Test/Activate/static catalog interceptions remain explicit UI-dispatch fakes; actual native DB
activation must remain false. The parent must supply/review the exact Tailwind asset guard before
future execution; fallback is not a claim that styling loaded or a browser workflow passed.

Freeze03 supersedes freeze02 for the repair. Fresh parent re-review, native/daemon lifecycle,
integration and human/whole-app acceptance remain pending. No Git mutation, done/acceptance claim,
waiver or `docs/development.md` edit occurred. The broad issue acceptance boxes remain unchecked.


## Authored probe Timer reads, freeze04 bridge (2026-11-13)

Parent pre-native inspection identified that the real shared navbar Timer controller requests
`GET /timer/status` and `GET /sessions` on Settings. The authored probe now permits those two exact
read-only paths through its existing local-origin GET guard. They remain real HTTP reads; no fake
Timer responses, extra writes, live provider discovery or broader path patterns were introduced.
Exact Tailwind fallback to the mandatory parent guard and the declared fake Test/Activate/static
catalog boundaries remain unchanged.

All 482 freeze03 source hashes were verified before this release with zero mismatches. Freeze04
changes only `tests/browser_ai_settings_providers.js` and this evidence document. Scoped Node syntax
and trailing-whitespace checks pass. No product source changed, and no browser, native/daemon, HTTP
or Git execution was performed. Freeze03 and all earlier failures/receipts remain preserved.
NEW04 source/evidence manifests and a bridge record identify the exact changed files/hashes;
parent native verification, review/integration and acceptance remain pending.


## Authored probe failure preservation, freeze05 bridge (2026-11-13)

The first parent native attempt against freeze04 is a retained failure, not acceptance. Its original
`native-run/browser.json` captures real create 201, two update 200 responses and Delete 204 with
zero original response bytes; all six declared fake interceptions are journaled. The later
cleanup attempted a second DELETE after the row had already been deleted; the parent denied that
unlisted mutation. The original exception before cleanup was masked and remains unobserved. A CDP
duplicate-body read failure is a hypothesis only, not an established cause. The final provider
table is empty. The retained parent disposition reports one normal SIGTERM, process reaped/absent,
connection refusal, no timer, unchanged logical storage and preserved private key.

The author-only probe now asserts the actual browser Delete status 204 and public provider-list
readback. Empty-body enforcement remains in the mandatory parent guard's capture of original
APIResponse bytes before unchanged fulfillment; the probe no longer requests a duplicate CDP body.
The protected block includes page creation and initialization. It catches the primary exception
before cleanup and rethrows it unchanged when cleanup succeeds. Cleanup first reads the actual
provider list and deletes only its own ID if still present; context close is attempted even when
that cleanup fails. Multiple errors are retained in an AggregateError with the primary error as
its cause and first member when present. No key plaintext is added to exported diagnostics.

Only the author probe and this evidence section change among all 482 freeze04 source paths.
Freeze04 and the failed native receipts/tools remain immutable. Freeze05 and its external bridge
record exact current hashes plus unchanged source/base/branch/status metadata. No product source
or product tests changed. No author checks, browser, daemon, HTTP, Git writes, provider calls or
whole-product test reruns were performed for this diagnostic probe change. Fresh parent review,
authoritative check execution and native retry remain pending; no completion or waiver is claimed.
