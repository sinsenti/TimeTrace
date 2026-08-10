from typing import List, Dict, Any
from datetime import datetime, timedelta, date, timezone


def calculate_tag_summaries(sessions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Calculates cumulative time spent per tag."""
    tag_totals: Dict[str, Dict[str, Any]] = {}

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


def calculate_detailed_analytics(sessions: List[Dict[str, Any]], tasks: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Generates comprehensive statistics for the custom analytics dashboard."""
    now = datetime.now(timezone.utc)
    
    # 1. Total Metrics
    total_seconds = sum(s.get("duration_seconds") or 0 for s in sessions)
    total_hours = round(total_seconds / 3600.0, 2)
    total_sessions = len(sessions)

    # 2. Daily Focus Trend (Last 14 days)
    daily_trend: Dict[str, float] = {}
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

    # 3. Hourly Focus Distribution (00:00 to 23:00 Heatmap)
    hourly_distribution = {f"{h:02d}:00": 0.0 for h in range(24)}
    for s in sessions:
        st_raw = s.get("start_time")
        if not st_raw:
            continue
        try:
            st_dt = datetime.fromisoformat(st_raw.replace("Z", "+00:00")) if isinstance(st_raw, str) else st_raw
            hour_key = f"{st_dt.hour:02d}:00"
            dur = (s.get("duration_seconds") or 0) / 3600.0
            if hour_key in hourly_distribution:
                hourly_distribution[hour_key] = round(hourly_distribution[hour_key] + dur, 2)
        except Exception:
            pass

    # 4. Energy & Habits Analytics (from Reflections)
    energy_levels: List[Dict[str, Any]] = []
    habit_counts: Dict[str, int] = {}
    obstacles_list: List[str] = []

    for s in sorted(sessions, key=lambda x: x.get("start_time") or ""):
        ref = s.get("reflection")
        if ref:
            st_raw = s.get("start_time", "")[:10]
            if ref.get("energy_level"):
                energy_levels.append({
                    "date": st_raw,
                    "energy": ref["energy_level"]
                })
            
            habits_raw = ref.get("habits_completed") or ""
            habits = [h.strip() for h in habits_raw.split(",") if h.strip()] if isinstance(habits_raw, str) else habits_raw
            for h in habits:
                habit_counts[h] = habit_counts.get(h, 0) + 1

            if ref.get("obstacles"):
                obstacles_list.append(f"{st_raw}: {ref['obstacles']}")

    avg_energy = round(sum(e["energy"] for e in energy_levels) / len(energy_levels), 2) if energy_levels else None

    # 5. Task Status & Priority Breakdown
    task_status_counts = {"in_progress": 0, "ongoing": 0, "completed": 0}
    task_priority_counts = {"high": 0, "medium": 0, "low": 0, "-": 0}

    for t in tasks:
        st = str(t.get("status", "in_progress")).lower()
        pr = str(t.get("priority", "-")).lower()
        if st in task_status_counts:
            task_status_counts[st] += 1
        if pr in task_priority_counts:
            task_priority_counts[pr] += 1

    return {
        "summary": {
            "total_hours": total_hours,
            "total_sessions": total_sessions,
            "avg_energy": avg_energy,
            "tasks_count": len(tasks)
        },
        "tags_summary": calculate_tag_summaries(sessions),
        "daily_trend": daily_trend,
        "hourly_distribution": hourly_distribution,
        "energy_trend": energy_levels,
        "habits_summary": habit_counts,
        "obstacles": obstacles_list[-10:],  # Recent 10 obstacles
        "task_status": task_status_counts,
        "task_priority": task_priority_counts
    }

