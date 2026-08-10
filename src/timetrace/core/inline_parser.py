import re
from datetime import datetime, date, timedelta
from typing import Dict, Any, Optional


def parse_inline_task(text: str) -> Dict[str, Any]:
    """Parses 1-2 line task creation markdown."""
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    if not lines:
        return {}

    first_line = lines[0]
    description = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""

    tags = re.findall(r"#\w+", first_line)
    tags_str = " ".join(tags)

    prio_match = re.search(r"!(high|medium|med|low|h|m|l|-)", first_line, re.IGNORECASE)
    priority = "-"
    if prio_match:
        p_val = prio_match.group(1).lower()
        if p_val in ("high", "h"):
            priority = "high"
        elif p_val in ("medium", "med", "m"):
            priority = "medium"
        elif p_val in ("low", "l"):
            priority = "low"

    status_match = re.search(
        r"@(in_progress|ongoing|completed|ip|og|done|c)", first_line, re.IGNORECASE
    )
    status = "in_progress"
    if status_match:
        s_val = status_match.group(1).lower()
        if s_val in ("completed", "done", "c"):
            status = "completed"
        elif s_val in ("ongoing", "og"):
            status = "ongoing"

    clean_title = first_line
    clean_title = re.sub(r"#\w+", "", clean_title)
    clean_title = re.sub(
        r"!(high|medium|med|low|h|m|l|-)", "", clean_title, flags=re.IGNORECASE
    )
    clean_title = re.sub(
        r"@(in_progress|ongoing|completed|ip|og|done|c)",
        "",
        clean_title,
        flags=re.IGNORECASE,
    )
    clean_title = " ".join(clean_title.split()).strip()

    return {
        "title": clean_title if clean_title else "Untitled Task",
        "description": description,
        "priority": priority,
        "status": status,
    }


def parse_inline_timer(text: str) -> Dict[str, Any]:
    """Parses 1-line timer start / split markdown."""
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    if not lines:
        return {}

    first_line = lines[0]
    extra_notes = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""

    tags = re.findall(r"#\w+", first_line)
    tags_str = " ".join(tags)

    task_id_match = re.search(r"@(\d+)", first_line)
    task_id = int(task_id_match.group(1)) if task_id_match else None

    pomo_match = re.search(r"!(\d+)m?", first_line)
    pomo_mins = int(pomo_match.group(1)) if pomo_match else 0

    clean_notes = first_line
    clean_notes = re.sub(r"#\w+", "", clean_notes)
    clean_notes = re.sub(r"@\d+", "", clean_notes)
    clean_notes = re.sub(r"!\d+m?", "", clean_notes)
    clean_notes = " ".join(clean_notes.split()).strip()

    if extra_notes:
        clean_notes = (
            f"{clean_notes}\n{extra_notes}".strip() if clean_notes else extra_notes
        )

    return {
        "tags": tags_str if tags_str else "#general",
        "notes": clean_notes,
        "task_id": task_id,
        "pomo_minutes": pomo_mins,
    }


