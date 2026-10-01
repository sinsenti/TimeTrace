---
name: senior-backend
description: Backend implementation patterns for TimeTrace - adding or changing an endpoint, a service method, a model, or CLI command across the FastAPI/SQLModel/SQLite stack. Use when asked to build a backend feature, wire a new route, add a service, or figure out where a piece of logic belongs.
---

# Senior Backend (TimeTrace)

One FastAPI process on `127.0.0.1:8002`, one SQLite file at `~/.timetrace/timetrace.db`, no auth, no network services, single user. Design for that, not for a SaaS.

**Request flow:** CLI or browser JS → HTTP → router (`interfaces/api/routers/`) → `Service(db)` (`services/`) → SQLModel (`db/models.py`) → SQLite.

## Where does this code go?

| It... | Goes in |
|---|---|
| parses a request, picks a status code, names a route | `interfaces/api/routers/<domain>.py` |
| queries or writes the DB, enforces a rule, coordinates entities | `services/<domain>_service.py` |
| is pure computation over plain dicts/values | `core/` (no FastAPI import, no DB import) |
| defines a request/response body | `interfaces/api/schemas.py` |
| defines a table | `db/models.py` **plus a migration** |
| is a terminal command | `interfaces/cli/commands.py` (talks to the daemon over HTTP, not to the DB) |

If you can't decide between service and core: does it need `self.db`? Service. Otherwise core, and the service calls it. `AnalyticsService` → `core/analytics.py` is the model to copy.

## Adding an endpoint end to end

1. **Schema** — add `FooCreate` / `FooUpdate` to `schemas.py`. `Update` models have all-optional fields and are applied with `model_dump(exclude_unset=True)`.
2. **Service method** — on the existing domain service. Signature takes plain values and schema objects, returns models or dicts. Raise `EntityNotFoundError` / `ValidationError`, never `HTTPException`.
3. **Route** — thin:

```python
@router.put("/{foo_id}", response_model=Foo)
def update_foo(foo_id: str, req: FooUpdate, db: DBSession = Depends(get_session)):
    return FooService(db).update_foo(foo_id, req)
```

4. **Ordering** — static paths before dynamic ones in the same router. `tasks.py` is explicit about this: `/statuses` and `/completed` are declared above `/{task_id}`, otherwise `"statuses"` gets captured as a task id.
5. **Register** — if it's a new router, import and `include_router` it in `routers/__init__.py`.
6. **Client** — call it from `static/js/*.js` via `api.get/post/put/del`, never raw `fetch`.
7. **Verify** — `uv run ruff check --fix .`, boot `uv run timetrace daemon`, `curl` the endpoint, paste the real response.

## Service conventions

```python
class FooService:
    def __init__(self, db: Session):
        self.db = db

    def get_foo(self, foo_id: str) -> Foo:
        foo = self.db.get(Foo, foo_id)
        if not foo:
            raise EntityNotFoundError("Foo", foo_id)
        return foo
```

- `self.db.get(Model, id)` for by-id; `self.db.exec(select(Model).where(...))` otherwise. `.all()` returns a list, `.first()` returns one or `None`.
- Write path: `self.db.add(obj)` → `self.db.commit()` → `self.db.refresh(obj)`.
- Commit **once** per logical operation. Committing inside a loop (as `import_markdown` does) means a mid-loop failure leaves a half-written state.
- Export new services from `services/__init__.py`.

## Ids

UUIDv7 strings everywhere. New model:

```python
id: str = Field(default_factory=generate_uuid7, primary_key=True)
```

Path params are `foo_id: str`. Never `int`. Never `parseInt` on the JS side. `RatingEntry.target_id` is a polymorphic string keyed by `target_type` with no FK — set both, and remember nothing cascades to it.

## Datetimes

The DB column holds **naive UTC**. The boundary rule:

```python
# writing
db_obj.due_date = ensure_utc(value).replace(tzinfo=None) if value else None

# reading, before comparing to now() or serializing
obj.created_at = ensure_utc(obj.created_at)
```

`ensure_utc` lives in `interfaces/api/utils.py`. Use `datetime.now(UTC)`, never `utcnow()`. Date-only values (`assigned_date`, `date_str`) stay `YYYY-MM-DD` strings.

## Errors

| Raise | Handler maps to |
|---|---|
| `EntityNotFoundError(entity, id)` | 404 |
| `TimerError(msg)` | 400 |
| `ValidationError(msg)` | 400 |

All three are in `core/exceptions.py`; handlers are registered in `create_daemon_app()` in `main.py`. Response body is `{"detail": "..."}`, which `api_client.js` reads and surfaces. FastAPI's own request-validation failures return 422 with a logged request body.

`interfaces/api/main.py` is a second, unused `FastAPI()` with none of these handlers. Ignore it.

## The timer is not a DB row

The running timer lives in `~/.timetrace/active_timer.json` via the module-level `timer_manager` singleton (`core/timer.py`). A `Session` row is only written when the timer stops or splits (`TimerService`). Anything touching timing must go through `timer_manager`, and must tolerate the background idle loop retroactively freezing it (`freeze_for_idle`) every 10 seconds.

## Model changes

Any edit to `db/models.py` needs a migration, same commit:

```bash
uv run timetrace db revision -m "add foo column"   # autogenerate, then read and fix it
uv run timetrace db migrate                        # apply
```

Autogenerate misses plenty on SQLite — always read the generated file. Type changes and PK changes need a table rebuild; see the `database-designer` skill.

## Things this project deliberately does not have

Don't propose them without asking: connection pooling (single file, single process), rate limiting (localhost, one user), JWT/OAuth/RBAC (no auth at all), Redis or a job queue, Postgres, Docker, read replicas, pagination on list endpoints (dataset is one person's task list), API versioning. The AGENTS.md roadmap describes some of these as *future intent* — that is not permission to build them now.
