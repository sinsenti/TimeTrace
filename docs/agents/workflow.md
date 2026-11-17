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

Use GitHub Issues via `docs/agents/issue-tracker.md` and the domain configuration in
`docs/agents/domain.md`; setup is complete. Keep upstream skill files unchanged.

## Default skill workflow

The owner selected the installed Matt Pocock skills' defaults on 2026-11-17. Read the invoked
skill and its linked references, then follow its process rather than a repository-specific duplicate.
Invoking a skill authorizes its normal procedural steps, including commits, branches/worktrees,
subagents, integration merges, issue updates, pushes/PRs when that skill calls for them, and cleanup.
Do not add per-action permission prompts, a separate spec-approval ceremony, mandatory tuicr, or an
extra adversarial/re-review gate. Follow the skill's own interviews, testing-seam agreement, ticket
approval, review and completion requirements.

`to-spec` publishes a GitHub spec issue with its default readiness label. `implement` reviews and
commits the requested work. `implement-spec` executes its task graph with isolated fresh-context
workers and an integration branch, performs its final `code-review`, resolves work as specified and
cleans up its worktrees. Follow each skill's actual instructions; for example, reporting a completed
integration branch does not itself add an unrequested merge into `dev`.

This policy supersedes older generic procedural prohibitions in local records and migrated issue
bodies. It does not resolve unanswered product/technical questions, change approved feature behavior,
resume deferred efforts, or override data/privacy safeguards. Preserve dirty user work; resets and
cleanup must not discard unrelated changes. Use synthetic isolated DB/timer/key state and fake
providers for development. Skill execution is not permission to use personal data or incur provider
costs. Report unavailable tools and unrun checks honestly.

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

## Project verification

Use `docs/development.md#testing-and-checks` for the existing test/lint commands and
`docs/development.md#migration-verification` for safe migration checks. These technical checks
remain applicable; the invoked skill supplies the review/delivery process. The old custom
whole-delivery and human/tuicr pre-merge ceremonies are no longer project requirements.

## Retained helpers

Reusable shell helpers were moved from the old skill/Claude directories into `scripts/agents/`:
`tt-worktree.sh`, `tt-status.sh`, `ship-gate.sh`, and the `tuicr/` review launchers. They are tools,
not discoverable skills. Review their environment options before use; none is run by skill discovery.

The worktree/status helpers derive their repository location from this checkout; `TT_MAIN_REPO`
and `TT_WORKTREE_PREFIX` can override it. Worktree creation still uses a file copy to seed a DB:
stop the source daemon first or use `--empty`. The legacy ship gate also uses a file copy and
checks committed changes against a base; use a consistent disposable source DB and separately
check uncommitted changes, Node runtime tests, and fresh migrations. The authoritative complete
technical verification procedure remains `docs/development.md`. Tuicr and these helpers are optional
utilities, not additional skill-execution gates.

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
