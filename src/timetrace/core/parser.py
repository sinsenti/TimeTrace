import re
from datetime import datetime, date
from typing import List, Dict, Any
import frontmatter


def export_sessions_to_markdown(sessions: List[Dict[str, Any]], log_date: date) -> str:
    post = frontmatter.Post("")
    post.metadata = {
        "date": log_date.isoformat(),
        "total_sessions": len(sessions),
        "generated_by": "TimeTrace"
    }

    content = "# Logged Sessions\n"
    for s in sessions:
        start_dt = datetime.fromisoformat(str(s["start_time"])) if isinstance(s["start_time"], str) else s["start_time"]
        end_dt = datetime.fromisoformat(str(s["end_time"])) if isinstance(s["end_time"], str) else s["end_time"]

        start_str = start_dt.strftime("%H:%M")
        end_str = end_dt.strftime("%H:%M") if end_dt else "NOW"
        tags = s.get("tags") or "#general"
        notes = s.get("notes") or "No notes"

        content += f"- [{start_str} - {end_str}] | {tags} | {notes}\n"

        if s.get("reflection"):
            ref = s["reflection"]
            content += f"  - Energy: {ref.get('energy_level', 3)}/5\n"
            if ref.get("obstacles"):
                content += f"  - Obstacles: {ref.get('obstacles')}\n"

    post.content = content
    return frontmatter.dumps(post)


def parse_markdown_to_sessions(md_content: str) -> List[Dict[str, Any]]:
    post = frontmatter.loads(md_content)
    base_date_str = str(post.metadata.get("date", date.today().isoformat()))

    sessions = []
    pattern = re.compile(r"-\s*\[(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\]\s*\|\s*([^|]+)\s*\|\s*(.+)")

    for line in post.content.splitlines():
        match = pattern.match(line.strip())
        if match:
            start_hhmm, end_hhmm, tags, notes = match.groups()
            start_dt = datetime.fromisoformat(f"{base_date_str}T{start_hhmm}:00")
            end_dt = datetime.fromisoformat(f"{base_date_str}T{end_hhmm}:00")
            duration = int((end_dt - start_dt).total_seconds())

            sessions.append({
                "start_time": start_dt,
                "end_time": end_dt,
                "duration_seconds": max(duration, 0),
                "tags": tags.strip(),
                "notes": notes.strip()
            })

    return sessions
