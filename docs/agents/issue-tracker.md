# Issue tracker: Local Markdown

Issues live as Markdown files in `.scratch/`.
Feature specs remain in `specs/<feature>.md` and require explicit owner
approval before implementation; follow `specs/README.md`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- One implementation ticket per file:
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`.
  Never combine all tickets into one file.
- Link tickets to the relevant spec in `specs/`.
- Record triage state in a `Status:` line near the top of each issue;
  use the role strings in `docs/agents/triage-labels.md`.
- Append comments and conversation history under `## Comments`.

## Publishing and fetching

When a skill says “publish to the issue tracker,” create the appropriate
ticket file under `.scratch/<feature-slug>/issues/`.
Publishing a spec means writing it to `specs/<feature>.md`; publication
does not imply owner approval.

When a skill says “fetch the relevant ticket,” read the referenced file.
Resolve a bare issue number within the specified feature directory;
ask for the feature or path if ambiguous.

## Wayfinding operations

Used by `/wayfinder`; these exploration tickets use lifecycle states
rather than triage roles.

- Map: `.scratch/<effort>/map.md`, containing Notes / Decisions-so-far / Fog.
- Child: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`,
  with the question in the body.
- Type: `research`, `prototype`, `grilling`, or `task` in a `Type:` line.
- State: `open`, `claimed`, or `resolved` in a `Status:` line.
- Blocking: `Blocked by: NN, NN`; unblocked when all listed tickets
  are resolved.
- Frontier: choose the lowest-numbered open, unblocked, unclaimed ticket.
- Claim: save `Status: claimed` before starting work.
- Resolve: append `## Answer`, set `Status: resolved`, and add a gist
  plus link to Decisions-so-far in the map.
