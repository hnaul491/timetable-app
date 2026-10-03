from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Semester, Subject
from app.subjects.resolver import PALETTE

SEMESTERS = [
    # code, name, zeus_group_id, start, end, active
    ("S1", "SE S1 (Fundamental)", 802, date(2026, 10, 12), date(2027, 1, 30), True),
    ("S2", "SE S2 (Common Core)", None, None, None, False),
    ("S3", "SE S3 (Specialization)", None, None, None, False),
]

S1_ALIASES = {
    "French for Fall 26 T1": ["French for Spring F26 T1", "Tutorat & French for Fall 26 T1"],
    "Interpersonal Communication": ["Interpersonnal Communication"],
}


def seed(session: Session) -> None:
    for code, name, group_id, start, end, active in SEMESTERS:
        if session.scalar(select(Semester).where(Semester.code == code)) is None:
            session.add(Semester(code=code, name=name, zeus_group_id=group_id,
                                 start_date=start, end_date=end, is_active=active))
    session.flush()
    s1 = session.scalar(select(Semester).where(Semester.code == "S1"))
    for index, (display_name, aliases) in enumerate(S1_ALIASES.items()):
        existing = session.scalar(select(Subject).where(
            Subject.semester_id == s1.id, Subject.display_name == display_name))
        if existing is None:
            session.add(Subject(semester_id=s1.id, display_name=display_name, aliases=aliases,
                                color=PALETTE[(index + 2) % len(PALETTE)], hidden=False))
    session.flush()


if __name__ == "__main__":
    from app.db import get_engine

    with Session(get_engine()) as db:
        seed(db)
        db.commit()
    print("Seed complete.")
