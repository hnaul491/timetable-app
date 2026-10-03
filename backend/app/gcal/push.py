import hashlib
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.config import Settings
from app.gcal.api import (ACCOUNT_ID, CALENDAR_NAME, REFRESH_TOKEN_NAME, TIME_ZONE, GcalFactory, GoogleAuthError,
                          GoogleCalendar, GoogleError, GoogleNotFound, GoogleRateLimited)
from app.models import Event, GcalTombstone, GoogleAccount
from app.secret_store import SecretStore
from app.services.events_query import VisibleEvent, active_semester, list_visible_events
from app.services.recurrence import PARIS
from app.timeutil import iso_utc

KEEP_PAST = timedelta(days=7)
FAR_FUTURE = datetime(2100, 1, 1)
CALENDAR_GONE = 'The "My Timetable" calendar is gone from Google; it will be recreated on the next push.'


def _paris(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc).astimezone(PARIS)


def event_body(e: VisibleEvent, app_url: str) -> dict[str, Any]:
    summary = e.title + (f" · {e.section}" if e.section else "")
    if e.kind == "exam":
        summary = f"Exam: {summary}"
    body: dict[str, Any] = {
        "summary": summary,
        "location": e.room,
        "description": f"Open in Timetable: {app_url.rstrip('/')}/events/{e.id}",
        "extendedProperties": {"private": {"timetableEventId": str(e.id)}},
    }
    if e.kind == "holiday":
        start, end = _paris(e.start_at), _paris(e.end_at)
        last = end.date() if (end.hour, end.minute) == (0, 0) else end.date() + timedelta(days=1)
        last = max(last, start.date() + timedelta(days=1))
        body["start"] = {"date": start.date().isoformat()}
        body["end"] = {"date": last.isoformat()}
        body["transparency"] = "transparent"
    else:
        body["start"] = {"dateTime": iso_utc(e.start_at), "timeZone": TIME_ZONE}
        body["end"] = {"dateTime": iso_utc(e.end_at), "timeZone": TIME_ZONE}
    return body


