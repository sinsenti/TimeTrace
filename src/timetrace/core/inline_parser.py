import re
from datetime import UTC, date, datetime, time, timedelta
from typing import Any


def strip_comments(text: str) -> str:
    """Strips HTML comments, blockquotes, and comments from text before parsing."""
    clean = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    lines = [line for line in clean.splitlines() if not line.strip().startswith(("> ", ">", "//"))]
    return "\n".join(lines).strip()


def parse_inline_task(text: str) -> dict[str, Any]:
    """Parses quick-add task creation syntax typed into a single title field
    (or a 1-2 line Neovim buffer): `#tag`s, `!priority`, `@status`,
    `due:Nd`/`d:Nh`/`d:Nd` and `target:Nd`/`t:Nh`/`t:Nd` relative offsets, and
    `(parenthesized)` description text.
    """
    clean_text = strip_comments(text)
    lines = [line.strip() for line in clean_text.splitlines() if line.strip()]
    if not lines:
        return {}

    first_line = lines[0]
    extra_description = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""

    tags = re.findall(r"#\w+", first_line)

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
        r"@(in_progress|ongoing|completed|scheduled|backlog|ip|og|done|c|todo|to do|sch|bl)",
        first_line,
        re.IGNORECASE,
    )
    status = "To Do"
    if status_match:
        s_val = status_match.group(1).lower()
        if s_val in ("completed", "done", "c"):
            status = "Done"
        elif s_val in ("ongoing", "og"):
            status = "Ongoing"
        elif s_val in ("scheduled", "sch"):
            status = "Scheduled"
        elif s_val in ("backlog", "bl"):
            status = "Backlog"
        elif s_val in ("in_progress", "ip", "todo", "to do"):
            status = "To Do"

    local_now = datetime.now().astimezone()

    due_date_value = None
    due_match = re.search(r"\b(?:due|d):(\d+)(?!\.\d)(h|d)?\b", first_line, re.IGNORECASE)
    if due_match:
        n = int(due_match.group(1))
        unit = (due_match.group(2) or "d").lower()
        if unit == "h":
            due_date_value = local_now + timedelta(hours=n)
        else:
            due_day = (local_now + timedelta(days=n)).date()
            due_date_value = datetime.combine(due_day, time(23, 59, 59), tzinfo=local_now.tzinfo)

    assigned_date_value = None
    schedule_session_at = None
    target_match = re.search(r"\b(?:target|t):(\d+)(?!\.\d)(h|d)?\b", first_line, re.IGNORECASE)
    if target_match:
        n = int(target_match.group(1))
        unit = (target_match.group(2) or "d").lower()
        if unit == "h":
            schedule_session_at = local_now + timedelta(hours=n)
            assigned_date_value = schedule_session_at.date().strftime("%Y-%m-%d")
        else:
            target_day = (local_now + timedelta(days=n)).date()
            assigned_date_value = target_day.strftime("%Y-%m-%d")

    paren_groups = re.findall(r"\(([^)]*)\)", first_line)
    paren_description = " ".join(g.strip() for g in paren_groups if g.strip())
    description_parts = [p for p in (paren_description, extra_description) if p]
    description = "\n".join(description_parts)

    clean_title = first_line
    clean_title = re.sub(r"\([^)]*\)", "", clean_title)
    clean_title = re.sub(r"#\w+", "", clean_title)
    clean_title = re.sub(r"!(high|medium|med|low|h|m|l|-)", "", clean_title, flags=re.IGNORECASE)
    clean_title = re.sub(
        r"@(in_progress|ongoing|completed|scheduled|backlog|ip|og|done|c|todo|to do|sch|bl)",
        "",
        clean_title,
        flags=re.IGNORECASE,
    )
    clean_title = re.sub(r"\b(?:due|d):\d+(?!\.\d)(?:h|d)?\b", "", clean_title, flags=re.IGNORECASE)
    clean_title = re.sub(r"\b(?:target|t):\d+(?!\.\d)(?:h|d)?\b", "", clean_title, flags=re.IGNORECASE)
    clean_title = " ".join(clean_title.split()).strip()

    result: dict[str, Any] = {
        "title": clean_title if clean_title else "Untitled Task",
        "description": description,
        "priority": priority,
        "status": status,
        "tags": " ".join(tags) if tags else "",
    }
    if due_date_value is not None:
        result["due_date"] = due_date_value
    if assigned_date_value is not None:
        result["assigned_date"] = assigned_date_value
    if schedule_session_at is not None:
        result["schedule_session_at"] = schedule_session_at
    return result


