from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.orm import Session

from app.models import Event, Subject, Task
from app.schemas import TaskOut
from app.timeutil import iso_utc


def not_hidden() -> ColumnElement[bool]:
    """Tasks without a subject, or whose subject is not hidden."""
    return or_(Task.subject_id.is_(None), Task.subject_id.not_in(select(Subject.id).where(Subject.hidden.is_(True))))


def task_out_list(session: Session, tasks: list[Task]) -> list[TaskOut]:
    subject_ids = {t.subject_id for t in tasks if t.subject_id is not None}
    event_ids = {t.event_id for t in tasks if t.event_id is not None}
    names = dict(session.execute(
        select(Subject.id, Subject.display_name).where(Subject.id.in_(subject_ids))
    ).all()) if subject_ids else {}
    starts = dict(session.execute(
        select(Event.id, Event.start_at).where(Event.id.in_(event_ids))
    ).all()) if event_ids else {}
    return [
        TaskOut(id=t.id, title=t.title, status=t.status, due_date=t.due_date, important=t.important,
                source=t.source, note_id=t.note_id, event_id=t.event_id, subject_id=t.subject_id,
                subject_name=names.get(t.subject_id),
                event_start=iso_utc(starts[t.event_id]) if t.event_id in starts else None,
                position=t.position)
        for t in tasks
    ]
