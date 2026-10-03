from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.deps import get_now
from app.models import Event, Note, Task
from app.routers.events import event_out
from app.schemas import EventDetailOut, ImportantIn, NoteOut, NoteUpdate
from app.services.events_query import describe_event, next_event
from app.services.note_tasks import sync_note_tasks
from app.services.task_query import task_out_list
from app.timeutil import iso_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
TABS = ("after", "before")


def load_event(session: Session, event_id: int) -> Event:
    event = session.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    return event


def build_detail(session: Session, event: Event) -> EventDetailOut:
    notes = {n.tab: n for n in session.scalars(select(Note).where(Note.event_id == event.id))}
    following = next_event(session, event)
    tasks = session.scalars(select(Task).where(Task.event_id == event.id).order_by(Task.position, Task.id)).all()
    return EventDetailOut(
        event=event_out(describe_event(session, event)),
        notes={
            tab: NoteOut(
                tab=tab,
                body=notes[tab].body if tab in notes else "",
                important=notes[tab].important if tab in notes else False,
                updated_at=iso_utc(notes[tab].updated_at) if tab in notes else None,
            )
            for tab in TABS
        },
        tasks=task_out_list(session, list(tasks)),
        next_event_id=following.id if following else None,
        next_event_start=iso_utc(following.start_at) if following else None,
        recurring_rule_id=event.recurring_rule_id,
    )


@router.get("/events/{event_id}", response_model=EventDetailOut)
def get_event(event_id: int, session: Session = Depends(get_session)) -> EventDetailOut:
    return build_detail(session, load_event(session, event_id))


@router.put("/events/{event_id}/notes/{tab}", response_model=EventDetailOut)
def put_note(event_id: int, tab: Literal["after", "before"], body: NoteUpdate,
             session: Session = Depends(get_session), now: datetime = Depends(get_now)) -> EventDetailOut:
    event = load_event(session, event_id)
    note = session.scalar(select(Note).where(Note.event_id == event.id, Note.tab == tab))
    if note is None:
        note = Note(event_id=event.id, tab=tab, body="", important=False, updated_at=now)
        session.add(note)
        session.flush()
    note.body, note.updated_at = body.body, now
    if body.important is not None:
        note.important = body.important
    sync_note_tasks(session, note, event, now)
    session.commit()
    return build_detail(session, event)


@router.put("/events/{event_id}/important", response_model=EventDetailOut)
def set_important(event_id: int, body: ImportantIn, session: Session = Depends(get_session),
                  now: datetime = Depends(get_now)) -> EventDetailOut:
    """The class-level star: kept on the after-class note, cleared from every note when removed."""
    event = load_event(session, event_id)
    notes = {n.tab: n for n in session.scalars(select(Note).where(Note.event_id == event.id))}
    if body.important:
        note = notes.get("after")
        if note is None:
            note = Note(event_id=event.id, tab="after", body="", important=True, updated_at=now)
            session.add(note)
        note.important = True
    else:
        for note in notes.values():
            note.important = False
    session.commit()
    return build_detail(session, event)
