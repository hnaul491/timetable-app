from datetime import datetime

import pytest

from app.zeus.ics_parser import InvalidFeedError, parse_ics


def ics(*events: str) -> str:
    return "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", *events,
                        "END:VCALENDAR"]) + "\r\n"


def vevent(uid, summary, start, end="20261020T143000Z", location="", description=""):
    lines = ["BEGIN:VEVENT", f"UID:{uid}", f"SUMMARY:{summary}", f"DTSTART:{start}"]
    if end is not None:
        lines.append(f"DTEND:{end}")
    lines += [f"LOCATION:{location}", f"DESCRIPTION:{description}", "END:VEVENT"]
    return "\r\n".join(lines)


def test_parses_basic_event():
    feed = parse_ics(ics(vevent("u1", "GR5 - French for Fall 26 T1", "20261020T123000Z",
                                location="KB605")))
    assert feed.skipped == 0
    [event] = feed.events
    assert event.uid == "u1"
    assert event.title == "GR5 - French for Fall 26 T1"
    assert event.start == datetime(2026, 10, 20, 12, 30)
    assert event.end == datetime(2026, 10, 20, 14, 30)
    assert event.room == "KB605"


def test_unescapes_commas_in_location():
    feed = parse_ics(ics(vevent("u1", "Tutorat & French for Fall 26 T1", "20261020T123000Z",
                                location="KB404\\, KB604 B")))
    assert feed.events[0].room == "KB404, KB604 B"


def test_unfolds_long_lines():
    folded = vevent("u1", "GR12 - French for Fall 26 T1", "20261020T123000Z",
                    description="SORTIE CULTURELLE : Bourgeois gentilhomme le samedi\r\n  24 octobre")
    assert "samedi 24 octobre" in parse_ics(ics(folded)).events[0].description


def test_skips_missing_end_and_duplicate_uid():
    feed = parse_ics(ics(
        vevent("u1", "Harmonization", "20261020T070000Z", end="20261020T100000Z"),
        vevent("u2", "Harmonization", "20261021T070000Z", end=None),
        vevent("u1", "Harmonization", "20261022T070000Z", end="20261022T100000Z"),
    ))
    assert [e.uid for e in feed.events] == ["u1"]
    assert feed.skipped == 2


def test_skips_event_ending_before_it_starts():
    feed = parse_ics(ics(vevent("u1", "X", "20261020T123000Z", end="20261020T120000Z")))
    assert feed.events == []
    assert feed.skipped == 1


def test_empty_calendar_returns_no_events():
    assert parse_ics(ics()).events == []


def test_html_body_is_invalid_feed():
    with pytest.raises(InvalidFeedError):
        parse_ics("<html><body>Maintenance</body></html>")


def test_malformed_dtstart_skips_only_that_event():
    bad = vevent("bad", "Broken", "2026-garbage")
    good = vevent("ok", "Relational Databases", "20261020T123000Z")
    feed = parse_ics(ics(bad, good))
    assert [e.uid for e in feed.events] == ["ok"]
    assert feed.skipped == 1
