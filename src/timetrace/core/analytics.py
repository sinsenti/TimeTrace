from datetime import UTC, datetime, timedelta
from typing import Any


def calculate_tag_summaries(sessions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Calculates cumulative time spent per tag."""
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
        summary.append({
            "tag": tag,
            "total_hours": round(data["total_seconds"] / 3600.0, 2),
            "session_count": data["session_count"]
        })

    summary.sort(key=lambda x: x["total_hours"], reverse=True)
    return summary


def calculate_detailed_analytics(sessions: list[dict[str, Any]], tasks: list[dict[str, Any]]) -> dict[str, Any]:
    """Generates comprehensive statistics and estimation accuracy metrics."""
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

    # Task Status & Priority Breakdown
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

    # Estimation Accuracy Analysis (Excludes tasks with 'Ongoing' status)
    task_actual_secs: dict[int, int] = {}
    for s in sessions:
        tid = s.get("task_id")
        if tid:
            task_actual_secs[tid] = task_actual_secs.get(tid, 0) + (s.get("duration_seconds") or 0)

    eval_tasks = [t for t in tasks if str(t.get("status", "")).lower() != "ongoing"]

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
    accuracy_score_pct = round((accurate_count / evaluated_tasks_count) * 100, 1) if evaluated_tasks_count > 0 else 100.0

    return {
        "summary": {
            "total_hours": total_hours,
            "total_sessions": total_sessions,
            "tasks_count": len(tasks)
        },
        "estimation": {
            "total_estimated_hours": total_est_hours,
            "total_actual_hours": total_hours,
            "accuracy_score_pct": accuracy_score_pct,
            "accurate_count": accurate_count,
            "underestimated_count": underestimated_count,
            "overestimated_count": overestimated_count,
            "evaluated_tasks_count": evaluated_tasks_count
        },
        "tags_summary": calculate_tag_summaries(sessions),
        "daily_trend": daily_trend,
        "hourly_distribution": hourly_distribution,
        "task_status": task_status_counts,
        "task_priority": task_priority_counts
    }
