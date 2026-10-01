---
name: api-design-reviewer
description: Review new or changed TimeTrace HTTP endpoints for consistency with the existing JSON API - route prefixes, path/query conventions, status codes, response shapes, UUID path params, and the api_client.js consumer contract. Use when a diff adds or changes a route in interfaces/api/routers/, or when auditing the API surface.
---

# API Design Reviewer (TimeTrace)

This is a **private API with exactly one consumer set**: the browser JS in `static/js/` and the Typer CLI in `interfaces/cli/commands.py`. Both ship in this repo. That changes the calculus:

- **No versioning.** There are no external clients to break. Change the shape and update both callers in the same commit. Never add `/v1/`.
- **No auth, no rate limiting, no HATEOAS, no idempotency keys.** Localhost, one user, one process. Proposing these is noise.
- **Breaking change = "did you update the callers?"** Grep `static/js/` and `interfaces/cli/commands.py` for every path you touched.

What actually matters is internal consistency, because inconsistency is what makes this API hard to work with.

## The prefix situation — know it before you add a route

Routers are mounted in `interfaces/api/routers/__init__.py` with these prefixes:

| Router | Prefix | Resulting paths |
|---|---|---|
| `tasks` | `/api/tasks` | `/api/tasks`, `/api/tasks/{task_id}/stats`, `/api/tasks/statuses` |
| `task_reviews` | `/api/task-reviews` | `/api/task-reviews` |
| `sessions` | `""` | `/sessions`, `/sessions/{session_id}`, `/sessions/retro` |
| `timer` | `/timer` | `/timer/status`, `/timer/start`, `/timer/stop`, `/timer/split` |
| `idle` | `/idle` | `/idle/toggle`, `/idle/resolve` |
| `habits` | `/habits` | `/habits`, `/habits/{habit_id}/log` |
| `revision` | `/revision` | `/revision/day-history`, `/revision/day-review` |
| `ratings` | none | `/rating-definitions`, `/rating-entries` |
| `analytics` | none | `/analytics/summary`, `/analytics/detailed`, `/markdown/export`, **`/api/agenda/export`** |

Only `tasks` and `task-reviews` carry `/api`; `/api/agenda/export` carries it by hand on an unprefixed router. **This is inconsistent and it is the status quo.** So:

- Adding a route to an existing router: follow that router's prefix. Don't fix the world in a feature diff.
- Adding a new router: state which convention you picked and why, in the PR description. Defaulting to the domain's own prefix (`/foo`) matches the majority.
- Proposing to unify everything under `/api`: that's a separate, deliberate change that touches every JS file and the CLI. Raise it; don't smuggle it.

Kebab-case for multi-word segments (`/task-reviews`, `/rating-definitions`, `/day-history`) — that part **is** consistent, follow it.

## Review checklist

**Route shape**
- [ ] Nouns, not verbs, for resources. Verb-ish action routes on the timer (`/timer/start`, `/timer/stop`, `/timer/split`, `/idle/resolve`) are the accepted exception — the timer is a state machine, not a collection.
- [ ] Static segments declared **before** dynamic ones in the same router. `tasks.py` groups them explicitly under numbered comment banners. `/statuses` after `/{task_id}` would be captured as a task id.
- [ ] Path params are `str` (UUIDv7). **`task_id: int` is always a bug.**
- [ ] Collection routes use `""`, not `"/"` — the routers use `@router.post("")` with a prefix.

**Query params**
- [ ] Reserved-word collisions get an alias, matching `tasks.py`: `status_filter: str | None = Query(None, alias="status")`.
- [ ] Filters are optional with sane defaults; `"all"` is the existing "no filter" sentinel for `status`/`category`.
- [ ] Dates in query strings are `YYYY-MM-DD` strings (`assigned_date`, `due_before`, `start_date`, `end_date`).

**Status codes**
- [ ] `201` on create, with `status_code=status.HTTP_201_CREATED`.
- [ ] `204` on delete, with the handler `return None`. `api_client.js` short-circuits 204 to `null` — returning a body with 204 is a silent contract break.
- [ ] Errors come from raising domain exceptions in the service (`EntityNotFoundError` → 404, `TimerError`/`ValidationError` → 400). No `HTTPException` in a router or service.
- [ ] Error body is `{"detail": "..."}` — that's what `api_client.js` reads to build its thrown `Error`.

**Response shape**
- [ ] `response_model=` set where the return is a model or list of models.
- [ ] Datetimes serialized through `ensure_utc(...).isoformat()`, so the client always receives an offset-aware ISO string.
- [ ] Bulk/action endpoints returning an ad-hoc dict follow the existing shape: `{"status": "success", "deleted_count": n}`.
- [ ] Non-JSON responses declare it (`response_class=PlainTextResponse` for `/markdown/export`, explicit `media_type` + `Content-Disposition` for `/api/agenda/export`).
- [ ] No pagination. The dataset is one person's data and no existing endpoint paginates; adding it to one endpoint alone makes the API less consistent, not more.

**Consumer contract**
- [ ] Every path added or changed is reflected in `static/js/` (via `api_client.js`) and, if applicable, the CLI.
- [ ] JS builds URLs with the id interpolated as a **quoted string**; no `parseInt` anywhere near it.
- [ ] Request bodies are declared as Pydantic schemas in `interfaces/api/schemas.py`, not read off `Request` — the two existing raw-body endpoints (`/markdown/import`, which takes text/plain) are the deliberate exception.

**Docs**
- [ ] The router has a `tags=[...]` label, so it groups correctly in `/docs`.
- [ ] Non-obvious query params have `Query(..., description=...)`, as `/api/agenda/export` does.

## Output

```
API REVIEW: <routes touched>

Consistency
  <finding>  path — what breaks the house convention, and which existing route sets it>

Contract
  <finding>  caller in static/js/foo.js:NN still hits the old path / shape>

Verdict: CONSISTENT | FIX BEFORE MERGE
```

Verify by hand, not by assertion: boot the daemon, `curl` each route, and read `http://127.0.0.1:8002/docs`. Paste the real responses. Do not sign off an API review on prose alone.
