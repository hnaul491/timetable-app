from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import Document, DocumentUpload, Event, GcalTombstone, Note, RecurringRule, Task
from app.timeutil import to_naive_utc

PARIS = ZoneInfo("Europe/Paris")
MAX_SPAN_DAYS = 400


def _hhmm(value: str) -> time:
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


def occurrences(rule: RecurringRule) -> list[tuple[datetime, datetime]]:
    start_t, end_t = _hhmm(rule.start_time), _hhmm(rule.end_time)
    last = min(rule.until_date, rule.from_date + timedelta(days=MAX_SPAN_DAYS))
    result: list[tuple[datetime, datetime]] = []
    day: date = rule.from_date
    while day <= last:
        if day.weekday() in rule.weekdays:
            start = datetime.combine(day, start_t, PARIS)
            end_day = day if end_t > start_t else day + timedelta(days=1)
            end = datetime.combine(end_day, end_t, PARIS)
            result.append((to_naive_utc(start), to_naive_utc(end)))
        day += timedelta(days=1)
    return result


def _has_note(session: Session, event_id: int) -> bool:
    return session.scalar(select(Note.id).where(Note.event_id == event_id, Note.body != "").limit(1)) is not None


def delete_event_cascade(session: Session, event: Event) -> None:
    if event.gcal_event_id:
        # The Google copy is removed by the next push.
        session.merge(GcalTombstone(gcal_event_id=event.gcal_event_id,
                                    created_at=datetime.now(timezone.utc).replace(tzinfo=None)))
    session.execute(update(Document).where(Document.event_id == event.id).values(event_id=None))
    session.execute(delete(DocumentUpload).where(DocumentUpload.event_id == event.id))
    session.execute(delete(Task).where(Task.event_id == event.id))
    session.execute(delete(Note).where(Note.event_id == event.id))
    session.delete(event)
    session.flush()


def regenerate(session: Session, rule: RecurringRule, now: datetime) -> int:
    kept_starts: set[datetime] = set()
    for event in session.scalars(select(Event).where(Event.recurring_rule_id == rule.id)).all():
        if event.start_at < now or _has_note(session, event.id):
            kept_starts.add(event.start_at)
        else:
            delete_event_cascade(session, event)
    created = 0
    for start, end in occurrences(rule):
        if start < now or start in kept_starts:
            continue
        session.add(Event(source="custom", semester_id=rule.semester_id, subject_id=None, section=None,
                          title_raw=rule.title, start_at=start, end_at=end, room=rule.location,
                          description="", kind=rule.kind, status="normal", recurring_rule_id=rule.id))
        created += 1
    session.flush()
    return created


def delete_rule(session: Session, rule: RecurringRule, now: datetime) -> None:
    for event in session.scalars(select(Event).where(Event.recurring_rule_id == rule.id)).all():
        if event.start_at >= now and not _has_note(session, event.id):
            delete_event_cascade(session, event)
        else:
            event.recurring_rule_id = None
    session.flush()
    session.delete(rule)
    session.flush()
