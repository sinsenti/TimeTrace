# Agenda #3 implementation checkpoint

Branch: `agenda-03-recorded-work`, base `4656a453c7899aa8194bf79580b38159a306e5c8`.

The initial worker timed out during its last full Python run. Changes were preserved, not reset
or stashed. This checkpoint commits the implementation before resuming validation; it is not
acceptance, integration or issue completion.

Implemented slices: explicit manual create/read and caller-owned recording staging; validated
explicit persisted/projected association; nonblocking same-task overlap warnings; pure interval
arithmetic; bounded indexed structured union queries and original/current plan comparison;
Folio manual form, retained draft/ACK protections and labeled progress. Timer v1 is unchanged.
Schema 0016 adds only a typed-work range index. The detailed producer/capability contract is in
[agenda-contract.md](agenda-contract.md).

Evidence recovered at resume:

- Initial root HTTP tracer: RED 404, then GREEN manual provenance/raw read.
- Subsequent validation, overlap, association, virtual capture, interval/compiler, precision,
  staging, AI allowlist and migration slices have retained RED/GREEN logs.
- Latest focused interval/recorded-work run: 19 passed, 204 warnings.
- Earlier full checkpoint: 745 Python passed, 487 warnings; 821 Node passed. These precede the
  final staging/precision changes. Last full Python rerun was interrupted around 57%; no final
  pass is inferred. Final reruns remain required.
- Scoped Python lint/format and JS syntax passed before interruption; full Ruff output matched
  the fresh base archive's 17 inherited findings byte-for-byte.
- Fresh and copied synthetic migration coverage passed (10 migration tests), including FK,
  metadata/JSON/polymorphic references and index SEARCH checks.
- Isolated native Folio checks observed manual provenance, two raw work rows after a 1800-second
  warning, 1.5h union, separate past plan, original/current 1h fill + .5h outside, reload and
  390px layout without horizontal overflow. Deterministic held-ACK races are Node evidence,
  not claimed native transport simulation.

Owned resources were rediscovered by PID/start time/cwd/command/private environment and health:
only the candidate daemon on port 18612 and the worker-created browser tab/profile may be cleaned
up. The separate preview lane's port 18702 is not owned and must remain untouched. No providers,
personal database, owner-worktree changes, publication or integration are authorized.

Pending: durable interpreter binding, final full suites/lint/migration confirmation, final native
read against the latest code, owned-resource cleanup, scoped finishing commit and implementation
report. Parent owns the independent two-axis review and integration.

## Resumed final validation

The venv now uses durable installed CPython 3.14.6, not the private temporary Python installation;
its editable package resolves to this checkout. No implementation rewrite was needed on resume.

- Full Python: **748 passed, 538 warnings**, 119.17s. Warnings include the inherited serializer
  warnings and Python 3.12+ sqlite datetime-adapter deprecations exercised by new bounded queries.
- Full Node: **821 passed**, zero failures/skips/cancellations.
- Scoped Python lint passed; all 16 changed Python files passed format checking. Changed Agenda
  JavaScript passed `node --check`; whitespace checking passed.
- Full Ruff remains **17 inherited findings**, byte-identical to a fresh base archive using the
  same executable, working-directory-relative output and `--no-cache`.
- Fresh/copied migration seam rerun: **10 passed**. Actual scratch startup reached
  `0016_recorded_work_index`, with the expected four-column index and empty FK check.
- Latest-code native rereads preserved raw rows and 1.5h task union. Editing only current schedule
  showed immutable original 09:00–10:00 / fill 1h, current 09:15–09:45 / fill .5h; outside task
  credit changed from .5h to 1h. A taskless manual entry added elapsed/unassigned credit without
  adding task credit. Recording from projected-plan context with attachment unchecked left the
  projection visible beside the work row while allowing matching fill. These used actual daemon
  responses, not mocked browser HTTP. Held ACK/conflict races remain deterministic Node coverage.
- Native console retained one expected failed `/timer/status` fetch from the controlled daemon
  shutdown/restart, plus the existing Tailwind CDN warning; no clean-console certification is made.
- The verified owned daemon and owned browser tab/profile were stopped/closed/deleted. Shutdown
  finished and port 18612 refused connections. The separate preview lane was not touched.

Remaining limitations are intentional capability boundaries, not claimed completed downstream work:
no tag/time grouping or full custom union widgets, no work editing/reassignment, no timer-v2 receipts
or file upgrade. Physical touch, screen readers, other engines and real 200% zoom were not tested.
The parent still owns required independent two-axis review and integration/publication.
