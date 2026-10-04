from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Event, Semester, SyncRun
from app.subjects.parser import parse_title
from app.subjects.resolver import SubjectResolver
from app.zeus.ics_client import ZeusFetchError
from app.zeus.ics_parser import InvalidFeedError, ParsedFeed, parse_ics

Fetcher = Callable[[Semester], str]
MIN_EVENTS_FOR_GUARD = 10
MAX_CANCEL_RATIO = 0.3


@dataclass
class SyncResult:
    fetched: int = 0
    inserted: int = 0
    updated: int = 0
    cancelled: int = 0
    skipped: int = 0
    kept: int = 0


def apply_feed(session: Session, semester: Semester, feed: ParsedFeed, now: datetime) -> SyncResult:
    if not feed.events:
        # An empty feed almost always means Zeus had a problem; never mass-cancel on it.
        raise InvalidFeedError("feed contains no events")

    resolver = SubjectResolver(session, semester.id)
    existing = {
        e.zeus_uid: e
        for e in session.scalars(
            select(Event).where(Event.semester_id == semester.id, Event.source == "zeus")
        )
    }
    feed_uids = {item.uid for item in feed.events}
    upcoming = [e for e in existing.values() if e.start_at >= now and e.status != "cancelled"]
    would_cancel = sum(1 for e in upcoming if e.zeus_uid not in feed_uids)
    # A truncated feed (wrong group, Zeus hiccup) must not wipe the semester: still apply
    # new/changed classes, but keep the missing ones instead of cancelling them.
    # Right after the group was changed on purpose, the old group's classes are meant to go: no guards.
    changed_on_purpose = semester.group_changed_at is not None
    keep_missing = (not changed_on_purpose and len(upcoming) >= MIN_EVENTS_FOR_GUARD
                    and would_cancel / len(upcoming) > MAX_CANCEL_RATIO)
    new_uids = feed_uids - set(existing)
    if keep_missing and len(new_uids) >= would_cancel:
        # Mostly unknown classes replacing the known ones: a different Zeus group, not a truncation.
        raise InvalidFeedError(
            f"feed looks like a different group: {len(new_uids)} unknown classes, "
            f"{would_cancel} of {len(upcoming)} upcoming missing")
    result = SyncResult(fetched=len(feed.events), skipped=feed.skipped)

    for item in feed.events:
        parsed = parse_title(item.title)
        subject_id = resolver.resolve(parsed.base_name).id if parsed.base_name else None
        event = existing.pop(item.uid, None)
        if event is None:
            session.add(Event(
                source="zeus", zeus_uid=item.uid, semester_id=semester.id, subject_id=subject_id,
                section=parsed.section, title_raw=item.title, start_at=item.start, end_at=item.end,
                room=item.room, description=item.description, kind=parsed.kind, status="normal",
            ))
            result.inserted += 1
            continue
        if event.start_at < now:
            continue
        differs = (event.start_at, event.end_at, event.room, event.title_raw) != (
            item.start, item.end, item.room, item.title)
        if differs or event.status == "cancelled":
            event.start_at, event.end_at = item.start, item.end
            event.room, event.title_raw, event.description = item.room, item.title, item.description
            event.subject_id, event.section, event.kind = subject_id, parsed.section, parsed.kind
            event.status, event.changed_at = "changed", now
            result.updated += 1
        elif event.description != item.description:
            event.description = item.description

    for event in existing.values():
        if event.start_at >= now and event.status != "cancelled":
            if keep_missing:
                result.kept += 1
                continue
            event.status, event.changed_at = "cancelled", now
            result.cancelled += 1

    semester.group_changed_at = None
    session.flush()
    return result


def run_sync(session: Session, fetch: Fetcher, now: datetime) -> SyncRun:
    run = SyncRun(started_at=now, status="running", fetched=0, inserted=0, updated=0,
                  cancelled=0, skipped=0)
    session.add(run)
    try:
        semester = session.scalar(select(Semester).where(Semester.is_active.is_(True)))
        if semester is None:
            raise ZeusFetchError("no active semester")
        result = apply_feed(session, semester, parse_ics(fetch(semester)), now)
    except ZeusFetchError as exc:
        run.status = "auth_failed" if exc.auth else "failed"
        run.error = str(exc)
    except InvalidFeedError as exc:
        run.status = "failed"
        run.error = f"invalid feed: {exc}"
    except Exception as exc:
        # Never store str(exc): it may contain the Zeus ICS URL (which embeds the key).
        session.rollback()
        run = SyncRun(started_at=now, status="failed", fetched=0, inserted=0, updated=0,
                      cancelled=0, skipped=0, error=f"unexpected error ({type(exc).__name__})")
        session.add(run)
    else:
        run.fetched, run.inserted, run.updated = result.fetched, result.inserted, result.updated
        run.cancelled, run.skipped = result.cancelled, result.skipped
        if result.kept:
            run.status = "partial"
            run.error = (f"kept {result.kept} upcoming classes that disappeared from the feed "
                         "(guard: more than 30% would be cancelled)")
        else:
            run.status = "ok"
    run.finished_at = now
    session.commit()
    return run
