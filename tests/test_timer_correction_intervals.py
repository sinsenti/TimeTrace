"""Dated starts and exact exclusions through the root HTTP seam."""

import os
import subprocess
import sys
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from test_timer_correction_preview import persisted_snapshot
from test_timer_correction_steps import clock as _base_clock

clock = _base_clock


def test_overnight_explicit_start_preserves_dates(client, clock):
    clock.at = datetime(2026, 11, 22, 23, 55, tzinfo=UTC)
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    clock.at += timedelta(minutes=15)
    path = "/timers/" + timer["id"]
    response = client.post(
        path + "/correction-preview",
        json={
            "target": {"kind": "running", "segment_id": timer["running_segment_id"]},
            "change": {
                "kind": "set_start",
                "start_utc": "2026-11-22T23:50:00Z",
                "timezone": "UTC",
                "local_datetime": "2026-11-22T23:50:00",
                "offset_seconds": 0,
            },
        },
    )
    assert response.status_code == 200, response.text
    approved = response.json()
    assert approved["after"]["start_utc"] == "2026-11-22T23:50:00+00:00"
    assert approved["duration_seconds"] == 1200
    result = client.post(path + "/correction", json={"operation_id": "correct", "preview": approved})
    assert result.status_code == 200, result.text
    stopped = client.post(path + "/stop", json={"operation_id": "stop"}).json()
    work = client.get("/recorded-work/" + stopped["recorded_work_ids"][0]).json()
    assert work["start_time"].startswith("2026-11-22T23:50:00")
    assert work["end_time"].startswith("2026-11-23T00:10:00")


