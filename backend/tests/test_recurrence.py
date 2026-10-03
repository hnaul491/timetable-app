from datetime import date, datetime

from sqlalchemy import select

from app.models import Event, Note, RecurringRule
from app.services.recurrence import delete_rule, occurrences, regenerate

NOW = datetime(2026, 10, 15, 12, 0)


def rule(session, semester, **over) -> RecurringRule:
    values = dict(semester_id=semester.id, title="French (external)", kind="french_ext", weekdays=[0],
                  start_time="19:30", end_time="21:00", from_date=date(2026, 10, 19),
                  until_date=date(2026, 11, 2), location="Alliance")
    values.update(over)
    r = RecurringRule(**values)
    session.add(r)
    session.flush()
    return r


def test_occurrences_keep_paris_time_across_dst(session, semester):
    r = rule(session, semester)
    assert occurrences(r) == [
        (datetime(2026, 10, 19, 17, 30), datetime(2026, 10, 19, 19, 0)),
        (datetime(2026, 10, 26, 18, 30), datetime(2026, 10, 26, 20, 0)),
        (datetime(2026, 11, 2, 18, 30), datetime(2026, 11, 2, 20, 0)),
    ]


def test_occurrences_multiple_weekdays_and_midnight(session, semester):
    r = rule(session, semester, weekdays=[2, 6], start_time="22:00", end_time="01:00",
             from_date=date(2026, 11, 4), until_date=date(2026, 11, 8))
    assert occurrences(r) == [
        (datetime(2026, 11, 4, 21, 0), datetime(2026, 11, 5, 0, 0)),
        (datetime(2026, 11, 8, 21, 0), datetime(2026, 11, 9, 0, 0)),
    ]


def test_regenerate_creates_future_occurrences_only(session, semester):
    r = rule(session, semester, from_date=date(2026, 10, 12))
    created = regenerate(session, r, NOW)
    events = session.scalars(select(Event).order_by(Event.start_at)).all()
    assert created == 3
    assert [e.start_at.date() for e in events] == [date(2026, 10, 19), date(2026, 10, 26), date(2026, 11, 2)]
    assert {(e.source, e.kind, e.title_raw, e.room, e.recurring_rule_id) for e in events} == {
        ("custom", "french_ext", "French (external)", "Alliance", r.id)}


def test_regenerate_keeps_noted_and_past_occurrences(session, semester):
    r = rule(session, semester)
    regenerate(session, r, datetime(2026, 10, 1))
    first, second, third = session.scalars(select(Event).order_by(Event.start_at)).all()
    session.add(Note(event_id=second.id, tab="after", body="[ ] homework p.12", updated_at=NOW))
    session.add(Note(event_id=third.id, tab="after", body="", updated_at=NOW))
    r.weekdays = [3]  # move to Thursdays
    regenerate(session, r, datetime(2026, 10, 20))
    remaining = session.scalars(select(Event).order_by(Event.start_at)).all()
    assert first in remaining  # past
    assert second in remaining  # has a note
    assert third not in remaining  # future, only an empty note
    assert [e.start_at.date() for e in remaining if e.start_at.weekday() == 3] == [date(2026, 10, 22), date(2026, 10, 29)]
    assert session.scalar(select(Note).where(Note.body == "")) is None


def test_delete_rule_keeps_noted_occurrences(session, semester):
    r = rule(session, semester)
    regenerate(session, r, datetime(2026, 10, 1))
    first, second, third = session.scalars(select(Event).order_by(Event.start_at)).all()
    session.add(Note(event_id=third.id, tab="before", body="Bring textbook", updated_at=NOW))
    delete_rule(session, r, datetime(2026, 10, 20))
    remaining = session.scalars(select(Event).order_by(Event.start_at)).all()
    assert [e.id for e in remaining] == [first.id, third.id]
    assert all(e.recurring_rule_id is None for e in remaining)
    assert session.scalar(select(RecurringRule)) is None
