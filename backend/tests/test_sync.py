from dataclasses import replace
from datetime import datetime

import pytest
from sqlalchemy import select

from app.models import Event, Subject, SyncRun
from app.zeus.ics_client import ZeusFetchError
from app.zeus.ics_parser import FeedEvent, InvalidFeedError, ParsedFeed
from app.zeus.sync import apply_feed, run_sync

NOW = datetime(2026, 10, 15, 12, 0)
LATER = datetime(2026, 10, 16, 12, 0)

FRENCH = FeedEvent("u-fr", "GR5 - French for Fall 26 T1", datetime(2026, 10, 20, 12, 30),
                   datetime(2026, 10, 20, 14, 30), "KB605", "")
RELDB = FeedEvent("u-db", "Relational Databases", datetime(2026, 10, 19, 11, 0),
                  datetime(2026, 10, 19, 13, 0), "KB602", "")
PAST = FeedEvent("u-past", "Harmonization", datetime(2026, 10, 13, 7, 0),
                 datetime(2026, 10, 13, 10, 0), "SM Cisco - KB105", "")


def feed(*events: FeedEvent, skipped: int = 0) -> ParsedFeed:
    return ParsedFeed(events=list(events), skipped=skipped)


def event_by_uid(session, uid: str) -> Event:
    return session.scalar(select(Event).where(Event.zeus_uid == uid))


def test_inserts_new_events_with_subject_section_and_kind(session, semester):
    result = apply_feed(session, semester, feed(FRENCH, RELDB, skipped=1), NOW)
    assert (result.fetched, result.inserted, result.skipped) == (2, 2, 1)
    french = event_by_uid(session, "u-fr")
    assert french.section == "GR5"
    assert french.kind == "class"
    assert session.get(Subject, french.subject_id).display_name == "French for Fall 26 T1"


def test_same_feed_twice_changes_nothing(session, semester):
    apply_feed(session, semester, feed(FRENCH, RELDB), NOW)
    result = apply_feed(session, semester, feed(FRENCH, RELDB), LATER)
    assert (result.inserted, result.updated, result.cancelled) == (0, 0, 0)
    assert event_by_uid(session, "u-fr").status == "normal"


def test_time_change_marks_future_event_changed(session, semester):
    apply_feed(session, semester, feed(FRENCH), NOW)
    moved = replace(FRENCH, start=datetime(2026, 10, 20, 13, 0), end=datetime(2026, 10, 20, 15, 0))
    result = apply_feed(session, semester, feed(moved), LATER)
    event = event_by_uid(session, "u-fr")
    assert result.updated == 1
    assert (event.status, event.changed_at, event.start_at) == ("changed", LATER, datetime(2026, 10, 20, 13, 0))


def test_room_change_marks_changed(session, semester):
    apply_feed(session, semester, feed(FRENCH), NOW)
    apply_feed(session, semester, feed(replace(FRENCH, room="KB204-B FLE")), LATER)
    event = event_by_uid(session, "u-fr")
    assert (event.status, event.room) == ("changed", "KB204-B FLE")


def test_past_events_are_never_modified(session, semester):
    apply_feed(session, semester, feed(PAST, FRENCH), NOW)
    result = apply_feed(session, semester, feed(replace(PAST, room="Elsewhere"), FRENCH), LATER)
    event = event_by_uid(session, "u-past")
    assert result.updated == 0
    assert (event.room, event.status) == ("SM Cisco - KB105", "normal")


def test_missing_future_event_cancelled_but_missing_past_kept(session, semester):
    apply_feed(session, semester, feed(PAST, FRENCH, RELDB), NOW)
    result = apply_feed(session, semester, feed(RELDB), LATER)
    assert result.cancelled == 1
    assert event_by_uid(session, "u-fr").status == "cancelled"
    assert event_by_uid(session, "u-past").status == "normal"


def test_cancelled_event_that_reappears_is_marked_changed(session, semester):
    apply_feed(session, semester, feed(FRENCH, RELDB), NOW)
    apply_feed(session, semester, feed(RELDB), NOW)
    apply_feed(session, semester, feed(FRENCH, RELDB), LATER)
    assert event_by_uid(session, "u-fr").status == "changed"


