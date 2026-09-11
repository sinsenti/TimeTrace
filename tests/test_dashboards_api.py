def test_overview_dashboard_is_seeded_and_runnable(client):
    response = client.get("/api/dashboards")

    assert response.status_code == 200
    dashboards = response.json()
    assert len(dashboards) == 1
    assert dashboards[0]["slug"] == "overview"
    assert dashboards[0]["widget_count"] == 9

    dashboard_id = dashboards[0]["id"]
    data = client.post(
        f"/api/dashboards/{dashboard_id}/data",
        json={"timezone": "UTC", "first_day_of_week": 1},
    )

    assert data.status_code == 200
    payload = data.json()
    assert len(payload["widgets"]) == 9
    assert len(payload["results"]) == 9
    assert payload["errors"] == {}


def test_dashboard_widget_crud_and_reorder(client):
    dashboard_id = client.get("/api/dashboards").json()[0]["id"]
    spec = {
        "mode": "structured",
        "query": {
            "source": "sessions",
            "measure": "session_count",
            "chart": "tile",
        },
    }

    created = client.post(
        f"/api/dashboards/{dashboard_id}/widgets",
        json={"title": "My sessions", "width": "full", "spec": spec},
    )
    assert created.status_code == 201
    widget = created.json()
    assert widget["title"] == "My sessions"
    assert widget["width"] == "full"

    updated = client.put(
        f"/api/dashboards/{dashboard_id}/widgets/{widget['id']}",
        json={"title": "Renamed sessions"},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Renamed sessions"

    detail = client.get(f"/api/dashboards/{dashboard_id}").json()
    widget_ids = [item["id"] for item in detail["widgets"]]
    reordered = client.post(
        f"/api/dashboards/{dashboard_id}/widgets/reorder",
        json={"widget_ids": list(reversed(widget_ids))},
    )
    assert reordered.status_code == 200
    assert [item["id"] for item in reordered.json()] == list(reversed(widget_ids))

    deleted = client.delete(f"/api/dashboards/{dashboard_id}/widgets/{widget['id']}")
    assert deleted.status_code == 204


def test_dashboard_rejects_stale_widget_reorder(client):
    dashboard_id = client.get("/api/dashboards").json()[0]["id"]

    response = client.post(
        f"/api/dashboards/{dashboard_id}/widgets/reorder",
        json={"widget_ids": []},
    )

    assert response.status_code == 400
    assert "exactly the widgets" in response.json()["detail"]


def test_dashboard_comparison_widget_runs(client):
    dashboard_id = client.get("/api/dashboards").json()[0]["id"]
    spec = {
        "mode": "structured",
        "query": {
            "source": "sessions",
            "measure": "session_count",
            "group_by": ["day"],
            "chart": "line",
            "sort": "dimension_asc",
            "fill_gaps": True,
            "date_range": {
                "preset": "custom",
                "start_date": "2026-01-01",
                "end_date": "2026-01-03",
            },
            "comparison": {"mode": "previous_period"},
        },
    }

    created = client.post(
        f"/api/dashboards/{dashboard_id}/widgets",
        json={"title": "Compared sessions", "width": "full", "spec": spec},
    )
    assert created.status_code == 201

    data = client.post(
        f"/api/dashboards/{dashboard_id}/data",
        json={"timezone": "UTC", "first_day_of_week": 1},
    )
    assert data.status_code == 200
    widget_id = created.json()["id"]
    result = data.json()["results"][widget_id]
    assert result["comparison"]["alignment"] == "positional"
    assert len(result["rows"]) == 3
    assert all(row["comparison_value"] == 0 for row in result["rows"])
