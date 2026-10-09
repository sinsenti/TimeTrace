---
name: karpathy-guidelines
description: Behavioral guardrails against LLM overbuilding in TimeTrace. Use when writing, refactoring, or reviewing Python/JS in this repo — especially when tempted to add a dependency, a new abstraction layer, or "while I was in there" changes. Keeps work surgical, keeps the stack local-first (SQLite/FastAPI/vanilla JS), and forces a verifiable done-condition.
---

# Karpathy Guidelines (TimeTrace)

Derived from [Andrej Karpathy's notes on LLM coding pitfalls](https://x.com/karpathy/status/2015883857489522876), rewritten around this repo's real failure modes.

Biases toward caution over speed. For a one-line copy fix, use judgment.

## 1. Think before coding

- State assumptions explicitly. If two readings of the request exist, name both — don't silently pick.
- If a simpler approach exists, say so before writing the complex one.
- If something is unclear, stop and name the confusion. `grill-me` exists for exactly this.

Repo-specific things to check before assuming:
- **Does this belong in a service or a router?** Routers are thin; business logic goes in `services/`. If you're writing an `if` in a router, you're in the wrong file.
- **Does this need a migration?** Any edit to `src/timetrace/db/models.py` needs a matching Alembic revision in `src/timetrace/db/migrations/versions/`. No exceptions — `run_migrations()` runs on every daemon boot and will drift otherwise.
- **Is this already on the roadmap as *not yet built*?** CLAUDE.md's roadmap table (RRULE projection, PowerSync, Tauri, job queues, AI drafts) is stated intent, not existing architecture. Never write code that imports or assumes it.

## 2. Simplicity first — and stay local-first

Minimum code that solves the problem. Nothing speculative.

Hard "no" list unless the user explicitly asks for it:
- **No new runtime dependencies.** The dep list is nine packages. Adding one is a decision, not an implementation detail. Propose it, don't just add it.
- **No Postgres, Redis, Celery/SAQ/Arq, Docker, or any network service.** This is one FastAPI process on port 8002 and one SQLite file at `~/.timetrace/timetrace.db`.
- **No frontend framework, bundler, or build step.** Plain JS files under `interfaces/api/static/js/`, one per feature area, all going through `api_client.js`.
- **No abstract base classes, registries, or plugin systems** for a single-user app with one implementation of everything.
- **No `try/except: pass` for scenarios that cannot happen.** The codebase already has too many bare `except Exception: pass` blocks; don't add more.

If you wrote 200 lines and 50 would do, rewrite it. Ask: "would a senior engineer call this overcomplicated for a single-user local app?"

## 3. Surgical changes

- Don't "improve" adjacent code, comments, or formatting you weren't asked to touch.
- Match the file's existing style even where you'd do it differently. `task_service.py` and `analytics.py` have different flavors — follow the one you're in.
- Notice unrelated dead code (e.g. `core/inline_parser.py`, `interfaces/api/main.py`)? Mention it. Don't delete it.
- Clean up only orphans **your** change created (now-unused imports, now-dead helpers).
- No emoji in UI copy or code unless the file already uses them.

The test: every changed line traces directly to the request.

## 4. Goal-driven execution — state how you'll verify

This repo has an existing pytest suite with isolated fixtures (see `tests/conftest.py` and the
`tdd-guide` skill). Behavior changes should add a focused regression test; run the relevant tests
and full suite. Verification also means concrete mechanical and manual checks where applicable:

| Change | Verification |
|---|---|
| Any Python | `uv run ruff check .`; use scoped `--fix` only on changed files |
| Model change | New Alembic revision applied to an isolated DB copy via `TIMETRACE_DB_FILE` |
| New/changed endpoint | Start an isolated scratch daemon using `docs/development.md`; curl `/health` and the endpoint on its non-8002 port |
| Service logic | A focused pytest test driving `Service(db)` against the in-memory `db` fixture |
| Frontend JS | Load the page, exercise the interaction, check the browser console for errors |

For multi-step work, state the plan up front:

```
1. Add `timezone` to Session model  -> verify: ruff clean
2. Alembic revision + apply to DB copy -> verify: `alembic upgrade head` succeeds, schema shows column
3. Surface in SessionService          -> verify: curl GET /sessions returns the field
```

"Make it work" is a weak criterion and forces a round-trip. "Response includes `timezone` and `/health` still returns ok" is a strong one.
