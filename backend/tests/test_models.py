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
