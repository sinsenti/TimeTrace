"""Pure ephemeral report encoding; never modify source strings."""

import csv
import html
import io
import unicodedata


def csv_text(value: str) -> str:
    probe = value.lstrip()
    while probe and (unicodedata.category(probe[0]).startswith("C") or probe[0].isspace()):
        probe = probe[1:]
    if (probe and probe[0] in "=+-@") or (value and unicodedata.category(value[0]).startswith("C")):
        return "'" + value
    return value


def markdown_text(value: str) -> str:
    value = html.escape(value, quote=True)
    for character in "\\|[]`*_":
        value = value.replace(character, "\\" + character)
    return value.replace("\r", "&#13;").replace("\n", "&#10;")


def render_history(rows: list[dict], snapshot: str, zone: str, totals: dict, request: dict) -> dict:
    columns = [
        "id",
        "classification",
        "task_id",
        "task_name",
        "start",
        "end",
        "duration_seconds",
        "note",
        "source",
        "timezone",
    ]
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow(
            [csv_text(str(row.get(key) or "")) if key != "duration_seconds" else row.get(key) for key in columns]
        )
    lines = [
        "# Activity history",
        "",
        f"Snapshot as of {snapshot}; regenerate for latest.",
        f"Timezone: {zone}. Whole intervals by local start day.",
        f"Local start dates: {request['start_date']} through {request['end_date']}.",
        markdown_text(
            f"Filters: title={request['title']!r}; tag={request['tag']!r}; note={request['note']!r}; "
            f"task={request['task_id']}; taskless={request['taskless']}; mode={request['mode']}"
        ),
        f"Entries: {len(rows)}; saved work: {sum(r['classification'] == 'recorded_work' for r in rows)}; "
        f"uncertain legacy: {sum(r['classification'] == 'legacy_uncertain' for r in rows)} (zero recorded credit).",
        "Readable report, not a lossless backup. Plans/live timers excluded; stop/save first.",
        f"Summed recorded work: {totals['summed_recorded_work_seconds']} seconds (overlaps count in full).",
        f"Elapsed recorded time: {totals['elapsed_recorded_time_seconds']} seconds (union).",
        "",
    ]
    group = None
    for row in rows:
        key = (row["classification"], row["start"][:10], row["task_id"])
        if key != group:
            group = key
            lines += [
                "",
                "## " + markdown_text(" / ".join(str(v or "Taskless") for v in key)),
                markdown_text(row["task_name"]),
                "",
                "| ID | Start | End | Duration seconds | Note | Source |",
                "|---|---|---|---|---|---|",
            ]
        lines.append(
            "| "
            + " | ".join(
                markdown_text(str(row.get(k) or "Unknown"))
                for k in ["id", "start", "end", "duration_seconds", "note", "source"]
            )
            + " |"
        )
    return {
        "markdown": {
            "filename": "timetrace-history.md",
            "media_type": "text/markdown;charset=utf-8",
            "content": "\n".join(lines) + "\n",
        },
        "csv": {
            "filename": "timetrace-history.csv",
            "media_type": "text/csv;charset=utf-8",
            "content": stream.getvalue(),
        },
    }
