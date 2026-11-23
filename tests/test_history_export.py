"""Public selected-history export regressions with synthetic evidence."""

from datetime import datetime

import pytest


@pytest.fixture(autouse=True)
def history_test_zone(monkeypatch):
    import time

    import timetrace.core.timezones as zones

    monkeypatch.setenv("TZ", "UTC")
    time.tzset()
    zones._reset_caches()
    yield
    monkeypatch.undo()
    time.tzset()
    zones._reset_caches()


def test_history_candidate_scan_refuses_incomplete_filtered_success_but_explicit_ids_are_bounded(client, db):
    from timetrace.db.models import Session as SavedInterval

    records = [
        SavedInterval(
            start_time=datetime(2000, 1, 4, 10),
            end_time=datetime(2000, 1, 4, 11),
            kind="recorded_work",
            provenance="manual",
            notes="excluded",
        )
        for _ in range(10001)
    ]
    records[-1].notes = "CAFÉ"
    db.add_all(records)
    db.commit()
    identifier = records[-1].id
    request = {"start_date": "2000-01-04", "end_date": "2000-01-04", "timezone": "UTC", "note": "café"}
    filtered = client.post("/api/agenda/history-export/preview", json={**request, "mode": "filtered"})
    assert filtered.status_code == 400
    assert "10,000" in filtered.text
    selected = client.post(
        "/api/agenda/history-export/preview", json={**request, "mode": "selected", "selected_ids": [identifier]}
    )
    assert selected.status_code == 200, selected.text
    assert selected.json()["work_count"] == 1
    assert selected.json()["summed_recorded_work_seconds"] == 3600


@pytest.mark.parametrize(
    "changes",
    [
        {"mode": "filtered", "selected_ids": ["00000000-0000-0000-0000-000000000001"]},
        {"task_id": "not-a-uuid"},
        {"task_id": ""},
        {"start_date": "9999-12-31", "end_date": "9999-12-31"},
        {"start_date": "2000-01-04", "end_date": "2002-01-04"},
        {"mode": "selected", "selected_ids": ["00000000-0000-0000-0000-000000000001"]},
    ],
)
def test_history_preview_refuses_unsupported_or_stale_selection(client, changes):
    request = {"start_date": "2000-01-04", "end_date": "2000-01-04", "timezone": "UTC", "mode": "selected"}
    response = client.post("/api/agenda/history-export/preview", json={**request, **changes})
    assert response.status_code == 400, response.text


def test_history_unicode_literal_filters_and_csv_payloads_do_not_mutate_saved_notes(client):
    import csv
    import io

    task = client.post("/api/tasks", json={"title": "CAFÉ | <b> [x] `code`"}).json()["id"]
    note = "\ufeff \t=SUM(1,2)\nUnicode café | <script>alert(1)</script>"
    identifier = client.post(
        "/recorded-work",
        json={
            "task_id": task,
            "start_time": "2000-01-04T23:30:00Z",
            "end_time": "2000-01-05T01:30:00Z",
            "notes": note,
            "tags": "#ÉTÉ",
        },
    ).json()["id"]
    request = {
        "start_date": "2000-01-04",
        "end_date": "2000-01-04",
        "timezone": "UTC",
        "mode": "filtered",
        "title": "café",
        "tag": "été",
        "note": "UNICODE",
    }
    response = client.post("/api/agenda/history-export/preview", json=request)
    assert response.status_code == 200, response.text
    envelope = response.json()
    assert envelope["work_count"] == 1
    assert envelope["rows"][0]["note"] == note
    assert envelope["summed_recorded_work_seconds"] == 7200
    csv_rows = list(csv.DictReader(io.StringIO(envelope["csv"]["content"])))
    assert csv_rows[0]["note"] == "'" + note
    assert csv_rows[0]["task_id"] == task
    assert "<script>" not in envelope["markdown"]["content"]
    assert "\\|" in envelope["markdown"]["content"]
    # A fresh public read observes original strings, not serializer transformations.
    repeated = client.post(
        "/api/agenda/history-export/preview", json={**request, "mode": "selected", "selected_ids": [identifier]}
    )
    assert repeated.json()["rows"][0]["note"] == note


