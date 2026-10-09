# Plan: replace session pre-generation with an RRULE projection engine

Author: tt-architect. Date: 2026-09-01. Target branch: `feat/recurrence-engine` off `dev`.
Alembic head verified as `0005_habit_goal_history`; this plan's migration is `0006_recurrence_rrule`.

---

## 0. The change, in one paragraph

A recurring task stops owning ~90 pre-generated `session` rows. Instead it stores one RFC 5545
`RRULE` string plus an explicit `DTSTART`, per-occurrence duration, and IANA timezone. A new pure
module `core/recurrence.py` expands that rule to occurrence instants **in local wall-clock time**
for whatever UTC window is asked for, and a new `RecurrenceService` merges those projected
occurrences with real `session` rows and a new `recurrenceexception` table. Projected occurrences
are returned by `GET /sessions?start&end` alongside real rows, carrying a synthetic id
(`virt:<task_id>:<YYYYMMDDTHHMMSSZ>`) and `is_virtual: true`. The moment anything real happens to
one — drag, resize, edit, delete, notes — `SessionService` materializes it: a real `session` row is
inserted and an exception row records that this occurrence is now overridden, so it never projects
again. Nothing regenerates on task edit, so a moved or deleted occurrence is permanent.

---

## 1. Ground truth: what the code and the live DB actually say

Read: `services/task_service.py`, `services/session_service.py`, `services/timer_service.py`,
`services/revision_service.py`, `services/query_service.py`, `db/models.py`,
`interfaces/api/routers/sessions.py`, `interfaces/api/schemas.py`,
`static/js/calendar.js`, `static/js/dashboard.js`, `static/js/utils.js`,
`static/js/session_modal.js`, `static/js/task_modal.js`, `static/js/subtasks.js`,
`templates/components/task_modal.html`, `templates/components/confirm_modal.html`,
`templates/task_detail.html`, `tests/test_tasks_api.py`. Live DB queried read-only.

### 1.1 What a user can express today

`Task.is_recurring: bool` + `Task.recurrence_rule: str | None = Field(default="daily")`
(`db/models.py:47-48`). The vocabulary is a 4-value picker, identical in both UIs
(`templates/components/task_modal.html:98-103`, `templates/task_detail.html:160-165`):
`daily` | `weekdays` | `weekly` | `monthly`. `schedule_recurrent_sessions_three_months`
(`task_service.py:211-266`) also accepts them, plus falls through to daily for anything unknown.
No interval, no weekday mask, no end date, no count, no per-occurrence duration.

The anchor is not stored: `schedule_recurrent_sessions_three_months` derives it from
`task.assigned_date` (a `YYYY-MM-DD` string, given a hardcoded `T09:00:00` if timeless, and parsed
as **UTC** by `ensure_utc`, not local) and otherwise from `task.created_at`. Duration per occurrence
is derived, not stored: `30 if estimated_minutes > 120 else estimated_minutes`
(`task_service.py:196-197`, `227-228`).

### 1.2 Corrections to the roadmap's / the brief's assumptions

Flag these to the owner; three of them change the design.

1. **The failure mode is resurrection, not destruction.** `schedule_recurrent_sessions_three_months`
   dedups by exact `start_time` equality (`task_service.py:235-239`) and only ever *inserts*. So a
   moved occurrence is not deleted — a **duplicate is recreated at the original slot**, and a
   *deleted* occurrence is silently **recreated**. The brief's "silently destroyed" is wrong;
   the coordinator's framing ("silently resurrected") is right. This matters because it means the
   old code never had delete authority, so the migration inherits no half-deleted state.
2. **The loop is worse than "on every task update".** `static/js/calendar.js:116-123`: dragging or
   resizing *any* session belonging to a task also `PUT /api/tasks/{id} {estimated_minutes}`. For a
   recurring task that is an `is_recurring` update, which re-runs the generator in the same
   user gesture. Dragging one occurrence therefore (a) resurrects the original slot and (b) rewrites
   the whole series' duration. Both must be fixed in this work.
3. **`is_recurring` is unambiguously authoritative; `recurrence_rule` is default leakage, not a
   sync problem.** Live DB: `(is_recurring=0, rule='daily') x 39` and `(is_recurring=1,
   rule='weekdays') x 1`. All 39 hold exactly the model default at `db/models.py:48`, and
   `static/js/task_modal.js:248` / `subtasks.js:306` send `recurrence_rule: 'daily'`
   unconditionally regardless of the checkbox. There is nothing to interpret and no owner decision
   needed: only `is_recurring = 1` rows convert. As a bonus fix, this plan flips the column default
   to `None` and NULLs it where `is_recurring = 0`.
4. **There is no flag distinguishing pre-generated rows from user-created ones.** `session` columns
   are exactly `id, task_id, start_time, end_time, duration_seconds, tags, notes, review_skipped,
   timezone, external_sync_id, external_provider, extended_properties_json`. The only signal is the
   notes fingerprint `notes LIKE 'Recurring: %'`, written at `task_service.py:248` and nowhere else
   in the codebase (verified by grep). This is the migration's only lever, and it is defeated the
   instant a user edits the notes. Stated as a limitation, mitigated in §7.
5. **The live DB has zero future sessions** (`SELECT COUNT(*) FROM session WHERE start_time >
   datetime('now')` = 0, out of 175 rows spanning 2026-08-10..2026-08-31). The single recurring
   task `01a02108-eb92-74ac-aa82-83fb19a270b3` "write week description" (`weekdays`,
   `assigned_date` NULL, `created_at` `2026-08-17 12:29:01.544567`) has 6 rows with
   `notes='Recurring: write week description'`, all in the past, all `900s` at
   `12:29:01.544567` local-of-UTC — visibly the generator's `created_at` time-of-day leaking into
   the schedule. So the migration's data step is a near no-op here. It must still be written
   defensively for other databases (§7).
6. **`SessionService.delete_session` already has `scope` — and two of its three branches destroy
   logged history.** `session_service.py:111-134`: `scope="all"` deletes *every* session for the
   task including past logged work; `scope="following"` deletes everything with
   `start_time >= selected.start_time`, so picking a past occurrence wipes logged rows after it.
   Reachable from the UI today (`templates/components/confirm_modal.html:27-33`,
   `static/js/utils.js:323`). This plan fixes it (§8) — call that out in the PR, it is a live
   data-loss bug independent of recurrence.
7. **The timer never links to a scheduled session.** `TimerService.stop_timer` always inserts a
   fresh row (`timer_service.py:97-104`). So "a timer runs against an occurrence" is not an existing
   flow and is deliberately *not* a materialization trigger in slice 1 (D12).
8. **Already-elapsed placeholders are counted as real logged work — an active corruption, not a
   future risk.** The generator writes a real `end_time` and `duration_seconds`
   (`task_service.py:242-250`), and `sum_durations_for_tasks` defines "logged" as
   `end_time <= now` (`session_service.py:176-197`). A placeholder that merely *elapsed* is
   therefore indistinguishable from performed work. The live DB's one recurring task reports
   ~1.67h logged and **667% progress** against a 15-minute estimate, from 6 placeholder rows plus
   one genuine 10-minute session. `progress_pct` is only suppressed for recurring tasks by the
   `is_unbounded` flag; the seconds themselves still flow into every ALL_TIME analytics widget.
   Removing pre-generation stops this getting worse but does **not** clean up existing rows — §7.5.
9. **Two anchoring schemes already doubled the live series.** The generator anchors on
   `created_at`'s time-of-day, while `handle_task_recurrence` (`task_service.py:418-437`)
   re-anchors on `assigned_date` at a hardcoded `09:00`. Dedupe is exact `start_time` equality, so
   the two schedules never collide and the first completion roughly doubles the task's future rows.
   The new design eliminates this by construction: exactly one `recurrence_dtstart`, never
   recomputed (§3.6), and completion creates nothing (§3.8 / Q1).

---

## 2. Decisions

