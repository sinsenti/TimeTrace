# Domain docs

## Layout and reading rules

This is a single-context repository:
- `GLOSSARY.md` at the repository root defines domain vocabulary.
- `docs/adr/` holds architecture decision records.

Before exploring the codebase, read the glossary and ADRs relevant
to the area being explored.

If these files do not exist, proceed silently without suggesting
their creation upfront. `/domain-modeling` creates them lazily when
terms or decisions are resolved.

Existing owner decisions in `CLAUDE.md` and the documents identified
by `AGENTS.md` remain authoritative; this setup does not replace them.

## Vocabulary

Use glossary terms in issue titles, proposals, hypotheses, and test
names. Respect explicitly avoided synonyms.

If a needed concept is missing, reconsider whether it belongs to the
domain; note genuine vocabulary gaps for `/domain-modeling`.

## Decision conflicts

Surface contradictions with an existing ADR explicitly, naming its
identifier and explaining why reopening it may be warranted.
Do not silently override a recorded decision.
