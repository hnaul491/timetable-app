from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.ai.assistant import run_chat
from app.ai.provider import AIError, AIRateLimited, LLMProvider
from app.ai.suggest import suggest_tasks
from app.auth import require_user
from app.config import Settings, get_settings
from app.db import get_session
from app.deps import get_llm, get_now
from app.models import ChatMessage, Event, Note, PendingAction, Subject
from app.routers.custom_events import add_custom_event
from app.routers.notes import load_event
from app.routers.tasks import add_task
from app.schemas import (ActionResult, AiStatus, ChatHistory, ChatIn, ChatMessageOut, ChatReply, CustomEventIn,
                         PendingActionOut, SuggestIn, SuggestOut, TaskCreate)
from app.services.events_query import describe_event
from app.services.note_tasks import sync_note_tasks
from app.services.recurrence import PARIS
from app.timeutil import iso_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
NOT_SET_UP = "AI is not set up on the server"
RATE_LIMITED = "AI limit reached, try again later"
UNAVAILABLE = "The assistant is not available right now"
NOTE_LIMIT = 20000


def _need_llm(llm: LLMProvider | None) -> LLMProvider:
    if llm is None:
        raise HTTPException(status_code=503, detail=NOT_SET_UP)
    return llm


def _ai_error(exc: AIError) -> HTTPException:
    # fixed texts: nothing from the provider (which could echo request details) reaches the client
    if isinstance(exc, AIRateLimited):
        return HTTPException(status_code=429, detail=RATE_LIMITED)
    return HTTPException(status_code=502, detail=UNAVAILABLE)


def action_out(action: PendingAction, now: datetime) -> PendingActionOut:
    status = "expired" if action.status == "pending" and action.expires_at <= now else action.status
    return PendingActionOut(id=action.id, kind=action.kind, status=status, summary=str(action.payload.get("summary", "")),
                            payload=action.payload, result=action.result, expires_at=iso_utc(action.expires_at))


def message_out(session: Session, message: ChatMessage, now: datetime) -> ChatMessageOut:
    actions = []
    if message.actions:
        found = {a.id: a for a in session.scalars(select(PendingAction).where(PendingAction.id.in_(message.actions)))}
        actions = [action_out(found[i], now) for i in message.actions if i in found]
    return ChatMessageOut(id=message.id, role=message.role, content=message.content, actions=actions)


@router.get("/ai/status", response_model=AiStatus)
def status(settings: Settings = Depends(get_settings)) -> AiStatus:
    return AiStatus(enabled=settings.ai_enabled, model=settings.gemini_model)


@router.post("/ai/suggest", response_model=SuggestOut)
def suggest(body: SuggestIn, session: Session = Depends(get_session), llm: LLMProvider | None = Depends(get_llm),
            settings: Settings = Depends(get_settings)) -> SuggestOut:
    llm = _need_llm(llm)
    event = load_event(session, body.event_id)
    note = session.scalar(select(Note).where(Note.event_id == event.id, Note.tab == body.tab))
    if note is None or not note.body.strip():
        return SuggestOut(suggestions=[])
    described = describe_event(session, event)
    context = f"{described.title}, {described.start_at:%Y-%m-%d}"
    try:
        items = suggest_tasks(llm, note.body, context, body.locale or "en")
    except AIError as exc:
        raise _ai_error(exc) from None
    return SuggestOut(suggestions=items)


@router.get("/chat", response_model=ChatHistory)
def history(session: Session = Depends(get_session), now: datetime = Depends(get_now)) -> ChatHistory:
    rows = session.scalars(select(ChatMessage).order_by(ChatMessage.id)).all()
    return ChatHistory(messages=[message_out(session, m, now) for m in rows])


@router.post("/chat", response_model=ChatReply)
def chat(body: ChatIn, session: Session = Depends(get_session), llm: LLMProvider | None = Depends(get_llm),
         now: datetime = Depends(get_now)) -> ChatReply:
    llm = _need_llm(llm)
    try:
        run_chat(session, llm, body.message, body.context, body.locale or "en", now)
    except AIError as exc:
        raise _ai_error(exc) from None
    last = session.scalar(select(ChatMessage).where(ChatMessage.role == "assistant").order_by(ChatMessage.id.desc()))
    return ChatReply(message=message_out(session, last, now))


