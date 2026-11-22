"""Characterize model-facing reads without inventing a stricter scope policy."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from timetrace.core.exceptions import EntityNotFoundError, ValidationError
from timetrace.db.models import AIDraftBatch, Task
from timetrace.db.models import Session as SessionModel
from timetrace.services import ai_tool_gateway
from timetrace.services.ai_insights_service import AIInsightsService
from timetrace.services.ai_tool_gateway import DbAIToolGateway

START = datetime(2026, 9, 10, 9, tzinfo=UTC)
END = START + timedelta(hours=2)
DATES = {"start_date": "2026-09-10", "end_date": "2026-09-11"}
WINDOW = {"start": START, "end": END}


@pytest.fixture
def gateway(db, monkeypatch):
    monkeypatch.setattr(ai_tool_gateway, "engine", db.get_bind())
    batch = AIDraftBatch()
    db.add(batch)
    db.commit()
    return DbAIToolGateway(batch.id)


def test_task_only_progress_keeps_recorded_session_aggregates(db, gateway):
    task = Task(title="Report", estimated_minutes=120)
    db.add(task)
    db.add(
        SessionModel(
            task_id=task.id,
            start_time=datetime(2020, 1, 1, 9),
            end_time=datetime(2020, 1, 1, 10),
            duration_seconds=3600,
        )
    )
    db.commit()
    gateway.data_scope["sessions"] = False

    result = gateway.get_task_progress(task.id)
    assert result["title"] == "Report"
    assert result["logged_hours"] == 1
    assert result["remaining_hours"] == 1
    assert result["session_count"] == 1
    with pytest.raises(ValidationError, match="sessions.*disabled"):
        gateway.list_sessions(**WINDOW)


def test_sessions_only_reads_keep_projected_task_metadata_and_diagnostic_titles(db, gateway):
    start = (datetime.now(UTC) + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    task = Task(
        title="Private standup",
        tags="team",
        is_recurring=True,
        recurrence_rrule="FREQ=DAILY",
        recurrence_dtstart=start.replace(tzinfo=None),
        recurrence_timezone="UTC",
        recurrence_duration_minutes=30,
    )
    db.add(task)
    db.commit()
    gateway.data_scope["tasks"] = False

    rows = gateway.list_sessions(start=start, end=start + timedelta(hours=2))
    assert len(rows) == 1
    assert rows[0]["task_id"] == task.id
    assert rows[0]["task_title"] == "Private standup"
    assert rows[0]["is_virtual"] is True
    assert rows[0]["id"].startswith("virt:")

    result = gateway.validate_schedule(
        [{"start_time": start.isoformat(), "end_time": (start + timedelta(minutes=15)).isoformat()}]
    )
    assert any("Private standup" in error and "overlaps" in error for error in result["errors"])
    with pytest.raises(ValidationError, match="tasks.*disabled"):
        gateway.get_task(task.id)


def test_human_local_insights_are_not_model_scope_gated(db, gateway):
    task = Task(title="Local report")
    db.add(task)
    db.commit()
    gateway.data_scope["tasks"] = False
    with pytest.raises(ValidationError, match="tasks.*disabled"):
        gateway.get_task_progress(task.id)
    assert AIInsightsService(db).get_task_progress(task.id)["title"] == "Local report"


def test_task_lookup_keeps_empty_query_and_not_found_contracts(gateway):
    assert gateway.resolve_task_reference("   ") == []
    with pytest.raises(EntityNotFoundError):
        gateway.get_task("missing")
    gateway.data_scope["tasks"] = False
    with pytest.raises(ValidationError, match="tasks.*disabled"):
        gateway.resolve_task_reference("")


# Each tuple records the existing ordered requirements, including multi-domain reads.
READS = [
    ("list_tasks", {}, ("tasks",)),
    ("get_task", {"task_id": "missing"}, ("tasks",)),
    ("resolve_task_reference", {"query": ""}, ("tasks",)),
    ("search_tasks", {"query": "report"}, ("tasks",)),
    ("get_task_progress", {"task_id": "missing"}, ("tasks",)),
    ("list_sessions", WINDOW, ("sessions",)),
    ("find_free_slots", {**WINDOW, "min_duration_minutes": 15}, ("sessions",)),
    ("validate_schedule", {"proposed_sessions": []}, ("sessions",)),
    ("find_conflicts", WINDOW, ("sessions", "tasks")),
    ("get_daily_briefing", {}, ("sessions", "tasks")),
    ("get_weekly_review", WINDOW, ("sessions", "tasks")),
    ("list_habits", DATES, ("habits",)),
    ("get_habit_progress", {**DATES, "habit_id": "missing"}, ("habits",)),
    ("get_day_summary", {"date_str": "2026-09-10"}, ("sessions", "tasks", "reviews")),
    ("list_day_reviews", DATES, ("reviews",)),
    ("get_task_review", {"task_id": "missing"}, ("reviews", "tasks")),
    ("list_task_reviews", {}, ("reviews", "tasks")),
    ("list_rating_definitions", {}, ("ratings",)),
    ("list_rating_entries", {"target_type": "day"}, ("ratings",)),
    ("get_timer_status", {}, ("timer",)),
    ("get_reflection_context", DATES, ("sessions", "tasks", "habits", "reviews", "ratings")),
    (
        "get_reflection_context",
        {**DATES, "include_timer": True},
        ("sessions", "tasks", "habits", "reviews", "ratings", "timer"),
    ),
]


@pytest.mark.parametrize("method,kwargs,domains", READS, ids=[item[0] for item in READS])
def test_read_requirements_and_error_order_are_unchanged(gateway, method, kwargs, domains):
    for domain in domains:
        gateway.data_scope[domain] = False
    for domain in domains:
        with pytest.raises(
            ValidationError,
            match=f"AI data scope '{domain}' is disabled. Enable it in Settings > AI before using this tool.",
        ):
            getattr(gateway, method)(**kwargs)
        gateway.data_scope[domain] = True


@pytest.mark.parametrize(
    "source,measure,domain",
    [
        ("sessions", "session_count", "sessions"),
        ("tasks", "task_count", "tasks"),
        ("habit_logs", "habit_completion_rate", "habits"),
        ("day_reviews", "avg_rating", "reviews"),
        ("rating_entries", "avg_rating", "ratings"),
    ],
)
def test_stats_require_the_source_domain_before_measure_validation(gateway, source, measure, domain):
    query = {"source": source, "measure": "invalid"}
    gateway.data_scope[domain] = False
    with pytest.raises(ValidationError, match=f"{domain}.*disabled"):
        gateway.get_time_stats(query)
    gateway.data_scope[domain] = True
    with pytest.raises(ValidationError, match="measure"):
        gateway.get_time_stats(query)
    assert "rows" in gateway.get_time_stats({"source": source, "measure": measure})


@pytest.mark.parametrize("field", ["task", "category", "status", "priority", "has_task"])
def test_session_stats_require_tasks_only_for_task_dependent_fields(gateway, field):
    gateway.data_scope["tasks"] = False
    query = {"source": "sessions", "measure": "session_count"}
    assert "rows" in gateway.get_time_stats(query)
    if field != "has_task":
        with pytest.raises(ValidationError, match="tasks.*disabled"):
            gateway.get_time_stats({**query, "group_by": [field]})
    with pytest.raises(ValidationError, match="tasks.*disabled"):
        gateway.get_time_stats({**query, "filters": [{"field": field, "op": "eq", "values": ["x"]}]})
    # Session tags remain session-scoped, not task-scoped.
    assert "rows" in gateway.get_time_stats({**query, "group_by": ["tag"]})


@pytest.mark.parametrize("source", ["sessions", "tasks"])
def test_average_rating_requires_ratings_and_keeps_tag_combination_error(gateway, source):
    query = {"source": source, "measure": "avg_rating"}
    with pytest.raises(ValidationError, match="ratings.*disabled"):
        gateway.get_time_stats(query)
    gateway.data_scope["ratings"] = True
    assert "rows" in gateway.get_time_stats(query)
    if source == "sessions":
        for extra in ({"group_by": ["tag"]}, {"filters": [{"field": "tag", "op": "eq", "values": ["team"]}]}):
            with pytest.raises(ValidationError, match="avg_rating cannot be combined with session tags"):
                gateway.get_time_stats({**query, **extra})


@pytest.mark.parametrize("target,domain", [("task", "tasks"), ("session", "sessions"), ("habit", "habits")])
def test_rating_entries_preserve_payload_dependent_scope(gateway, target, domain):
    gateway.data_scope.update({"ratings": True, domain: False})
    with pytest.raises(ValidationError, match=f"{domain}.*disabled"):
        gateway.list_rating_entries(target_type=target)
    assert gateway.list_rating_entries(target_type="day")["entries"] == []
    with pytest.raises(ValidationError, match="filter rating entries by target_type=day"):
        gateway.list_rating_entries()
    gateway.data_scope.update({"tasks": True, "sessions": True, "habits": True})
    assert gateway.list_rating_entries(target_type=target)["entries"] == []
    assert gateway.list_rating_entries()["entries"] == []


def test_read_bounds_filters_and_validation_remain_observable(db, gateway):
    older = Task(title="Older", created_at=datetime(2026, 1, 1))
    newer = Task(title="Newer", created_at=datetime(2026, 1, 2))
    done = Task(title="Done", status="Done", created_at=datetime(2026, 1, 3))
    db.add_all([older, newer, done])
    db.commit()
    assert [row["title"] for row in gateway.list_tasks(limit=0)] == ["Newer"]
    assert [row["title"] for row in gateway.list_tasks(include_done=True, limit=1)] == ["Done"]
    assert [row["title"] for row in gateway.resolve_task_reference("old", limit=0)] == ["Older"]
    with pytest.raises(ValidationError, match="end must be strictly after start"):
        gateway.list_sessions(start=END, end=START)
    with pytest.raises(ValidationError, match="query must be an object"):
        gateway.get_time_stats(None)
    with pytest.raises(ValidationError, match="unsupported source"):
        gateway.get_time_stats({"source": "unknown"})
    with pytest.raises(ValidationError, match="limit must be an integer"):
        gateway.get_time_stats({"source": "sessions", "measure": "session_count", "limit": "invalid"})


def test_task_and_statistics_upper_bounds_are_preserved(db, gateway):
    db.add_all([Task(title=f"Report {index}", status=f"Stage {index}") for index in range(205)])
    db.commit()
    assert len(gateway.list_tasks(limit=1000)) == 200
    assert len(gateway.resolve_task_reference("Report", limit=1000)) == 20
    query = {"source": "tasks", "measure": "task_count", "group_by": ["status"]}
    assert len(gateway.get_time_stats({**query, "limit": 1000})["rows"]) == 100
    # Statistics historically treat zero as the default 50, unlike list tools' clamp to one.
    assert len(gateway.get_time_stats({**query, "limit": 0})["rows"]) == 50


def test_session_filter_and_bounds_are_preserved(db, gateway):
    task = Task(title="Linked report")
    db.add(task)
    db.add_all(
        [
            SessionModel(
                task_id=task.id if index == 0 else None,
                start_time=START.replace(tzinfo=None),
                end_time=END.replace(tzinfo=None),
            )
            for index in range(502)
        ]
    )
    db.commit()
    assert len(gateway.list_sessions(**WINDOW, limit=1000)) == 500
    assert len(gateway.list_sessions(**WINDOW, limit=0)) == 1
    filtered = gateway.list_sessions(**WINDOW, task_id=task.id)
    assert len(filtered) == 1
    assert filtered[0]["task_id"] == task.id
    assert filtered[0]["is_virtual"] is False


def test_denied_or_invalid_reads_do_not_check_out_a_database_connection(db, gateway):
    engine = db.get_bind()
    checked_out = []

    def checkout(connection, record, proxy):
        checked_out.append(connection)

    event.listen(engine, "checkout", checkout)
    try:
        gateway.data_scope["tasks"] = False
        with pytest.raises(ValidationError, match="tasks.*disabled"):
            gateway.get_task("missing")
        with pytest.raises(ValidationError, match="habits.*disabled"):
            gateway.list_habits(**DATES)
        with pytest.raises(ValidationError, match="unsupported source"):
            gateway.get_time_stats({"source": "unknown"})
        assert checked_out == []
    finally:
        event.remove(engine, "checkout", checkout)


def test_concurrent_reads_own_and_release_independent_sessions(tmp_path, monkeypatch):
    # Use separate real connections: StaticPool's single in-memory connection cannot establish
    # concurrent checkout/return behavior. Observe only the DB boundary, not gateway helpers.
    engine = create_engine(f"sqlite:///{tmp_path / 'reads.db'}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(ai_tool_gateway, "engine", engine)
    with Session(engine) as db:
        task = Task(title="Concurrent report")
        db.add(task)
        db.commit()
        task_id = task.id
    gateway = DbAIToolGateway("unused")
    barrier = Barrier(2, timeout=10)
    checked_out = []
    checked_in = []

    def checkout(connection, record, proxy):
        checked_out.append(connection)
        barrier.wait()

    def checkin(connection, record):
        checked_in.append(connection)

    event.listen(engine, "checkout", checkout)
    event.listen(engine, "checkin", checkin)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            found = pool.submit(gateway.get_task, task_id)
            missing = pool.submit(gateway.get_task, "missing")
            assert found.result(timeout=15)["title"] == "Concurrent report"
            with pytest.raises(EntityNotFoundError):
                missing.result(timeout=15)
        assert len(checked_out) == 2
        assert checked_out[0] is not checked_out[1]
        assert {id(conn) for conn in checked_in} == {id(conn) for conn in checked_out}
    finally:
        engine.dispose()


def test_ai_planning_reads_include_typed_plan_and_reserve_its_window(client, gateway):
    start = (datetime.now(UTC) + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    end = start + timedelta(hours=2)
    plan_end = start + timedelta(minutes=30)
    response = client.post(
        "/scheduled-sessions",
        json={
            "start_time": (start - timedelta(minutes=30)).isoformat(),
            "end_time": plan_end.isoformat(),
            "notes": "Reserved writing",
        },
    )
    assert response.status_code == 201, response.text
    plan = response.json()
    (item,) = gateway.list_sessions(start=start, end=end)
    assert item["id"] == plan["id"]
    assert item["kind"] == "scheduled_session"
    assert datetime.fromisoformat(item["original_end"]) == plan_end
    assert item["revision"] == 1
    slots = gateway.find_free_slots(start=start, end=end, min_duration_minutes=15, working_hours_only=False)
    assert datetime.fromisoformat(slots[0]["start"]) == plan_end
    overlap = {"start_time": start.isoformat(), "end_time": (start + timedelta(minutes=15)).isoformat()}
    check = gateway.validate_schedule([overlap])
    assert not check["valid"] and any("Reserved writing" in error and "overlaps" in error for error in check["errors"])
    work = client.post("/sessions", json=overlap).json()
    (result,) = gateway.find_conflicts(start=start, end=end)
    assert {result["session_a_id"], result["session_b_id"]} == {plan["id"], work["id"]}
    assert result["overlap_minutes"] == 15


@pytest.mark.parametrize("target", ["plan", "captured_anchor", "recorded_work", "legacy"])
def test_validation_reserves_protected_targets_but_replaces_editable_legacy(client, db, gateway, target):
    from timetrace.core.recurrence import format_occurrence_id
    from timetrace.core.timezones import daemon_timezone

    tz = daemon_timezone()
    start = (datetime.now(tz) + timedelta(days=-2 if target == "recorded_work" else 2)).replace(
        hour=10, minute=0, second=0, microsecond=0
    )
    end = start + timedelta(hours=1)
    settings = client.put(
        "/api/ai/settings",
        json={"scheduling_days": [start.strftime("%A").lower()], "maximum_daily_minutes": 90},
    )
    assert settings.status_code == 200, settings.text
    window = {"start_time": start.isoformat(), "end_time": end.isoformat()}

    if target in ("plan", "captured_anchor"):
        start_utc = start.astimezone(UTC).replace(tzinfo=None)
        task = Task(
            title="Reserved commitment",
            is_recurring=True,
            recurrence_rrule="FREQ=DAILY;COUNT=1",
            recurrence_dtstart=start_utc,
            recurrence_timezone="UTC",
            recurrence_duration_minutes=60,
        )
        db.add(task)
        db.commit()
        virtual_id = format_occurrence_id(task.id, start_utc)
        path = f"/scheduled-sessions/{virtual_id}"
        projected = client.get(path)
        assert projected.status_code == 200, projected.text
        capture = client.put(
            path, json={**window, "expected_projection_revision": projected.json()["projection_revision"]}
        )
        assert capture.status_code == 200, capture.text
        target_id = capture.json()["id"] if target == "plan" else virtual_id
    elif target == "recorded_work":
        # The explicit manual-recording flow is a later ticket; seed a closed work record.
        row = SessionModel(
            kind="recorded_work",
            provenance="manual",
            start_time=start.astimezone(UTC).replace(tzinfo=None),
            end_time=end.astimezone(UTC).replace(tzinfo=None),
            duration_seconds=3600,
            notes="Reserved commitment",
        )
        db.add(row)
        db.commit()
        target_id = row.id
    else:
        legacy = client.post("/sessions", json={**window, "notes": "Reserved commitment"})
        assert legacy.status_code == 201, legacy.text
        target_id = legacy.json()["id"]

    check = gateway.validate_schedule([{**window, "session_id": target_id}])
    if target == "legacy":
        assert check["valid"], check
        assert check["daily_minutes"] == {start.date().isoformat(): 60}
    else:
        assert not check["valid"], check
        assert check["daily_minutes"] == {start.date().isoformat(): 120}
        assert any("Reserved commitment" in error and "overlaps" in error for error in check["errors"])
        assert any("exceeds daily limit 90" in error for error in check["errors"])
        assert any("cannot edit" in error and "Choose another time" in error for error in check["errors"])


def test_new_human_recorded_work_query_source_remains_outside_ai_allowlist(gateway):
    with pytest.raises(ValidationError, match="unsupported source"):
        gateway.get_time_stats({"source": "recorded_work", "measure": "recorded_task_time"})
