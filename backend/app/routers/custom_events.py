from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.deps import get_now
from app.models import Event, RecurringRule, Semester
from app.routers.events import event_out
from app.schemas import CustomEventIn, Deleted, EventOut, RecurringRuleIn, RecurringRuleOut
from app.services.events_query import active_semester, describe_event
from app.services.recurrence import delete_event_cascade, delete_rule, regenerate
from app.timeutil import to_naive_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
MAX_EVENT = timedelta(hours=24)


def _semester(session: Session) -> Semester:
    semester = active_semester(session)
    if semester is None:
        raise HTTPException(status_code=409, detail="no active semester")
    return semester


def _span(body: CustomEventIn) -> tuple[datetime, datetime]:
    start, end = to_naive_utc(body.start), to_naive_utc(body.end)
    if end <= start or end - start > MAX_EVENT:
        raise HTTPException(status_code=422, detail="end must be after start and within 24 hours")
    return start, end


def _custom_event(session: Session, event_id: int) -> Event:
    event = session.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    if event.source != "custom":
        raise HTTPException(status_code=400, detail="school classes cannot be edited or deleted")
    return event


def add_custom_event(session: Session, body: CustomEventIn) -> Event:
    """Validate and add (not commit) an own event in the active semester."""
    semester = _semester(session)
    start, end = _span(body)
    event = Event(source="custom", semester_id=semester.id, subject_id=None, section=None,
                  title_raw=body.title.strip(), start_at=start, end_at=end, room=body.room.strip(),
                  description="", kind=body.kind, status="normal")
    session.add(event)
    return event


@router.post("/events", response_model=EventOut, status_code=201)
def create_event(body: CustomEventIn, session: Session = Depends(get_session)) -> EventOut:
    event = add_custom_event(session, body)
    session.commit()
    return event_out(describe_event(session, event))


@router.put("/events/{event_id}", response_model=EventOut)
def update_event(event_id: int, body: CustomEventIn, session: Session = Depends(get_session)) -> EventOut:
    event = _custom_event(session, event_id)
    start, end = _span(body)
    event.title_raw, event.kind, event.room = body.title.strip(), body.kind, body.room.strip()
    event.start_at, event.end_at = start, end
    event.recurring_rule_id = None  # an edited occurrence no longer follows its weekly rule
    session.commit()
    return event_out(describe_event(session, event))


@router.delete("/events/{event_id}", response_model=Deleted)
def delete_event(event_id: int, session: Session = Depends(get_session)) -> Deleted:
    delete_event_cascade(session, _custom_event(session, event_id))
    session.commit()
    return Deleted(deleted=True)


def _rule_out(session: Session, rule: RecurringRule) -> RecurringRuleOut:
    count = session.scalar(select(func.count()).select_from(Event).where(Event.recurring_rule_id == rule.id))
    return RecurringRuleOut(id=rule.id, title=rule.title, kind=rule.kind, weekdays=rule.weekdays,
                            start_time=rule.start_time, end_time=rule.end_time, from_date=rule.from_date,
                            until_date=rule.until_date, location=rule.location, occurrences=count or 0)


def _rule(session: Session, rule_id: int) -> RecurringRule:
    rule = session.get(RecurringRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="repeating event not found")
    return rule


def _apply(rule: RecurringRule, body: RecurringRuleIn) -> None:
    rule.title, rule.kind, rule.weekdays = body.title.strip(), body.kind, body.weekdays
    rule.start_time, rule.end_time = body.start_time, body.end_time
    rule.from_date, rule.until_date, rule.location = body.from_date, body.until_date, body.location.strip()


@router.get("/recurring", response_model=list[RecurringRuleOut])
def list_rules(session: Session = Depends(get_session)) -> list[RecurringRuleOut]:
    semester = active_semester(session)
    if semester is None:
        return []
    rules = session.scalars(select(RecurringRule).where(RecurringRule.semester_id == semester.id).order_by(RecurringRule.id))
    return [_rule_out(session, r) for r in rules]


@router.post("/recurring", response_model=RecurringRuleOut, status_code=201)
def create_rule(body: RecurringRuleIn, session: Session = Depends(get_session),
                now: datetime = Depends(get_now)) -> RecurringRuleOut:
    rule = RecurringRule(semester_id=_semester(session).id)
    _apply(rule, body)
    session.add(rule)
    session.flush()
    regenerate(session, rule, now)
    session.commit()
    return _rule_out(session, rule)


@router.put("/recurring/{rule_id}", response_model=RecurringRuleOut)
def update_rule(rule_id: int, body: RecurringRuleIn, session: Session = Depends(get_session),
                now: datetime = Depends(get_now)) -> RecurringRuleOut:
    rule = _rule(session, rule_id)
    _apply(rule, body)
    regenerate(session, rule, now)
    session.commit()
    return _rule_out(session, rule)


@router.delete("/recurring/{rule_id}", response_model=Deleted)
def remove_rule(rule_id: int, session: Session = Depends(get_session), now: datetime = Depends(get_now)) -> Deleted:
    delete_rule(session, _rule(session, rule_id), now)
    session.commit()
    return Deleted(deleted=True)