def parse_inline_timer(text: str) -> dict[str, Any]:
    """Parses 1-line timer start / split markdown supporting string/UUID task IDs."""
    clean_text = strip_comments(text)
    lines = [line.strip() for line in clean_text.splitlines() if line.strip()]
    if not lines:
        return {}

    first_line = lines[0]
    extra_notes = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""

    tags = re.findall(r"#\w+", first_line)
    tags_str = " ".join(tags)

    task_id_match = re.search(r"@(task\s*)?([a-f0-9-]{4,36})", first_line, re.IGNORECASE)
    task_id = task_id_match.group(2) if task_id_match else None

    pomo_match = re.search(r"!(\d+)m?", first_line)
    pomo_mins = int(pomo_match.group(1)) if pomo_match else 0

    clean_notes = first_line
    clean_notes = re.sub(r"#\w+", "", clean_notes)
    clean_notes = re.sub(r"@(task\s*)?[a-f0-9-]{4,36}", "", clean_notes, flags=re.IGNORECASE)
    clean_notes = re.sub(r"!\d+m?", "", clean_notes)
    clean_notes = " ".join(clean_notes.split()).strip()

    if extra_notes:
        clean_notes = f"{clean_notes}\n{extra_notes}".strip() if clean_notes else extra_notes

    return {
        "tags": tags_str if tags_str else "#general",
        "notes": clean_notes,
        "task_id": task_id,
        "pomo_minutes": pomo_mins,
    }


def _local_time_to_utc(date_str: str, time_str: str) -> datetime:
    """Interprets input date & time as local time and converts to UTC aware datetime."""
    local_tz = datetime.now().astimezone().tzinfo
    naive_dt = datetime.fromisoformat(f"{date_str}T{time_str}")
    local_dt = naive_dt.replace(tzinfo=local_tz)
    return local_dt.astimezone(UTC)


def parse_inline_session_edit(text: str, base_session: dict[str, Any] | None = None) -> dict[str, Any]:
    """Parses edited session text from Neovim buffer supporting string/UUID task IDs."""
    clean_text = strip_comments(text)
    lines = [line.strip() for line in clean_text.splitlines() if line.strip()]
    if not lines:
        return {}

    first_line = lines[0]
    extra_notes = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""

    result: dict[str, Any] = {}

    time_range_match = re.search(r"\[(.*?)\]", first_line)
    if time_range_match:
        raw_range = time_range_match.group(1).strip()
        parts = raw_range.split("-")
        if len(parts) == 2:
            s_str, e_str = parts[0].strip(), parts[1].strip()
            try:
                base_date = date.today().isoformat()
                if base_session and base_session.get("start_time"):
                    st_val = str(base_session["start_time"])
                    if "T" in st_val:
                        dt = datetime.fromisoformat(st_val.replace("Z", "+00:00")).astimezone()
                        base_date = dt.strftime("%Y-%m-%d")

                if len(s_str) <= 5:
                    s_dt = _local_time_to_utc(base_date, f"{s_str}:00")
                else:
                    naive = datetime.fromisoformat(s_str.replace(" ", "T"))
                    s_dt = naive.replace(tzinfo=datetime.now().astimezone().tzinfo).astimezone(UTC)

                if e_str.upper() != "NOW":
                    if len(e_str) <= 5:
                        e_dt = _local_time_to_utc(base_date, f"{e_str}:00")
                    else:
                        naive = datetime.fromisoformat(e_str.replace(" ", "T"))
                        e_dt = naive.replace(tzinfo=datetime.now().astimezone().tzinfo).astimezone(UTC)
                else:
                    e_dt = datetime.now(UTC)

                result["start_time"] = s_dt
                result["end_time"] = e_dt
            except Exception:
                pass

        first_line = re.sub(r"\[.*?\]", "", first_line)

    first_line = re.sub(r"\(\d+(\.\d+)?m\)", "", first_line)

    tags = re.findall(r"#\w+", first_line)
    if tags:
        result["tags"] = " ".join(tags)

    task_id_match = re.search(r"@(task\s*)?([a-f0-9-]{4,36})", first_line, re.IGNORECASE)
    if task_id_match:
        result["task_id"] = task_id_match.group(2)

    clean_notes = first_line
    clean_notes = re.sub(r"#\w+", "", clean_notes)
    clean_notes = re.sub(r"@(task\s*)?[a-f0-9-]{4,36}", "", clean_notes, flags=re.IGNORECASE)
    clean_notes = " ".join(clean_notes.split()).strip()

    if extra_notes:
        clean_notes = f"{clean_notes}\n{extra_notes}".strip() if clean_notes else extra_notes

    result["notes"] = clean_notes
    return result


