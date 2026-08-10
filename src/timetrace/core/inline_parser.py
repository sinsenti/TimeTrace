import re
from typing import Dict, Any


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

    status_match = re.search(r"@(in_progress|ongoing|completed|ip|og|done|c)", first_line, re.IGNORECASE)
    status = "in_progress"
    if status_match:
        s_val = status_match.group(1).lower()
        if s_val in ("completed", "done", "c"):
            status = "completed"
        elif s_val in ("ongoing", "og"):
            status = "ongoing"

    clean_title = first_line
    clean_title = re.sub(r"#\w+", "", clean_title)
    clean_title = re.sub(r"!(high|medium|med|low|h|m|l|-)", "", clean_title, flags=re.IGNORECASE)
    clean_title = re.sub(r"@(in_progress|ongoing|completed|ip|og|done|c)", "", clean_title, flags=re.IGNORECASE)
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

    task_id_match = re.search(r"@(task\s*)?(\d+)", first_line, re.IGNORECASE)
    task_id = int(task_id_match.group(2)) if task_id_match else None

    pomo_match = re.search(r"!(\d+)m?", first_line)
    pomo_mins = int(pomo_match.group(1)) if pomo_match else 0

    clean_notes = first_line
    clean_notes = re.sub(r"#\w+", "", clean_notes)
    clean_notes = re.sub(r"@(task\s*)?\d+", "", clean_notes, flags=re.IGNORECASE)
    clean_notes = re.sub(r"!\d+m?", "", clean_notes)
    clean_notes = " ".join(clean_notes.split()).strip()

    if extra_notes:
        clean_notes = f"{clean_notes}\n{extra_notes}".strip() if clean_notes else extra_notes

    return {
        "tags": tags_str if tags_str else "#general",
        "notes": clean_notes,
        "task_id": task_id,
        "pomo_minutes": pomo_mins
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

    task_id_match = re.search(r"@(task\s*)?(\d+)", first_line, re.IGNORECASE)
    task_id = int(task_id_match.group(2)) if task_id_match else None

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
    clean_notes = re.sub(r"@(task\s*)?\d+", "", clean_notes, flags=re.IGNORECASE)
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
        "notes": clean_notes
    }


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
    habits = [h.strip() for h in habits_part.split(",") if h.strip()] if habits_part else []

    return {
        "energy_level": max(1, min(5, energy_level)),
        "habits": habits,
        "obstacles": obstacles
    }

