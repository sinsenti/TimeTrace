from typing import List, Dict, Any
from collections import defaultdict


def calculate_tag_summaries(sessions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    tag_data = defaultdict(lambda: {"total_seconds": 0, "session_count": 0, "sessions": []})

    for s in sessions:
        tags_str = s.get("tags") or "#uncategorized"
        tags_list = [t.strip() for t in tags_str.split() if t.startswith("#")]
        if not tags_list:
            tags_list = ["#uncategorized"]

        duration = s.get("duration_seconds") or 0

        for tag in tags_list:
            tag_data[tag]["total_seconds"] += duration
            tag_data[tag]["session_count"] += 1
            tag_data[tag]["sessions"].append({
                "id": s.get("id"),
                "start_time": s.get("start_time"),
                "end_time": s.get("end_time"),
                "duration_seconds": duration,
                "notes": s.get("notes")
            })

    summary = []
    for tag, data in tag_data.items():
        summary.append({
            "tag": tag,
            "total_seconds": data["total_seconds"],
            "total_hours": round(data["total_seconds"] / 3600, 2),
            "session_count": data["session_count"],
            "sessions": data["sessions"]
        })

    return sorted(summary, key=lambda x: x["total_seconds"], reverse=True)
