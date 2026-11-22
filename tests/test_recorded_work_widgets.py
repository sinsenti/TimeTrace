"""Agenda #9 public editable-query behavior, using synthetic records only."""


def test_recorded_widget_groups_by_start_day_and_category_without_summing_groups(client, monkeypatch):
    import timetrace.core.timezones as zones

    monkeypatch.setenv("TZ", "UTC")
    zones._reset_caches()
    task = client.post("/api/tasks", json={"title": "Writing", "category": "Focus"}).json()["id"]
    for start, end in [
        ("2000-01-04T23:30:00Z", "2000-01-05T00:30:00Z"),
        ("2000-01-05T00:00:00Z", "2000-01-05T01:00:00Z"),
    ]:
        response = client.post("/recorded-work", json={"task_id": task, "start_time": start, "end_time": end})
        assert response.status_code == 201, response.text
    response = client.post(
        "/analytics/query",
        json={
            "query": {
                "source": "recorded_work",
                "measure": "recorded_task_time",
                "group_by": ["day", "category"],
                "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-05"},
                "sort": "dimension_asc",
            },
            "timezone": "UTC",
            "first_day_of_week": 1,
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert [row["value"] for row in result["rows"]] == [1, 1]
    assert result["total"] == 1.5
    assert result["meta"]["totals_overlap"] is True
