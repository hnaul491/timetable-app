from dataclasses import dataclass
from datetime import datetime

from icalendar import Calendar

from app.timeutil import to_naive_utc


class InvalidFeedError(Exception):
    pass


@dataclass(frozen=True)
class FeedEvent:
    uid: str
    title: str
    start: datetime
    end: datetime
    room: str
    description: str


@dataclass
class ParsedFeed:
    events: list[FeedEvent]
    skipped: int


def parse_ics(text: str) -> ParsedFeed:
    if "BEGIN:VCALENDAR" not in text:
        raise InvalidFeedError("response is not an iCalendar document")
    try:
        calendar = Calendar.from_ical(text)
    except ValueError as exc:
        raise InvalidFeedError(f"could not parse calendar: {exc}") from None

    events: list[FeedEvent] = []
    seen: set[str] = set()
    skipped = 0
    for component in calendar.walk("VEVENT"):
        try:
            uid = str(component.get("UID", "")).strip()
            dtstart = component.get("DTSTART")
            dtend = component.get("DTEND")
            if not uid or uid in seen or dtstart is None or dtend is None:
                skipped += 1
                continue
            start = to_naive_utc(dtstart.dt)
            end = to_naive_utc(dtend.dt)
            if end <= start:
                skipped += 1
                continue
            event = FeedEvent(
                uid=uid,
                title=str(component.get("SUMMARY", "")).strip(),
                start=start,
                end=end,
                room=str(component.get("LOCATION", "")).strip(),
                description=str(component.get("DESCRIPTION", "")).strip(),
            )
        except ValueError:
            skipped += 1
            continue
        seen.add(uid)
        events.append(event)
    return ParsedFeed(events=events, skipped=skipped)