def parse_inline_retro(text: str) -> dict[str, Any]:
    """Parses 1-2 line retroactive session markdown supporting string/UUID task IDs."""
    clean_text = strip_comments(text)
    lines = [line.strip() for line in clean_text.splitlines() if line.strip()]
    if not lines:
        return {}

    first_line = lines[0]
    extra_notes = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""

    tags = re.findall(r"#\w+", first_line)
    tags_str = " ".join(tags)

    task_id_match = re.search(r"@(task\s*)?([a-f0-9-]{4,36})", first_line, re.IGNORECASE)
    task_id = task_id_match.group(2) if task_id_match else None

    start_ago_match = re.search(r"-\d+(m|h)", first_line)
    start_ago_mins = 60
    if start_ago_match:
        val_str = start_ago_match.group(0).lstrip("-")
        val = int(re.sub(r"[^\d]", "", val_str))
        unit = val_str[-1].lower()
        start_ago_mins = val * 60 if unit == "h" else val

    dur_match = re.search(r"\b(\d+)m\b", re.sub(r"-\d+(m|h)", "", first_line))
    dur_mins = int(dur_match.group(1)) if dur_match else 30

    clean_notes = first_line
    clean_notes = re.sub(r"#\w+", "", clean_notes)
    clean_notes = re.sub(r"@(task\s*)?[a-f0-9-]{4,36}", "", clean_notes, flags=re.IGNORECASE)
    clean_notes = re.sub(r"-\d+(m|h)", "", clean_notes)
    clean_notes = re.sub(r"\b\d+m\b", "", clean_notes)
    clean_notes = " ".join(clean_notes.split()).strip()

    if extra_notes:
        clean_notes = f"{clean_notes}\n{extra_notes}".strip() if clean_notes else extra_notes

    return {
        "task_id": task_id,
        "start_mins_ago": start_ago_mins,
        "duration_mins": dur_mins,
        "tags": tags_str if tags_str else "#general",
        "notes": clean_notes,
    }


def parse_inline_reflection(text: str) -> dict[str, Any]:
    """Parses 1-2 line post-session reflection markdown."""
    clean_text = strip_comments(text)
    lines = [line.strip() for line in clean_text.splitlines() if line.strip()]
    if not lines:
        return {"energy_level": 3, "habits": [], "obstacles": ""}

    first_line = lines[0]
    obstacles = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""

    energy_match = re.search(r"(\d)/5", first_line)
    energy_level = int(energy_match.group(1)) if energy_match else 3

    habits_part = re.sub(r"\d/5", "", first_line).strip()
    habits_part = habits_part.lstrip("|").strip()
    habits = [h.strip() for h in habits_part.split(",") if h.strip()] if habits_part else []

    return {
        "energy_level": max(1, min(5, energy_level)),
        "habits": habits,
        "obstacles": obstacles,
    }
