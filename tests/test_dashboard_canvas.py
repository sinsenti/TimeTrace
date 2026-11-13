"""Canvas adoption uses the existing dashboard/detail/query public contracts unchanged."""


def test_canvas_existing_customized_and_deleted_seeds_are_not_reinserted(client):
    overview = client.get("/api/dashboards").json()[0]
    path = f"/api/dashboards/{overview['id']}"
    original = client.get(path).json()["widgets"]
    removed, renamed = original[:2]
    assert client.delete(f"{path}/widgets/{removed['id']}").status_code == 204
    assert client.put(f"{path}/widgets/{renamed['id']}", json={"title": "My unchanged custom name"}).status_code == 200
    for _ in range(2):
        assert client.get("/api/dashboards").json()[0]["widget_count"] == 9
        detail = client.get(path).json()
        assert removed["id"] not in [widget["id"] for widget in detail["widgets"]]
        assert (
            next(widget for widget in detail["widgets"] if widget["id"] == renamed["id"])["title"]
            == "My unchanged custom name"
        )
        assert next(widget for widget in detail["widgets"] if widget["id"] == renamed["id"])["spec"] == renamed["spec"]

    reset = client.post(f"{path}/reset")
    assert reset.status_code == 200
    assert len(reset.json()["widgets"]) == 10
    assert set(widget["id"] for widget in reset.json()["widgets"]).isdisjoint(widget["id"] for widget in original)


def test_canvas_empty_named_dashboard_survives_overview_deletion_and_last_delete_seeds(client):
    overview = client.get("/api/dashboards").json()[0]
    custom = client.post("/api/dashboards", json={"name": "Empty named canvas"}).json()
    path = f"/api/dashboards/{custom['id']}"
    assert client.post(f"{path}/reset").status_code == 400
    assert client.delete(f"/api/dashboards/{overview['id']}").status_code == 204
    for _ in range(2):
        assert [row["id"] for row in client.get("/api/dashboards").json()] == [custom["id"]]
        assert client.get(path).json()["widgets"] == []
    assert client.delete(path).status_code == 204
    seeded = client.get("/api/dashboards").json()
    assert len(seeded) == 1
    assert seeded[0]["slug"] == "overview"
    assert seeded[0]["widget_count"] == 10
    assert seeded[0]["id"] != overview["id"]


def test_canvas_individual_queries_preserve_aggregate_context_comparison_contract(client):
    overview = client.get("/api/dashboards").json()[0]
    path = f"/api/dashboards/{overview['id']}"
    query = {
        "source": "sessions",
        "measure": "session_count",
        "group_by": ["day"],
        "chart": "line",
        "date_range": {"preset": "custom", "start_date": "2026-01-01", "end_date": "2026-01-03"},
        "comparison": {"mode": "previous_period"},
        "fill_gaps": True,
        "sort": "dimension_asc",
    }
    created = client.post(
        f"{path}/widgets",
        json={
            "title": "Custom baseline",
            "width": "full",
            "spec": {"mode": "structured", "query": query},
        },
    )
    assert created.status_code == 201
    context = {"timezone": "UTC", "first_day_of_week": 0}
    combined = client.post(f"{path}/data", json=context).json()
    for widget in client.get(path).json()["widgets"]:
        individual = client.post("/analytics/query", json={**context, "query": widget["spec"]["query"]})
        assert individual.status_code == 200
        independent = individual.json()
        aggregate = combined["results"][widget["id"]]
        # Each read measures its own execution time; all semantic metadata must match.
        assert independent["meta"].pop("elapsed_ms") >= 0
        assert aggregate["meta"].pop("elapsed_ms") >= 0
        assert independent == aggregate
    compared = combined["results"][created.json()["id"]]
    assert compared["comparison"]["alignment"] == "positional"
    assert len(compared["rows"]) == 3


def test_canvas_named_widget_edit_reorder_and_remove_read_back(client):
    created = client.post("/api/dashboards", json={"name": "My canvas"})
    assert created.status_code == 201
    path = f"/api/dashboards/{created.json()['id']}"
    widgets = []
    for title in ["First", "Second"]:
        response = client.post(
            f"{path}/widgets",
            json={
                "title": title,
                "width": "half",
                "spec": {
                    "mode": "structured",
                    "query": {
                        "source": "sessions",
                        "measure": "session_count",
                        "chart": "tile",
                    },
                },
            },
        )
        assert response.status_code == 201
        widgets.append(response.json())
    assert client.put(path, json={"name": "Renamed canvas"}).status_code == 200
    assert (
        client.put(f"{path}/widgets/{widgets[0]['id']}", json={"title": "Edited", "width": "full"}).status_code == 200
    )
    assert (
        client.post(f"{path}/widgets/reorder", json={"widget_ids": [w["id"] for w in reversed(widgets)]}).status_code
        == 200
    )
    detail = client.get(path).json()
    assert detail["name"] == "Renamed canvas"
    assert [w["title"] for w in detail["widgets"]] == ["Second", "Edited"]
    assert detail["widgets"][1]["width"] == "full"
    assert client.delete(f"{path}/widgets/{widgets[1]['id']}").status_code == 204
    assert [w["title"] for w in client.get(path).json()["widgets"]] == ["Edited"]