def test_holiday_and_exam_kinds(session, semester):
    holiday = FeedEvent("u-hol", "Vacances", datetime(2026, 12, 21, 7, 0), datetime(2026, 12, 21, 19, 0), "", "")
    exam = FeedEvent("u-ex", "Relational Databases Exam", datetime(2027, 1, 26, 8, 0),
                     datetime(2027, 1, 26, 10, 0), "KB003 (amphi 3)", "")
    apply_feed(session, semester, feed(holiday, exam, RELDB), NOW)
    hol, ex, db = (event_by_uid(session, u) for u in ("u-hol", "u-ex", "u-db"))
    assert (hol.kind, hol.subject_id) == ("holiday", None)
    assert ex.kind == "exam"
    assert ex.subject_id == db.subject_id


def test_empty_feed_changes_nothing(session, semester):
    apply_feed(session, semester, feed(FRENCH, RELDB), NOW)
    session.commit()
    with pytest.raises(InvalidFeedError):
        apply_feed(session, semester, feed(), LATER)
    assert event_by_uid(session, "u-fr").status == "normal"

    run = run_sync(session, lambda sem: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", LATER)
    assert run.status == "failed"
    assert event_by_uid(session, "u-db").status == "normal"


def test_run_sync_success_records_counts(session, semester):
    text = "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//t//EN",
        "BEGIN:VEVENT", "UID:u1", "SUMMARY:Relational Databases",
        "DTSTART:20261019T110000Z", "DTEND:20261019T130000Z", "LOCATION:KB602", "END:VEVENT",
        "END:VCALENDAR", "",
    ])
    run = run_sync(session, lambda sem: text, NOW)
    assert (run.status, run.fetched, run.inserted, run.error) == ("ok", 1, 1, None)
    assert run.finished_at == NOW
    assert session.scalar(select(SyncRun)).id == run.id


def test_run_sync_auth_failure(session, semester):
    def fetch(sem):
        raise ZeusFetchError("Zeus rejected the ICS link", auth=True)

    run = run_sync(session, fetch, NOW)
    assert (run.status, run.error) == ("auth_failed", "Zeus rejected the ICS link")


def test_run_sync_without_active_semester(session):
    run = run_sync(session, lambda sem: "", NOW)
    assert run.status == "failed"
    assert run.error == "no active semester"


def test_unexpected_error_is_persisted_as_failed_without_leaking_secret(session, semester, monkeypatch):
    apply_feed(session, semester, feed(FRENCH), NOW)
    session.commit()

    def boom(*args, **kwargs):
        raise RuntimeError("boom https://zeus.ionis-it.com/api/group/802/ics/SECRETKEY99")

    monkeypatch.setattr("app.zeus.sync.apply_feed", boom)
    text = ("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:20261020T123000Z\r\n"
            "DTEND:20261020T143000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
    run = run_sync(session, lambda sem: text, LATER)
    assert run.status == "failed"
    assert run.error == "unexpected error (RuntimeError)"
    assert "SECRETKEY99" not in run.error
    session.expire_all()
    [stored] = session.scalars(select(SyncRun)).all()
    assert (stored.status, stored.error) == ("failed", "unexpected error (RuntimeError)")
    assert stored.finished_at == LATER
    assert event_by_uid(session, "u-fr").status == "normal"
    assert len(session.scalars(select(Event)).all()) == 1


from datetime import timedelta


def many(n: int) -> list[FeedEvent]:
    base = datetime(2026, 11, 2, 8, 0)
    return [FeedEvent(f"m{i}", "Relational Databases", base + timedelta(days=i),
                      base + timedelta(days=i, hours=2), "KB602", "") for i in range(n)]


def test_partial_feed_guard_blocks_mass_cancellation(session, semester):
    events = many(20)
    apply_feed(session, semester, feed(*events), NOW)
    session.commit()
    with pytest.raises(InvalidFeedError, match="would cancel 15 of 20"):
        apply_feed(session, semester, feed(*events[:5]), LATER)
    statuses = {e.status for e in session.scalars(select(Event))}
    assert statuses == {"normal"}

    text = "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//t//EN",
                        "BEGIN:VEVENT", "UID:m0", "SUMMARY:Relational Databases",
                        "DTSTART:20261102T080000Z", "DTEND:20261102T100000Z", "END:VEVENT",
                        "END:VCALENDAR", ""])
    run = run_sync(session, lambda sem: text, LATER)
    assert run.status == "failed"
    assert "would cancel 19 of 20" in run.error


def test_small_cancellations_still_apply(session, semester):
    events = many(20)
    apply_feed(session, semester, feed(*events), NOW)
    result = apply_feed(session, semester, feed(*events[:18]), LATER)
    assert result.cancelled == 2
