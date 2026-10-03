from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.models import Event, MySection, Note, Subject, Task
from app.services.events_query import VisibleEvent, list_visible_events

FAR_PAST = datetime(2000, 1, 1)
FAR_FUTURE = datetime(2100, 1, 1)
SESSION_KINDS = ("class", "exam")
SNIPPET_LENGTH = 160


@dataclass(frozen=True)
class SubjectSummary:
    id: int
    display_name: str
    color: str
    hidden: bool
    aliases: list[str]
    sessions: int
    sessions_done: int
    next_start: datetime | None
    exam_start: datetime | None
    exam_room: str | None
    open_tasks: int
    note_count: int


def _sessions_by_subject(session: Session, semester_id: int) -> dict[int, list[VisibleEvent]]:
    events, _ = list_visible_events(session, semester_id, FAR_PAST, FAR_FUTURE)
    grouped: dict[int, list[VisibleEvent]] = {}
    for event in events:
        if event.subject_id is not None and event.kind in SESSION_KINDS:
            grouped.setdefault(event.subject_id, []).append(event)
    return grouped


def _summary(subject: Subject, events: list[VisibleEvent], open_tasks: int, now: datetime) -> SubjectSummary:
    live = [e for e in events if e.status != "cancelled"]
    upcoming = [e for e in live if e.start_at >= now]
    exams = [e for e in live if e.kind == "exam"]
    return SubjectSummary(
        id=subject.id, display_name=subject.display_name, color=subject.color, hidden=subject.hidden,
        aliases=list(subject.aliases), sessions=len(live), sessions_done=sum(1 for e in live if e.start_at < now),
        next_start=upcoming[0].start_at if upcoming else None,
        exam_start=exams[0].start_at if exams else None, exam_room=exams[0].room if exams else None,
        open_tasks=open_tasks, note_count=sum(e.note_count for e in events),
    )


def subject_summaries(session: Session, semester_id: int, now: datetime) -> list[SubjectSummary]:
    subjects = session.scalars(
        select(Subject).where(Subject.semester_id == semester_id).order_by(Subject.display_name)
    ).all()
    grouped = _sessions_by_subject(session, semester_id)
    open_tasks = dict(session.execute(
        select(Task.subject_id, func.count())
        .where(Task.status != "done", Task.subject_id.is_not(None))
        .group_by(Task.subject_id)
    ).all())
    return [_summary(s, grouped.get(s.id, []), open_tasks.get(s.id, 0), now) for s in subjects]


def subject_sessions(session: Session, semester_id: int, subject_id: int) -> list[VisibleEvent]:
    return _sessions_by_subject(session, semester_id).get(subject_id, [])


def note_snippets(session: Session, event_ids: list[int]) -> dict[int, str]:
    if not event_ids:
        return {}
    snippets: dict[int, str] = {}
    rows = session.execute(
        select(Note.event_id, Note.tab, Note.body).where(Note.event_id.in_(event_ids), Note.body != "")
    ).all()
    for event_id, tab, body in sorted(rows, key=lambda r: (r[0], r[1] != "after")):
        snippets.setdefault(event_id, body.strip()[:SNIPPET_LENGTH])
    return snippets


def merge_subjects(session: Session, source: Subject, target: Subject) -> None:
    session.execute(update(Event).where(Event.subject_id == source.id).values(subject_id=target.id))
    session.execute(update(Task).where(Task.subject_id == source.id).values(subject_id=target.id))
    session.execute(delete(MySection).where(MySection.subject_id == source.id))
    known = {target.display_name.casefold(), *(a.casefold() for a in target.aliases)}
    aliases = list(target.aliases)
    for name in [source.display_name, *source.aliases]:
        if name.casefold() not in known:
            aliases.append(name)
            known.add(name.casefold())
    target.aliases = aliases  # new list so the JSON column is marked dirty
    session.delete(source)
    session.flush()
