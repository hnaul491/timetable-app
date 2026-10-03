from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Event, Note, Subject, Task
from app.services.events_query import VisibleEvent, list_visible_events
from app.services.recurrence import PARIS
from app.timeutil import to_naive_utc

SCHOOL_KINDS = ("class", "exam")


def paris_today(now: datetime) -> date:
    return now.replace(tzinfo=timezone.utc).astimezone(PARIS).date()


def default_week_start(today: date) -> date:
    monday = today - timedelta(days=today.weekday())
    return monday + timedelta(days=7) if today.weekday() >= 5 else monday


def paris_midnight_utc(day: date) -> datetime:
    return to_naive_utc(datetime.combine(day, time(0, 0), PARIS))


def week_events(session: Session, semester_id: int, week_start: date) -> list[VisibleEvent]:
    events, _ = list_visible_events(session, semester_id, paris_midnight_utc(week_start),
                                    paris_midnight_utc(week_start + timedelta(days=7)))
    return events


def hours_by_kind(events: list[VisibleEvent]) -> dict[str, float]:
    totals = {"school": 0.0, "work": 0.0, "french_ext": 0.0, "other": 0.0}
    for e in events:
        if e.kind == "holiday" or e.status == "cancelled":
            continue
        key = "school" if e.source == "zeus" and e.kind in SCHOOL_KINDS else e.kind if e.kind in totals else "other"
        totals[key] += (e.end_at - e.start_at).total_seconds() / 3600
    return {k: round(v, 1) for k, v in totals.items()}


def open_tasks_due(session: Session, before: date | None = None, start: date | None = None,
                   end: date | None = None) -> list[Task]:
    query = select(Task).where(Task.status != "done", Task.due_date.is_not(None))
    if before is not None:
        query = query.where(Task.due_date < before)
    if start is not None:
        query = query.where(Task.due_date >= start)
    if end is not None:
        query = query.where(Task.due_date <= end)
    return list(session.scalars(query.order_by(Task.due_date, Task.position, Task.id)))


def important_notes(session: Session, semester_id: int, start: datetime, end: datetime) -> list[tuple[Note, Event, str]]:
    rows = session.execute(
        select(Note, Event, Subject.display_name)
        .join(Event, Note.event_id == Event.id)
        .outerjoin(Subject, Event.subject_id == Subject.id)
        .where(Event.semester_id == semester_id, Note.important.is_(True),
               Event.start_at >= start, Event.start_at < end)
        .order_by(Event.start_at, Note.tab)
    ).all()
    return [(note, event, name or event.title_raw) for note, event, name in rows]
