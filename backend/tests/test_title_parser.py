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


@pytest.mark.parametrize("raw", ["GR1 - Vacances", "G2 - Bank holiday", "gr12  -  vacances", "  G3 -BANK   HOLIDAY ",
                                 "GR1 - VACANCES"])
def test_holidays_with_a_group_are_holidays(raw):
    assert parse_title(raw) == ParsedTitle(None, None, "holiday")


def test_a_group_class_that_merely_contains_vacances_is_not_a_holiday():
    assert parse_title("GR1 - Vacances Studies") == ParsedTitle("Vacances Studies", "GR1", "class")
