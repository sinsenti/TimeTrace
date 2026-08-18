from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlmodel import Session, select

from timetrace.core.analytics import calculate_detailed_analytics, calculate_tag_summaries
from timetrace.core.parser import export_sessions_to_markdown, parse_markdown_to_sessions
from timetrace.db.models import Session as SessionModel
from timetrace.db.models import Task
from timetrace.interfaces.api.utils import ensure_utc


class AnalyticsService:
    def __init__(self, db: Session):
        self.db = db

    def get_summary(self) -> list[dict[str, Any]]:
        sessions = self.db.exec(select(SessionModel)).all()
        session_dicts = [s.model_dump() for s in sessions]
        return calculate_tag_summaries(session_dicts)

    def get_detailed(self) -> dict[str, Any]:
        sessions = self.db.exec(select(SessionModel)).all()
        tasks = self.db.exec(select(Task)).all()

        session_dicts = []
        for s in sessions:
            s_dict = s.model_dump()
            s_dict["start_time"] = ensure_utc(s.start_time).isoformat() if s.start_time else None
            s_dict["end_time"] = ensure_utc(s.end_time).isoformat() if s.end_time else None
            session_dicts.append(s_dict)

        task_dicts = [t.model_dump() for t in tasks]
        return calculate_detailed_analytics(session_dicts, task_dicts)

    def export_markdown(self) -> str:
        sessions = self.db.exec(select(SessionModel)).all()
        session_dicts = []
        for s in sessions:
            s_dict = s.model_dump()
            s_dict["start_time"] = ensure_utc(s.start_time).isoformat() if s.start_time else None
            s_dict["end_time"] = ensure_utc(s.end_time).isoformat() if s.end_time else None
            session_dicts.append(s_dict)

        return export_sessions_to_markdown(session_dicts, date.today())

    def import_markdown(self, content: str) -> int:
        parsed_sessions = parse_markdown_to_sessions(content)
        added_count = 0
        for s in parsed_sessions:
            db_session = SessionModel(
                start_time=ensure_utc(s["start_time"]),
                end_time=ensure_utc(s["end_time"]),
                duration_seconds=s["duration_seconds"],
                tags=s["tags"],
                notes=s["notes"],
            )
            self.db.add(db_session)
            self.db.commit()
            self.db.refresh(db_session)
            added_count += 1
        return added_count

    def export_agenda_briefing(self, mode: str = "sessions") -> str:
        """Generates clean, scannable Markdown briefings for sessions or tasks without decorative icons."""
        now = datetime.now(UTC)
        tasks = self.db.exec(select(Task)).all()
        tasks_map = {t.id: t for t in tasks}

        if mode == "tasks_short":
            lines = [
                "---",
                "type: tasks_concise_briefing",
                f"generated_at: {now.strftime('%Y-%m-%d %H:%M:%S UTC')}",
                f"total_tasks: {len(tasks)}",
                "---",
                "",
                "# TimeTrace Task Agenda Summary",
                "",
                "| ID | Title | Status | Priority | Category | Target / Due Day | Tags |",
                "|---|---|---|---|---|---|---|",
            ]
            for t in sorted(tasks, key=lambda x: (x.status != "To Do", x.status != "Ongoing")):
                due_info = t.due_date.strftime("%Y-%m-%d %H:%M") if t.due_date else (t.assigned_date or "-")
                lines.append(
                    f"| #{t.id} | {t.title} | {t.status} | {t.priority.upper()} | {t.category} | {due_info} | {t.tags or '-'} |"
                )
            lines.append("")
            return "\n".join(lines)

        elif mode == "tasks_full":
            lines = [
                "---",
                "type: tasks_complete_dossier",
                f"generated_at: {now.strftime('%Y-%m-%d %H:%M:%S UTC')}",
                f"total_tasks: {len(tasks)}",
                "---",
                "",
                "# TimeTrace Complete Task Dossier",
                "",
            ]

            root_tasks = [t for t in tasks if not t.parent_id]
            for t in root_tasks:
                subtasks = [child for child in tasks if child.parent_id == t.id]
                lines.extend([
                    f"## Task #{t.id}: {t.title}",
                    f"- Status: {t.status}",
                    f"- Priority: {t.priority.upper()}",
                    f"- Category: {t.category}",
                    f"- Estimated Duration: {t.estimated_minutes or 15} mins",
                    f"- Target Day: {t.assigned_date or 'Unassigned'}",
                    f"- Due Day: {t.due_date.strftime('%Y-%m-%d %H:%M') if t.due_date else 'None'}",
                    f"- Recurrent: {'Yes (' + (t.recurrence_rule or 'daily') + ')' if t.is_recurring else 'No'}",
                    f"- Tags: {t.tags or 'None'}",
                ])

                if t.description and t.description.strip():
                    lines.extend(["", "### Description", t.description.strip()])

                if t.attachments:
                    lines.extend(["", f"- Attachments: {t.attachments}"])

                if subtasks:
                    lines.extend(["", "### Subtasks Breakdown"])
                    for sub in subtasks:
                        check = "[x]" if sub.status in ("Done", "completed") else "[ ]"
                        lines.append(f"- {check} #{sub.id} {sub.title} ({sub.estimated_minutes or 15}m) [{sub.status}]")

                lines.extend(["", "---", ""])

            return "\n".join(lines)

        else:
            # Mode: "sessions" (Chronological Agenda)
            sessions = self.db.exec(select(SessionModel)).all()
            today_date = now.date()
            tomorrow_date = today_date + timedelta(days=1)

            group_now: list[dict] = []
            group_later: list[dict] = []
            group_tomorrow: list[dict] = []
            group_upcoming: list[dict] = []

            for s in sessions:
                if not s.start_time:
                    continue

                st_utc = ensure_utc(s.start_time)
                et_utc = ensure_utc(s.end_time) if s.end_time else st_utc + timedelta(minutes=15)
                st_local = st_utc.astimezone()
                et_local = et_utc.astimezone()
                sess_date = st_local.date()

                task_obj = tasks_map.get(s.task_id)
                title = task_obj.title if task_obj else (s.notes or s.tags or "Session Log")

                item = {
                    "id": s.id,
                    "title": title,
                    "start_str": st_local.strftime("%H:%M"),
                    "end_str": et_local.strftime("%H:%M"),
                    "date_str": st_local.strftime("%Y-%m-%d"),
                    "tags": s.tags or "#general",
                    "notes": s.notes or "",
                    "is_running": st_utc <= now <= et_utc,
                }

                if item["is_running"]:
                    group_now.append(item)
                elif sess_date == today_date and st_utc > now:
                    group_later.append(item)
                elif sess_date == tomorrow_date:
                    group_tomorrow.append(item)
                elif sess_date > tomorrow_date:
                    group_upcoming.append(item)

            lines = [
                "---",
                "type: session_agenda_briefing",
                f"generated_at: {now.strftime('%Y-%m-%d %H:%M:%S UTC')}",
                f"total_sessions: {len(sessions)}",
                "---",
                "",
                "# TimeTrace Session Agenda",
                "",
            ]

            lines.append("## Now")
            if group_now:
                for item in group_now:
                    lines.append(f"- [{item['start_str']} - {item['end_str']}] {item['title']} | {item['tags']} (ACTIVE)")
            else:
                lines.append("- No active session running.")

            lines.append("")
            lines.append("## Later Today")
            if group_later:
                for item in sorted(group_later, key=lambda x: x["start_str"]):
                    lines.append(f"- [{item['start_str']} - {item['end_str']}] {item['title']} | {item['tags']}")
            else:
                lines.append("- No remaining sessions scheduled for today.")

            lines.append("")
            lines.append(f"## Tomorrow ({tomorrow_date.strftime('%Y-%m-%d')})")
            if group_tomorrow:
                for item in sorted(group_tomorrow, key=lambda x: x["start_str"]):
                    lines.append(f"- [{item['start_str']} - {item['end_str']}] {item['title']} | {item['tags']}")
            else:
                lines.append("- No sessions scheduled for tomorrow.")

            lines.append("")
            lines.append("## Upcoming")
            if group_upcoming:
                for item in sorted(group_upcoming, key=lambda x: (x["date_str"], x["start_str"]))[:15]:
                    lines.append(f"- [{item['date_str']} {item['start_str']} - {item['end_str']}] {item['title']} | {item['tags']}")
            else:
                lines.append("- No future upcoming sessions found.")

            lines.append("")
            return "\n".join(lines)
