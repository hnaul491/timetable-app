import re
from dataclasses import dataclass, replace
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Event, MySection, Note, Semester, Subject, Task


@dataclass(frozen=True)
class VisibleEvent:
    id: int
    title: str
    subject_id: int | None
    subject_name: str | None
    color: str | None
    section: str | None
    start_at: datetime
    end_at: datetime
    room: str
    kind: str
    status: str
    source: str
    note_count: int = 0
    open_tasks: int = 0
    important: bool = False


@dataclass(frozen=True)
class SectionChoice:
    subject_id: int
    subject_name: str
    sections: list[str]
    chosen: str | None


ALL_SECTIONS = "ALL"
"""my_section value meaning: show every section of this subject."""


def natural_key(value: str) -> list[int | str]:
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", value)]


def active_semester(session: Session) -> Semester | None:
    return session.scalar(select(Semester).where(Semester.is_active.is_(True)))


def _subjects(session: Session, semester_id: int) -> dict[int, Subject]:
    return {s.id: s for s in session.scalars(select(Subject).where(Subject.semester_id == semester_id))}


def _chosen(session: Session, subject_ids: list[int]) -> dict[int, str]:
    rows = session.scalars(select(MySection).where(MySection.subject_id.in_(subject_ids)))
    return {row.subject_id: row.section for row in rows}


def _to_visible(event: Event, subject: Subject | None) -> VisibleEvent:
    return VisibleEvent(
        id=event.id,
        title=subject.display_name if subject else event.title_raw,
        subject_id=event.subject_id,
        subject_name=subject.display_name if subject else None,
        color=subject.color if subject else None,
        section=event.section,
        start_at=event.start_at,
        end_at=event.end_at,
        room=event.room,
        kind=event.kind,
        status=event.status,
        source=event.source,
    )


def _with_counts(session: Session, events: list[VisibleEvent]) -> list[VisibleEvent]:
    if not events:
        return events
    ids = [e.id for e in events]
    note_counts: dict[int, int] = {}
    important: set[int] = set()
    for event_id, is_important, body in session.execute(
        select(Note.event_id, Note.important, Note.body).where(Note.event_id.in_(ids))
    ):
        if body:
            note_counts[event_id] = note_counts.get(event_id, 0) + 1
        if is_important:  # a starred class is important even when its notes are empty
            important.add(event_id)
    open_tasks = dict(session.execute(
        select(Task.event_id, func.count()).where(Task.event_id.in_(ids), Task.status != "done").group_by(Task.event_id)
    ).all())
    return [replace(e, note_count=note_counts.get(e.id, 0), open_tasks=open_tasks.get(e.id, 0),
                    important=e.id in important) for e in events]


def describe_event(session: Session, event: Event) -> VisibleEvent:
    subject = session.get(Subject, event.subject_id) if event.subject_id is not None else None
    return _with_counts(session, [_to_visible(event, subject)])[0]


def next_event(session: Session, event: Event) -> Event | None:
    if event.recurring_rule_id is not None:
        query = select(Event).where(Event.recurring_rule_id == event.recurring_rule_id)
    elif event.subject_id is not None:
        query = select(Event).where(
            Event.subject_id == event.subject_id,
            or_(Event.section.is_(None), Event.section == event.section),
        )
    else:
        return None
    query = query.where(Event.start_at > event.start_at, Event.status != "cancelled")
    return session.scalars(query.order_by(Event.start_at).limit(1)).first()


def visibility(event: Event, subject: Subject | None, chosen: dict[int, str]) -> str:
    """The calendar's rule: "show", "hide" (hidden subject / another section) or "missing" (no section chosen)."""
    if subject is not None and subject.hidden:
        return "hide"
    if event.section is None:
        return "show"
    pick = chosen.get(event.subject_id) if event.subject_id is not None else None
    if pick is None:
        return "missing"
    return "show" if pick == ALL_SECTIONS or pick == event.section else "hide"


def invisible_event_ids(session: Session, semester_id: int) -> set[int]:
    """Ids of the semester's events the calendar does not show, for excluding them from other listings."""
    subjects = _subjects(session, semester_id)
    chosen = _chosen(session, list(subjects))
    rows = session.scalars(select(Event).where(Event.semester_id == semester_id))
    return {e.id for e in rows
            if visibility(e, subjects.get(e.subject_id) if e.subject_id is not None else None, chosen) != "show"}


def list_visible_events(
    session: Session, semester_id: int, start: datetime, end: datetime, with_counts: bool = True
) -> tuple[list[VisibleEvent], list[str]]:
    subjects = _subjects(session, semester_id)
    chosen = _chosen(session, list(subjects))
    rows = session.scalars(
        select(Event)
        .where(Event.semester_id == semester_id, Event.start_at < end, Event.end_at > start)
        .order_by(Event.start_at, Event.id)
    )
    visible: list[VisibleEvent] = []
    missing: set[str] = set()
    for event in rows:
        subject = subjects.get(event.subject_id) if event.subject_id is not None else None
        verdict = visibility(event, subject, chosen)
        if verdict == "missing":
            missing.add(subject.display_name if subject else event.title_raw)
        elif verdict == "show":
            visible.append(_to_visible(event, subject))
    return (_with_counts(session, visible) if with_counts else visible), sorted(missing)


def section_choices(session: Session, semester_id: int) -> list[SectionChoice]:
    subjects = _subjects(session, semester_id)
    chosen = _chosen(session, list(subjects))
    pairs = session.execute(
        select(Event.subject_id, Event.section)
        .where(Event.semester_id == semester_id, Event.section.is_not(None), Event.subject_id.is_not(None))
        .distinct()
    ).all()
    by_subject: dict[int, set[str]] = {}
    for subject_id, section in pairs:
        by_subject.setdefault(subject_id, set()).add(section)
    return sorted(
        (
            SectionChoice(subject_id=sid, subject_name=subjects[sid].display_name,
                          sections=sorted(sections, key=natural_key), chosen=chosen.get(sid))
            for sid, sections in by_subject.items()
        ),
        key=lambda c: c.subject_name,
    )