def test_legacy_opt_in_is_separate_and_plan_carry_in_never_become_work(client):
    interval = {"start_time": "2000-01-04T08:00:00Z", "end_time": "2000-01-04T13:00:00Z"}
    legacy = client.post("/sessions", json=interval).json()["id"]
    assert client.post("/scheduled-sessions", json=interval).status_code == 201
    carry = client.post(
        "/recorded-work", json={"start_time": "2000-01-03T23:30:00Z", "end_time": "2000-01-04T02:00:00Z"}
    ).json()["id"]
    request = {"start_date": "2000-01-04", "end_date": "2000-01-04", "timezone": "UTC", "mode": "filtered"}
    ordinary = client.post("/api/agenda/history-export/preview", json=request).json()
    assert ordinary["rows"] == []
    opted = client.post("/api/agenda/history-export/preview", json={**request, "include_uncertain": True}).json()
    assert opted["work_count"] == 0
    assert opted["legacy_count"] == 1
    assert opted["rows"][0]["id"] == legacy
    assert opted["rows"][0]["duration_seconds"] is None
    assert opted["rows"][0]["source"] is None
    assert opted["summed_recorded_work_seconds"] == opted["elapsed_recorded_time_seconds"] == 0
    stale = client.post(
        "/api/agenda/history-export/preview", json={**request, "mode": "selected", "selected_ids": [carry]}
    )
    assert stale.status_code == 400


@pytest.mark.parametrize("note", ["=1+1", " +1", "\t@SUM(A1)", "\r-1", "\n=1", "\ufeff =1", "\x01 \ufeff\t+1"])
def test_every_formula_or_control_prefix_is_spreadsheet_inert(client, note):
    import csv
    import io

    client.post(
        "/recorded-work", json={"start_time": "2000-01-04T10:00:00Z", "end_time": "2000-01-04T11:00:00Z", "notes": note}
    )
    preview = client.post(
        "/api/agenda/history-export/preview",
        json={"start_date": "2000-01-04", "end_date": "2000-01-04", "timezone": "UTC", "mode": "filtered"},
    ).json()
    row = next(csv.DictReader(io.StringIO(preview["csv"]["content"])))
    assert row["note"] == "'" + note
    assert preview["rows"][0]["note"] == note


def test_eligible_row_cap_and_combined_artifact_cap_refuse_not_truncate(client, db):
    from timetrace.db.models import Session as SavedInterval

    db.add_all(
        [
            SavedInterval(
                start_time=datetime(2000, 1, 4, 10),
                end_time=datetime(2000, 1, 4, 11),
                kind="recorded_work",
                provenance="manual",
            )
            for _ in range(2001)
        ]
    )
    db.commit()
    request = {"start_date": "2000-01-04", "end_date": "2000-01-04", "timezone": "UTC", "mode": "filtered"}
    response = client.post("/api/agenda/history-export/preview", json=request)
    assert response.status_code == 400
    assert "2,000" in response.text
    giant = client.post(
        "/recorded-work",
        json={"start_time": "2000-01-05T10:00:00Z", "end_time": "2000-01-05T11:00:00Z", "notes": "x" * (2200 * 1024)},
    ).json()["id"]
    response = client.post(
        "/api/agenda/history-export/preview",
        json={
            **request,
            "start_date": "2000-01-05",
            "end_date": "2000-01-05",
            "mode": "selected",
            "selected_ids": [giant],
        },
    )
    assert response.status_code == 400
    assert "4 MiB" in response.text


def test_repeated_dst_hour_has_endpoint_specific_offsets_and_utc_duration(client, monkeypatch):
    import time

    import timetrace.core.timezones as zones

    monkeypatch.setenv("TZ", "America/New_York")
    time.tzset()
    zones._reset_caches()
    client.post("/recorded-work", json={"start_time": "2000-10-29T05:30:00Z", "end_time": "2000-10-29T06:30:00Z"})
    result = client.post(
        "/api/agenda/history-export/preview",
        json={"start_date": "2000-10-29", "end_date": "2000-10-29", "timezone": "Europe/Warsaw", "mode": "filtered"},
    ).json()
    assert result["rows"][0]["start"] == "2000-10-29T01:30:00-04:00"
    assert result["rows"][0]["end"] == "2000-10-29T01:30:00-05:00"
    assert result["timezone"] == "America/New_York"
    assert result["warnings"]
    assert result["summed_recorded_work_seconds"] == result["elapsed_recorded_time_seconds"] == 3600