| # | Decision | One-line reason |
|---|---|---|
| D1 | Authoritative recurrence = new `task.recurrence_rrule` (RRULE body, no `RRULE:` prefix). `recurrence_rule` is demoted to a **UI preset label only** (`daily`/`weekdays`/`weekly`/`monthly`/`custom`), never parsed for scheduling. | Keeps both existing frontends working with zero template changes while the engine reads a real RRULE; `'daily'` is not a valid RRULE so rewriting the column in place would leave 39 rows holding a value that fails to parse. |
| D2 | New columns `recurrence_dtstart` (naive UTC), `recurrence_duration_minutes`, `recurrence_timezone` (IANA). | The anchor and duration are currently *derived* from `created_at`/`estimated_minutes`, which is exactly why the live series fires at `12:29:01.544567`. |
| D3 | Expansion happens in **local wall-clock** in `recurrence_timezone`, then converts each occurrence to naive UTC. | Project rule is local-calendar bucketing; verified experimentally that this keeps a 09:00-local weekly rule at 09:00 local across a DST boundary (UTC instant shifts, wall clock does not). |
| D4 | `UNTIL` is stored **naive local**, never `Z`-suffixed. | Verified: `dateutil.rrule.rrulestr` raises `ValueError: RRULE UNTIL values must be specified in UTC when DTSTART is timezone-aware` for a `Z` UNTIL against our naive-local DTSTART. |
| D5 | Add dependency `python-dateutil>=2.9.0`. | `dateutil.rrule.rrulestr` round-trips everything we store (verified for `FREQ`/`INTERVAL`/`BYDAY`/`COUNT`/naive `UNTIL`/`RRULE:` prefix/embedded `DTSTART:`); hand-rolling `BYDAY`+`INTERVAL`+`UNTIL` is exactly the wrong thing to hand-roll. Pure Python, one transitive dep (`six`). |
| D6 | Exception identity = `(task_id, occurrence_start)` where `occurrence_start` is the **original projected instant as naive UTC** — RFC 5545 `RECURRENCE-ID`. | It is the only key a virtual occurrence has; anything derived from the session row would not exist yet. |
| D7 | **Projection is future-only**: `project_range` clamps its lower bound to `max(window_start, now)`. | A past occurrence with no session row means "it didn't happen"; emitting it would double-render every past day that already has a real logged row (the live DB has 6 such rows). Also removes any need for the migration to back-link history. |
| D8 | Virtual occurrence id = `virt:<task_id>:<YYYYMMDDTHHMMSSZ>`, and `SessionService.get/update/delete` accept it transparently. | Every frontend mutation path already funnels through `/sessions/{id}` PUT/DELETE, so drag, resize, click-edit and delete keep working with near-zero JS change. |
| D9 | Only `GET /sessions?start&end` (both bounds present) and `TimerService.get_status`'s next-session lookup see virtuals. Analytics, day review, exports and task stats stay real-rows-only. | Those are all "what actually happened" surfaces; the logged-vs-scheduled split shipped 2026-08-24 already draws this line. |
| D10 | Slice 1 supports edit scope `only_this` only; `following`/`all` are delete-only. | "This and following" *edits* require splitting one Task into two (tags, subtasks, stats, ratings all follow) — a separate slice, not a line of code. |
| D11 | `recurrence_dtstart` is written **once**, at first activation, and never recomputed by any later update — including completion. Completion resets status only. | The live series already doubled because two independent anchors (`created_at` time-of-day and `assigned_date`+09:00) both generated rows; one immutable anchor makes that unrepresentable. |
| D12 | Starting a timer does **not** materialize an occurrence in slice 1, and `TimerStartRequest` gains no `session_id`. | Today working a scheduled occurrence produces two counted rows (placeholder + timer row); making the occurrence virtual already removes one of them, so the double-count is fixed by construction without touching the timer. |
| D13 | The migration never deletes a **past** session row under any condition. Cleanup of already-elapsed placeholders is a separate, opt-in, explicitly-confirmed CLI command (§7.5), not part of boot-time `upgrade()`. | A past `Recurring: …` row is genuinely ambiguous between "placeholder that elapsed" and "I planned it and then did it"; that ambiguity must be resolved by a human, and `run_migrations()` runs unattended on every daemon boot. |

---

## 3. Files to touch, in dependency order

### 3.1 `pyproject.toml`
Add `"python-dateutil>=2.9.0"` to `[project].dependencies`. Run `uv sync` (regenerates `uv.lock`;
`six` appears as a transitive dep). No ruff config change.

### 3.2 `src/timetrace/core/timezones.py` — NEW (pure, no DB/FastAPI)

Extraction of the private `_daemon_timezone_name()` at `services/query_service.py:48-65`, which
projection also needs. Move, don't copy.

```python
DEFAULT_TZ_NAME = "UTC"

def daemon_timezone_name() -> str: ...        # TZ env -> /etc/localtime symlink -> "UTC"; cached
def daemon_timezone() -> ZoneInfo: ...        # resolved ZoneInfo, falls back to UTC
def resolve_timezone(name: str | None) -> ZoneInfo: ...   # named zone or daemon zone; never raises
def to_local_naive(utc_naive: datetime, tz: ZoneInfo) -> datetime: ...
def from_local_naive(local_naive: datetime, tz: ZoneInfo) -> datetime: ...  # -> naive UTC
def _reset_caches() -> None: ...              # test hook, module-private by convention
```

`from_local_naive` uses `local_naive.replace(tzinfo=tz).astimezone(UTC).replace(tzinfo=None)`.
Document the two DST edge cases in the docstring: a nonexistent local time (spring forward)
resolves with `fold=0`, i.e. the pre-transition offset — verified `2026-03-29 02:30` Europe/Berlin
→ `01:30Z` → renders as `03:30` local; an ambiguous local time (fall back) resolves to the first
(DST) occurrence. Deterministic, documented, not silently wrong.

Then edit `services/query_service.py`: delete `_daemon_timezone_name` and `_daemon_tz_name_cache`,
import `daemon_timezone_name` from `core.timezones`, and have `_resolve_timezone` (line 80) call it.
Behavior must be byte-identical — its warning strings are asserted against nothing today, but the
`/analytics/query` contract depends on the mismatch warning.

### 3.3 `src/timetrace/core/recurrence.py` — NEW (pure, no DB/FastAPI)

Structured like `core/query_spec.py`: frozen dataclasses + module functions, no I/O.

```python
MAX_OCCURRENCES_PER_SERIES = 500        # hard cap per project_series() call
MAX_WINDOW_DAYS = 400                   # enforced by the caller, referenced here for the error text
VIRTUAL_ID_PREFIX = "virt:"
_OCCURRENCE_STAMP_FMT = "%Y%m%dT%H%M%SZ"

PRESET_TO_RRULE = {
    "daily":    "FREQ=DAILY",
    "weekdays": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    "weekly":   "FREQ=WEEKLY",
    "monthly":  "FREQ=MONTHLY",
}

@dataclass(frozen=True)
class RecurrenceSpec:
    rrule: str                  # RRULE body, e.g. "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
    dtstart_utc: datetime       # naive UTC, second precision
    duration_minutes: int
    timezone_name: str

@dataclass(frozen=True)
class Occurrence:
    start_utc: datetime         # naive UTC == the RECURRENCE-ID
    end_utc: datetime           # start + duration
    occurrence_id: str          # "virt:<task_id>:<stamp>"

def preset_to_rrule(preset: str | None) -> str            # unknown/None -> PRESET_TO_RRULE["daily"]
def rrule_to_preset(rrule: str | None) -> str             # exact reverse match, else "custom"
def validate_rrule(rrule: str, dtstart_utc, timezone_name) -> None
def format_occurrence_id(task_id: str, start_utc: datetime) -> str
def parse_occurrence_id(value: str) -> tuple[str, datetime] | None   # (task_id, naive-UTC start)
def is_occurrence_id(value: str) -> bool
def expand(spec: RecurrenceSpec, window_start_utc, window_end_utc, task_id) -> list[Occurrence]
def next_occurrence(spec: RecurrenceSpec, after_utc: datetime, task_id: str) -> Occurrence | None
def set_until(rrule: str, until_local_naive: datetime) -> str   # replaces/inserts UNTIL, drops COUNT
```

`expand` algorithm, exactly:

1. `tz = resolve_timezone(spec.timezone_name)`.
2. `dtstart_local = to_local_naive(spec.dtstart_utc, tz)`.
3. `rule = rrulestr(spec.rrule, dtstart=dtstart_local)` — naive in, naive out. Wrap
   `ValueError`/`TypeError` from dateutil and re-raise as `core.exceptions.ValidationError`
   (`core/` may import `core.exceptions`; that is not a FastAPI/DB dependency).
