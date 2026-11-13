# Agent workflow

## Skills and discovery

The repository uses Matt Pocock's published engineering/productivity collection. The only skill
content directory is `.agents/skills/`, which Codex discovers. `.pi/skills` is a relative symlink
to it so Pi uses the same files. There is no project Claude Code installation.

Skills are reusable workflows; `.codex/agents/*.toml` are optional specialist subagent roles,
not another skill collection. They are retained for planning, implementation, migrations,
review, and verification. `CLAUDE.md` remains the historical owner-decision record used by
`AGENTS.md`; its filename does not make its contents disposable Claude configuration.

In Codex, invoke skills with `$ask-matt`, `$grill-with-docs`, `$to-spec`, `$to-tickets`,
`$implement`, `$implement-spec`, or `$code-review`. Upstream recipes sometimes say to call a
"Skill tool" or use slash commands; use Codex's available skill mechanism, reading the named
`SKILL.md` when no dedicated invocation tool exists. Preserve upstream invocation policies in
`agents/openai.yaml`; explicit-only workflows should remain explicit-only.

The generic recipes do not authorize commits, resets, merges, PRs, provider calls, or changes to
personal data. Follow `AGENTS.md`, the approved spec, and the user's actual authorization.
Use the existing local tracker/domain configuration in `docs/agents/`; setup is already complete.

## Updating skills

Source: <https://github.com/mattpocock/skills>. `.agents/skills-lock.json` records the exact source
commit, release version, source path and SHA-256 of every installed file. This is a repository
integrity manifest, not a skills.sh lockfile. The upstream MIT license is `.agents/SKILLS-LICENSE`.

To update, resolve the current upstream `main` commit, inspect its published plugin manifest
(`.claude-plugin/plugin.json`), and install every path listed in its `skills` array at that exact
commit. The manifest is upstream packaging metadata; it does not require running Claude Code.
Stage the installation outside this repository, compare it with the current files, and preserve
any local additions in project documentation before replacing skills. Keep vendor files unchanged.
Refresh the integrity manifest and verify every file against the staged source. Pi needs no second
installation. Do not also install a global/plugin copy of this collection for this project.

The initial shared installation is upstream 1.3.2 at
`5863806dd4e15c63174bee4e7515a4256792ecfa` (2026-11-13). It contains 27 published skills.
The 12 other upstream skills under `misc/` and `in-progress/` are not part of the published bundle;
they include Claude-only hooks and experimental workflows and are not installed here.

## Whole-delivery review

Before implementing a multi-ticket spec, record the starting commit as the fixed review base.
Before declaring the whole delivery complete:

1. Run the full project checks on the integrated result, separating baseline failures and unrun checks.
2. Use `code-review` against the starting commit for all tickets, tests and delivery documentation
   together. Per-ticket reviews do not replace this review.
3. Trace affected workflows through every relevant caller, including pre-existing renderers and
   handlers newly reached by the change. Where relevant, cover alternate entry points, interrupted
   initialization, delayed/failed reads, and preservation of unsaved input.
4. Fix confirmed findings with caller-visible regressions for behavior changes. Re-run applicable
   checks and obtain an independent review of the amendments until no confirmed findings remain.
5. Report the reviewed base/final commit, resolved/outstanding findings, exact check results and
   deferred manual acceptance. If required checks/review remain incomplete, report that status.

This preserves the local whole-delivery rule formerly patched into `implement-spec`. Implementation
completion is separate from human acceptance and permission to commit, publish or merge.

## Pre-merge gate

Only run this flow when a merge is requested. Before a feature merges into `dev`:

1. Complete automated verification: full regression suite, Ruff with baseline failures distinguished,
   and changed-JavaScript syntax checks. Follow `docs/development.md#testing-and-checks`.
   Schema changes additionally require fresh and existing-copy migration verification, row/FK
   checks, and an isolated daemon/ORM smoke check as described in
   `docs/development.md#migration-verification`. Work only against disposable isolated databases.
2. Obtain an independent adversarial review (the optional `tt-reviewer` role or `code-review`), fix
   confirmed findings, and re-run affected checks. Clean reviews need not manufacture defects.
3. Open the branch diff for explicit human review in tuicr. With tmux, use
   `scripts/agents/tuicr/tuicr-window.sh /path/to/worktree`; otherwise start tuicr in the worktree.
   The helper defaults to `dev..HEAD`, or the working tree when there are no commits ahead.
4. Tell the owner the review is ready, then wait for feedback. Read it with `tuicr review list`
   and `tuicr review comments --repo /path/to/worktree --session <slug>` when ready. Fix blocking
   issues; address suggestions or explain why they were declined. Do not impersonate the owner
   or write comments into their review without authorization. Re-check feedback after amendments.
