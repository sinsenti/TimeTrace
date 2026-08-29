from datetime import UTC, datetime, timedelta
from typing import Any


def calculate_tag_summaries(sessions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Calculates cumulative time spent per tag.

    Reference implementation. `AnalyticsService.get_summary()` used to call this directly; it
    now goes through `QueryService`/`core/query_compiler.py` (sessions x sum_duration x [tag],
    fan-out attribution), which reproduces this exact tag fan-out/#general fallback contract
    in SQL. This function is kept as the documented contract that SQL must match, and as a
    fallback reference if the SQL path is ever in doubt -- not because anything still calls it.
    """
    tag_totals: dict[str, dict[str, Any]] = {}

    for s in sessions:
        dur_seconds = s.get("duration_seconds") or 0
        tag_str = s.get("tags") or "#general"
        tags = [t.strip() for t in tag_str.split() if t.startswith("#")]
        if not tags:
            tags = ["#general"]

        for tag in tags:
            if tag not in tag_totals:
                tag_totals[tag] = {"tag": tag, "total_seconds": 0, "session_count": 0}
            tag_totals[tag]["total_seconds"] += dur_seconds
            tag_totals[tag]["session_count"] += 1

    summary = []
    for tag, data in tag_totals.items():
        summary.append(
            {
                "tag": tag,
                "total_hours": round(data["total_seconds"] / 3600.0, 2),
                "session_count": data["session_count"],
            }
        )

    summary.sort(key=lambda x: x["total_hours"], reverse=True)
    return summary


def calculate_day_breakdowns(sessions: list[dict[str, Any]], task_titles: dict[str, str]) -> dict[str, Any]:
    """Breaks a single day's sessions down by tag (fan-out attribution -- the
    full session duration is credited to every tag on that session, so tag
    percentages of the day total can sum past 100%, matching
    calculate_tag_summaries's tokenizing rules) and by task (exclusive -- each
    session contributes to exactly one task row). Sessions without a task_id
    collapse into a single "Direct Session Log" row; a task_id not present in
    task_titles (task since deleted) becomes "(deleted task)".
    """
    total_seconds = sum(s.get("duration_seconds") or 0 for s in sessions)

    if total_seconds == 0:
        return {"total_seconds": 0, "tag_breakdown": [], "task_breakdown": []}

    tag_totals: dict[str, dict[str, Any]] = {}
    task_totals: dict[str | None, dict[str, Any]] = {}

    for s in sessions:
        dur_seconds = s.get("duration_seconds") or 0

        tag_str = s.get("tags") or "#general"
        tags = [t.strip() for t in tag_str.split() if t.startswith("#")]
        if not tags:
            tags = ["#general"]
        for tag in tags:
            if tag not in tag_totals:
                tag_totals[tag] = {"tag": tag, "total_seconds": 0, "session_count": 0}
            tag_totals[tag]["total_seconds"] += dur_seconds
            tag_totals[tag]["session_count"] += 1

        task_id = s.get("task_id")
        if task_id not in task_totals:
            if task_id is None:
                title = "Direct Session Log"
            elif task_id in task_titles:
                title = task_titles[task_id]
            else:
                title = "(deleted task)"
            task_totals[task_id] = {
                "task_id": task_id,
                "title": title,
                "total_seconds": 0,
                "session_count": 0,
            }
        task_totals[task_id]["total_seconds"] += dur_seconds
        task_totals[task_id]["session_count"] += 1

    def finalize(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        for row in rows:
            row["total_hours"] = round(row["total_seconds"] / 3600.0, 2)
            row["percent"] = round((row["total_seconds"] / total_seconds) * 100, 1)
        rows.sort(key=lambda r: r["total_seconds"], reverse=True)
        return rows

    return {
        "total_seconds": total_seconds,
        "tag_breakdown": finalize(list(tag_totals.values())),
        "task_breakdown": finalize(list(task_totals.values())),
    }


def calculate_detailed_analytics(sessions: list[dict[str, Any]], tasks: list[dict[str, Any]]) -> dict[str, Any]:
    """Generates comprehensive statistics and estimation accuracy metrics.

    Reference implementation, retired from the live request path. This loaded every session
    and task into Python to aggregate them and bucketed `daily_trend` by UTC date while
    `hourly_distribution` used local time -- both defects the structured query engine
    (`core/query_compiler.py` + `services/query_service.py`) fixes by aggregating in SQL and
    bucketing everything by local calendar time. The `/stats` "Overview" dashboard now composes
    the equivalent widgets through `POST /analytics/query/batch` instead of calling
    `AnalyticsService.get_detailed()` (retired; see `analytics_service.py`). Kept here, unused,
    as the documented behavioural reference for estimation-accuracy bucketing (0.85-1.15 =
    accurate) that the SQL estimation CTE deliberately reproduces, including its one noted
    divergence (zero-evaluated-tasks fallback to 100%, which the SQL path intentionally does
    NOT copy).
    """
    now = datetime.now(UTC)

    total_seconds = sum(s.get("duration_seconds") or 0 for s in sessions)
    total_hours = round(total_seconds / 3600.0, 2)
    total_sessions = len(sessions)

    # Daily Focus Trend (Last 14 days)
    daily_trend: dict[str, float] = {}
    for i in range(13, -1, -1):
        d_str = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        daily_trend[d_str] = 0.0

    for s in sessions:
        st_raw = s.get("start_time")
        if not st_raw:
            continue
        st_date = st_raw[:10] if isinstance(st_raw, str) else st_raw.strftime("%Y-%m-%d")
        if st_date in daily_trend:
            dur = (s.get("duration_seconds") or 0) / 3600.0
            daily_trend[st_date] = round(daily_trend[st_date] + dur, 2)

    # Hourly Focus Distribution
    hourly_distribution = {f"{h:02d}:00": 0.0 for h in range(24)}
    for s in sessions:
        st_raw = s.get("start_time")
        if not st_raw:
            continue
        try:
            if isinstance(st_raw, str):
                st_dt = datetime.fromisoformat(st_raw.replace("Z", "+00:00"))
            else:
                st_dt = st_raw

            local_dt = st_dt.astimezone() if st_dt.tzinfo else st_dt.replace(tzinfo=UTC).astimezone()
            hour_key = f"{local_dt.hour:02d}:00"
            dur = (s.get("duration_seconds") or 0) / 3600.0
            if hour_key in hourly_distribution:
                hourly_distribution[hour_key] = round(hourly_distribution[hour_key] + dur, 2)
        except Exception:
            pass

    task_status_counts = {"To Do": 0, "Ongoing": 0, "Scheduled": 0, "Done": 0, "Backlog": 0}
    task_priority_counts = {"high": 0, "medium": 0, "low": 0, "-": 0}

    for t in tasks:
        st = str(t.get("status", "To Do"))
        pr = str(t.get("priority", "-")).lower()

        if st in task_status_counts:
            task_status_counts[st] += 1
        elif st.lower() in ("completed", "done"):
            task_status_counts["Done"] += 1
        elif st.lower() in ("in_progress", "in progress", "ip"):
            task_status_counts["To Do"] += 1

        if pr in task_priority_counts:
            task_priority_counts[pr] += 1

    task_actual_secs: dict[int, int] = {}
    for s in sessions:
        tid = s.get("task_id")
        if tid:
            task_actual_secs[tid] = task_actual_secs.get(tid, 0) + (s.get("duration_seconds") or 0)

    eval_tasks = tasks

    total_est_minutes = sum(t.get("estimated_minutes") or 15 for t in eval_tasks)
    total_est_hours = round(total_est_minutes / 60.0, 2)

    accurate_count = 0
    underestimated_count = 0
    overestimated_count = 0

    for t in eval_tasks:
        tid = t.get("id")
        est_secs = (t.get("estimated_minutes") or 15) * 60
        actual_secs = task_actual_secs.get(tid, 0)

        if actual_secs == 0:
            continue

        ratio = actual_secs / est_secs if est_secs > 0 else 1.0
        if 0.85 <= ratio <= 1.15:
            accurate_count += 1
        elif ratio > 1.15:
            underestimated_count += 1
        else:
            overestimated_count += 1

    evaluated_tasks_count = accurate_count + underestimated_count + overestimated_count
    accuracy_score_pct = (
        round((accurate_count / evaluated_tasks_count) * 100, 1) if evaluated_tasks_count > 0 else 100.0
    )

    return {
        "summary": {"total_hours": total_hours, "total_sessions": total_sessions, "tasks_count": len(tasks)},
        "estimation": {
            "total_estimated_hours": total_est_hours,
            "total_actual_hours": total_hours,
            "accuracy_score_pct": accuracy_score_pct,
            "accurate_count": accurate_count,
            "underestimated_count": underestimated_count,
            "overestimated_count": overestimated_count,
            "evaluated_tasks_count": evaluated_tasks_count,
        },
        "tags_summary": calculate_tag_summaries(sessions),
        "daily_trend": daily_trend,
        "hourly_distribution": hourly_distribution,
        "task_status": task_status_counts,
        "task_priority": task_priority_counts,
    }
