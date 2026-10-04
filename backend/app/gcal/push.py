import hashlib
import json
import logging
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.config import Settings
from app.gcal.api import (ACCOUNT_ID, CALENDAR_NAME, REFRESH_TOKEN_NAME, TIME_ZONE, GcalFactory, GoogleAuthError,
                          GoogleCalendar, GoogleError, GoogleNotFound, GoogleRateLimited)
from app.models import Event, GcalTombstone, GoogleAccount
from app.secret_store import SecretStore
from app.services.events_query import VisibleEvent, active_semester, list_visible_events
from app.services.recurrence import PARIS
from app.timeutil import iso_utc

logger = logging.getLogger(__name__)

KEEP_PAST = timedelta(days=7)
FAR_FUTURE = datetime(2100, 1, 1)
FAR_PAST = datetime(2000, 1, 1)
LEASE = timedelta(minutes=2)
SAME_ERROR_LIMIT = 3
SWEEP_EVERY = timedelta(hours=24)
SWEEP_MIN_LEFT_S = 5.0
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
    # Only the active semester is reconciled; other semesters' rows (and their Google copies) are left untouched.
    visible, _ = list_visible_events(session, semester.id, FAR_PAST, FAR_FUTURE)
    wanted = {e.id: e for e in visible if e.kind in account.kinds and e.status != "cancelled"}
    rows = session.scalars(select(Event).where(Event.semester_id == semester.id).order_by(Event.start_at, Event.id))
    for row in rows:
        if row.end_at <= since:
            # Past the window: never sent or updated, but a stale Google copy is removed once no longer wanted.
            if row.gcal_event_id is not None and row.id not in wanted:
                ops.append(Op("delete", row.id, row.gcal_event_id, None, None))
            continue
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


BATCH_SIZE = 4
WORKERS = 4
PARALLEL = ("insert", "update")


class _Skipped(Exception):
    """A parallel call that was not made because the run was already stopping."""


Outcome = tuple[str | None, Exception | None]


def _google(gcal: GoogleCalendar, calendar_id: str, op: Op) -> str | None:
    """Do the Google call of one op (no database access: this runs in worker threads).

    Returns the Google event id to store for an insert (or an update that had to insert again).
    """
    if op.action in ("remove", "delete"):
        _delete_quietly(gcal, calendar_id, op.gcal_event_id)
        return None
    if op.action == "update":
        try:
            gcal.update_event(calendar_id, op.gcal_event_id, op.body)
            return None
        except GoogleNotFound:
            pass  # deleted by hand in Google: create it again below
    return gcal.insert_event(calendar_id, op.body)


def _record(session: Session, op: Op, new_id: str | None) -> None:
    """Store the outcome of a successful Google call (main thread)."""
    if op.action == "remove":
        session.execute(delete(GcalTombstone).where(GcalTombstone.gcal_event_id == op.gcal_event_id))
        return
    event = session.get(Event, op.event_id)
    if event is None:
        return  # row deleted since planning
    if op.action == "delete":
        event.gcal_event_id = event.gcal_hash = None
        return
    if new_id is not None:
        event.gcal_event_id = new_id
    event.gcal_hash = op.digest


class _Workers:
    """Thread pool for parallel Google calls; every worker thread owns a client (never shared across threads)."""

    def __init__(self, gcal: GoogleCalendar, factory: Callable[[], GoogleCalendar] | None) -> None:
        self._gcal = gcal
        self._factory = factory
        self._local = threading.local()
        self._clients: list[GoogleCalendar] = []
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._pool = ThreadPoolExecutor(max_workers=WORKERS)

    def _client(self) -> GoogleCalendar:
        if self._factory is None:
            return self._gcal
        client = getattr(self._local, "client", None)
        if client is None:
            client = self._factory()
            self._local.client = client
            with self._lock:
                self._clients.append(client)
        return client

    def _run(self, calendar_id: str, op: Op) -> str | None:
        if self._stop.is_set():
            raise _Skipped()
        try:
            return _google(self._client(), calendar_id, op)
        except (GoogleRateLimited, GoogleAuthError, GoogleNotFound):
            self._stop.set()  # the run is over: do not start more calls
            raise

    def map(self, calendar_id: str, ops: list[Op]) -> list[Outcome]:
        futures = [self._pool.submit(self._run, calendar_id, op) for op in ops]
        out: list[Outcome] = []
        for future in futures:
            try:
                out.append((future.result(), None))
            except Exception as exc:  # noqa: BLE001 - classified by the caller
                out.append((None, exc))
        return out

    def close(self) -> None:
        self._pool.shutdown(wait=True)
        for client in self._clients:
            _close(client)


