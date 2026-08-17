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
    """Generates comprehensive statistics for the custom analytics dashboard."""
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

    # Hourly Focus Distribution (00:00 to 23:00 Heatmap)
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

    # Task Status & Priority Breakdown (Mapped to canonical status values)
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

    return {
        "summary": {
            "total_hours": total_hours,
            "total_sessions": total_sessions,
            "tasks_count": len(tasks)
        },
        "tags_summary": calculate_tag_summaries(sessions),
        "daily_trend": daily_trend,
        "hourly_distribution": hourly_distribution,
        "task_status": task_status_counts,
        "task_priority": task_priority_counts
    }
