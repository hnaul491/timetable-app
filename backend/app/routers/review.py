from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.deps import get_now
from app.models import WeekReview
from app.routers.events import event_out
from app.schemas import ImportantNoteOut, ReviewMarkOut, ReviewOut
from app.services.events_query import active_semester
from app.services.review import (SCHOOL_KINDS, default_week_start, hours_by_kind, important_notes, open_tasks_due,
                                 paris_midnight_utc, paris_today, week_events)
from app.services.task_query import task_out_list
from app.timeutil import iso_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


def _monday(value: date) -> date:
    if value.weekday() != 0:
        raise HTTPException(status_code=422, detail="week_start must be a Monday")
    return value


@router.get("/review", response_model=ReviewOut)
def get_review(week_start: date | None = None, session: Session = Depends(get_session),
               now: datetime = Depends(get_now)) -> ReviewOut:
    today = paris_today(now)
    start = _monday(week_start) if week_start else default_week_start(today)
    end = start + timedelta(days=6)
    previous = start - timedelta(days=7)
    mark = session.get(WeekReview, start)
    semester = active_semester(session)
    week = week_events(session, semester.id, start) if semester else []
    last_week = week_events(session, semester.id, previous) if semester else []
    notes = important_notes(session, semester.id, paris_midnight_utc(previous),
                            paris_midnight_utc(start + timedelta(days=7))) if semester else []
    return ReviewOut(
        week_start=start,
        week_end=end,
        reviewed_at=iso_utc(mark.reviewed_at) if mark else None,
        overdue=task_out_list(session, open_tasks_due(session, before=today)),
        due_this_week=task_out_list(session, open_tasks_due(session, start=start, end=end)),
        important=[ImportantNoteOut(event_id=event.id, title=title, start=iso_utc(event.start_at), tab=note.tab,
                                    body=note.body) for note, event, title in notes],
        without_notes=[event_out(e) for e in last_week
                       if e.source == "zeus" and e.kind in SCHOOL_KINDS and e.status != "cancelled" and e.note_count == 0],
        changes=[event_out(e) for e in week if e.source == "zeus" and e.status in ("changed", "cancelled")],
        week=[event_out(e) for e in week],
        hours=hours_by_kind(week),
    )


@router.post("/review/{week_start}/done", response_model=ReviewMarkOut)
def mark_reviewed(week_start: date, session: Session = Depends(get_session),
                  now: datetime = Depends(get_now)) -> ReviewMarkOut:
    start = _monday(week_start)
    mark = session.get(WeekReview, start)
    if mark is None:
        mark = WeekReview(week_start=start, reviewed_at=now)
        session.add(mark)
    else:
        mark.reviewed_at = now
    session.commit()
    return ReviewMarkOut(week_start=start, reviewed_at=iso_utc(mark.reviewed_at))