def _batches(ops: list[Op]) -> list[list[Op]]:
    """Consecutive inserts/updates are grouped (up to BATCH_SIZE) to run in parallel; other ops go alone."""
    units: list[list[Op]] = []
    for op in ops:
        if op.action in PARALLEL and units and len(units[-1]) < BATCH_SIZE and units[-1][0].action in PARALLEL:
            units[-1].append(op)
        else:
            units.append([op])
    return units


def _inline(gcal: GoogleCalendar, calendar_id: str, op: Op) -> Outcome:
    try:
        return _google(gcal, calendar_id, op), None
    except Exception as exc:  # noqa: BLE001 - classified by the caller
        return None, exc


def push(session: Session, account: GoogleAccount, gcal: GoogleCalendar, now: datetime, app_url: str,
         deadline: float, clock: Callable[[], float] = time.monotonic,
         worker_factory: Callable[[], GoogleCalendar] | None = None) -> PushResult:
    """Reconcile Google with the timetable.

    `worker_factory` builds one client per worker thread; without it the workers share `gcal`, which must then be
    thread-safe (tests only).
    """
    result = PushResult(status="ok")
    workers: _Workers | None = None
    try:
        if account.calendar_id is None:
            try:
                account.calendar_id = gcal.create_calendar(CALENDAR_NAME, TIME_ZONE)
            except GoogleAuthError:
                raise
            except GoogleError as exc:
                session.rollback()
                result.status, result.error = "failed", str(exc)
                account.last_push_at = now
                account.last_push_error = result.error
                session.commit()
                return result
            session.commit()
        ops = plan_ops(session, account, now, app_url)
        calendar_id = account.calendar_id
        workers = _Workers(gcal, worker_factory)
        streak, last_error = 0, None
        consumed = 0
        for unit in _batches(ops):
            if clock() >= deadline:
                break
            consumed += len(unit)
            live = [op for op in unit if op.action == "remove" or session.get(Event, op.event_id) is not None]
            if live and live[0].action in PARALLEL:
                outcomes = workers.map(calendar_id, live)
            else:
                outcomes = [_inline(gcal, calendar_id, op) for op in live]
            stop_run = False
            fatal: Exception | None = None
            crash: Exception | None = None
            for op, (new_id, error) in zip(live, outcomes):
                if error is None:
                    try:
                        _record(session, op, new_id)
                        session.commit()
                    except StaleDataError:
                        session.rollback()
                        logger.warning("Google event created but not recorded (row changed); "
                                       "it may be duplicated on the next push")
                        result.failed += 1
                        result.error = "A timetable row changed while pushing; it is retried on the next push"
                        continue
                    result.done += 1
                    streak, last_error = 0, None
                elif isinstance(error, _Skipped):
                    result.remaining += 1
                elif isinstance(error, GoogleRateLimited):
                    result.remaining += 1
                    result.error = str(error)
                    stop_run = True
                elif isinstance(error, (GoogleNotFound, GoogleAuthError)):
                    # NotFound here means inserting failed: the calendar itself is gone. Auth wins when both occur.
                    if fatal is None or isinstance(error, GoogleAuthError):
                        fatal = error
                elif isinstance(error, GoogleError):
                    result.failed += 1
                    result.error = str(error)
                    streak = streak + 1 if result.error == last_error else 1
                    last_error = result.error
                    if streak >= SAME_ERROR_LIMIT:  # persistent error: stop hammering Google
                        stop_run = True
                elif crash is None:
                    crash = error  # raised after every success of the batch is recorded
            if crash is not None:
                raise crash
            if isinstance(fatal, GoogleAuthError):
                raise fatal
            if fatal is not None:
                raise _CalendarMissing()
            if stop_run:
                break
        result.remaining += len(ops) - consumed
        if not (result.remaining or result.failed):
            _sweep_orphans(session, account, gcal, now, deadline, clock)
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
    finally:
        if workers is not None:
            workers.close()
    account.last_push_at = now
    account.last_push_error = result.error
    session.commit()
    return result


