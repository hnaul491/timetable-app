from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.gcal.api import DEFAULT_KINDS, GoogleAuthError, GoogleError, GoogleRateLimited
from app.gcal.push import body_hash, event_body, push
from app.models import Event, GcalTombstone, GoogleAccount, MySection, Subject
from app.services.events_query import VisibleEvent
from app.services.recurrence import delete_event_cascade
from tests.gcal_fakes import FakeCalendar

NOW = datetime(2026, 10, 15, 12, 0)
URL = "https://app.example"
NEVER = 1e12


def ev(session, semester, uid, start, *, subject=None, kind="class", section=None, status="normal", source="zeus",
       hours=2, title=None):
    event = Event(source=source, zeus_uid=uid if source == "zeus" else None, semester_id=semester.id,
                  subject_id=subject.id if subject else None, section=section, title_raw=title or uid,
                  start_at=start, end_at=start + timedelta(hours=hours), room="KB602", kind=kind, status=status)
    session.add(event)
    session.flush()
    return event


@pytest.fixture
def world(session, semester):
    db = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[], color="#2E55E6")
    fr = Subject(semester_id=semester.id, display_name="French for Fall 26 T1", aliases=[], color="#0E7F72")
    genai = Subject(semester_id=semester.id, display_name="GenAI 101", aliases=[], color="#6A45D8", hidden=True)
    session.add_all([db, fr, genai])
    session.flush()
    session.add(MySection(subject_id=fr.id, section="GR5"))
    events = {
        "class": ev(session, semester, "c1", datetime(2026, 10, 19, 11), subject=db),
        "exam": ev(session, semester, "x1", datetime(2027, 1, 26, 8), subject=db, kind="exam"),
        "mine": ev(session, semester, "f5", datetime(2026, 10, 20, 12), subject=fr, section="GR5"),
        "other_group": ev(session, semester, "f1", datetime(2026, 10, 20, 12), subject=fr, section="GR1"),
        "hidden": ev(session, semester, "g1", datetime(2026, 10, 21, 8), subject=genai),
        "old": ev(session, semester, "o1", datetime(2026, 10, 1, 8), subject=db),
        "cancelled": ev(session, semester, "k1", datetime(2026, 10, 22, 8), subject=db, status="cancelled"),
        "work": ev(session, semester, "w1", datetime(2026, 10, 23, 8), kind="work", source="custom",
                   title="Work shift", hours=4),
        "misc": ev(session, semester, "m1", datetime(2026, 10, 24, 8), kind="other", source="custom",
                   title="Dentist", hours=1),
    }
    account = GoogleAccount(id=1, email="me@example.com", kinds=list(DEFAULT_KINDS), connected_at=NOW)
    session.add(account)
    session.commit()
    return events, account


def run(session, account, fake, deadline=NEVER, clock=lambda: 0.0):
    return push(session, account, fake, NOW, URL, deadline, clock)


def summaries(fake):
    return sorted(body["summary"] for body in fake.events.values())


def test_first_push_creates_calendar_and_sends_only_wanted_events(session, world):
    events, account = world
    fake = FakeCalendar()
    result = run(session, account, fake)
    assert (result.status, result.done, result.failed, result.remaining) == ("ok", 4, 0, 0)
    assert fake.calendars == {"cal1": "My Timetable"} and account.calendar_id == "cal1"
    assert {name for name, e in events.items() if e.gcal_event_id} == {"class", "exam", "mine", "work"}
    assert summaries(fake) == ["Exam: Relational Databases", "French for Fall 26 T1 · GR5", "Relational Databases",
                               "Work shift"]
    assert (account.last_push_at, account.last_push_error) == (NOW, None)


def test_second_push_changes_nothing(session, world):
    _, account = world
    fake = FakeCalendar()
    run(session, account, fake)
    calls = list(fake.calls)
    result = run(session, account, fake)
    assert (result.status, result.done) == ("ok", 0)
    assert fake.calls == calls


def test_changes_update_and_cancellations_delete(session, world):
    events, account = world
    fake = FakeCalendar()
    run(session, account, fake)
    moved_id, cancelled_id = events["class"].gcal_event_id, events["mine"].gcal_event_id
    events["class"].room = "KB999"
    events["mine"].status = "cancelled"
    session.commit()
    result = run(session, account, fake)
    assert (result.status, result.done) == ("ok", 2)
    assert fake.events[moved_id]["location"] == "KB999"
    assert cancelled_id not in fake.events and events["mine"].gcal_event_id is None


