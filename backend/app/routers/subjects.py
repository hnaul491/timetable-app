from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_user
from app.config import Settings, get_settings
from app.db import get_session
from app.deps import get_drive_factory, get_now
from app.gdrive.api import DriveFactory
from app.models import Subject, Task
from app.schemas import MergeIn, SessionOut, SubjectDetailOut, SubjectPatch, SubjectSummaryOut
from app.services.documents import rename_subject_folder
from app.services.events_query import active_semester
from app.services.subjects_query import (SubjectSummary, merge_subjects, note_snippets, subject_sessions,
                                         subject_summaries)
from app.services.task_query import task_out_list
from app.timeutil import iso_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


def _out(s: SubjectSummary) -> SubjectSummaryOut:
    return SubjectSummaryOut(
        id=s.id, display_name=s.display_name, color=s.color, hidden=s.hidden, aliases=s.aliases,
        sessions=s.sessions, sessions_done=s.sessions_done,
        next_start=iso_utc(s.next_start) if s.next_start else None,
        exam_start=iso_utc(s.exam_start) if s.exam_start else None, exam_room=s.exam_room,
        open_tasks=s.open_tasks, note_count=s.note_count,
    )


def _subject(session: Session, subject_id: int) -> Subject:
    subject = session.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="subject not found")
    return subject


def _summary_of(session: Session, subject: Subject, now: datetime) -> SubjectSummaryOut:
    summary = next(s for s in subject_summaries(session, subject.semester_id, now) if s.id == subject.id)
    return _out(summary)


@router.get("/subjects", response_model=list[SubjectSummaryOut])
def list_subjects(session: Session = Depends(get_session), now: datetime = Depends(get_now)) -> list[SubjectSummaryOut]:
    semester = active_semester(session)
    if semester is None:
        return []
    return [_out(s) for s in subject_summaries(session, semester.id, now)]


@router.get("/subjects/{subject_id}", response_model=SubjectDetailOut)
def get_subject(subject_id: int, session: Session = Depends(get_session),
                now: datetime = Depends(get_now)) -> SubjectDetailOut:
    subject = _subject(session, subject_id)
    events = subject_sessions(session, subject.semester_id, subject.id)
    snippets = note_snippets(session, [e.id for e in events])
    tasks = session.scalars(
        select(Task).where(Task.subject_id == subject.id)
        .order_by(Task.status == "done", Task.due_date.is_(None), Task.due_date, Task.id)
    ).all()
    return SubjectDetailOut(
        subject=_summary_of(session, subject, now),
        sessions=[
            SessionOut(id=e.id, start=iso_utc(e.start_at), end=iso_utc(e.end_at), room=e.room, kind=e.kind,
                       status=e.status, section=e.section, note_snippet=snippets.get(e.id),
                       note_count=e.note_count, open_tasks=e.open_tasks, important=e.important)
            for e in events
        ],
        tasks=task_out_list(session, list(tasks)),
    )


@router.patch("/subjects/{subject_id}", response_model=SubjectSummaryOut)
def patch_subject(subject_id: int, body: SubjectPatch, session: Session = Depends(get_session),
                  now: datetime = Depends(get_now), settings: Settings = Depends(get_settings),
                  drive_factory: DriveFactory = Depends(get_drive_factory)) -> SubjectSummaryOut:
    subject = _subject(session, subject_id)
    renamed = body.display_name is not None and body.display_name != subject.display_name
    if renamed:
        new_key = body.display_name.casefold()
        others = session.scalars(select(Subject).where(
            Subject.semester_id == subject.semester_id, Subject.id != subject.id))
        for other in others:
            if other.display_name.casefold() == new_key or any(a.casefold() == new_key for a in other.aliases):
                raise HTTPException(status_code=409, detail="another subject already has this name")
        # Keep the old name resolvable so the next Zeus sync does not create a duplicate subject.
        aliases = [a for a in subject.aliases if a.casefold() != new_key]
        if subject.display_name.casefold() != new_key and not any(
                a.casefold() == subject.display_name.casefold() for a in aliases):
            aliases.append(subject.display_name)
        subject.aliases = aliases
        subject.display_name = body.display_name
    if body.color is not None:
        subject.color = body.color
    if body.hidden is not None:
        subject.hidden = body.hidden
    session.commit()
    if renamed:
        rename_subject_folder(session, settings, drive_factory, subject)
    return _summary_of(session, subject, now)


@router.post("/subjects/{subject_id}/merge", response_model=SubjectSummaryOut)
def merge_subject(subject_id: int, body: MergeIn, session: Session = Depends(get_session),
                  now: datetime = Depends(get_now)) -> SubjectSummaryOut:
    source = _subject(session, subject_id)
    target = _subject(session, body.into_id)
    if source.id == target.id or source.semester_id != target.semester_id:
        raise HTTPException(status_code=422, detail="choose a different subject of the same semester")
    merge_subjects(session, source, target)
    session.commit()
    return _summary_of(session, target, now)