def _sweep_orphans(session: Session, account: GoogleAccount, gcal: GoogleCalendar, now: datetime, deadline: float,
                   clock: Callable[[], float]) -> None:
    """Delete the app's own duplicate events from its Google calendar.

    Runs after a complete push, at most once per 24 h. Only events carrying the app's marker are ever touched:
    an event without a marker is the user's own and is kept. A marked event nobody points at is adopted when its
    row has no Google id yet; it is deleted when its row points at another Google event or no longer exists.
    Best effort: Google errors never fail the push (except auth); an interrupted sweep continues on the next push.
    """
    if account.calendar_id is None or deadline - clock() < SWEEP_MIN_LEFT_S:
        return
    if account.last_sweep_at is not None and now - account.last_sweep_at < SWEEP_EVERY:
        return
    try:
        listed = gcal.list_app_event_ids(account.calendar_id)
    except GoogleNotFound:
        raise _CalendarMissing() from None
    except GoogleAuthError:
        raise
    except GoogleError as exc:
        logger.warning("Orphan sweep failed (%s)", type(exc).__name__)
        return
    try:
        known = set(session.scalars(select(Event.gcal_event_id).where(Event.gcal_event_id.is_not(None))))
        known.update(session.scalars(select(GcalTombstone.gcal_event_id)))
        listed_ids = {gcal_event_id for gcal_event_id, _ in listed}
        for gcal_event_id, marker in listed:
            if marker is None or gcal_event_id in known:
                continue  # the user's own event, or one the timetable already tracks
            if not (marker.isascii() and marker.isdigit() and len(marker) < 18):
                continue  # not a marker this app writes
            if deadline - clock() < SWEEP_MIN_LEFT_S:
                return
            row = session.get(Event, int(marker))
            if row is not None and (row.gcal_event_id is None or row.gcal_event_id not in listed_ids):
                # adopt: the row has no copy, or its recorded copy is gone — keep this one; the next push updates it
                row.gcal_event_id, row.gcal_hash = gcal_event_id, None
                known.add(gcal_event_id)
                continue
            _delete_quietly(gcal, account.calendar_id, gcal_event_id)
        account.last_sweep_at = now
    except GoogleAuthError:
        raise
    except GoogleError as exc:
        logger.warning("Orphan sweep failed (%s)", type(exc).__name__)


def _close(gcal: object) -> None:
    close = getattr(gcal, "close", None)
    if callable(close):
        try:
            close()
        except Exception:  # noqa: BLE001
            logger.warning("Closing the Google client failed")


def _take_lease(session: Session, now: datetime) -> bool:
    taken = session.execute(
        update(GoogleAccount)
        .where(GoogleAccount.id == ACCOUNT_ID,
               or_(GoogleAccount.push_lock_until.is_(None), GoogleAccount.push_lock_until < now))
        .values(push_lock_until=now + LEASE)
    )
    session.commit()
    return taken.rowcount == 1


def _release_lease(session: Session) -> None:
    try:
        session.rollback()
        session.execute(update(GoogleAccount).where(GoogleAccount.id == ACCOUNT_ID).values(push_lock_until=None))
        session.commit()
    except Exception:  # noqa: BLE001 - the lease expires by itself
        logger.warning("Releasing the push lease failed")
        session.rollback()


def run_push(session: Session, settings: Settings, factory: GcalFactory, now: datetime, deadline: float,
             clock: Callable[[], float] = time.monotonic) -> PushResult:
    """Push for the connected account, if any. Never raises: the daily sync must not fail because of Google."""
    leased = False
    try:
        account = session.get(GoogleAccount, ACCOUNT_ID)
        if account is None or account.needs_reconnect or not settings.google_configured:
            return PushResult(status="skipped")
        token = SecretStore(session, settings.token_encryption_key).get(REFRESH_TOKEN_NAME)
        if not token:
            account.needs_reconnect = True
            account.last_push_error = "Google is not connected any more — connect it again in Settings"
            session.commit()
            return PushResult(status="failed", error=account.last_push_error)
        if not _take_lease(session, now):
            return PushResult(status="skipped", error="Another push is already running")
        leased = True
        gcal = factory(token)
        try:
            return push(session, account, gcal, now, settings.app_url, deadline, clock,
                        worker_factory=lambda: factory(token))
        finally:
            _close(gcal)
    except Exception as exc:  # noqa: BLE001 - record and move on
        logger.exception("Google Calendar push failed")
        error = f"unexpected error ({type(exc).__name__})"
        try:
            session.rollback()
            account = session.get(GoogleAccount, ACCOUNT_ID)
            if account is not None:
                account.last_push_at, account.last_push_error = now, error
                session.commit()
        except Exception:  # noqa: BLE001
            session.rollback()
        return PushResult(status="failed", error=error)
    finally:
        if leased:
            _release_lease(session)
