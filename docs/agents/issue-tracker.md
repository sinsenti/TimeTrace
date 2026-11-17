# Issue tracker: GitHub Issues

GitHub Issues in **sinsenti/TimeTrace** is the canonical tracker:
<https://github.com/sinsenti/TimeTrace/issues>.
Use it for new implementation tickets, bugs, and wayfinding maps/decision tickets.
Specs published by `to-spec` live as GitHub issues. Existing `specs/` files are supporting contracts;
research and prototypes remain repository assets.
Read `docs/agents/triage-labels.md` before triaging.

## Access and commands

Use `gh` with an explicit repository so other checkouts cannot redirect operations:

```bash
gh repo view sinsenti/TimeTrace --json nameWithOwner,viewerPermission,hasIssuesEnabled
gh issue list --repo sinsenti/TimeTrace --state open --limit 100
gh issue view NUMBER --repo sinsenti/TimeTrace --json number,title,body,comments,labels,assignees,state,url
gh issue create --repo sinsenti/TimeTrace --title 'Title' --body-file /absolute/path/to/body.md --label ready-for-agent
gh issue comment NUMBER --repo sinsenti/TimeTrace --body-file /absolute/path/to/comment.md
```

Use pagination (`gh api --paginate`) when a list may exceed the requested limit. Read the full issue
body and comments before acting. Fetch by GitHub number or URL; old local ticket numbers are not
GitHub numbers. Use linked titles in human-facing summaries.

Orca's project GitHub account should be `sinsenti`. Verify effective repository permissions before
writes rather than assuming the ambient login matches. If this shell still uses another account,
use a per-command credential without changing the global login:

```bash
GH_TOKEN="$(gh auth token --hostname github.com --user sinsenti)" gh repo view sinsenti/TimeTrace --json viewerPermission
```

Apply that prefix to the needed commands only. Never print, save, or commit tokens. If the selected
account cannot write, stop and ask the owner to fix access; do not fall back to local publication.

## Pull requests as a triage surface

**PRs as a request surface: no.** External PRs are not automatically part of the feature-request
queue. An explicitly requested PR review is still handled normally. PR operations follow the
invoked skill; this triage-discovery flag is not a publication permission gate.

## Publishing, relationships, and completion

- Publish one GitHub issue per approved ticket, blockers first. Link its spec and parent issue when
  applicable; retain acceptance criteria, safety constraints, and unresolved technical gates.
- When `to-spec` publishes a specification, create a GitHub spec/parent issue and apply its default
  `ready-for-agent` label. Use the skill's testing-seam agreement and specification process; no extra
  repository-file or owner-signoff stage is required. Existing local contracts remain context, and
  genuinely unresolved behavior still needs a decision rather than a guessed answer.
- Execution follows the invoked skill's defaults in [workflow.md](workflow.md#default-skill-workflow).
  Older blanket commit/merge prohibitions in imported issue bodies are historical procedural rules,
  not additional execution gates. Feature-specific decisions and technical prerequisites remain.
- Use native sub-issues for parent/child relationships and native issue dependencies for blocking.
  These REST operations use database `id` values, not issue numbers:

  ```bash
  gh api repos/sinsenti/TimeTrace/issues/CHILD_NUMBER --jq .id
  gh api --method POST repos/sinsenti/TimeTrace/issues/PARENT_NUMBER/sub_issues -F sub_issue_id=CHILD_DATABASE_ID
  gh api --method POST repos/sinsenti/TimeTrace/issues/DEPENDENT_NUMBER/dependencies/blocked_by -F issue_id=BLOCKER_DATABASE_ID
  gh api --paginate repos/sinsenti/TimeTrace/issues/PARENT_NUMBER/sub_issues
  gh api --paginate repos/sinsenti/TimeTrace/issues/DEPENDENT_NUMBER/dependencies/blocked_by
  ```

  Replace uppercase placeholders. Create issues before wiring relationships; verify each edge by
  reading it back. If a native operation is unavailable, report the limitation and use explicit
  linked `Parent` / `Blocked by` body sections as a documented fallback. Never silently drop edges.
- Work only on open, unclaimed issues whose blockers are completed. `ready-for-agent` describes
  specification readiness, not absence of blockers. Claim by assigning the driving developer.
- Post implementation evidence and deferred checks before closing an issue as completed. Close
  declined work as not planned with a reason. Use the invoked skill's review and delivery steps.
- After an uncertain write response, read back before retrying to avoid duplicate issues/comments.
  Update shared issue bodies from a fresh read so concurrent edits are preserved.

## Wayfinding operations

- Map: a GitHub issue labelled `wayfinder:map`, with Destination / Notes / Decisions so far /
  Not yet specified / Out of scope. It is the canonical index, not a duplicate store of answers.
- Child: a native sub-issue with the question in its body and exactly one type label:
  `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
  Wayfinding issues use only `wayfinder:` labels, not implementation triage labels.
- State: GitHub open/closed; an assignee is the claim. Assign the developer driving the map, not
  a fictitious agent identity. Skip claimed tickets.
- Frontier: list the map's open sub-issues, exclude assigned issues, then read each candidate's
  native blockers. Select the lowest-numbered issue whose blockers are all completed; inspect
  linked fallback blockers too. A not-planned blocker does not count as satisfied.
- Resolve: post the answer as a resolution comment, close the child as completed, and append a
  linked-title gist to the map's Decisions so far. Human-led decisions require actual owner input.

## Existing local records and migration

Old `.scratch/<feature>/` paths identify historical records, not a live ticket store. Migrated
copies and UI exploration artifacts were archived outside the checkout at the owner's request;
unique UI evidence remains local. The [migration mapping](github-migration.md) records verified
GitHub successors and [local recovery details](github-migration.md#local-archive-cleanup).
New publication and ongoing issue lifecycle updates belong on GitHub; do not maintain two live trackers.
The completed migration is recorded there; changing tracker configuration alone does not alter
historical completion or reopen delivered work.

When the owner requests migration of an existing effort, reconcile it against current source and
latest delivery evidence first. Search GitHub for duplicates; publish only the agreed scope, wire
real dependencies, and record a local-path → GitHub-URL mapping in that effort's index. Preserve
original files/evidence and identify the GitHub successor so old local identifiers stay traceable.
Resolved historical work need not become a new open issue.

This repository is public: review local material before publication. Keep personal data, private
session transcripts, credentials, database content, and machine-specific evidence paths out of
issue bodies. Summarize safe findings and link tracked assets at reachable repository URLs;
uncommitted/untracked files and local absolute paths are not accessible GitHub attachments.