def test_invalid_daemon_zone_uses_explicit_utc_fallback(client, monkeypatch):
    import time

    import timetrace.core.timezones as zones

    monkeypatch.setenv("TZ", "Not/A_Zone")
    time.tzset()
    zones._reset_caches()
    result = client.post(
        "/api/agenda/history-export/preview",
        json={
            "start_date": "2000-01-04",
            "end_date": "2000-01-04",
            "timezone": "UTC",
            "mode": "selected",
            "selected_ids": [],
        },
    )
    assert result.status_code == 200
    assert result.json()["timezone"] == "UTC"
    assert result.json()["warnings"]


def test_taskless_title_filter_uses_same_visible_no_task_label(client):
    client.post("/recorded-work", json={"start_time": "2000-01-04T10:00:00Z", "end_time": "2000-01-04T11:00:00Z"})
    result = client.post(
        "/api/agenda/history-export/preview",
        json={
            "start_date": "2000-01-04",
            "end_date": "2000-01-04",
            "timezone": "UTC",
            "mode": "filtered",
            "title": "no TASK",
        },
    ).json()
    assert result["work_count"] == 1


def test_export_preserves_microsecond_precision_without_hour_roundtrip(client):
    client.post(
        "/recorded-work", json={"start_time": "2000-01-04T10:00:00Z", "end_time": "2000-01-04T10:00:00.000007Z"}
    )
    preview = client.post(
        "/api/agenda/history-export/preview",
        json={"start_date": "2000-01-04", "end_date": "2000-01-04", "timezone": "UTC", "mode": "filtered"},
    ).json()
    assert preview["summed_recorded_work_seconds"] == 0.000007
    assert preview["elapsed_recorded_time_seconds"] == 0.000007


def test_summed_recorded_work_counts_same_task_overlap_fully(client):
    task = client.post("/api/tasks", json={"title": "Overlap"}).json()["id"]
    for start, end, task_id in [("10:00", "11:00", task), ("10:30", "11:30", task), ("11:15", "11:45", None)]:
        response = client.post(
            "/recorded-work",
            json={
                "start_time": f"2000-01-04T{start}:00Z",
                "end_time": f"2000-01-04T{end}:00Z",
                "task_id": task_id,
            },
        )
        assert response.status_code == 201, response.text
    query = {
        "source": "recorded_work",
        "measure": "summed_recorded_work",
        "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"},
    }
    response = client.post("/analytics/query", json={"timezone": "UTC", "query": query})
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 2.5
    assert response.json()["meta"]["basis"] == "summed_recorded_work"
    query["measure"] = "elapsed_recorded_time"
    assert client.post("/analytics/query", json={"timezone": "UTC", "query": query}).json()["total"] == 1.75


def test_explicit_empty_history_preview_never_exports_all(client):
    response = client.post(
        "/recorded-work",
        json={
            "start_time": "2000-01-04T10:00:00Z",
            "end_time": "2000-01-04T11:00:00Z",
        },
    )
    assert response.status_code == 201
    response = client.post(
        "/api/agenda/history-export/preview",
        json={
            "start_date": "2000-01-04",
            "end_date": "2000-01-04",
            "timezone": "UTC",
            "mode": "selected",
            "selected_ids": [],
        },
    )
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["work_count"] == 0
    assert preview["rows"] == []
    assert preview["summed_recorded_work_seconds"] == 0
    assert preview["elapsed_recorded_time_seconds"] == 0
    assert preview["markdown"]["content"]
    assert preview["csv"]["content"]


def test_selected_history_snapshot_excludes_unselected_work_and_counts_overlap(client):
    ids = []
    for start, end in [("10:00", "11:00"), ("10:30", "11:30"), ("09:00", "12:00")]:
        ids.append(
            client.post(
                "/recorded-work",
                json={
                    "start_time": f"2000-01-04T{start}:00Z",
                    "end_time": f"2000-01-04T{end}:00Z",
                    "notes": "=SUM(1,2)",
                },
            ).json()["id"]
        )
    response = client.post(
        "/api/agenda/history-export/preview",
        json={
            "start_date": "2000-01-04",
            "end_date": "2000-01-04",
            "timezone": "UTC",
            "mode": "selected",
            "selected_ids": ids[:2],
        },
    )
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["work_count"] == 2
    assert {r["id"] for r in preview["rows"]} == set(ids[:2])
    assert preview["summed_recorded_work_seconds"] == 7200
    assert preview["elapsed_recorded_time_seconds"] == 5400
    assert "'=SUM(1,2)" in preview["csv"]["content"]
    assert "+00:00" in preview["markdown"]["content"]
    assert "Local start dates: 2000-01-04 through 2000-01-04" in preview["markdown"]["content"]
