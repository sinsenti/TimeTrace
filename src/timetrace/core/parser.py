import re
from datetime import UTC, date, datetime, timedelta
from typing import Any

import frontmatter


def export_sessions_to_markdown(sessions: list[dict[str, Any]], log_date: date) -> str:
    post = frontmatter.Post("")
    post.metadata = {
        "date": log_date.isoformat(),
        "total_sessions": len(sessions),
        "generated_by": "TimeTrace"
    }

    content = "# Logged Sessions\n"
    for s in sessions:
        start_dt = datetime.fromisoformat(str(s["start_time"])) if isinstance(s["start_time"], str) else s["start_time"]
        end_dt = datetime.fromisoformat(str(s["end_time"])) if isinstance(s.get("end_time"), str) and s.get("end_time") else s.get("end_time")

        start_str = start_dt.strftime("%H:%M") if start_dt else "00:00"
        end_str = end_dt.strftime("%H:%M") if end_dt else "NOW"
        tags = s.get("tags") or "#general"
        notes = s.get("notes") or "No notes"

        content += f"- [{start_str} - {end_str}] | {tags} | {notes}\n"

    post.content = content
    return frontmatter.dumps(post)


def parse_markdown_to_sessions(md_content: str) -> list[dict[str, Any]]:
    post = frontmatter.loads(md_content)
    raw_date = post.metadata.get("date", date.today())
    base_date_str = raw_date.isoformat() if isinstance(raw_date, (date, datetime)) else str(raw_date)

    sessions: list[dict[str, Any]] = []
    session_pattern = re.compile(r"^-\s*\[(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2}|NOW)\]\s*\|\s*([^|]+)\s*\|\s*(.+)")
    sub_bullet_pattern = re.compile(r"^\s+-\s*(.+)")

    for line in post.content.splitlines():
        line_str = line.rstrip()
        match = session_pattern.match(line_str)
        if match:
            start_hhmm, end_hhmm, tags, notes = match.groups()
            start_dt = datetime.fromisoformat(f"{base_date_str}T{start_hhmm}:00").replace(tzinfo=UTC)
            
            if end_hhmm.upper() == "NOW":
                end_dt = datetime.now(UTC)
            else:
                end_dt = datetime.fromisoformat(f"{base_date_str}T{end_hhmm}:00").replace(tzinfo=UTC)
                if end_dt < start_dt:
                    end_dt += timedelta(days=1)

            duration = max(0, int((end_dt - start_dt).total_seconds()))

            sessions.append({
                "start_time": start_dt,
                "end_time": end_dt,
                "duration_seconds": duration,
                "tags": tags.strip(),
                "notes": notes.strip()
            })
        elif sessions and sub_bullet_pattern.match(line_str):
            sub_text = sub_bullet_pattern.match(line_str).group(1).strip()
            sessions[-1]["notes"] += f"\n  - {sub_text}"

    return sessions