def body_hash(body: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


@dataclass(frozen=True)
class Op:
    action: str  # "insert" | "update" | "delete" (event no longer wanted) | "remove" (tombstone)
    event_id: int | None
    gcal_event_id: str | None
    body: dict[str, Any] | None
    digest: str | None


@dataclass
class PushResult:
    status: str  # "ok" | "partial" | "failed" | "skipped"
    done: int = 0
    failed: int = 0
    remaining: int = 0
    error: str | None = None


class _CalendarMissing(Exception):
    pass


def plan_ops(session: Session, account: GoogleAccount, now: datetime, app_url: str) -> list[Op]:
    ops = [Op("remove", None, t.gcal_event_id, None, None)
           for t in session.scalars(select(GcalTombstone).order_by(GcalTombstone.created_at))]
    semester = active_semester(session)
    if semester is None:
        return ops
    since = now - KEEP_PAST
    visible, _ = list_visible_events(session, semester.id, since, FAR_FUTURE)
    wanted = {e.id: e for e in visible if e.kind in account.kinds and e.status != "cancelled"}
    rows = session.scalars(select(Event).where(Event.semester_id == semester.id, Event.end_at > since)
                           .order_by(Event.start_at, Event.id))
    for row in rows:
        if row.id in wanted:
            body = event_body(wanted[row.id], app_url)
            digest = body_hash(body)
            if row.gcal_event_id is None:
                ops.append(Op("insert", row.id, None, body, digest))
            elif row.gcal_hash != digest:
                ops.append(Op("update", row.id, row.gcal_event_id, body, digest))
        elif row.gcal_event_id is not None:
            ops.append(Op("delete", row.id, row.gcal_event_id, None, None))
    return ops


def reset_calendar(session: Session, account: GoogleAccount) -> None:
    account.calendar_id = None
    session.execute(update(Event).where(Event.gcal_event_id.is_not(None)).values(gcal_event_id=None, gcal_hash=None))
    session.execute(delete(GcalTombstone))
    session.flush()


def _delete_quietly(gcal: GoogleCalendar, calendar_id: str, gcal_event_id: str) -> None:
    try:
        gcal.delete_event(calendar_id, gcal_event_id)
    except GoogleNotFound:
        pass  # already gone in Google


def _apply(session: Session, gcal: GoogleCalendar, calendar_id: str, op: Op) -> None:
    if op.action == "remove":
        _delete_quietly(gcal, calendar_id, op.gcal_event_id)
        session.execute(delete(GcalTombstone).where(GcalTombstone.gcal_event_id == op.gcal_event_id))
        return
    event = session.get(Event, op.event_id)
    if op.action == "delete":
        _delete_quietly(gcal, calendar_id, op.gcal_event_id)
        event.gcal_event_id = event.gcal_hash = None
        return
    if op.action == "update":
        try:
            gcal.update_event(calendar_id, op.gcal_event_id, op.body)
            event.gcal_hash = op.digest
            return
        except GoogleNotFound:
            pass  # deleted by hand in Google: create it again below
    event.gcal_event_id = gcal.insert_event(calendar_id, op.body)
    event.gcal_hash = op.digest


def push(session: Session, account: GoogleAccount, gcal: GoogleCalendar, now: datetime, app_url: str,
         deadline: float, clock: Callable[[], float] = time.monotonic) -> PushResult:
    result = PushResult(status="ok")
    try:
        if account.calendar_id is None:
            account.calendar_id = gcal.create_calendar(CALENDAR_NAME, TIME_ZONE)
            session.commit()
        ops = plan_ops(session, account, now, app_url)
        for index, op in enumerate(ops):
            if clock() >= deadline:
                result.remaining = len(ops) - index
                break
            try:
                _apply(session, gcal, account.calendar_id, op)
            except GoogleNotFound:
                raise _CalendarMissing() from None  # inserting failed: the calendar itself is gone
            except GoogleRateLimited as exc:
                session.rollback()
                result.remaining = len(ops) - index
                result.error = str(exc)
                break
            except GoogleAuthError:
                raise
            except GoogleError as exc:
                session.rollback()
                result.failed += 1
                result.error = str(exc)
                continue
            session.commit()
            result.done += 1
    except GoogleAuthError as exc:
        session.rollback()
        account.needs_reconnect = True
        result.status, result.error = "failed", str(exc)
    except _CalendarMissing:
        session.rollback()
        reset_calendar(session, account)
        result.status, result.error = "failed", CALENDAR_GONE
    else:
        if result.remaining or result.failed:
            result.status = "partial"
    account.last_push_at = now
    account.last_push_error = result.error
    session.commit()
    return result


def run_push(session: Session, settings: Settings, factory: GcalFactory, now: datetime, deadline: float,
             clock: Callable[[], float] = time.monotonic) -> PushResult:
    """Push for the connected account, if any. Never raises: the daily sync must not fail because of Google."""
    account = session.get(GoogleAccount, ACCOUNT_ID)
    if account is None or account.needs_reconnect or not settings.google_configured:
        return PushResult(status="skipped")
    try:
        token = SecretStore(session, settings.token_encryption_key).get(REFRESH_TOKEN_NAME)
        if not token:
            account.needs_reconnect = True
            account.last_push_error = "Google is not connected any more — connect it again in Settings"
            session.commit()
            return PushResult(status="failed", error=account.last_push_error)
        return push(session, account, factory(token), now, settings.app_url, deadline, clock)
    except Exception as exc:  # noqa: BLE001 — record and move on
        session.rollback()
        error = f"unexpected error ({type(exc).__name__})"
        account = session.get(GoogleAccount, ACCOUNT_ID)
        if account is not None:
            account.last_push_at, account.last_push_error = now, error
            session.commit()
        return PushResult(status="failed", error=error)