def test_hiding_a_subject_or_a_kind_removes_its_events(session, world):
    events, account = world
    fake = FakeCalendar()
    run(session, account, fake)
    session.get(Subject, events["class"].subject_id).hidden = True
    account.kinds = ["class", "exam", "holiday", "french_ext"]
    session.commit()
    result = run(session, account, fake)
    assert (result.status, result.done) == ("ok", 3)
    assert summaries(fake) == ["French for Fall 26 T1 · GR5"]


def test_deleted_events_are_removed_from_google(session, world):
    events, account = world
    fake = FakeCalendar()
    run(session, account, fake)
    work_id = events["work"].gcal_event_id
    delete_event_cascade(session, events["work"])
    session.add(GcalTombstone(gcal_event_id="already-gone", created_at=NOW))
    session.commit()
    result = run(session, account, fake)
    assert (result.status, result.done) == ("ok", 2)
    assert work_id not in fake.events
    assert session.scalars(select(GcalTombstone)).all() == []


def test_time_budget_leaves_the_rest_for_next_time(session, world):
    _, account = world
    fake = FakeCalendar()
    ticks = iter(range(100))
    first = run(session, account, fake, deadline=2, clock=lambda: next(ticks))
    assert (first.status, first.done, first.remaining) == ("partial", 2, 2)
    second = run(session, account, fake)
    assert (second.status, second.done, second.remaining) == ("ok", 2, 0)
    assert len(fake.events) == 4


def test_revoked_access_asks_to_reconnect(session, world):
    _, account = world
    fake = FakeCalendar(fail={"insert_event": [GoogleAuthError("Google access was revoked")]})
    result = run(session, account, fake)
    assert (result.status, result.error) == ("failed", "Google access was revoked")
    assert account.needs_reconnect is True
    assert account.last_push_error == "Google access was revoked"


def test_calendar_deleted_in_google_is_recreated(session, world):
    events, account = world
    fake = FakeCalendar()
    run(session, account, fake)
    fake.calendars.clear()
    fake.events.clear()
    events["class"].room = "KB999"
    session.commit()
    result = run(session, account, fake)
    assert result.status == "failed" and "recreated" in result.error
    assert account.calendar_id is None
    assert all(e.gcal_event_id is None for e in session.scalars(select(Event)))
    again = run(session, account, fake)
    assert (again.status, again.done) == ("ok", 4)
    assert fake.calendars == {"cal2": "My Timetable"}


def test_event_deleted_by_hand_is_sent_again_when_it_changes(session, world):
    events, account = world
    fake = FakeCalendar()
    run(session, account, fake)
    del fake.events[events["class"].gcal_event_id]
    events["class"].room = "KB999"
    session.commit()
    result = run(session, account, fake)
    assert (result.status, result.done) == ("ok", 1)
    assert fake.events[events["class"].gcal_event_id]["location"] == "KB999"


def test_one_failing_event_does_not_stop_the_others(session, world):
    _, account = world
    fake = FakeCalendar(fail={"insert_event": [GoogleError("Google Calendar returned 500 (backendError)")]})
    result = run(session, account, fake)
    assert (result.status, result.done, result.failed) == ("partial", 3, 1)
    assert account.last_push_error == "Google Calendar returned 500 (backendError)"
    retry = run(session, account, fake)
    assert (retry.status, retry.done) == ("ok", 1)
    assert account.last_push_error is None


def test_rate_limit_stops_and_resumes(session, world):
    _, account = world
    fake = FakeCalendar(fail={"insert_event": [None, GoogleRateLimited("Google rate limit reached")]})
    result = run(session, account, fake)
    assert (result.status, result.done, result.remaining) == ("partial", 1, 3)
    assert (run(session, account, fake).done, len(fake.events)) == (3, 4)


def visible(**changes) -> VisibleEvent:
    base = dict(id=7, title="Relational Databases", subject_id=1, subject_name="Relational Databases",
                color="#2E55E6", section=None, start_at=datetime(2026, 10, 19, 11), end_at=datetime(2026, 10, 19, 13),
                room="KB602", kind="class", status="normal", source="zeus")
    base.update(changes)
    return VisibleEvent(**base)


