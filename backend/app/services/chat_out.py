from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ChatMessage, PendingAction
from app.schemas import ChatMessageOut, PendingActionOut
from app.timeutil import iso_utc


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
