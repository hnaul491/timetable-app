import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.deps import get_now
from app.models import Document, Event, Note, Subject, Task
from app.schemas import (SearchDocument, SearchEvent, SearchNote, SearchResponse, SearchSubject,
                         SearchTask)
from app.services.events_query import active_semester, invisible_event_ids
from app.timeutil import iso_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
SNIPPET_WIDTH = 80


def _like(column: ColumnElement, needle: str) -> ColumnElement[bool]:
    """Case-insensitive substring match; % and _ in the needle match literally."""
    return func.lower(column).contains(needle, autoescape=True)


def _snippet(body: str, needle: str) -> str:
    text = re.sub(r"\s+", " ", body).strip()
    pos = max(text.lower().find(needle), 0)
    start = max(0, pos - (SNIPPET_WIDTH - len(needle)) // 2)
    end = min(len(text), start + SNIPPET_WIDTH)
    start = max(0, min(start, end - SNIPPET_WIDTH))
    return ("…" if start > 0 else "") + text[start:end] + ("…" if end < len(text) else "")


@router.get("/search", response_model=SearchResponse)
def search(q: str = Query(...), limit: int = Query(8, ge=1, le=50),
           session: Session = Depends(get_session), now: datetime = Depends(get_now)) -> SearchResponse:
    needle = q.strip().lower()
    if not 2 <= len(needle) <= 100:
        raise HTTPException(status_code=422, detail="q must be 2 to 100 characters")
    semester = active_semester(session)
    if semester is None:
        return SearchResponse(events=[], subjects=[], notes=[], tasks=[], documents=[])

    subjects = list(session.scalars(select(Subject).where(Subject.semester_id == semester.id,
                                                          Subject.hidden.is_(False))))
    names = {s.id: s.display_name for s in subjects}
    matched = [s for s in subjects if needle in s.display_name.lower()
               or any(needle in str(a).lower() for a in s.aliases or [])]
    subject_hits = [SearchSubject(id=s.id, name=s.display_name)
                    for s in sorted(matched, key=lambda s: s.display_name.lower())[:limit]]

    # events of this semester that the calendar shows (same rule as list_visible_events)
    hidden_events = invisible_event_ids(session, semester.id)
    in_semester = and_(Event.semester_id == semester.id, Event.id.not_in(hidden_events or {-1}))
    event_match = or_(_like(Event.title_raw, needle), _like(Event.room, needle),
                      Event.subject_id.in_([s.id for s in matched]))
    base = select(Event).where(in_semester, event_match)
    upcoming = list(session.scalars(base.where(Event.end_at > now).order_by(Event.start_at, Event.id)
                                    .limit(limit)))
    past = list(session.scalars(base.where(Event.end_at <= now).order_by(Event.start_at.desc(), Event.id)
                                .limit(limit - len(upcoming)))) if len(upcoming) < limit else []
    event_hits = []
    for e in upcoming + past:
        title = names.get(e.subject_id) or e.title_raw
        event_hits.append(SearchEvent(
            id=e.id, title=title, start=iso_utc(e.start_at), end=iso_utc(e.end_at), room=e.room or None,
            cancelled=e.status == "cancelled", title_raw=e.title_raw if e.title_raw != title else None))

    note_rows = session.execute(
        select(Note.id, Note.event_id, Note.body, Event.title_raw, Event.subject_id)
        .join(Event, Event.id == Note.event_id).where(in_semester, _like(Note.body, needle))
        .order_by(Note.updated_at.desc(), Note.id).limit(limit)).all()
    note_hits = [SearchNote(id=nid, event_id=eid, event_title=names.get(sid) or title,
                            snippet=_snippet(body, needle))
                 for nid, eid, body, title, sid in note_rows]

    visible_events = select(Event.id).where(in_semester)
    subject_ok = or_(Task.subject_id.is_(None), Task.subject_id.in_(list(names) or [-1]))
    task_scope = or_(Task.event_id.in_(visible_events), Task.event_id.is_(None))
    task_rows = session.scalars(
        select(Task).where(task_scope, subject_ok, _like(Task.title, needle))
        .order_by(Task.due_date.is_(None), Task.due_date, Task.id).limit(limit))
    task_hits = [SearchTask(id=t.id, title=t.title, done=t.status == "done", due=t.due_date,
                            event_id=t.event_id) for t in task_rows]

    doc_rows = session.scalars(
        select(Document).where(Document.subject_id.in_(list(names) or [-1]), _like(Document.name, needle),
                               or_(Document.event_id.is_(None), Document.event_id.in_(visible_events)))
        .order_by(Document.created_at.desc(), Document.id.desc()).limit(limit))
    doc_hits = [SearchDocument(id=d.id, name=d.name, subject_id=d.subject_id,
                               web_view_link=d.web_view_link or None) for d in doc_rows]

    return SearchResponse(events=event_hits, subjects=subject_hits, notes=note_hits, tasks=task_hits,
                          documents=doc_hits)