@router.delete("/chat", status_code=204)
def clear_chat(session: Session = Depends(get_session)) -> None:
    session.query(ChatMessage).delete()
    session.commit()


# ---- the only place the assistant's proposals become real rows ------------------------------------------

def _paris(day: str, at: str) -> datetime:
    return datetime.combine(date.fromisoformat(day), time.fromisoformat(at), PARIS)


def _own_event(session: Session, title: str, day: str, start: str, end: str, kind: str, room: str) -> Event:
    return add_custom_event(session, CustomEventIn(title=title, kind=kind, start=_paris(day, start),
                                                   end=_paris(day, end), room=room))


def _execute(session: Session, action: PendingAction, now: datetime) -> dict:
    data = action.payload
    if action.kind == "task":
        task = add_task(session, TaskCreate(title=data["title"], due_date=data.get("due_date"),
                                            subject_id=data.get("subject_id"), event_id=data.get("event_id")),
                        now, "ai")
        session.flush()
        return {"kind": "task", "ids": [task.id]}
    if action.kind == "event":
        event = _own_event(session, data["title"], data["date"], data["start"], data["end"], data["kind"],
                           data.get("room", ""))
        session.flush()
        return {"kind": "event", "ids": [event.id]}
    if action.kind == "study_blocks":
        subject = session.get(Subject, data["subject_id"])
        if subject is None:
            raise HTTPException(status_code=409, detail="this subject no longer exists")
        events = [_own_event(session, f"Study: {subject.display_name}"[:200], b["date"], b["start"], b["end"],
                             "other", "") for b in data["blocks"]]
        session.flush()
        return {"kind": "study_blocks", "ids": [e.id for e in events]}
    if action.kind == "note":
        event = session.get(Event, data["event_id"])
        if event is None:
            raise HTTPException(status_code=409, detail="this class no longer exists")
        note = session.scalar(select(Note).where(Note.event_id == event.id, Note.tab == data["tab"]))
        if note is None:
            note = Note(event_id=event.id, tab=data["tab"], body="", important=False, updated_at=now)
            session.add(note)
            session.flush()
        joiner = "" if not note.body or note.body.endswith("\n") else "\n"
        body = f"{note.body}{joiner}{data['text']}"
        if len(body) > NOTE_LIMIT:
            raise HTTPException(status_code=422, detail="the note would become too long")
        note.body, note.updated_at = body, now
        sync_note_tasks(session, note, event, now)
        return {"kind": "note", "ids": [note.id]}
    raise HTTPException(status_code=409, detail="unknown action")


def _pending(session: Session, action_id: int, now: datetime) -> PendingAction:
    action = session.get(PendingAction, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="action not found")
    if action.status != "pending":
        raise HTTPException(status_code=409, detail=f"this action was already {action.status}")
    if action.expires_at <= now:
        raise HTTPException(status_code=409, detail="this action has expired")
    return action


@router.post("/actions/{action_id}/confirm", response_model=ActionResult)
def confirm(action_id: int, session: Session = Depends(get_session), now: datetime = Depends(get_now)) -> ActionResult:
    action = _pending(session, action_id, now)
    # claim first (atomic): a concurrent second confirm sees rowcount 0 and creates nothing
    claimed = session.execute(update(PendingAction).where(PendingAction.id == action_id,
                                                          PendingAction.status == "pending")
                              .values(status="confirmed")).rowcount
    if claimed != 1:
        session.rollback()
        raise HTTPException(status_code=409, detail="this action was already handled")
    try:
        result = _execute(session, action, now)
    except HTTPException as exc:
        session.rollback()
        raise HTTPException(status_code=409 if exc.status_code == 422 else exc.status_code, detail=exc.detail) from None
    except Exception:
        session.rollback()
        raise
    session.refresh(action)
    action.result = result
    session.commit()
    return ActionResult(status="confirmed", result=result)


@router.post("/actions/{action_id}/dismiss", response_model=ActionResult, response_model_exclude_none=True)
def dismiss(action_id: int, session: Session = Depends(get_session), now: datetime = Depends(get_now)) -> ActionResult:
    action = _pending(session, action_id, now)
    action.status = "dismissed"
    session.commit()
    return ActionResult(status="dismissed")