4. Convert the window: `ws_local = to_local_naive(window_start_utc, tz)`,
   `we_local = to_local_naive(window_end_utc, tz)`.
5. Iterate `rule.xafter(ws_local, inc=True)`, breaking on `occ >= we_local` and on the
   `MAX_OCCURRENCES_PER_SERIES` counter. Do **not** use `rule.between(..., inc=True)` — it is
   inclusive on both ends and would double-emit at window seams between adjacent calendar views.
6. For each occurrence: `start_utc = from_local_naive(occ, tz)`,
   `end_utc = start_utc + timedelta(minutes=spec.duration_minutes)`,
   `occurrence_id = format_occurrence_id(task_id, start_utc)`.

`validate_rrule` rejects, with `ValidationError`:
- anything dateutil cannot parse;
- `FREQ` in `{SECONDLY, MINUTELY, HOURLY}` (a 400-day window would blow the occurrence cap and the
  daemon has no use for sub-daily recurrence);
- a `Z`-suffixed `UNTIL` (per D4 — the stored form is naive local);
- a rule that yields zero occurrences ever;
- `dtstart_utc.microsecond != 0` (ids are second-precision, so a sub-second DTSTART would make
  `format_occurrence_id` lossy and break round-tripping).

`format_occurrence_id` / `parse_occurrence_id` are strict: the stamp must match
`^\d{8}T\d{6}Z$` and the task-id segment must be 36 chars. `parse_occurrence_id` returns `None`
for anything else (including a plain UUID) rather than raising, so callers can use it as a
discriminator. No real UUIDv7 can begin with `virt:`, so the namespaces cannot collide.

### 3.4 `src/timetrace/db/models.py` — SCHEMA CHANGE (migration mandatory)

On `Task`, replacing lines 47-48:

```python
    is_recurring: bool = Field(default=False)
    # UI preset label only ("daily"|"weekdays"|"weekly"|"monthly"|"custom"). NEVER parsed for
    # scheduling -- recurrence_rrule is authoritative. Default was "daily", which leaked onto
    # every non-recurring task in the live DB; now None.
    recurrence_rule: str | None = Field(default=None)
    recurrence_rrule: str | None = Field(default=None)        # RFC 5545 RRULE body, no "RRULE:" prefix
    recurrence_dtstart: datetime | None = Field(default=None)  # naive UTC, second precision
    recurrence_duration_minutes: int | None = Field(default=None)
    recurrence_timezone: str | None = Field(default=None)      # IANA name captured at write time
```

New table (placed after `Session`, before `TaskReview`, so the `session_id` FK target is defined):

```python
class RecurrenceException(SQLModel, table=True):
    """One row per occurrence of a recurring task that deviates from its RRULE.

    `occurrence_start` is RFC 5545's RECURRENCE-ID: the *original* projected instant, naive UTC,
    which stays the identity even after the session row is dragged elsewhere. kind="override"
    always carries session_id (the materialized row); kind="skip" never does.
    """

    __table_args__ = (UniqueConstraint("task_id", "occurrence_start", name="uq_recurrence_exception"),)

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    task_id: str = Field(foreign_key="task.id", index=True)
    occurrence_start: datetime = Field(index=True)     # naive UTC, RECURRENCE-ID
    kind: str                                          # "skip" | "override"
    session_id: str | None = Field(default=None, foreign_key="session.id")
    created_at: datetime = Field(default_factory=utc_now)
```

Only two kinds. "moved", "resized", "renoted" are all just `override` — the deviation lives in the
session row, not in the exception's kind. Table name resolves to `recurrenceexception`, matching
`habitgoalhistory` / `externalsyncstate`.

Note: `Task.subtasks` cascades `all, delete-orphan`, and `Task.sessions` does not — deleting a task
today NULLs its sessions' `task_id` (`task_service.py:534-541`). `TaskService.delete_task` must
also delete that task's `recurrenceexception` rows explicitly (they have no cascade and their FK
would dangle). Same in `delete_completed_tasks`.

### 3.5 `src/timetrace/db/migrations/versions/0006_recurrence_rrule.py` — hand to `tt-migrator`
See §7 for the exact behavior.

### 3.6 `src/timetrace/services/recurrence_service.py` — NEW

```python
class RecurrenceService:
    def __init__(self, db: Session): ...

    # --- spec plumbing -------------------------------------------------------
    def spec_for_task(self, task: Task) -> RecurrenceSpec | None
    def apply_recurrence_fields(self, task: Task, incoming: dict) -> None
    def list_recurring_tasks(self) -> list[Task]

    # --- projection ----------------------------------------------------------
    def project_range(self, start_utc, end_utc) -> list[ProjectedOccurrence]
    def project_task(self, task, start_utc, end_utc) -> list[ProjectedOccurrence]
    def next_upcoming(self, within_days: int = 30) -> ProjectedOccurrence | None

    # --- exceptions / materialization ---------------------------------------
    def resolve_occurrence(self, occurrence_id: str) -> tuple[Task, datetime]
    def materialize(self, occurrence_id: str) -> SessionModel
    def skip(self, task_id: str, occurrence_start: datetime) -> None
    def truncate_series(self, task_id: str, from_occurrence_start: datetime) -> int
    def end_series(self, task_id: str) -> int
    def reconcile_series(self, task_id: str) -> int
    def delete_for_task(self, task_ids: list[str]) -> None
```

Details that matter:

