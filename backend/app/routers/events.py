from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.schemas import EventOut, EventsResponse
from app.services.events_query import VisibleEvent, active_semester, list_visible_events
from app.timeutil import iso_utc, to_naive_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
MAX_RANGE = timedelta(days=42)


def event_out(e: VisibleEvent) -> EventOut:
    return EventOut(id=e.id, title=e.title, subject_id=e.subject_id, subject_name=e.subject_name,
                    color=e.color, section=e.section, start=iso_utc(e.start_at), end=iso_utc(e.end_at),
                    room=e.room, kind=e.kind, status=e.status, source=e.source,
                    note_count=e.note_count, open_tasks=e.open_tasks, important=e.important)


@router.get("/events", response_model=EventsResponse)
def get_events(start: datetime, end: datetime, session: Session = Depends(get_session)) -> EventsResponse:
    start_utc, end_utc = to_naive_utc(start), to_naive_utc(end)
    if end_utc <= start_utc or end_utc - start_utc > MAX_RANGE:
        raise HTTPException(status_code=400, detail="range must be longer than 0 and at most 42 days")
    semester = active_semester(session)
    if semester is None:
        return EventsResponse(events=[], missing_sections=[])
    events, missing = list_visible_events(session, semester.id, start_utc, end_utc)
    return EventsResponse(
        events=[event_out(e) for e in events],
        missing_sections=missing,
    )