def parse_inline_session_edit(
    text: str, base_session: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Parses session modifications from Neovim: timestamps, duration, tags, notes."""
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    if not lines:
        return {}

    first_line = lines[0]
    extra_notes = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""

    tags = re.findall(r"#\w+", first_line)
    tags_str = " ".join(tags)

    base_start = base_session.get("start_time") if base_session else None
    base_date_str = date.today().isoformat()
    if base_start:
        if isinstance(base_start, str):
            base_date_str = base_start.split("T")[0]
        elif isinstance(base_start, datetime):
            base_date_str = base_start.date().isoformat()

    start_dt: Optional[datetime] = None
    end_dt: Optional[datetime] = None

    # Match time intervals e.g. [2026-08-10 14:00 - 15:30] or [14:00 - 15:30] or 14:00 - NOW
    range_match = re.search(
        r"\[?\b((\d{4}-\d{2}-\d{2}\s+)?\d{2}:\d{2})\s*-\s*((\d{4}-\d{2}-\d{2}\s+)?\d{2}:\d{2}|NOW)\b\]?",
        first_line,
        re.IGNORECASE,
    )

    clean_line = first_line

    if range_match:
        raw_start = range_match.group(1).strip()
        raw_end = range_match.group(3).strip()
        clean_line = clean_line.replace(range_match.group(0), "")

        # Parse Start Time
        if len(raw_start) == 5:  # HH:MM
            start_dt = datetime.fromisoformat(f"{base_date_str}T{raw_start}:00")
        else:  # YYYY-MM-DD HH:MM
            s_date, s_time = raw_start.split()
            start_dt = datetime.fromisoformat(f"{s_date}T{s_time}:00")

        # Parse End Time
        if raw_end.upper() != "NOW":
            if len(raw_end) == 5:  # HH:MM
                s_date_str = start_dt.date().isoformat() if start_dt else base_date_str
                end_dt = datetime.fromisoformat(f"{s_date_str}T{raw_end}:00")
            else:  # YYYY-MM-DD HH:MM
                e_date, e_time = raw_end.split()
                end_dt = datetime.fromisoformat(f"{e_date}T{e_time}:00")

    # Match duration override in parens e.g. (90m) or (1.5h)
    dur_match = re.search(r"\(?(\d+(?:\.\d+)?)\s*(m|h)\)?", clean_line, re.IGNORECASE)
    if dur_match:
        dur_val = float(dur_match.group(1))
        dur_unit = dur_match.group(2).lower()
        dur_mins = dur_val * 60 if dur_unit == "h" else dur_val
        clean_line = clean_line.replace(dur_match.group(0), "")

        if start_dt and not end_dt:
            end_dt = start_dt + timedelta(minutes=dur_mins)

    # Clean tags from remaining text to leave notes
    clean_notes = clean_line
    clean_notes = re.sub(r"#\w+", "", clean_notes)
    clean_notes = " ".join(clean_notes.split()).strip()

    if extra_notes:
        clean_notes = (
            f"{clean_notes}\n{extra_notes}".strip() if clean_notes else extra_notes
        )

    res = {"tags": tags_str if tags_str else "#general", "notes": clean_notes}
    if start_dt:
        res["start_time"] = start_dt.isoformat()
    if end_dt:
        res["end_time"] = end_dt.isoformat()

    return res


def parse_inline_reflection(text: str) -> Dict[str, Any]:
    """Parses 1-2 line post-session reflection markdown."""
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    if not lines:
        return {"energy_level": 3, "habits": [], "obstacles": ""}

    first_line = lines[0]
    obstacles = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""

    energy_match = re.search(r"(\d)/5", first_line)
    energy_level = int(energy_match.group(1)) if energy_match else 3

    habits_part = re.sub(r"\d/5", "", first_line).strip()
    habits_part = habits_part.lstrip("|").strip()
    habits = (
        [h.strip() for h in habits_part.split(",") if h.strip()] if habits_part else []
    )

    return {
        "energy_level": max(1, min(5, energy_level)),
        "habits": habits,
        "obstacles": obstacles,
    }


def parse_inline_retro(text: str) -> Dict[str, Any]:
    """Parses 1-2 line retroactive session markdown."""
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    if not lines:
        return {}

    first_line = lines[0]
    extra_notes = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""

    tags = re.findall(r"#\w+", first_line)
    tags_str = " ".join(tags)

    start_ago_match = re.search(r"-(\d+)(m|h)", first_line)
    start_ago_mins = 60
    if start_ago_match:
        val = int(start_ago_match.group(1))
        unit = start_ago_match.group(2).lower()
        start_ago_mins = val * 60 if unit == "h" else val

    dur_match = re.search(r"\b(\d+)m\b", re.sub(r"-\d+(m|h)", "", first_line))
    dur_mins = int(dur_match.group(1)) if dur_match else 30

    clean_notes = first_line
    clean_notes = re.sub(r"#\w+", "", clean_notes)
    clean_notes = re.sub(r"-\d+(m|h)", "", clean_notes)
    clean_notes = re.sub(r"\b\d+m\b", "", clean_notes)
    clean_notes = " ".join(clean_notes.split()).strip()

    if extra_notes:
        clean_notes = (
            f"{clean_notes}\n{extra_notes}".strip() if clean_notes else extra_notes
        )

    return {
        "start_mins_ago": start_ago_mins,
        "duration_mins": dur_mins,
        "tags": tags_str if tags_str else "#general",
        "notes": clean_notes,
    }
