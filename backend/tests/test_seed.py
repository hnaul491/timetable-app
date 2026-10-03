from sqlalchemy import select

from app.models import Semester, Subject
from app.seed import seed


def test_seed_is_idempotent_and_sets_s1_active(session):
    seed(session)
    seed(session)
    session.commit()
    semesters = session.scalars(select(Semester).order_by(Semester.code)).all()
    assert [s.code for s in semesters] == ["S1", "S2", "S3"]
    s1 = semesters[0]
    assert s1.is_active and s1.zeus_group_id == 802
    assert not semesters[1].is_active and semesters[1].zeus_group_id is None


def test_seed_creates_s1_aliases(session):
    seed(session)
    session.commit()
    french = session.scalar(select(Subject).where(Subject.display_name == "French for Fall 26 T1"))
    assert set(french.aliases) == {"French for Spring F26 T1", "Tutorat & French for Fall 26 T1"}
    ic = session.scalar(select(Subject).where(Subject.display_name == "Interpersonal Communication"))
    assert ic.aliases == ["Interpersonnal Communication"]
