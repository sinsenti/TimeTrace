"""Ticket 12 review repairs through the real analytics HTTP/compiler/SQL seam."""

from datetime import datetime, timedelta

import pytest
from sqlmodel import text

from timetrace.core.query_compiler import QueryContext, compile_query
from timetrace.core.query_spec import AnalyticsQuery
from timetrace.db.models import Session as SessionModel
from timetrace.db.models import Task


@pytest.fixture
def weekday_tasks(db):
    tasks = [Task(title="Same label"), Task(title="Same label")]
    db.add_all(tasks)
    db.commit()
    for start in [datetime(2024, 2, 25, 12), datetime(2024, 2, 26, 12)]:
        for task in tasks:
            db.add(
                SessionModel(
                    task_id=task.id, start_time=start, end_time=start + timedelta(hours=1), duration_seconds=3600
                )
            )
    db.commit()
    return [task.id for task in tasks]


def query_payload(dimension, **changes):
    return {
        "source": "sessions",
        "measure": "session_count",
        "group_by": [dimension, "task"],
        "sort": "value_desc",
        **changes,
    }


@pytest.mark.parametrize("dimension", ["hour_of_day", "weekday"])
def test_multidimensional_time_gap_fill_rejects_instead_of_losing_task_rows(client, weekday_tasks, dimension):
    query = query_payload(dimension)
    control = client.post("/analytics/query", json={"query": query})
    assert control.status_code == 200, control.text
    assert control.json()["row_count"] == (2 if dimension == "hour_of_day" else 4)
    assert {row["keys"][1] for row in control.json()["rows"]} == set(weekday_tasks)
    response = client.post("/analytics/query", json={"query": {**query, "fill_gaps": True}})
    assert response.status_code == 400, response.text
    assert "second group_by dimension" in response.json()["detail"]


@pytest.mark.parametrize("first_day", [0, 1])
@pytest.mark.parametrize("descending", [False, True])
@pytest.mark.parametrize("comparison", [False, True])
def test_weekday_dimension_sort_keeps_all_task_rows_in_stable_week_order(
    client, db, weekday_tasks, first_day, descending, comparison
):
    query = query_payload("weekday", sort="dimension_desc" if descending else "dimension_asc")
    if comparison:
        query.update(
            date_range={"preset": "custom", "start_date": "2024-02-25", "end_date": "2024-02-26"},
            comparison={"mode": "custom", "start_date": "2024-02-25", "end_date": "2024-02-26"},
        )
    response = client.post("/analytics/query", json={"query": query, "first_day_of_week": first_day})
    assert response.status_code == 200, response.text
    rows = response.json()["rows"]
    assert len(rows) == 4, rows
    days = ["0", "1"] if first_day == 0 else ["1", "0"]
    if descending:
        days.reverse()
    meta = response.json()["meta"]
    context = QueryContext(
        timezone=meta["timezone"],
        first_day_of_week=first_day,
        range_start_utc=datetime.fromisoformat(meta["range_start_utc"]) if meta["range_start_utc"] else None,
        range_end_utc=datetime.fromisoformat(meta["range_end_utc"]) if meta["range_end_utc"] else None,
    )
    compiled = compile_query(AnalyticsQuery.model_validate(query), context)
    incoming = [[str(raw[0]), str(raw[1])] for raw in db.exec(text(compiled.sql), params=compiled.params).all()]
    # The compiler promises DESC on the first dimension only; preserve secondary SQL order.
    assert [row["keys"] for row in rows] == [keys for day in days for keys in incoming if keys[0] == day]
    assert {tuple(row["keys"]) for row in rows} == {(day, task) for day in days for task in weekday_tasks}
    assert all(row["labels"][1] == "Same label" and row["value"] == 1 and row["count"] == 1 for row in rows)
    if comparison:
        assert all(row["comparison_value"] == 1 and row["delta"] == 0 for row in rows)


@pytest.mark.parametrize(("dimension", "count"), [("hour_of_day", 24), ("weekday", 7)])
@pytest.mark.parametrize("first_day", [0, 1])
def test_single_dimension_gap_fill_keeps_existing_dense_contract(client, weekday_tasks, dimension, count, first_day):
    query = query_payload(dimension, group_by=[dimension], fill_gaps=True)
    response = client.post("/analytics/query", json={"query": query, "first_day_of_week": first_day})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["row_count"] == count
    assert sum(row["value"] for row in result["rows"]) == 4
    assert all(len(row["keys"]) == 1 for row in result["rows"])
    if dimension == "weekday":
        assert [row["keys"][0] for row in result["rows"]] == [str((first_day + i) % 7) for i in range(7)]
    assert result["meta"]["first_day_of_week"] == first_day


@pytest.mark.parametrize("dimension", ["day", "week", "month"])
def test_existing_calendar_fill_validation_messages_are_unchanged(client, dimension):
    query = query_payload(dimension, fill_gaps=True)
    response = client.post("/analytics/query", json={"query": query})
    assert response.status_code == 400
    assert response.json()["detail"] == "fill_gaps on day/week/month requires a bounded date_range (not all_time)"
    query["date_range"] = {"preset": "last_7_days"}
    response = client.post("/analytics/query", json={"query": query})
    assert response.status_code == 400
    assert response.json()["detail"] == "fill_gaps on day/week/month doesn't support a second group_by dimension"
