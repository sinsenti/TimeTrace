---
name: implement-spec
description: "Implement the result of /to-spec and /to-tickets in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Start every subagent with a fresh context window.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency.

## Steps

1. Read the spec and tickets to understand the task graph. Record the starting commit before implementation as the fixed base for the final whole-delivery review.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create the integration branch. If the issue tracker closes work through PRs, or the user asks for one, open a draft PR after the first merge in step 5 (a branch with no commits ahead of main can't open one), marked as closing the spec and tickets.

4. Use a fresh **implementer subagent** for each ticket, each in its own worktree on its own branch. Each implementer subagent:
   - confirms its worktree is based on the integration branch before starting, and resets onto it if not;
   - calls the Skill tool with `tdd` to build the ticket;
   - merges the integration branch tip into its own branch before reporting done

5. Once an **implementer subagent** completes, merge its work to the integration branch with a **merger subagent**.

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

7. **Whole-delivery review — required before reporting completion.** Once all tickets are implemented:
   - Run the project's full automated checks on the integrated result, reporting baseline failures and unverified checks separately.
   - Call the Skill tool with `code-review` against the recorded starting commit, covering **all tickets together**, their tests and delivery documentation. Per-ticket reviews do not replace this review.
   - Ask the reviewers to trace affected workflows through all relevant callers, including pre-existing renderers or handlers newly reached by the changes. Where affected, check alternate entry points, interrupted initialization, delayed/failed reads and preservation of unsaved input.
   - Fix confirmed findings in a single fresh **implementer subagent**, adding caller-visible regressions for behavior fixes. Re-run the applicable automated checks and obtain an independent re-review of the amendments. Repeat until no confirmed findings remain unresolved.
   - Proceed only when the final integrated result has passed review and required checks. Otherwise report **blocked** or **verification incomplete**, with the outstanding items, rather than declaring the delivery finished.

8. If a draft PR exists, mark it ready for review. Otherwise, resolve each ticket the way the issue tracker closes work, and report the integration branch. Include the reviewed base and final commit, findings resolved/outstanding, exact check results and deferred manual acceptance. Distinguish implementation/review completion from human acceptance; passing this review does not authorize a merge, push or release.

9. Clean up all **implementer subagent** worktrees.
