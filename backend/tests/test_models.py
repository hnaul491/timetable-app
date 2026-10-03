from datetime import datetime

from sqlalchemy import select

from app.models import Event, MySection, Subject


def test_subject_aliases_round_trip(session, semester):
    session.add(
        Subject(semester_id=semester.id, display_name="French for Fall 26 T1",
                aliases=["French for Spring F26 T1"])
    )
    session.commit()
    subject = session.scalar(select(Subject))
    assert subject.aliases == ["French for Spring F26 T1"]
    assert subject.hidden is False
    assert subject.color == "#2E55E6"


def test_event_defaults(session, semester):
    subject = Subject(semester_id=semester.id, display_name="Harmonization", aliases=[])
    session.add(subject)
    session.flush()
    session.add(MySection(subject_id=subject.id, section="G1"))
    session.add(
        Event(source="zeus", zeus_uid="u1", semester_id=semester.id, subject_id=subject.id,
              title_raw="Harmonization", start_at=datetime(2026, 10, 20, 7, 0),
              end_at=datetime(2026, 10, 20, 10, 0), kind="class")
    )
    session.commit()
    event = session.scalar(select(Event))
    assert event.status == "normal"
    assert event.room == ""
    assert event.changed_at is None


from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Note, RecurringRule, Task


def test_note_task_and_rule_defaults(session, semester):
    rule = RecurringRule(semester_id=semester.id, title="Work shift", kind="work", weekdays=[2, 6],
                         start_time="12:00", end_time="16:00", from_date=date(2026, 10, 19),
                         until_date=date(2026, 12, 20))
    session.add(rule)
    session.flush()
    event = Event(source="custom", semester_id=semester.id, title_raw="Work shift",
                  start_at=datetime(2026, 10, 21, 10, 0), end_at=datetime(2026, 10, 21, 14, 0),
                  kind="work", recurring_rule_id=rule.id)
    session.add(event)
    session.flush()
    note = Note(event_id=event.id, tab="after", updated_at=datetime(2026, 10, 21, 15, 0))
    session.add(note)
    session.flush()
    session.add(Task(note_id=note.id, event_id=event.id, title="Bring apron", source="note",
                     created_at=datetime(2026, 10, 21, 15, 0)))
    session.commit()
    task = session.scalar(select(Task))
    assert (task.status, task.important, task.position, task.due_date) == ("todo", False, 0, None)
    assert session.scalar(select(Note)).body == ""
    assert session.scalar(select(RecurringRule)).weekdays == [2, 6]
    assert session.scalar(select(Event)).recurring_rule_id == rule.id


def test_one_note_per_event_and_tab(session, semester):
    event = Event(source="custom", semester_id=semester.id, title_raw="x",
                  start_at=datetime(2026, 10, 21, 10, 0), end_at=datetime(2026, 10, 21, 11, 0), kind="other")
    session.add(event)
    session.flush()
    session.add_all([Note(event_id=event.id, tab="after", updated_at=datetime(2026, 10, 21)),
                     Note(event_id=event.id, tab="after", updated_at=datetime(2026, 10, 21))])
    with pytest.raises(IntegrityError):
        session.flush()
