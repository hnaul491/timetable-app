import pytest

from app.subjects.parser import ParsedTitle, parse_title


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("GR5 - French for Fall 26 T1", ParsedTitle("French for Fall 26 T1", "GR5", "class")),
        ("GR12 - French for Fall 26 T1", ParsedTitle("French for Fall 26 T1", "GR12", "class")),
        ("G1 - Adapting to a New Culture", ParsedTitle("Adapting to a New Culture", "G1", "class")),
        ("GR2 - French for Spring F26 T1", ParsedTitle("French for Spring F26 T1", "GR2", "class")),
        ("Relational Databases", ParsedTitle("Relational Databases", None, "class")),
        ("Relational Databases Exam", ParsedTitle("Relational Databases", None, "exam")),
        ("Interpersonnal Communication ", ParsedTitle("Interpersonnal Communication", None, "class")),
        ("Engineering Tools (Terminal · Git · CI · Docker)",
         ParsedTitle("Engineering Tools (Terminal · Git · CI · Docker)", None, "class")),
        ("Tutorat & French for Fall 26 T1", ParsedTitle("Tutorat & French for Fall 26 T1", None, "class")),
        ("Vacances", ParsedTitle(None, None, "holiday")),
        ("Bank Holiday", ParsedTitle(None, None, "holiday")),
    ],
)
def test_parse_title(raw, expected):
    assert parse_title(raw) == expected


def test_collapses_inner_whitespace():
    assert parse_title("GR5  -   French  for Fall 26 T1").base_name == "French for Fall 26 T1"
