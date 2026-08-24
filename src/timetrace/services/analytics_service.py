from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlmodel import Session, select

from timetrace.core.ids import short_id
from timetrace.core.parser import export_sessions_to_markdown, parse_markdown_to_sessions
from timetrace.core.query_spec import AnalyticsQuery, Dimension, Measure, QuerySource, SortKey
from timetrace.db.models import Habit, HabitLog, Task
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import QueryContextRequest
from timetrace.interfaces.api.utils import ensure_utc
from timetrace.services.query_service import QueryService

# `get_detailed()` (backing the old `/analytics/detailed` route) has been retired, not
# re-pointed: it only ever had one caller, `static/js/stats.js`'s `loadAnalyticsData()`, and
# that's been replaced by the `/stats` page composing the same charts itself out of real
# `AnalyticsQuery` widgets via `POST /analytics/query/batch` (see `static/js/dashboards.js`).
# `core/analytics.py`'s `calculate_detailed_analytics` stays as documentation of the exact
# behaviour (including its one deliberate divergence) the new SQL path reproduces.


class AnalyticsService:
    def __init__(self, db: Session):
        self.db = db

    def get_summary(self) -> list[dict[str, Any]]:
        """Time-per-tag summary backing the CLI's `timetrace analytics` output. Re-pointed at
        the structured query engine (sessions x sum_duration x [tag], fan-out attribution,
        all-time) -- this must keep returning the exact same `[{tag, total_hours,
        session_count}]` shape the CLI already prints.
        """
        query = AnalyticsQuery(
            source=QuerySource.SESSIONS,
            measure=Measure.SUM_DURATION,
            group_by=[Dimension.TAG],
            sort=SortKey.VALUE_DESC,
            limit=2000,
        )
        result = QueryService(self.db).run(query, QueryContextRequest())
        return [
            {"tag": row.labels[0], "total_hours": round(row.value or 0.0, 2), "session_count": row.count}
            for row in result.rows
        ]

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

    def export_agenda_briefing(
        self, mode: str = "sessions", start_date: str | None = None, end_date: str | None = None
    ) -> str:
        """Generates clean, scannable Markdown briefings for sessions, tasks, or habits without decorative icons."""
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
                    f"| #{short_id(t.id)} | {t.title} | {t.status} | {t.priority.upper()} | {t.category} | {due_info} | {t.tags or '-'} |"
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
                    f"## Task #{short_id(t.id)}: {t.title}",
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
                        lines.append(
                            f"- {check} #{short_id(sub.id)} {sub.title} ({sub.estimated_minutes or 15}m) [{sub.status}]"
                        )

                lines.extend(["", "---", ""])

            return "\n".join(lines)

        elif mode == "habits":
            habits = self.db.exec(select(Habit)).all()
            logs = self.db.exec(select(HabitLog)).all()
            log_map: dict[str, list[HabitLog]] = {}
            for l in logs:
                log_map.setdefault(l.habit_id, []).append(l)

            lines = [
                "---",
                "type: habits_briefing",
                f"generated_at: {now.strftime('%Y-%m-%d %H:%M:%S UTC')}",
                f"total_habits: {len(habits)}",
                "---",
                "",
                "# TimeTrace Habits Briefing",
                "",
                "| ID | Habit Name | Type | Target | Frequency | Total Logs | Completed | Compliance % |",
                "|---|---|---|---|---|---|---|---|",
            ]
            for h in habits:
                h_logs = log_map.get(h.id, [])
                comp = sum(1 for l in h_logs if l.status == "completed")
                tot = len(h_logs)
                rate = f"{round((comp / tot) * 100)}%" if tot > 0 else "0%"
                target_str = f"{h.target_value} {h.unit or ''}".strip() if h.habit_type == "numeric" else "Checkmark"
                lines.append(
                    f"| #{short_id(h.id)} | {h.name} | {h.habit_type} | {target_str} | {h.frequency} | {tot} | {comp} | {rate} |"
                )
            lines.append("")
            return "\n".join(lines)

        elif mode in ("all", "all_date_range"):
            lines = [
                "---",
                "type: complete_system_export",
                f"generated_at: {now.strftime('%Y-%m-%d %H:%M:%S UTC')}",
                f"date_filter_start: {start_date or 'None'}",
                f"date_filter_end: {end_date or 'None'}",
                "---",
                "",
                "# TimeTrace System-Wide Export",
                "",
            ]

            # 1. Sessions Section
            sess_query = select(SessionModel)
            all_sessions = self.db.exec(sess_query).all()
            filtered_sessions = []
            for s in all_sessions:
                if not s.start_time:
                    continue
                st_str = ensure_utc(s.start_time).strftime("%Y-%m-%d")
                if start_date and st_str < start_date:
                    continue
                if end_date and st_str > end_date:
                    continue
                filtered_sessions.append(s)

            lines.extend([
                f"## 1. Sessions Log ({len(filtered_sessions)} entries)",
                "",
                "| ID | Start Time | End Time | Duration (mins) | Task ID | Tags | Notes |",
                "|---|---|---|---|---|---|---|",
            ])
            for s in sorted(filtered_sessions, key=lambda x: x.start_time or datetime.min):
                st = ensure_utc(s.start_time).strftime("%Y-%m-%d %H:%M") if s.start_time else "-"
                et = ensure_utc(s.end_time).strftime("%Y-%m-%d %H:%M") if s.end_time else "-"
                dur_m = round((s.duration_seconds or 0) / 60)
                lines.append(
                    f"| #{short_id(s.id)} | {st} | {et} | {dur_m}m | {s.task_id or '-'} | {s.tags or '-'} | {s.notes or '-'} |"
                )

            lines.extend(["", "---", ""])

            # 2. Tasks Section
            lines.extend([
                f"## 2. Tasks ({len(tasks)} entries)",
                "",
                "| ID | Title | Status | Priority | Category | Target Day | Due Day | Tags |",
                "|---|---|---|---|---|---|---|---|",
            ])
            for t in tasks:
                due_info = t.due_date.strftime("%Y-%m-%d %H:%M") if t.due_date else "-"
                lines.append(
                    f"| #{short_id(t.id)} | {t.title} | {t.status} | {t.priority.upper()} | {t.category} "
                    f"| {t.assigned_date or '-'} | {due_info} | {t.tags or '-'} |"
                )

            lines.extend(["", "---", ""])

            # 3. Habits Section
            habits = self.db.exec(select(Habit)).all()
            lines.extend([
                f"## 3. Habits ({len(habits)} entries)",
                "",
                "| ID | Name | Type | Target | Frequency | Reminder Time |",
                "|---|---|---|---|---|---|",
            ])
            for h in habits:
                target_str = f"{h.target_value} {h.unit or ''}".strip() if h.habit_type == "numeric" else "Checkmark"
                lines.append(
                    f"| #{short_id(h.id)} | {h.name} | {h.habit_type} | {target_str} | {h.frequency} | {h.reminder_time or '-'} |"
                )

            lines.append("")
            return "\n".join(lines)

        else:
            # Default Mode: "sessions" (Chronological Agenda)
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
                "## Now",
            ]

            if group_now:
                for item in group_now:
                    lines.append(f"- [{item['start_str']} - {item['end_str']}] {item['title']} | {item['tags']} (ACTIVE)")
            else:
                lines.append("- No active session running.")

            lines.extend(["", "## Later Today"])
            if group_later:
                for item in sorted(group_later, key=lambda x: x["start_str"]):
                    lines.append(f"- [{item['start_str']} - {item['end_str']}] {item['title']} | {item['tags']}")
            else:
                lines.append("- No remaining sessions scheduled for today.")

            lines.extend(["", f"## Tomorrow ({tomorrow_date.strftime('%Y-%m-%d')})"])
            if group_tomorrow:
                for item in sorted(group_tomorrow, key=lambda x: x["start_str"]):
                    lines.append(f"- [{item['start_str']} - {item['end_str']}] {item['title']} | {item['tags']}")
            else:
                lines.append("- No sessions scheduled for tomorrow.")

            lines.extend(["", "## Upcoming"])
            if group_upcoming:
                for item in sorted(group_upcoming, key=lambda x: (x["date_str"], x["start_str"]))[:15]:
                    lines.append(f"- [{item['date_str']} {item['start_str']} - {item['end_str']}] {item['title']} | {item['tags']}")
            else:
                lines.append("- No future upcoming sessions found.")

            lines.append("")
            return "\n".join(lines)
