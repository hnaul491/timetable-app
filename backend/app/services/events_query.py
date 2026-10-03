import re
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Event, MySection, Semester, Subject


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


def list_visible_events(
    session: Session, semester_id: int, start: datetime, end: datetime
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
        if subject is not None and subject.hidden:
            continue
        if event.section is not None:
            pick = chosen.get(event.subject_id) if event.subject_id is not None else None
            if pick is None:
                missing.add(subject.display_name if subject else event.title_raw)
                continue
            if pick != ALL_SECTIONS and pick != event.section:
                continue
        visible.append(VisibleEvent(
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
        ))
    return visible, sorted(missing)


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
