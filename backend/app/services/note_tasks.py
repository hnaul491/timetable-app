import re
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Event, Note, Task

LINE_RE = re.compile(r"^(\s*)\[( |x|X)\]\s+(.*?)\s*$")
DUE_RE = re.compile(r"\s+@(\d{4}-\d{2}-\d{2})$")


@dataclass(frozen=True)
class TaskLine:
    title: str
    done: bool
    due: date | None


def _parse(line: str) -> TaskLine | None:
    match = LINE_RE.match(line)
    if not match:
        return None
    text = match.group(3)
    due = None
    due_match = DUE_RE.search(text)
    if due_match:
        try:
            due = date.fromisoformat(due_match.group(1))
            text = text[: due_match.start()].rstrip()
        except ValueError:
            due = None
    if not text:
        return None
    return TaskLine(text, match.group(2) in "xX", due)


def parse_task_lines(body: str) -> list[TaskLine]:
    return [parsed for line in body.splitlines() if (parsed := _parse(line)) is not None]


def render_line(title: str, done: bool, due: date | None) -> str:
    line = f"[{'x' if done else ' '}] {title}"
    return f"{line} @{due.isoformat()}" if due else line


def update_line(body: str, title: str, done: bool, due: date | None, occurrence: int = 0) -> str:
    lines = body.split("\n")
    seen = 0
    for index, raw in enumerate(lines):
        carriage = "\r" if raw.endswith("\r") else ""
        line = raw[:-1] if carriage else raw
        parsed = _parse(line)
        if parsed is None or parsed.title != title:
            continue
        if seen == occurrence:
            indent = LINE_RE.match(line).group(1)
            lines[index] = indent + render_line(title, done, due) + carriage
            return "\n".join(lines)
        seen += 1
    return body


def sync_note_tasks(session: Session, note: Note, event: Event, now: datetime) -> list[Task]:
    existing = session.scalars(
        select(Task).where(Task.note_id == note.id, Task.source == "note").order_by(Task.position, Task.id)
    ).all()
    pool: dict[str, list[Task]] = {}
    for task in existing:
        pool.setdefault(task.title, []).append(task)

    kept: list[Task] = []
    for position, line in enumerate(parse_task_lines(note.body)):
        bucket = pool.get(line.title)
        task = bucket.pop(0) if bucket else None
        if task is None:
            task = Task(note_id=note.id, event_id=event.id, subject_id=event.subject_id, title=line.title,
                        status="done" if line.done else "todo", due_date=line.due, important=note.important,
                        position=position, source="note", created_at=now)
            session.add(task)
        else:
            if line.done:
                task.status = "done"
            elif task.status == "done":
                task.status = "todo"
            task.due_date, task.position, task.important = line.due, position, note.important
        kept.append(task)

    for leftovers in pool.values():
        for task in leftovers:
            session.delete(task)
    session.flush()
    return kept
