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
