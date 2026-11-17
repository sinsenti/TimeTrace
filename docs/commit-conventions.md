# Commit conventions

Use this convention for new commits; leave existing history unchanged. This is a documented
agreement, with no commit hooks or automated enforcement.

## Subject

```text
type(scope): summary [feature/ticket]
```

Use a lowercase type and scope, followed by a concise imperative summary (for example, “add” or
“preserve”). The scope names the affected area, not the ticket. Omit the bracketed reference when
there is no associated ticket.

| Type | Use for |
| --- | --- |
| `feat` | New application behavior |
| `fix` | Corrections to broken behavior |
| `refactor` | Code restructuring without behavior changes |
| `docs` | Documentation and agent instruction changes |
| `test` | Test additions or changes without production changes |
| `chore` | Tooling, dependencies, and skill/workflow maintenance |

Use stable scopes such as `tasks`, `calendar`, `ai`, `skills`, or `agents`. Skill additions and
workflow changes use `chore(skills)`; documentation-only clarifications to existing skills use
`docs(skills)`. Shared agent guidance uses `docs(agents)`.

```text
chore(skills): add research workflow
docs(skills): clarify research completion criteria
docs(agents): clarify approval requirements
refactor(ai): centralize read context [module-deepening/04]
fix(tasks): preserve links after refresh [module-deepening/06]
```

## Tickets and subtickets

Follow the [GitHub issue tracker](agents/issue-tracker.md) for ticket identities. GitHub issue
numbers are repository-wide; use the real issue number, for example `[#54]`, when a commit belongs
to an issue. Historical `[module-deepening/04]` references retain their original local meaning;
use the migration mapping to find their GitHub successors rather than interpreting `04` as issue #4.

A ticket may have several focused commits using the same reference. A bracketed reference records
association, not completion; use closing keywords only when the issue is actually resolved.

## Commit boundaries and body

Keep each commit focused on one logical change. Include its tests and necessary documentation;
keep unrelated skill maintenance separate from application changes. Commit only intended files,
preserving unrelated working-tree changes.

An optional body explains why the change was needed, important constraints, and verification.
If one inseparable change covers multiple tickets, list their feature-qualified references in the
body rather than obscuring the subject with a long list.

For example, commits can be found with:

```bash
git log --oneline --grep='chore(skills):' --fixed-strings
git log --oneline --grep='module-deepening/04' --fixed-strings
```
