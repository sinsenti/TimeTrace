import re
from datetime import datetime, date, timezone
from typing import List, Dict, Any, Optional
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
        end_dt = datetime.fromisoformat(str(s["end_time"])) if isinstance(s.get("end_time"), str) and s.get("end_time") else s.get("end_time")

        start_str = start_dt.strftime("%H:%M") if start_dt else "00:00"
        end_str = end_dt.strftime("%H:%M") if end_dt else "NOW"
        tags = s.get("tags") or "#general"
        notes = s.get("notes") or "No notes"

        content += f"- [{start_str} - {end_str}] | {tags} | {notes}\n"

        if s.get("reflection"):
            ref = s["reflection"]
            content += f"  - Energy: {ref.get('energy_level', 3)}/5\n"
            if ref.get("obstacles"):
                content += f"  - Obstacles: {ref.get('obstacles')}\n"
            if ref.get("habits_completed"):
                content += f"  - Habits: {ref.get('habits_completed')}\n"

    post.content = content
    return frontmatter.dumps(post)


def parse_markdown_to_sessions(md_content: str) -> List[Dict[str, Any]]:
    post = frontmatter.loads(md_content)
    raw_date = post.metadata.get("date", date.today())
    base_date_str = raw_date.isoformat() if isinstance(raw_date, (date, datetime)) else str(raw_date)

    sessions: List[Dict[str, Any]] = []
    session_pattern = re.compile(r"^-\s*\[(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2}|NOW)\]\s*\|\s*([^|]+)\s*\|\s*(.+)")
    energy_pattern = re.compile(r"^\s*-\s*Energy:\s*(\d)/5", re.IGNORECASE)
    obstacles_pattern = re.compile(r"^\s*-\s*Obstacles:\s*(.+)", re.IGNORECASE)
    habits_pattern = re.compile(r"^\s*-\s*Habits:\s*(.+)", re.IGNORECASE)

    current_session: Optional[Dict[str, Any]] = None

    for line in post.content.splitlines():
        line_str = line.rstrip()
        match = session_pattern.match(line_str)
        if match:
            if current_session:
                sessions.append(current_session)

            start_hhmm, end_hhmm, tags, notes = match.groups()
            start_dt = datetime.fromisoformat(f"{base_date_str}T{start_hhmm}:00").replace(tzinfo=timezone.utc)
            
            if end_hhmm.upper() == "NOW":
                end_dt = datetime.now(timezone.utc)
            else:
                end_dt = datetime.fromisoformat(f"{base_date_str}T{end_hhmm}:00").replace(tzinfo=timezone.utc)
                if end_dt < start_dt:
                    end_dt += timedelta(days=1)

            duration = max(0, int((end_dt - start_dt).total_seconds()))

            current_session = {
                "start_time": start_dt,
                "end_time": end_dt,
                "duration_seconds": duration,
                "tags": tags.strip(),
                "notes": notes.strip(),
                "reflection": None
            }
            continue

        if current_session:
            energy_match = energy_pattern.match(line_str)
            if energy_match:
                if not current_session["reflection"]:
                    current_session["reflection"] = {}
                current_session["reflection"]["energy_level"] = int(energy_match.group(1))
                continue

            obstacles_match = obstacles_pattern.match(line_str)
            if obstacles_match:
                if not current_session["reflection"]:
                    current_session["reflection"] = {}
                current_session["reflection"]["obstacles"] = obstacles_match.group(1).strip()
                continue

            habits_match = habits_pattern.match(line_str)
            if habits_match:
                if not current_session["reflection"]:
                    current_session["reflection"] = {}
                current_session["reflection"]["habits_completed"] = habits_match.group(1).strip()
                continue

    if current_session:
        sessions.append(current_session)

    return sessions
