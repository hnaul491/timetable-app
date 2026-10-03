from sqlalchemy import func, select

from app.models import Subject
from app.subjects.resolver import PALETTE, SubjectResolver


def test_matches_display_name_case_insensitively(session, semester):
    session.add(Subject(semester_id=semester.id, display_name="Data Privacy by Design", aliases=[]))
    session.flush()
    resolver = SubjectResolver(session, semester.id)
    assert resolver.resolve("Data Privacy By Design").display_name == "Data Privacy by Design"


def test_matches_alias(session, semester):
    session.add(Subject(semester_id=semester.id, display_name="French for Fall 26 T1",
                        aliases=["French for Spring F26 T1"]))
    session.flush()
    resolver = SubjectResolver(session, semester.id)
    assert resolver.resolve("French for Spring F26 T1").display_name == "French for Fall 26 T1"


def test_creates_missing_subject_once_with_palette_color(session, semester):
    resolver = SubjectResolver(session, semester.id)
    first = resolver.resolve("GenAI 101")
    second = resolver.resolve("genai 101")
    assert first.id == second.id
    assert first.color == PALETTE[0]
    assert session.scalar(select(func.count()).select_from(Subject)) == 1


def test_new_subjects_get_different_colors(session, semester):
    resolver = SubjectResolver(session, semester.id)
    assert resolver.resolve("A").color != resolver.resolve("B").color