5. Merge only after the owner explicitly approves the reviewed result. Passing checks and resolving
   comments do not independently authorize merging. Pushes and PRs require their own authorization.

## Retained helpers

Reusable shell helpers were moved from the old skill/Claude directories into `scripts/agents/`:
`tt-worktree.sh`, `tt-status.sh`, `ship-gate.sh`, and the `tuicr/` review launchers. They are tools,
not discoverable skills. Review their environment options before use; none is run by skill discovery.

The worktree/status helpers derive their repository location from this checkout; `TT_MAIN_REPO`
and `TT_WORKTREE_PREFIX` can override it. Worktree creation still uses a file copy to seed a DB:
stop the source daemon first or use `--empty`. The legacy ship gate also uses a file copy and
checks committed changes against a base; use a consistent disposable source DB and separately
check uncommitted changes, Node runtime tests, and fresh migrations. The authoritative complete
verification procedure remains `docs/development.md`; a helper verdict is not merge permission.

## Migration audit (2026-11-13)

The removed 15 TimeTrace skills appeared in both `.claude/skills` and `.agents/skills`.
Nine manifests were byte-identical; the remaining six differed only in assistant names and paths.
Their five Claude specialist role bodies likewise differed from the Codex roles only in references
to `CLAUDE.md` versus `AGENTS.md`. The unique standalone worktree/status scripts were retained.
The duplicate fixture stub in `tdd-guide` was retired; tests use `tests/conftest.py`.

Discovery and repository references establish that the skills were available and some were required;
they do not prove historical invocation frequency. In particular, `AGENTS.md` explicitly referenced
`spec-driven-workflow` and the Claude `merge-review`; those references are now replaced by project
documentation. This file/reference audit does not establish whether the other skills were invoked.

The invalid `.Codex/scripts/...` and `.Codex/skills/...` paths were present from the first Codex
configuration commit, `191abf5` (2026-10-01). They pointed at neither the real `.claude/scripts`
helpers nor `.agents/skills` review launchers. Lowercasing alone would not have fixed them.
The source diff shows a Claude-to-Codex naming/path substitution; intent behind it is not recorded.

Stale instructions found in the removed skills:

| Skill | Obsolete assumption | Current source/evidence |
| --- | --- | --- |
| `database-designer` | Fresh migration fails at 0002; programmatic Alembic URLs are ignored | `0002_add_task_statuses_and_subtasks.py` uses a literal datetime; `db/migrations/env.py:get_url` honors explicit configuration |
| `performance-profiler` | `/analytics/detailed` and `AnalyticsService.get_detailed()` are current; summaries aggregate all rows in Python | Detailed endpoint/method retired; `AnalyticsService.get_summary()` uses `QueryService` |
| `performance-profiler`, `adversarial-reviewer`, `code-reviewer` | `schedule_recurrent_sessions_three_months` remains a live task operation | Method removed; `SessionService` uses recurrence projections/exceptions |
| `karpathy-guidelines`, `grill-me`, `spec-driven-workflow` | RRULE projection and AI drafts remain future work | Shipped, as recorded in `AGENTS.md` and `docs/development.md` |
| `adversarial-reviewer` | No secrets/provider keys should exist in this project | Shipped AI configuration stores encrypted keys; privacy rules are in `AGENTS.md` |
| `central-chat`, `merge-review` | `.Codex/...` helper paths exist | No such directory; retained helpers now live under `scripts/agents/` |

The fresh-bootstrap and Alembic-URL bugs were fixed in `17b5d8d` (2026-08-21), detailed analytics
was retired in `64970d0` (2026-08-24), and recurrence pre-generation was removed in `82422c1`
(2026-09-02). Those obsolete claims were subsequently copied into the Codex skills on 1 October.

Related stale Codex role instructions were corrected: nonexistent roadmap sections, Python
analytics aggregation, unsafe scratch-copy recipes, and implied permission to commit/migrate real
data. Codex specialist roles remain optional and are not copies of Matt's skills.

Migration verification: all 79 installed files match the pinned upstream source and integrity
manifest. All 27 YAML manifests/UI policies and five agent TOMLs parse; Pi 1.5.2's real skill loader
discovers all 27 skills through the symlink with no diagnostics. All eight retained shell helpers
pass `bash -n`; worktree/review help and repository resolution from outside the checkout pass.
The bundled skill-creator validator accepts 11 skills and rejects 16 solely for upstream
`disable-model-invocation` / `argument-hint` fields; their Codex invocation policies are separately
validated in `agents/openai.yaml`. Vendor files remain unchanged.

The Python regression suite was attempted but stalled during collection before producing test
results; a bounded retry was terminated after 35 seconds (exit 137). No suite pass is claimed.
Interactive tuicr, worktree creation, daemon boot, provider calls and personal-data migrations were
not exercised for this configuration migration.
