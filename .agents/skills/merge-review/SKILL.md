---
name: merge-review
description: The mandatory gate before any TimeTrace feature branch merges into dev — automated checks, an adversarial agent review, then a human review in a tuicr tmux window whose comments must be resolved before the merge happens. Use whenever a branch or worktree is ready to merge, or the user says a feature is done.
---

# Pre-merge review gate

Nothing reaches `dev` without passing this. The order matters: cheap automated checks first so
the human never spends attention on something a linter could have caught, then an adversarial
agent pass, then the human in tuicr, and only then the merge.

**The human review is not optional and not advisory.** The user reviews every branch in tuicr
before it merges. Never merge to `dev` because the automated checks were green.

## 1. Automated gate

Run in the branch's worktree. All of these must pass before you involve a human:

```bash
source .tt-env 2>/dev/null || true      # scratch DB + non-8002 port, if this is a worktree

uv run ruff check .                     # no NEW violations (repo has pre-existing E501s)
for f in $(git diff --name-only "$BASE_BRANCH"...HEAD -- '*.js'); do node --check "$f"; done
```

If `db/models.py` or `db/migrations/` changed, additionally: apply the migration to a **copy** of
the real database, verify row counts and `PRAGMA foreign_key_check`, and boot the daemon on that
copy. The `ship-gate` skill and the `tt-migrator` agent cover this; do not shortcut it.

## 2. Adversarial agent review

Run the `tt-reviewer` agent against the branch diff. It hunts this codebase's recurring bug
classes (naive/aware datetime mixing, UTC-vs-local date bucketing, `parseInt` on UUID ids,
unquoted ids in inline handlers, model changes without a migration, logic leaking into routers,
full-table-scan analytics).

Fix what it confirms, then re-run the automated gate. Do not pass unresolved confirmed findings
to the human — their review time is for design and product judgement, not for defects a reviewer
agent already found.

## 3. Human review in tuicr

Open the review in its own tmux window, scoped to what is actually being merged:

```bash
.Codex/skills/tuicr/tuicr-window.sh /path/to/worktree
```

With no extra arguments this reviews `dev..HEAD` — the branch's commits, which is the thing
being merged. It returns immediately rather than blocking, and prints the tmux window id.

Then **tell the user the review is open and stop**. Do not merge, and do not poll aggressively.
Read their feedback when they say it is ready, or poll at a relaxed interval (~30s) if explicitly
asked to wait:

```bash
tuicr review list --repo /path/to/worktree
tuicr review comments --repo /path/to/worktree --session <slug>
```

Comments come back as JSON. Treat them by `comment_type`:

- `issue` — blocking. Fix before merge.
- `suggestion` — implement it, or explain why not. Don't silently skip.
- `note` — answer or acknowledge.
- `praise` — nothing to do.

This is a **user-led** review: do not add your own comments into their session, and never
impersonate their comments. (Agent-authored comments via `tuicr review add --username` are for
the separate "agent reviews a patch" workflow, not this one.)

After addressing feedback, re-run the automated gate and re-open the review on the updated
branch. Re-read `tuicr review comments` before claiming completion — the user may have added
more while you were working.

## 4. Merge

Only after the user's comments are resolved and they have said it is good:

```bash
git -C "$MAIN_REPO" switch dev
git -C "$MAIN_REPO" merge --no-ff feat/<slug>
```

Then clean up the worktree if the feature is finished:
`.Codex/scripts/tt-worktree.sh rm <slug>`

Never `git push` and never open a PR as part of this flow unless the user asks — those stay
gated deliberately.