def test_event_body_for_a_class():
    assert event_body(visible(section="G1"), "https://app.example/") == {
        "summary": "Relational Databases · G1",
        "location": "KB602",
        "description": "Open in Timetable: https://app.example/events/7",
        "extendedProperties": {"private": {"timetableEventId": "7"}},
        "start": {"dateTime": "2026-10-19T11:00:00Z", "timeZone": "Europe/Paris"},
        "end": {"dateTime": "2026-10-19T13:00:00Z", "timeZone": "Europe/Paris"},
    }


def test_holidays_are_all_day_in_paris_dates():
    # Toussaint after the 25 Oct clock change: 1 Nov 00:00 Paris = 31 Oct 23:00Z.
    toussaint = event_body(visible(kind="holiday", title="Toussaint", start_at=datetime(2026, 10, 31, 23),
                                   end_at=datetime(2026, 11, 1, 23)), URL)
    assert (toussaint["start"], toussaint["end"], toussaint["transparency"]) == (
        {"date": "2026-11-01"}, {"date": "2026-11-02"}, "transparent")
    until_late = event_body(visible(kind="holiday", start_at=datetime(2026, 10, 31, 23),
                                    end_at=datetime(2026, 11, 1, 22, 59)), URL)
    assert until_late["end"] == {"date": "2026-11-02"}


def test_exam_summary_and_stable_hash():
    body = event_body(visible(kind="exam"), URL)
    assert body["summary"] == "Exam: Relational Databases"
    assert body_hash(body) == body_hash(dict(reversed(list(body.items()))))
    assert body_hash(body) != body_hash({**body, "location": "KB003"})


def test_old_copy_is_never_updated_but_removed_when_unwanted(session, world):
    events, account = world
    fake = FakeCalendar()
    run(session, account, fake)  # creates the calendar
    old = events["old"]
    fake.events["gold"] = event_body(visible(id=old.id), URL)
    old.gcal_event_id, old.gcal_hash = "gold", "stale"
    old.room = "KB999"
    session.commit()
    run(session, account, fake)
    assert fake.events["gold"]["location"] == "KB602"
    session.get(Subject, old.subject_id).hidden = True
    session.commit()
    result = run(session, account, fake)
    assert result.status == "ok" and "gold" not in fake.events and old.gcal_event_id is None


def settings(**changes):
    from cryptography.fernet import Fernet
    from app.config import Settings
    values = dict(google_client_id="id", google_client_secret="secret", token_encryption_key=Fernet.generate_key().decode())
    values.update(changes)
    return Settings(**values)


def test_run_push_skips_without_account_or_when_reconnect_needed(session, semester):
    from app.gcal.push import run_push
    cfg = settings()
    assert run_push(session, cfg, lambda token: FakeCalendar(), NOW, NEVER).status == "skipped"
    session.add(GoogleAccount(id=1, email="me@example.com", kinds=list(DEFAULT_KINDS), connected_at=NOW,
                              needs_reconnect=True))
    session.commit()
    assert run_push(session, cfg, lambda token: FakeCalendar(), NOW, NEVER).status == "skipped"


def test_run_push_without_stored_token_asks_to_reconnect(session, world):
    from app.gcal.push import run_push
    _, account = world
    result = run_push(session, settings(), lambda token: FakeCalendar(), NOW, NEVER)
    assert result.status == "failed" and account.needs_reconnect is True


def test_run_push_never_raises(session, world):
    from app.gcal.api import REFRESH_TOKEN_NAME
    from app.gcal.push import run_push
    from app.secret_store import SecretStore
    _, account = world
    cfg = settings()
    SecretStore(session, cfg.token_encryption_key).set(REFRESH_TOKEN_NAME, "tok")
    session.commit()

    def boom(token):
        raise RuntimeError("x")

    result = run_push(session, cfg, boom, NOW, NEVER)
    assert (result.status, result.error) == ("failed", "unexpected error (RuntimeError)")
    assert account.last_push_error == "unexpected error (RuntimeError)"


def test_calendar_create_error_is_reported_as_failed(session, world):
    _, account = world
    fake = FakeCalendar(fail={"create_calendar": [GoogleRateLimited("Google rate limit reached")]})
    result = run(session, account, fake)
    assert (result.status, result.error) == ("failed", "Google rate limit reached")
    assert account.last_push_error == "Google rate limit reached" and account.last_push_at == NOW