@pytest.mark.parametrize("paused", [False, True])
def test_exact_middle_exclusion_retains_original_times(client, clock, paused):
    clock.at = datetime(2026, 11, 23, 11, tzinfo=UTC)
    timer = client.post("/timers", json={"operation_id": "start", "notes": "keep"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    path = "/timers/" + timer["id"]
    clock.at += timedelta(minutes=30)
    if paused:
        current = client.post(path + "/pause", json={"operation_id": "pause"}).json()["timer"]
        target = {"kind": "buffered", "segment_id": current["manual_pause_note_segment_id"]}
    else:
        target = {"kind": "running", "segment_id": timer["running_segment_id"]}
    response = client.post(
        path + "/correction-preview",
        json={
            "target": target,
            "change": {
                "kind": "exclude",
                "start_utc": "2026-11-23T11:10:00Z",
                "end_utc": "2026-11-23T11:15:00Z",
                "timezone": "UTC",
                "start_local_datetime": "2026-11-23T11:10:00",
                "end_local_datetime": "2026-11-23T11:15:00",
                "start_offset_seconds": 0,
                "end_offset_seconds": 0,
            },
        },
    )
    assert response.status_code == 200, response.text
    approved = response.json()
    result = client.post(path + "/correction", json={"operation_id": "exclude", "preview": approved})
    assert result.status_code == 200, result.text
    current = result.json()["timer"]
    assert current["state"] == ("paused" if paused else "running")
    assert current["segments"][0]["id"] == timer["running_segment_id"]
    if paused:
        assert current["manual_pause_note_segment_id"] is None
    stopped = client.post(path + "/stop", json={"operation_id": "stop"}).json()
    rows = [client.get("/recorded-work/" + i).json() for i in stopped["recorded_work_ids"]]
    assert [(r["start_time"][11:19], r["end_time"][11:19]) for r in rows] == [
        ("11:00:00", "11:10:00"),
        ("11:15:00", "11:30:00"),
    ]
    assert [r["notes"] for r in rows] == ["keep", "keep"]
    assert client.post(path + "/stop", json={"operation_id": "stop"}).json() == stopped


def exclusion(target, start="2026-11-23T11:10:00", end="2026-11-23T11:15:00"):
    return {
        "target": target,
        "change": {
            "kind": "exclude",
            "start_utc": start + "Z",
            "end_utc": end + "Z",
            "timezone": "UTC",
            "start_local_datetime": start,
            "end_local_datetime": end,
            "start_offset_seconds": 0,
            "end_offset_seconds": 0,
        },
    }


def begin(client, clock):
    clock.at = datetime(2026, 11, 23, 11, tzinfo=UTC)
    timer = client.post("/timers", json={"operation_id": "start", "notes": "keep"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    clock.at += timedelta(minutes=30)
    return "/timers/" + timer["id"], {"kind": "running", "segment_id": timer["running_segment_id"]}


@pytest.mark.parametrize("offset,utc", [(-14400, "2026-11-01T05:30:00Z"), (-18000, "2026-11-01T06:30:00Z")])
def test_dst_fold_requires_explicit_offset_and_selects_distinct_instant(client, clock, offset, utc):
    clock.at = datetime(2026, 11, 1, 5, tzinfo=UTC)
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    clock.at = datetime(2026, 11, 1, 7, tzinfo=UTC)
    path = "/timers/" + timer["id"]
    request = {
        "target": {"kind": "running", "segment_id": timer["running_segment_id"]},
        "change": {
            "kind": "set_start",
            "start_utc": utc,
            "timezone": "America/New_York",
            "local_datetime": "2026-11-01T01:30:00",
            "offset_seconds": offset,
        },
    }
    missing = deepcopy(request)
    del missing["change"]["offset_seconds"]
    assert client.post(path + "/correction-preview", json=missing).status_code == 422
    response = client.post(path + "/correction-preview", json=request)
    assert response.status_code == 200, response.text
    assert response.json()["after"]["start_utc"] == utc.replace("Z", "+00:00")
    assert response.json()["duration_seconds"] == (5400 if offset == -14400 else 1800)
    assert (
        client.post(path + "/correction", json={"operation_id": "correct", "preview": response.json()}).status_code
        == 200
    )


@pytest.mark.parametrize(
    "zone,local,utc,offset",
    [
        ("America/New_York", "2026-03-08T02:30:00", "2026-03-08T07:30:00Z", -18000),
        ("Bad/Zone", "2026-03-08T03:30:00", "2026-03-08T07:30:00Z", -14400),
        ("America/New_York", "2026-03-08T03:30:00", "2026-03-08T07:30:00Z", -18000),
        ("UTC", "2026-03-07T23:30:00", "2026-03-08T07:30:00Z", 0),
    ],
)
def test_invalid_local_utc_roundtrip_refuses_without_writes(client, db, tmp_path, clock, zone, local, utc, offset):
    clock.at = datetime(2026, 3, 7, 23, tzinfo=UTC)
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    clock.at = datetime(2026, 3, 8, 9, tzinfo=UTC)
    before = persisted_snapshot(tmp_path, db)
    response = client.post(
        "/timers/" + timer["id"] + "/correction-preview",
        json={
            "target": {"kind": "running", "segment_id": timer["running_segment_id"]},
            "change": {
                "kind": "set_start",
                "start_utc": utc,
                "timezone": zone,
                "local_datetime": local,
                "offset_seconds": offset,
            },
        },
    )
    assert response.status_code == 400, response.text
    assert persisted_snapshot(tmp_path, db) == before


def test_step_is_absolute_across_dst_transition(client, clock):
    clock.at = datetime(2026, 3, 8, 7, 2, tzinfo=UTC)
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    clock.at += timedelta(minutes=10)
    response = client.post(
        "/timers/" + timer["id"] + "/correction-preview",
        json={
            "target": {"kind": "running", "segment_id": timer["running_segment_id"]},
            "change": {"kind": "step_start", "credited_delta_seconds": 300},
        },
    )
    assert response.status_code == 200
    assert response.json()["after"]["start_utc"] == "2026-03-08T06:57:00+00:00"


@pytest.mark.parametrize("start,end", [("11:00:00", "11:05:00"), ("11:25:00", "11:30:00")])
@pytest.mark.parametrize("paused", [False, True])
def test_edge_exclusion_and_stop_keep_exact_positive_fragments(client, clock, start, end, paused):
    path, target = begin(client, clock)
    if paused:
        paused_timer = client.post(path + "/pause", json={"operation_id": "pause"}).json()["timer"]
        target = {"kind": "buffered", "segment_id": paused_timer["manual_pause_note_segment_id"]}
    approved = client.post(
        path + "/correction-preview", json=exclusion(target, "2026-11-23T" + start, "2026-11-23T" + end)
    )
    assert approved.status_code == 200, approved.text
    result = client.post(path + "/correction", json={"operation_id": "exclude", "preview": approved.json()})
    assert result.status_code == 200, result.text
    stopped = client.post(path + "/stop", json={"operation_id": "stop"}).json()
    rows = [client.get("/recorded-work/" + i).json() for i in stopped["recorded_work_ids"]]
    assert len(rows) == 1
    assert rows[0]["start_time"][11:19] == ("11:05:00" if start == "11:00:00" else "11:00:00")
    assert rows[0]["end_time"][11:19] == ("11:30:00" if start == "11:00:00" else "11:25:00")


@pytest.mark.parametrize(
    "start,end",
    [
        ("11:10:00", "11:10:00"),
        ("11:15:00", "11:10:00"),
        ("11:00:00", "11:30:00"),
        ("11:30:00", "11:31:00"),
        ("10:55:00", "11:00:00"),
    ],
)
def test_invalid_exclusion_bounds_are_atomic(client, db, tmp_path, clock, start, end):
    path, target = begin(client, clock)
    before = persisted_snapshot(tmp_path, db)
    response = client.post(
        path + "/correction-preview", json=exclusion(target, "2026-11-23T" + start, "2026-11-23T" + end)
    )
    assert response.status_code == 400, response.text
    assert persisted_snapshot(tmp_path, db) == before


def paused_pair(client, clock):
    path, target = begin(client, clock)
    first = client.post(path + "/pause", json={"operation_id": "pause"}).json()["timer"]["segments"][0]
    clock.at += timedelta(minutes=10)
    client.post(path + "/resume", json={"operation_id": "resume"})
    clock.at += timedelta(minutes=30)
    current = client.post(path + "/pause", json={"operation_id": "pause-again"}).json()["timer"]
    return path, first, current


def test_multitarget_pause_gap_and_trimmed_note_pointer(client, clock):
    path, first, current = paused_pair(client, clock)
    target = {
        "kind": "selection",
        "targets": [{"kind": "buffered", "segment_id": s["id"]} for s in current["segments"]],
    }
    approved = client.post(
        path + "/correction-preview", json=exclusion(target, "2026-11-23T11:25:00", "2026-11-23T11:45:00")
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["already_uncredited_seconds"] == 600
    assert approved.json()["removed_seconds"] == 600
    result = client.post(path + "/correction", json={"operation_id": "exclude", "preview": approved.json()})
    assert result.status_code == 200, result.text
    timer = result.json()["timer"]
    assert timer["state"] == "paused"
    assert timer["manual_pause_note_segment_id"] == current["manual_pause_note_segment_id"]
    assert [(s["start_time"][11:19], s["end_time"][11:19]) for s in timer["segments"]] == [
        ("11:00:00", "11:25:00"),
        ("11:45:00", "12:10:00"),
    ]


def test_mixed_buffer_and_running_selection_retains_real_pause(client, clock):
    path, running_target = begin(client, clock)
    first = client.post(path + "/pause", json={"operation_id": "pause"}).json()["timer"]["segments"][0]
    clock.at += timedelta(minutes=10)
    current = client.post(path + "/resume", json={"operation_id": "resume"}).json()["timer"]
    clock.at += timedelta(minutes=30)
    targets = {
        "kind": "selection",
        "targets": [
            {"kind": "running", "segment_id": current["running_segment_id"]},
            {"kind": "buffered", "segment_id": first["id"]},
        ],
    }
    approved = client.post(
        path + "/correction-preview", json=exclusion(targets, "2026-11-23T11:25:00", "2026-11-23T11:45:00")
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["already_uncredited_seconds"] == 600
    result = client.post(path + "/correction", json={"operation_id": "mixed", "preview": approved.json()})
    assert result.status_code == 200, result.text
    assert result.json()["timer"]["state"] == "running"
    assert result.json()["timer"]["running_start"] == "2026-11-23T11:45:00+00:00"
    assert result.json()["timer"]["segments"][0]["end_time"] == "2026-11-23T11:25:00+00:00"


def test_unselected_work_is_not_mislabeled_as_uncredited_gap(client, clock):
    path, first, current = paused_pair(client, clock)
    response = client.post(
        path + "/correction-preview",
        json=exclusion({"kind": "buffered", "segment_id": first["id"]}, "2026-11-23T11:25:00", "2026-11-23T11:45:00"),
    )
    assert response.status_code == 200, response.text
    assert response.json()["removed_seconds"] == 300
    assert response.json()["already_uncredited_seconds"] == 600
    assert response.json()["unselected_covered_seconds"] == 300


def test_splitting_older_target_preserves_pointer_splitting_itself_clears(client, clock):
    path, first, current = paused_pair(client, clock)
    payload = exclusion({"kind": "buffered", "segment_id": first["id"]})
    approved = client.post(path + "/correction-preview", json=payload).json()
    result = client.post(path + "/correction", json={"operation_id": "older", "preview": approved})
    assert result.status_code == 200, result.text
    assert result.json()["timer"]["manual_pause_note_segment_id"] == current["manual_pause_note_segment_id"]
    target = {"kind": "buffered", "segment_id": current["manual_pause_note_segment_id"]}
    payload = exclusion(target, "2026-11-23T11:50:00", "2026-11-23T11:55:00")
    approved = client.post(path + "/correction-preview", json=payload).json()
    result = client.post(path + "/correction", json={"operation_id": "current", "preview": approved})
    assert result.status_code == 200, result.text
    assert result.json()["timer"]["manual_pause_note_segment_id"] is None
    assert (
        client.post(
            path + "/note",
            json={
                "operation_id": "note",
                "expected_revision": result.json()["timer"]["revision"],
                "new_notes": "must refuse",
            },
        ).status_code
        == 409
    )


@pytest.mark.parametrize("invalid", ["duplicate", "foreign", "nonintersect"])
def test_multitarget_invalid_member_refuses_everything(client, db, tmp_path, clock, invalid):
    path, first, current = paused_pair(client, clock)
    target = {"kind": "buffered", "segment_id": first["id"]}
    second = (
        deepcopy(target)
        if invalid == "duplicate"
        else {
            "kind": "buffered",
            "segment_id": ("foreign" if invalid == "foreign" else current["manual_pause_note_segment_id"]),
        }
    )
    before = persisted_snapshot(tmp_path, db)
    response = client.post(
        path + "/correction-preview", json=exclusion({"kind": "selection", "targets": [target, second]})
    )
    assert response.status_code in (400, 409), response.text
    assert persisted_snapshot(tmp_path, db) == before


def test_exclusion_forbidden_evidence_survives_reinit_and_blocks_resurrection(client, clock):
    path, target = begin(client, clock)
    approved = client.post(path + "/correction-preview", json=exclusion(target)).json()
    result = client.post(path + "/correction", json={"operation_id": "exclude", "preview": approved}).json()
    right = {"kind": "running", "segment_id": result["timer"]["running_segment_id"]}
    assert (
        client.post(
            path + "/correction-preview",
            json={"target": right, "change": {"kind": "step_start", "credited_delta_seconds": 300}},
        ).status_code
        == 400
    )
    assert client.post("/timers/correction-initialize", json={"operation_id": "reinit"}).status_code == 200
    assert (
        client.post(
            path + "/correction-preview",
            json={
                "target": right,
                "change": {
                    "kind": "set_start",
                    "start_utc": "2026-11-23T11:10:00Z",
                    "timezone": "UTC",
                    "local_datetime": "2026-11-23T11:10:00",
                    "offset_seconds": 0,
                },
            },
        ).status_code
        == 400
    )


@pytest.mark.parametrize("field", ["range", "allocated", "cutoff", "target"])
def test_exclusion_tampering_cannot_be_authority(client, db, tmp_path, clock, field):
    path, target = begin(client, clock)
    approved = client.post(path + "/correction-preview", json=exclusion(target)).json()
    if field == "range":
        approved["request"]["change"]["end_utc"] = "2026-11-23T11:20:00+00:00"
    elif field == "allocated":
        approved["after"][1]["segment_id"] = "forged"
    elif field == "target":
        approved["request"]["target"]["segment_id"] = "forged"
    else:
        approved["cutoff"] = "2026-11-23T12:00:00+00:00"
    before = persisted_snapshot(tmp_path, db)
    response = client.post(path + "/correction", json={"operation_id": "bad", "preview": approved})
    assert response.status_code == 409, response.text
    assert persisted_snapshot(tmp_path, db) == before


def test_exclusion_stale_target_and_unrelated_timer_activity(client, clock):
    path, target = begin(client, clock)
    approved = client.post(path + "/correction-preview", json=exclusion(target)).json()
    other = client.post("/timers", json={"operation_id": "other"}).json()["timer"]
    client.post("/timers/" + other["id"] + "/pause", json={"operation_id": "other-pause"})
    result = client.post(path + "/correction", json={"operation_id": "exclude", "preview": approved})
    assert result.status_code == 200, result.text
    right = {"kind": "running", "segment_id": result.json()["timer"]["running_segment_id"]}
    fresh = client.post(
        path + "/correction-preview", json=exclusion(right, "2026-11-23T11:20:00", "2026-11-23T11:25:00")
    ).json()
    client.post(path + "/pause", json={"operation_id": "pause"})
    response = client.post(path + "/correction", json={"operation_id": "stale", "preview": fresh})
    assert response.status_code == 409
    assert response.json()["code"] == "correction_preview_stale"
    assert (
        client.post(path + "/correction", json={"operation_id": "exclude", "preview": approved}).json() == result.json()
    )


def test_paused_dated_trim_retains_pointer_and_restores_without_new_bound(client, clock):
    path, target = begin(client, clock)
    paused = client.post(path + "/pause", json={"operation_id": "pause"}).json()["timer"]
    target = {"kind": "buffered", "segment_id": paused["manual_pause_note_segment_id"]}
    for index, stamp in enumerate(["2026-11-23T11:05:00", "2026-11-23T11:00:00"]):
        approved = client.post(
            path + "/correction-preview",
            json={
                "target": target,
                "change": {
                    "kind": "set_start",
                    "start_utc": stamp + "Z",
                    "timezone": "UTC",
                    "local_datetime": stamp,
                    "offset_seconds": 0,
                },
            },
        )
        assert approved.status_code == 200, approved.text
        result = client.post(
            path + "/correction", json={"operation_id": "date-" + str(index), "preview": approved.json()}
        )
        assert result.status_code == 200, result.text
        assert result.json()["timer"]["state"] == "paused"
        assert result.json()["timer"]["manual_pause_note_segment_id"] == paused["manual_pause_note_segment_id"]


def test_genuine_pre_milestone_step_receipt_retries_through_two_restarts(tmp_path):
    fixture = Path(__file__).parent / "fixtures" / "timer_step_v1_7a3a37e.json"
    env = {
        **os.environ,
        "TIMETRACE_DB_FILE": str(tmp_path / "historical.db"),
        "TIMETRACE_TIMER_STATE_FILE": str(tmp_path / "active_timer.json"),
        "HOME": str(tmp_path / "home"),
        "TMPDIR": str(tmp_path),
        "GOLDEN_FIXTURE": str(fixture),
    }
    setup = """
import json, os
from pathlib import Path
from fastapi.testclient import TestClient
from sqlmodel import Session
from timetrace.db.session import init_db, engine
from timetrace.db.models import MutationOperation
from timetrace.main import create_daemon_app
init_db()
s=json.load(open(os.environ['GOLDEN_FIXTURE']))
with Session(engine) as db:
    if db.get(MutationOperation,s['receipt']['id']) is None:
        db.add(MutationOperation.model_validate(s['receipt']))
        db.commit()
        Path(os.environ['TIMETRACE_TIMER_STATE_FILE']).write_text(s['receipt']['after_state_json'])
c=TestClient(create_daemon_app())
r=c.post(s['path']+'/correction',json=s['request'])
assert r.status_code==200,r.text
assert r.json()==json.loads(s['receipt']['result_json'])
assert c.get('/operations/'+s['receipt']['id']).json()['status']=='finalized'
"""
    for _ in range(2):
        subprocess.run([sys.executable, "-P", "-c", setup], env=env, capture_output=True, text=True, check=True)


def test_exclusion_crash_recovery_fixes_fragment_ids_and_stop_rows(tmp_path):
    env = {
        **os.environ,
        "TIMETRACE_DB_FILE": str(tmp_path / "crash.db"),
        "TIMETRACE_TIMER_STATE_FILE": str(tmp_path / "active_timer.json"),
        "HOME": str(tmp_path / "home"),
        "TMPDIR": str(tmp_path),
    }
    setup = """
import os,json
from datetime import UTC,datetime,timedelta
from fastapi.testclient import TestClient
from timetrace.db.session import init_db
from timetrace.main import create_daemon_app
from timetrace.services import multiple_timer_service as module
class Clock(datetime):
    at=datetime(2026,11,23,11,tzinfo=UTC)
    @classmethod
    def now(cls,tz=None): return cls.at
module.datetime=Clock
init_db()
c=TestClient(create_daemon_app())
"""
    crash = (
        setup
        + """
t=c.post('/timers',json={'operation_id':'start','notes':'keep'}).json()['timer']
c.post('/timers/correction-initialize',json={'operation_id':'init'})
Clock.at+=timedelta(minutes=30)
p='/timers/'+t['id']
e=c.post(p+'/correction-preview',json={'target':{'kind':'running','segment_id':t['running_segment_id']},'change':{
    'kind':'exclude','start_utc':'2026-11-23T11:10:00Z','end_utc':'2026-11-23T11:15:00Z','timezone':'UTC',
    'start_local_datetime':'2026-11-23T11:10:00','end_local_datetime':'2026-11-23T11:15:00',
    'start_offset_seconds':0,'end_offset_seconds':0}}).json()
payload={'operation_id':'exclude','preview':e}
open(os.environ['TIMETRACE_DB_FILE']+'.request','w').write(json.dumps({'path':p,'payload':payload}))
replace=os.replace
calls=0
def die(src,dst):
    global calls
    if str(dst)==os.environ['TIMETRACE_TIMER_STATE_FILE']:
        calls+=1
        if calls==2: os._exit(77)
    return replace(src,dst)
os.replace=die
c.post(p+'/correction',json=payload)
"""
    )
    result = subprocess.run([sys.executable, "-P", "-c", crash], env=env, capture_output=True, text=True)
    assert result.returncode == 77, result.stderr
    recovery = (
        setup
        + """
Clock.at+=timedelta(minutes=30)
s=json.load(open(os.environ['TIMETRACE_DB_FILE']+'.request'))
r=c.post(s['path']+'/correction',json=s['payload'])
assert r.status_code==200,r.text
stopped=c.post(s['path']+'/stop',json={'operation_id':'stop'})
assert stopped.status_code==200,stopped.text
assert c.post(s['path']+'/stop',json={'operation_id':'stop'}).json()==stopped.json()
expected_ids=[f['segment_id'] for f in s['payload']['preview']['after']]
assert expected_ids==[f['id'] for f in stopped.json()['timer']['segments']]
rows=[c.get('/recorded-work/'+i).json() for i in stopped.json()['recorded_work_ids']]
assert len(rows)==2
assert [(r['start_time'][11:19],r['end_time'][11:19]) for r in rows]==[('11:00:00','11:10:00'),('11:15:00','11:30:00')]
assert [r['notes'] for r in rows]==['keep','keep']
"""
    )
    for _ in range(2):
        subprocess.run([sys.executable, "-P", "-c", recovery], env=env, capture_output=True, text=True, check=True)