- **`spec_for_task`** returns `None` unless `task.is_recurring` **and** `recurrence_rrule` and
  `recurrence_dtstart` are set. Never falls back to `recurrence_rule`, `created_at` or
  `assigned_date` — a half-populated recurring task simply does not project (fail closed; the old
  code's implicit anchors are what produced the `12:29:01.544567` schedule).
- **`apply_recurrence_fields(task, incoming)`** is the single write-side normalizer, called from
  both `TaskService.create_task` and `update_task`:
  - if `incoming` has `recurrence_rrule`: `validate_rrule` it and set `recurrence_rule =
    rrule_to_preset(...)`;
  - elif `incoming` has `recurrence_rule` (the current frontend's only field):
    `recurrence_rrule = preset_to_rrule(...)`;
  - if `is_recurring` and `recurrence_dtstart` is unset: derive **once, at first activation only**
    from `assigned_date` (interpreted as **local** midnight + 09:00 local, not UTC — fixing the
    `ensure_utc`-on-a-date-string bug at `task_service.py:218-221`) else from `created_at`;
    `.replace(second=0, microsecond=0)`;
  - `recurrence_duration_minutes` defaults to the historical formula
    `30 if (estimated_minutes or 15) > 120 else (estimated_minutes or 15)` so existing series keep
    their length;
  - `recurrence_timezone` defaults to `daemon_timezone_name()`;
  - if `is_recurring` flips **False**: leave the recurrence columns intact (so re-enabling restores
    the series) but call `end_series(task_id)` so nothing projects;
  - **never recompute `recurrence_dtstart` on a later update.** This is the whole point: an
    unrelated edit must not shift the series. Only an explicit `recurrence_dtstart` in the request
    moves it, and doing so calls `reconcile_series` afterwards.
- **`project_range(start_utc, end_utc)`**:
  1. `lower = max(ensure_utc(start_utc), datetime.now(UTC)).replace(tzinfo=None)` (D7). If
     `lower >= end`, return `[]` — a purely-historical viewport costs one comparison.
  2. `list_recurring_tasks()` — `select(Task).where(Task.is_recurring == True, Task.recurrence_rrule.is_not(None))`.
     Filter out tasks whose `status_id`/`status` maps to an `is_completed` TaskStatus (reuse
     `TaskService._status_flags`-equivalent logic; a Done recurring task must stop projecting).
  3. One batched exception fetch for the whole window:
     `select(RecurrenceException).where(task_id.in_(ids), occurrence_start >= lower, occurrence_start < end)`
     → `dict[(task_id, occurrence_start)] = exception`.
  4. For each task: `expand(spec, lower, end, task.id)`; drop any occurrence with an exception
     (either kind — `skip` means gone, `override` means the real row is already in the DB query).
  5. Emit `ProjectedOccurrence` (a dataclass, or a plain dict shaped like `list_sessions`' output —
     see §5).
  Cost: one Task query + one exception query + pure-Python expansion per series. With 1 recurring
  task and a 7-day viewport this is ~5 occurrences. `MAX_WINDOW_DAYS` guards a pathological range.
- **`materialize(occurrence_id)`** — idempotent:
  1. `resolve_occurrence` → parse the id, `db.get(Task, task_id)` (raise `EntityNotFoundError("Task", …)`
     if missing), build the spec (raise `ValidationError` if the task is not recurring).
  2. If an exception already exists at `(task_id, occurrence_start)`:
     `override` → return its session row; `skip` → raise
     `ValidationError("occurrence was cancelled")`.
  3. Verify the instant is genuinely an occurrence: `expand(spec, occurrence_start,
     occurrence_start + 1s, task_id)` non-empty. Otherwise
     `EntityNotFoundError("Occurrence", occurrence_id)` → 404, which is the right answer for a
     stale synthetic id held by a browser tab after the rule changed.
  4. Insert `SessionModel(task_id, start_time=occurrence_start, end_time=start+duration,
     duration_seconds=duration*60, tags=task.tags or "", notes="")`.
     **`notes` is empty, not `f"Recurring: {title}"`** — the calendar already renders the task title
     (`calendar.js:86`), the old string was only ever a fingerprint, and keeping it would mislead
     the migration's own cleanup rule on a future run.
  5. Insert `RecurrenceException(kind="override", session_id=new.id)`. Single `commit()` for both.
     The unique constraint on `(task_id, occurrence_start)` is the concurrency backstop; on
     `IntegrityError`, roll back and re-read (the daemon is single-process but has a background
     idle loop).
- **`reconcile_series(task_id)`** — adoption, **exact match only, no heuristics**: for each real
  future session of the task with no exception link, if its `start_time` is exactly a projected
  occurrence, insert `kind="override"` pointing at it. Otherwise leave it strictly alone as a plain
  unlinked session row. Called after any change to `recurrence_rrule`/`dtstart`/`duration`, and
  once lazily per series on first projection (guarded by a per-request memo so a calendar refetch
  doesn't re-run it 7 times). This is what stops a legacy DB from double-rendering rows the old
  generator left at exact occurrence instants.
- **Orphaned exceptions after a rule edit.** `reconcile_series` also handles the reverse: for each
  exception whose `occurrence_start` is no longer an occurrence of the current rule **and** is in
  the future — `kind="skip"`: delete it (the anchor it cancelled no longer exists);
  `kind="override"`: delete the exception but **keep the session row**. Rationale: the row is real
  user-intent work; it just stops being part of the series. Never touch an exception whose
  `occurrence_start` is in the past.
- **`delete_for_task`** deletes exception rows for the given task ids; called from
  `TaskService.delete_task` / `delete_completed_tasks` before deleting the task.

### 3.7 `src/timetrace/services/session_service.py` — the single merge funnel

- `list_sessions(start=None, end=None, include_virtual=True)` becomes **the** read path. After
  building the real-row list exactly as today, if `start and end and include_virtual`:
  - reject `(end - start) > MAX_WINDOW_DAYS` with `ValidationError`;
  - append `RecurrenceService(self.db).project_range(start, end)`;
  - sort the merged list by `start_time`.
  If either bound is missing, return real rows only — `static/js/session_review.js:7`,
  `stats.js:11/44` and `timer_control.js:20` all call `GET /sessions` unbounded and must not get an
  unbounded projection.
- `get_session_by_id(session_id)`: if `is_occurrence_id(session_id)`, return the projected
  occurrence dict **without materializing** (a GET must not write). Include the parent task under
  `"task"` the way the real branch does.
- `update_session(session_id, req)`: if `is_occurrence_id(session_id)`, first
  `session_id = RecurrenceService(self.db).materialize(session_id).id`, then fall through to the
  existing body unchanged. Materialize-on-write, in one place, for every caller.
- `delete_session(session_id, scope="only_this")` — rewritten, see §8.
- `list_future_sessions` / `sum_durations_for_tasks` / `clear_future_sessions`: **unchanged, real
  rows only.** They back the completion-policy prompt and task stats, which are about committed
  rows. Consequence: a recurring task's completion prompt shows nothing (it already never fires —
  `task_service.py:406` skips recurring tasks entirely).
- New `next_upcoming_occurrence()` → delegates to `RecurrenceService.next_upcoming`, used by
  `TimerService`.

### 3.8 `src/timetrace/services/task_service.py`

- **Delete `schedule_recurrent_sessions_three_months` (lines 211-266) entirely**, and its two call
  sites at 185-186 and **391-392**. Line 391-392 is the bug in the brief.
- **Delete `handle_task_recurrence` (418-437)** and its call site at 386-387. Replace with
  `_reset_recurring_task_status(task)`: when a recurring task is moved to a completed status, reset
  `status`/`status_id` back to the lowest-`position` non-completed `TaskStatus`. It must **not**
  touch `assigned_date` — under the new design that field is no longer the schedule anchor, and
  mutating it did nothing but confuse the Target Day badge. **Owner question Q1 (§10).**
- In `create_task` and `update_task`, call
  `RecurrenceService(self.db).apply_recurrence_fields(db_task, task_dict)` where the generator calls
  used to be. In `update_task`, if any of `recurrence_rrule`/`recurrence_rule`/
  `recurrence_dtstart`/`recurrence_duration_minutes`/`recurrence_timezone` was in the request, call
  `reconcile_series(task.id)` after the commit.
- `delete_task` / `delete_completed_tasks`: call `RecurrenceService.delete_for_task` before deleting.
- `get_task_tree` (588-589): add `recurrence_rrule`, `recurrence_dtstart` (ISO via `ensure_utc`),
  `recurrence_duration_minutes`, `recurrence_timezone`. `subtasks.js:151-158` reads this to prefill
  the inspector.
- `get_task_statistics` (615): leave `is_unbounded = not estimated_minutes or task.is_recurring` as
  is. It stays correct for a different reason now (a recurring task's estimate is per-occurrence,
  not a total), and `scheduled_hours` will simply read 0 for recurring tasks because there are no
  future rows — which is the honest answer. Note it in the PR; do not "clean up" the flag.

### 3.9 `src/timetrace/services/timer_service.py`

`get_status()` lines 28-48 currently pick the next future `session` row. With no pre-generated rows
that silently returns `None` for recurring tasks. Replace the query with
`SessionService(self.db).next_upcoming_occurrence()`, which compares the earliest real future row
against `RecurrenceService.next_upcoming(within_days=30)` and returns whichever is sooner. Keep the
`next_session` response shape byte-identical (`title`, `start_time`, `starts_in_minutes`) —
`static/js/timer_control.js` reads it.

### 3.10 `src/timetrace/services/__init__.py`
Add `from timetrace.services.recurrence_service import RecurrenceService` and the `__all__` entry.

### 3.11 `src/timetrace/interfaces/api/schemas.py`

- `TaskCreate` (41-42) / `TaskUpdate` (61-62): change `recurrence_rule` default to `None`; add
  `recurrence_rrule: str | None = None`, `recurrence_dtstart: datetime | None = None`,
  `recurrence_duration_minutes: int | None = None`, `recurrence_timezone: str | None = None`.
- `TaskTreeResponse` (80-81) and `TaskWithPolicyResponse` (~343-344): add the same four fields.
- New:
  ```python
  class ProjectedOccurrenceRead(BaseModel):
      id: str                  # "virt:<task_id>:<stamp>"
      task_id: str
      start_time: datetime
      end_time: datetime
      duration_seconds: int
      tags: str
      notes: str = ""
      review_skipped: bool = False
      is_virtual: Literal[True] = True
      series_task_id: str
      occurrence_start: datetime
  ```
  Used for documentation/validation of the projected half; `GET /sessions` keeps
  `response_model=list[dict]` (`routers/sessions.py:19`) so adding keys is non-breaking.
- `SessionUpdate`: unchanged.
- New `RecurrenceScope = Literal["only_this", "following", "all"]` for the router's `scope` param,
  replacing the free-string default at `routers/sessions.py:41`.

### 3.12 `src/timetrace/interfaces/api/routers/sessions.py` (stays thin)

- `GET /sessions`: add `include_virtual: bool = Query(True)`; pass through.
- `PUT /sessions/{session_id}`: add `scope: RecurrenceScope = Query("only_this")`, pass to
  `update_session`. The service raises `ValidationError` for `following`/`all` (D10) → 400.
  `response_model=SessionModel` is already correct: a materialized occurrence returns a real row.
- `DELETE /sessions/{session_id}`: retype `scope` to `RecurrenceScope` so a typo 422s instead of
  silently falling into the `else: delete this one` branch at `session_service.py:131`.
- No new endpoints. Deliberate: the whole design's value is that `/sessions/{id}` keeps working.

### 3.13 Frontend

**`static/js/calendar.js`**
- `formatCalEventFromSession` (77-98): when `s.is_virtual`, set
  `extendedProps.isVirtual = true`, `classNames: ['tt-virtual-occurrence']`, and keep
  `editable: true`. The event id is already `String(s.id)` — the synthetic id passes through
  untouched, and there is no `parseInt` anywhere on a session id (verified).
- `handleCalendarEventUpdate` (100-126) — **two required fixes**:
  1. The id changes on materialization. After `api.put`, if `updatedSession.id !== event.id`:
     `event.remove(); calendar.addEvent(formatCalEventFromSession(updatedSession));` and replace the
     virtual entry in `allSessions` (the current `findIndex` at 112 matches on the old id, so do the
     swap in the same block). Without this, the next drag of that event PUTs a synthetic id whose
     occurrence is now skipped → 400.
  2. Lines 116-123 must **not** rewrite the task's `estimated_minutes` when the event belongs to a
     recurring series (`s.is_virtual` or `allTasksMap[taskId].is_recurring`). Resizing one
     occurrence must not resize the series. If the owner wants "resize changes the series", that is
     an explicit `recurrence_duration_minutes` write, not a side effect — **owner question Q2**.

**`static/js/utils.js`**
- `promptDeleteSession` (292-315): the `allSessions.find` lookup already works for a virtual entry,
  and `allTasksMap[s.task_id].is_recurring` is true, so the three-scope modal already appears.
  Only change: in `confirmRecurringDelete` (323), `api.delete('/sessions/' +
  encodeURIComponent(sid) + '?scope=' + scope)`. (`:` is a legal path char, but encoding is free
  and Starlette decodes it.)
- Update the modal copy in `templates/components/confirm_modal.html:27-33` to state what the fixed
  semantics now are: "following" and "all" **never delete already-logged past sessions** (§8).

**`static/js/session_modal.js`**
- `openEditSessionModal` works unchanged (reads from `allSessions`).
- Line 314 (`api.put('/sessions/'+sessionId)`): same id-swap handling as the calendar; the DOM field
  `edit_session_id` must be updated to the returned real id, or a second save 400s.
- `startTimerFromModal` (355-365): unchanged — it starts a timer with the task id, and the timer
  still creates its own row. Materialization from the timer is out of scope (§9).

**`static/css`** (whichever file the dashboard loads; check `templates/dashboard.html`): add
`.tt-virtual-occurrence` — dashed border, ~70% opacity — so a projected occurrence is visibly
"not yet a thing". No emoji, no new icon.

**No template change** is required for the recurrence picker in slice 1: `task_modal.html:98-103`
and `task_detail.html:160-165` keep sending `recurrence_rule`, which `apply_recurrence_fields`
converts. The RRULE builder UI is slice 2.

---

## 4. Schema impact — explicit

`db/models.py` changes (four new `Task` columns, one changed default, one new table), therefore
**an Alembic migration is mandatory**: `0006_recurrence_rrule`, `down_revision =
'0005_habit_goal_history'`. Hand §7 to `tt-migrator`. `run_migrations()` (`db/session.py`) runs
`alembic upgrade head` on every daemon boot and no longer swallows failures, so a model change
without this migration means every real database silently lacks `recurrenceexception` and the first
projection raises `OperationalError: no such table`.

---

## 5. API surface

| Route | Change |
|---|---|
| `GET /sessions?start&end` | Response gains projected occurrences when both bounds are given. Each projected item: `id` = `virt:<task_id>:<stamp>`, `is_virtual: true`, `series_task_id`, `occurrence_start`, and the same `task_id`/`start_time`/`end_time`/`duration_seconds`/`tags`/`notes`/`review_skipped` keys a real row has (so `formatCalEventFromSession` and `sessionMatchesBreakdownFilter` need no new branches). New `include_virtual: bool = true` param. `ValidationError` (400) if the window exceeds `MAX_WINDOW_DAYS`. |
| `GET /sessions` (no bounds) | Unchanged — real rows only. |
| `GET /sessions/{id}` | Accepts a synthetic id; returns the projected shape; does not materialize. 404 if the occurrence no longer exists. |
| `PUT /sessions/{id}` | Accepts a synthetic id; materializes then applies the update; returns the **real** `SessionModel` with a **new UUID id**. New `scope` param, `only_this` only (400 otherwise). |
| `DELETE /sessions/{id}?scope=` | Accepts a synthetic id. Semantics per §8. `scope` is now an enum (422 on a bad value instead of silently deleting one row). |
| `GET /timer/status` | `next_session` now also considers projected occurrences. Shape unchanged. |
| `POST /api/tasks`, `PUT /api/tasks/{id}` | Accept `recurrence_rrule`/`recurrence_dtstart`/`recurrence_duration_minutes`/`recurrence_timezone`; `recurrence_rule` still accepted as a preset. **No longer create or delete any session rows for recurring tasks.** |
| `GET /api/tasks/{id}/tree`, `/stats` | `tree` gains the four fields. `stats` numbers unchanged in shape; `scheduled_hours` for a recurring task now reads 0. |

No new routes. That is the design's main payoff.

---

## 6. Where each read path stands (D9)

| Caller | Sees virtuals? | Why |
|---|---|---|
| `SessionService.list_sessions(start, end)` → calendar | **Yes** | The viewport is the whole point. |
| `SessionService.list_sessions()` unbounded → `session_review.js`, `stats.js`, `timer_control.js` | No | Unbounded projection is meaningless; these are review/logged surfaces. |
| `TimerService.get_status().next_session` | **Yes** | Otherwise "next up" goes blank for recurring tasks. |
| `RevisionService.get_day_summary` / `get_day_history_overview` | No | Day review is about what happened; it already excludes future days. |
| `AnalyticsService` (all three `select(SessionModel)` sites), `QueryService` / `POST /analytics/query` | No | Analytics measures logged time; the 2026-08-24 logged-vs-scheduled split already draws this line. Consequence: recurring work only enters stats once materialized *and* elapsed. **Caveat, see §6.1** — "logged only" is not actually expressible in the query vocabulary, so a *materialized-but-still-future* occurrence is summed by ALL_TIME widgets. This design shrinks that hole from ~90 rows per series to only rows the user deliberately touched; it does not close it. |
| `SessionService.list_future_sessions` / `sum_durations_for_tasks` / `clear_future_sessions` (completion policy, task stats) | No | Committed rows only. |
| `AnalyticsService` markdown agenda/dossier export | No | **Known gap**: the agenda export will stop listing upcoming recurring occurrences. Slice 4, flagged as **Q3**. |

### 6.1 The stats engine cannot say "logged only" — handoff, not in scope

Do not resolve §6 by asserting "SQL only ever sees the past". It does not:
`core/query_spec.py:58-79` has no time-relative `FilterField`, the `sessions` source in
`core/query_compiler.py:303-344` emits no past/future predicate, and `RangePreset.ALL_TIME` emits
no time `WHERE` clause at all. Four seeded Overview widgets are `ALL_TIME`, two of them literally
titled "Total Time Logged".

What this design changes: today ~90 future placeholder rows per recurring series are summed into
those widgets. After this change there are no future placeholder rows, so the only future rows left
are ones the user materialized on purpose (dragged, edited, deleted-then-not). The hole narrows
from "every recurring series inflates every total" to "a session you deliberately scheduled in the
future is counted as logged" — which is the *pre-existing* behavior for every non-recurring
scheduled session and is out of this plan's scope.

**Handoff (do not build here):** a `FilterField.SESSION_TIME_RELATIVE` (`past` / `future` /
`straddling`, compiled to `end_time <= :now` / `start_time > :now`) added to `core/query_spec.py`
+ `core/query_compiler.py`, and applied by default to `sum_duration`/`session_count` on the
`sessions` source. That is a stats-engine change with its own capabilities/UI surface; file it as a
slice-2 item on the statistics track, not on this branch. Flag it in the PR body so it isn't lost.

---

## 7. Migration `0006_recurrence_rrule` — exact behavior (for `tt-migrator`)

`revision = '0006_recurrence_rrule'`, `down_revision = '0005_habit_goal_history'`.
No `sa.func.now()` anywhere (the 0002 lesson: SQLite's `DateTime` binder needs real `datetime`
objects). Compute one `run_ts = datetime.now(UTC).replace(tzinfo=None)` at the top and use it for
every comparison and every `created_at`, so the migration is a single consistent instant.

### upgrade(), in order

1. **Schema.** `op.add_column("task", ...)` × 4: `recurrence_rrule` (`sa.String()`, nullable),
   `recurrence_dtstart` (`sa.DateTime()`, nullable), `recurrence_duration_minutes`
   (`sa.Integer()`, nullable), `recurrence_timezone` (`sa.String()`, nullable). SQLite supports
   plain `ADD COLUMN` for nullable columns — **no batch table rebuild**, unlike `0004`.
2. **Table.** `op.create_table("recurrenceexception", ...)` per §3.4, with
   `sa.UniqueConstraint("task_id", "occurrence_start", name="uq_recurrence_exception")` and indexes
   on `task_id` and `occurrence_start`. FKs to `task.id` and `session.id`.
3. **Convert, `is_recurring = 1` only** (1 row in the live DB). For each such task:
   - `recurrence_rrule` = `{'daily': 'FREQ=DAILY', 'weekdays': 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
     'weekly': 'FREQ=WEEKLY', 'monthly': 'FREQ=MONTHLY'}` keyed on `lower(recurrence_rule)`,
     defaulting to `FREQ=DAILY` for anything else (matching the old code's fall-through at
     `task_service.py:263-264`). Inline this dict as a literal in the migration — do **not** import
     `core.recurrence.PRESET_TO_RRULE`; a migration must not move when application code moves.
   - `recurrence_dtstart` = if `assigned_date` parses as `YYYY-MM-DD`, that date at **09:00 local**
     converted to naive UTC (reproducing the old default hour, but fixing the local/UTC confusion);
     else `created_at`; then `.replace(second=0, microsecond=0)`. For the live row this yields
     `2026-08-17 12:29:00`. **Do not** try to align this with the 6 existing past rows at
     `12:29:01.544567` — per D7 projection is future-only, so past rows never need to match.
   - `recurrence_duration_minutes` = `30 if (estimated_minutes or 15) > 120 else (estimated_minutes or 15)`
     → 15 for the live row.
   - `recurrence_timezone` = `os.environ.get("TZ")` else the `/etc/localtime` symlink tail else
     `"UTC"`. Inline this too (~8 lines); do not import `core.timezones`.
4. **NULL the leaked default.** `UPDATE task SET recurrence_rule = NULL WHERE is_recurring = 0`
   (39 rows in the live DB, every one holding the model default `'daily'`). Purely cosmetic —
   nothing reads the column for scheduling after this change — but it stops the field lying.
5. **Placeholder cleanup — one deterministic DELETE, nothing clever.**
   ```sql
   DELETE FROM session
    WHERE start_time > :run_ts
      AND notes LIKE 'Recurring: %'
      AND review_skipped = 0
      AND task_id IN (SELECT id FROM task WHERE is_recurring = 1)
      AND id NOT IN (SELECT target_id FROM ratingentry WHERE target_type = 'session')
   ```
   Row count in the live DB: **0** (verified: zero future sessions exist at all). Write it anyway
   for other databases and for any DB where the daemon has pre-generated since.

   It **must refuse to touch**:
   - anything with `start_time <= run_ts` — every past/logged row, unconditionally. This is the
     single most important line in the migration.
   - anything whose `notes` is not exactly the generator's fingerprint. The fingerprint
     `'Recurring: '` is written only at `task_service.py:248` (verified by grep). Any user edit to
     notes defeats the pattern — which is the desired direction of failure: keep the row.
   - anything `review_skipped = 1` (the user made a review decision about it).
   - anything with a `ratingentry` whose `target_type='session'` and `target_id = session.id`.
   - anything whose task has `is_recurring = 0` (i.e. rows orphaned from a series the user turned
     off — those are the user's now).
   - `'Scheduled: %'` rows from `_create_scheduled_session` (0 in the live DB) — those are
     one-off quick-add sessions, never part of a series.

   **Stated limitation, plainly:** there is no column marking a row as pre-generated (§1.2 #4).
   `notes LIKE 'Recurring: %'` is the only discriminator, it is user-editable, it goes stale the
   moment a task is renamed, and `delete_task` NULLs `task_id` rather than deleting
   (`task_service.py:528-543`) so an orphaned placeholder has *only* that string left. For
   **future** rows the fingerprint is a good-enough heuristic in the safe direction (a false
   negative keeps a row). For **past** rows it is not a discriminator at all — a past
   `Recurring: …` row is genuinely ambiguous between "placeholder that elapsed" and "I planned it
   and then actually did it", and this migration does not claim to tell them apart. It refuses to
   touch any row with `start_time <= run_ts`, full stop (D13). The design compensates at
   the service layer rather than in SQL: any surviving future row that sits exactly on an occurrence
   instant is adopted as `kind="override"` by `RecurrenceService.reconcile_series` on first
   projection, and any that does not is left as a plain unlinked session row. **The migration
   inserts no `recurrenceexception` rows at all** — reconstructing a `RECURRENCE-ID` for a *moved*
   row is genuinely impossible, and guessing "nearest occurrence within ±36h" inside an
   unrollbackable boot-time migration is not worth it for a case the live DB does not contain.
6. Do **not** touch `alembic_version` by hand; do not `create_all`.

### downgrade()
`op.drop_table("recurrenceexception")`, then drop the four columns (SQLite needs
`op.batch_alter_table("task")` for DROP COLUMN under older SQLite; alembic's batch mode handles the
table rebuild). Add a comment: **downgrade does not resurrect deleted placeholder sessions and does
not restore `recurrence_rule` on non-recurring tasks** — it is a schema downgrade only.

### Verification `tt-migrator` must perform
- Against **a copy of the live DB** (`cp ~/.timetrace/timetrace.db /tmp/.../probe.db`, then
  `TIMETRACE_DB_FILE=/tmp/.../probe.db uv run timetrace db migrate`; a fresh backup goes to
  `~/.timetrace/backups/` first): assert `SELECT COUNT(*) FROM session` is still **175**;
  the recurring task has `recurrence_rrule='FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'`,
  `recurrence_dtstart='2026-08-17 12:29:00'`, `recurrence_duration_minutes=15`;
  `SELECT COUNT(*) FROM task WHERE recurrence_rule IS NOT NULL` is **1**;
  `recurrenceexception` exists and is empty.
- Against a **genuinely fresh** DB (`TIMETRACE_DB_FILE=/tmp/fresh.db uv run timetrace db migrate`):
  `alembic upgrade head` reaches `0006_recurrence_rrule` from nothing. This is the only check that
  catches a broken chain (per CLAUDE.md's 0002/env.py lesson).
- A synthetic DB seeded with a recurring task + 90 `'Recurring: …'` future rows + 3 user-modified
  future rows (one moved, one renoted, one rated): assert the 90 vanish, the 3 survive, and no past
  row is touched.
- `downgrade` then `upgrade` again on a scratch copy, clean.

### 7.5 The already-elapsed placeholders — a separate, opt-in cleanup (NOT in `upgrade()`)

Removing pre-generation stops the corruption in §1.2 #8 from growing, but the 6 past placeholder
rows in the live DB keep inflating "Total Time Logged" and drive the recurring task's 667%
progress figure. The migration must not delete them (D13), so ship a remedy the owner drives:

New CLI command `timetrace recurrence audit` in `interfaces/cli/commands.py`, backed by
`RecurrenceService.audit_legacy_placeholders() -> list[LegacyPlaceholder]`. It is **read-only by
default** and prints one row per candidate with every signal, so a human can judge:

- `task_id`, `title`, `start_time` (local), `duration_seconds`;
- `notes` matches the generator fingerprint exactly (yes/no);
- `start_time`'s time-of-day + microseconds equals the task's `created_at` time-of-day
  (the live rows are all `12:29:01.544567`, matching `created_at` to the microsecond — a signal no
  human-created session can plausibly produce, but still only a signal);
- `review_skipped`, whether a `ratingentry` targets it, whether `tags`/`notes` differ from the
  task's defaults.

`timetrace recurrence audit --delete` deletes only the rows that satisfy **all** of: fingerprint
match, microsecond-exact time-of-day match against `created_at`, `duration_seconds` equal to the
derived legacy duration, `review_skipped = 0`, and no rating entry. It prints the full list and
requires a typed confirmation. It writes a JSON dump of every deleted row to
`~/.timetrace/backups/` first, so the decision is reversible by hand.

Scope note: this is one service method, one CLI command, no schema and no API. If the builder is
short on budget, cut the `--delete` half and ship `audit` read-only — the owner can then decide
per row (6 rows in the live DB). **Owner question Q5.**

---

## 8. Delete / edit scope semantics

`SessionService.delete_session(session_id, scope)` rewritten. `SessionModel` rows that belong to no
recurring series behave exactly as today for `only_this`.

| Scope | Virtual occurrence | Materialized occurrence (has an `override` exception) | Plain session on a recurring task | Plain session, non-recurring task |
|---|---|---|---|---|
| `only_this` | Insert `kind="skip"`. No row is created or deleted. | Delete the session row; flip the exception to `kind="skip"`, `session_id=NULL` (so it does not re-project). | Delete the row. | Delete the row (today's behavior). |
| `following` | `truncate_series`: `set_until(rrule, <occurrence-1s in local naive>)`; delete every exception with `occurrence_start >= occurrence`, and the session rows of the `override` ones **only where `start_time > now`**. | Same, anchored on the exception's `occurrence_start`, and delete this row. | Set `UNTIL` at that row's `start_time`; same future-only deletion. | 400 `ValidationError("scope 'following' requires a recurring task")` — today it happily deletes a range of unrelated sessions. |
| `all` | `end_series`: set `is_recurring=False` and `recurrence_rrule=None`; delete all exceptions; delete the session rows of `override` exceptions **only where `start_time > now`**. | Same. | Same. | Same 400 as above. |

**The fix inside this table:** `following` and `all` now delete **only rows with `start_time > now`**
and only rows belonging to the series. Today (`session_service.py:116-130`) `scope="all"` deletes
every session for the task — including the 6 logged rows of the live recurring task — and
`following` deletes everything at or after the picked instant regardless of whether it is logged.
That is a live data-loss bug reachable from the delete modal; call it out in the PR body.

Edits (`PUT`): `only_this` materializes and applies. `following`/`all` return
`ValidationError("scope '<x>' is not supported for edits yet — edit the recurrence on the task")`
→ 400. "This and following" edits mean splitting one `Task` into two (tags, subtasks, ratings,
stats, `TaskReview` all have to be decided); that is slice 3, not a flag.

---

## 9. Deliberately NOT doing

- **No RRULE builder UI.** The 4-preset select stays; `apply_recurrence_fields` translates it.
  Multi-weekday `BYDAY`, `INTERVAL`, `UNTIL`/`COUNT` pickers = slice 2. Consequence: a user cannot
  yet *author* anything the old vocabulary couldn't express — the engine can, the UI can't.
- **No "this and following" edits** (D10) = slice 3.
- **No `WKST`.** All four presets use `INTERVAL=1`, where `WKST` is irrelevant. When slice 2 adds
  `INTERVAL>1` weekly rules, `WKST` must be emitted from the client's `firstDayOfWeek`
  (`static/js/settings.js:35`), which is still client-side only. Verified this actually bites:
  `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE` from a Sunday DTSTART skips the DTSTART's own week under the
  default `WKST=MO`.
- **No timer→occurrence materialization** (D12). `TimerStartRequest` gains no `session_id`;
  stop/split still INSERT a fresh row. Note this *improves* today's behavior without being touched:
  working a scheduled occurrence currently yields two counted rows (the elapsed placeholder plus the
  timer's row); with the occurrence virtual, only the timer's row exists. A future slice can offer
  "this timer filled the 09:00 occurrence" and materialize on `timer/start`.
- **No time-relative filter in the stats query vocabulary** (§6.1) — handed off to the statistics
  track.
- **Not fixing `DELETE /sessions/{id}?scope=all`'s unbounded delete as a standalone change** — it
  *is* fixed, but only as a consequence of §8's rewrite of that method, which this branch has to
  touch anyway. No separate patch.
- **No occurrence-level completion state.** "I did Tuesday's standup" is not representable; the
  existing status field is per-task. `_reset_recurring_task_status` is a placeholder for the old
  behavior, not a model.
- **No `session.timezone` / floating-vs-fixed formalization.** `recurrence_timezone` is a
  recurrence field only; the `session.timezone` column stays unused groundwork per CLAUDE.md.
- **No projection of past occurrences** (D7). "You missed Tuesday" is a habits question.
- **No Google/CalDAV `EXDATE`/`RDATE` import-export.** External integrations are explicitly
  deferred. The exception table is `EXDATE`-shaped so it will map later, but nothing reads
  `external_sync_id`.
- **No aggregation over virtual occurrences** in `AnalyticsService`/`QueryService` (§6).

---

## 10. Owner questions — answer before the builder starts

- **Q1 (behavior change).** Today, completing a recurring task bumps `assigned_date` to the next
  occurrence and resets status to "To Do" (`handle_task_recurrence`) — a *second* anchoring scheme
  that already doubled the live series (§1.2 #9). Under the new design **completion advances
  nothing**: `recurrence_dtstart` is immutable (D11), the RRULE alone decides when the next
  occurrence is, and completion only resets the status so the task is actionable again. Consequence:
  the Target Day badge on a recurring task stops moving. Confirm that's acceptable — the
  alternative (deriving the badge from the next projected occurrence) is a small extra step in
  `TaskService.list_tasks`, but it means every task list does a projection.
- **Q2 (behavior change).** Resizing any session of a task currently rewrites the task's
  `estimated_minutes` (`calendar.js:116-123`). For a recurring series this plan makes resizing one
  occurrence a *per-occurrence* change only. Should resizing instead offer "change this occurrence"
  vs "change every future occurrence" (i.e. write `recurrence_duration_minutes`)? Slice 1 assumes
  per-occurrence only.
- **Q3 (visible gap).** The Markdown agenda export (`AnalyticsService`, "sessions" mode) reads real
  rows only and will stop listing upcoming recurring occurrences. Acceptable for slice 1, or does
  the export need the merged read path too?
- **Q4.** `MAX_WINDOW_DAYS = 400` and `MAX_OCCURRENCES_PER_SERIES = 500` — fine, or is there a
  "year view" plan that needs more?
- **Q5 (data).** The 6 past placeholder rows on "write week description" are why that task reads
  667% progress and why "Total Time Logged" is ~1.5h high. Do you want
  `timetrace recurrence audit --delete` (§7.5) built and run, audit-only, or neither? The
  boot migration will not touch them either way.

None of these block reading the plan; Q1, Q2 and Q5 change user-visible numbers or behavior.

---

## 11. Verification

Per the standing preference, manual verification leads; the automated set is small and targets what
manual testing genuinely cannot reach.

### 11.1 Manual checklist (the actual acceptance test)
Against a **copy** of the live DB, with the daemon on :8002:

1. Open the dashboard week view containing the "write week description" series. Expect Mon–Fri
   occurrences at 12:29 local, rendered ghosted (dashed/faded), **and** the 6 past logged rows
   rendered normally with **no duplicates on those past days**.
2. Drag one future occurrence to a different day/time. It becomes solid. Reload → it stays where
   you put it, and **no ghost reappears in its original slot**. (This is the headline bug.)
3. Edit the task's description (`PUT /api/tasks`). Reload → nothing regenerates, nothing moves,
   session count unchanged. This is the `task_service.py:391-392` regression gone.
4. Resize a future occurrence. Confirm the task's estimate in the inspector is **unchanged** and
   the other occurrences keep their original length.
5. Delete a future occurrence → "Only this". Reload → it stays gone forever.
6. Delete a future occurrence → "This and following". Reload → later occurrences gone, earlier
   future occurrences intact, **all 6 past logged rows still present** (this is the data-loss fix).
7. Delete → "All". Reload → the series stops projecting, **the 6 past logged rows are still there**,
   and the task shows as non-recurring.
8. Set the recurrence to `weekly`, save, reload. Occurrences move to weekly; the occurrence you
   moved in step 2 is still present as a real session (detached from the series); no stale ghosts.
9. Turn `is_recurring` off, save, reload → no ghosts. Turn it back on → ghosts return on the same
   weekday/time as before (dtstart was not recomputed).
10. `GET /timer/status` (or the timer widget's "next up") names the next projected occurrence.
11. `/stats` and the day-review tab totals are **byte-identical** before and after the branch
    (nothing analytics-facing should move).
12. `uv run ruff check .` clean; `uv run python -P -m pytest -q` green (safe-path mode avoids root `copy.py` shadowing).

### 11.2 Automated — `tests/test_recurrence.py` (pure, no DB; this is where the value is)
- `expand` with `FREQ=WEEKLY` at 09:00 local across a spring-forward boundary in a DST zone
  (parametrize `Europe/Berlin` and `America/New_York`) asserts **every** occurrence is 09:00 local
  and that the naive-UTC instants shift by exactly one hour at the transition. **This is the test
  that cannot be done manually** and is the one real correctness risk in the engine.
- `format_occurrence_id` / `parse_occurrence_id` round-trip; `parse_occurrence_id` returns `None`
  for a plain UUIDv7 and for a malformed stamp.
- Window seams: `expand(spec, w1_start, w1_end)` and `expand(spec, w1_end, w2_end)` produce
  **disjoint** sets whose union equals `expand(spec, w1_start, w2_end)` (the `xafter`-vs-`between`
  inclusivity trap).
- `preset_to_rrule` for all four presets + unknown + `None`; `rrule_to_preset` round-trip and
  `"custom"` for anything else.
- `validate_rrule` rejects: unparseable, `FREQ=HOURLY`, a `Z`-suffixed `UNTIL`, a sub-second
  DTSTART, a zero-occurrence rule.
- `set_until` produces a naive (non-`Z`) `UNTIL` that `rrulestr` accepts against a naive DTSTART,
  and drops any pre-existing `COUNT`.
- `MAX_OCCURRENCES_PER_SERIES` truncates rather than hanging.

### 11.3 Automated — `tests/test_recurrence_service.py` (DB, uses the `db`/`client` fixtures)
- Creating an `is_recurring` task inserts **zero** session rows. Note that
  `tests/test_tasks_api.py::test_recurring_task_update_does_not_duplicate_sessions` asserts
  `count_after_update == count_after_create`, which becomes `0 == 0` and **passes vacuously** — so
  nothing in `tests/` will go red on this branch. Rewrite it to assert the absolute counts
  (`0` after create, `0` after an unrelated update, `0` `recurrenceexception` rows) rather than
  deleting it, and update its docstring: the regression it documented no longer exists because the
  generator no longer exists.
- Completion does not advance the anchor: `PUT /api/tasks/{id} {"status": "Done"}` on a recurring
  task leaves `recurrence_dtstart` and `assigned_date` unchanged, creates no session rows, and
  resets `status` to the lowest-position non-completed status (the §1.2 #9 doubling bug).
- `GET /sessions?start&end` over a future week returns N virtual items with `is_virtual: true`
  and ids matching `^virt:`; the same call with `include_virtual=false` returns none.
- `GET /sessions` with **no** bounds returns no virtual items.
- `PUT /sessions/virt:...` returns 200 with a **36-char UUID** id ≠ the request id, creates exactly
  one session row and one `recurrenceexception(kind="override")`, and a subsequent range GET returns
  the real row and **no ghost at that instant**.
- `PUT` the same synthetic id twice → the second returns 400 (occurrence overridden/cancelled), not
  a duplicate row.
- `DELETE /sessions/virt:...?scope=only_this` → 204, one `kind="skip"` row, zero session rows, and
  the ghost is gone from a re-GET.
- `DELETE ...?scope=following` on a series with 2 past logged rows and 5 future ones: past rows
  survive, `UNTIL` is set, later ghosts stop projecting.
- `DELETE ...?scope=all`: past rows survive, `is_recurring` is False.
- `PUT /api/tasks/{id}` with an unrelated field on a recurring task: session count and
  `recurrenceexception` count both unchanged (the resurrection regression).
- Changing `recurrence_rule` from `daily` to `weekly`: a future `override` row whose
  `occurrence_start` is no longer an occurrence keeps its session row and loses its exception; a
  future `skip` exception at a vanished anchor is deleted; a **past** exception is untouched.
- `reconcile_series` adoption: seed a future session row at an exact occurrence instant with no
  exception → first projection adopts it as `override` and emits no ghost there. Seed one 20 minutes
  off → not adopted, left alone, ghost still emitted (documents the known duplicate-looking case).
- `GET /timer/status` returns a `next_session` sourced from a projection when no future rows exist.
- `DELETE /api/tasks/{id}` on a recurring task with exceptions leaves no orphan
  `recurrenceexception` rows.

---

## 12. SETTLED OWNER DECISIONS (2026-09-01) — these override §10

The five owner questions in §10 are answered. Build to these.

- **Q1 — Target Day badge: SHOW THE NEXT OCCURRENCE.** Derive the badge from the next projected
  occurrence (one `rrule.after(now)` per recurring task in list views). Do **not** freeze it and do
  **not** keep the old mechanism of completion bumping a stored date — `recurrence_dtstart` stays
  immutable and `handle_task_recurrence`'s second anchoring scheme (the cause of the live series
  doubling) is removed. Completion only resets status so the task is actionable again.
- **Q2 — Resize scope: OFFER "THIS OCCURRENCE" vs "ALL FUTURE OCCURRENCES".** This is a change from
  the plan's slice-1 assumption of per-occurrence-only. "This occurrence" writes an `override`
  exception; "all future" writes `recurrence_duration_minutes` on the task. This requires a scope
  prompt in the drag/resize path — reuse the existing `confirm_modal.html` / `showCustomConfirm`
  conventions rather than inventing a new modal system, and note `stats.html` lacks
  `confirm_modal.html` so `showCustomConfirm` degrades to `window.confirm` there.
  Also fix `calendar.js:116-123`, which currently PUTs the task's `estimated_minutes` after ANY
  drag — that is what re-triggers generation and refills the vacated slot.
- **Q3 — Markdown agenda export: WIRE THE MERGED READ PATH.** The agenda export's "Later Today /
  Tomorrow / Upcoming" sections must go through the same `SessionService` merge funnel as the
  calendar so projected occurrences appear. A silently-empty agenda section is exactly the
  wrong-but-no-error failure class this project keeps hitting.
- **Q4 — Limits: ACCEPT AS PLANNED.** `MAX_WINDOW_DAYS = 400`, `MAX_OCCURRENCES_PER_SERIES = 500`.
  No year-view plan exists.
- **Q5 — Elapsed placeholders: BUILD `timetrace recurrence audit [--delete]`.** Build the opt-in CLI
  command as specified in §7.5. It must default to report-only and require `--delete` to remove
  anything. It must never touch a row that lacks the `notes LIKE 'Recurring: %'` fingerprint.

### Live-database state as of 2026-09-01, AFTER authorized cleanup

The owner authorized deleting the one polluted recurring task outright. Already done:

- Task `01a02108-eb92-74ac-aa82-83fb19a270b3` (`write week description`, `is_recurring=1`,
  `recurrence_rule='weekdays'`) **deleted**, along with **all 7** of its sessions — the 6 generated
  placeholders (all stamped `12:29:01.544567`, the task's own `created_at`, which is what proved
  they were generated rather than worked) and its one real 10-minute session.
- Live DB now: 39 tasks, 168 sessions, **0** rows with `is_recurring=1`, **0** rows with
  `notes LIKE 'Recurring: %'`, 0 future sessions. The 5 sessions with `task_id IS NULL` are
  pre-existing orphans, unrelated to this cleanup.
- Backup: `~/.timetrace/backups/timetrace-pre-recurrence-20260901-112112.db`.
- **A pre-deletion copy is preserved for migration testing** at
  `scratchpad/realdb-copy-for-migration-tests.db` — this is the ONLY remaining real-data fixture
  that still contains an `is_recurring=1` row, so the migration's conversion path must be verified
  against it. Against the current live DB the conversion step is a no-op (0 rows to convert), so
  the live DB alone cannot prove the conversion works.

### Consequence for §7's migration

The data-conversion step now has zero rows to act on in the live database, and the placeholder
DELETE has zero matching rows. Both must still be implemented and must still be correct (other
databases, and any DB where the daemon pre-generates before upgrading), but neither is the risky
part any more. Verify against all three: the fresh DB, the current live copy, and
`realdb-copy-for-migration-tests.db`.
