"""Free time finder: for each day of a period, is a daily window free of classes/events?

`compute_free_time` is a pure function over busy items (naive UTC datetimes) and query parameters;
`free_time_for_session` loads the items the calendar shows and calls it.
"""
from dataclasses import dataclass
from collections.abc import Callable
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy.orm import Session

from app.services.events_query import active_semester, scan_visible_events
from app.services.recurrence import PARIS

MAX_DAYS = 200
MAX_BUFFER = 240
MAX_MIN_FREE = 1440
DEFAULT_WEEKDAYS = (0, 1, 2, 3, 4)


@dataclass(frozen=True)
class BusyItem:
    id: int
    title: str
    start_at: datetime
    end_at: datetime
    kind: str
    status: str


@dataclass(frozen=True)
class FreeTimeParams:
    window_from: time
    window_to: time
    start: date
    end: date
    weekdays: tuple[int, ...] = DEFAULT_WEEKDAYS
    buffer: int = 0
    min_free: int | None = None


def _utc(day: date, at: time) -> datetime:
    return datetime.combine(day, at, PARIS).astimezone(timezone.utc).replace(tzinfo=None)


def _iso(dt: datetime) -> str:
    return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def blocks(item: BusyItem) -> bool:
    return item.status != "cancelled" and item.kind != "holiday"


def _day_result(day: date, params: FreeTimeParams, items: list[BusyItem], covered: Callable[[date], bool]) -> dict:
    weekday = day.weekday()
    if weekday not in params.weekdays:
        return {"date": day.isoformat(), "weekday": weekday, "status": "off", "counts": False,
                "free_minutes": 0, "longest_free": 0, "blockers": []}
    if not covered(day):  # no timetable data for this day: not free, not busy
        return {"date": day.isoformat(), "weekday": weekday, "status": "unknown", "counts": False,
                "free_minutes": 0, "longest_free": 0, "blockers": []}
    w_start, w_end = _utc(day, params.window_from), _utc(day, params.window_to)
    buffer = timedelta(minutes=params.buffer)
    hits = sorted((i for i in items if blocks(i) and i.start_at - buffer < w_end and i.end_at > w_start),
                  key=lambda i: (i.start_at, i.id))
    cursor, free, longest = w_start, timedelta(0), timedelta(0)
    for item in hits:
        gap = min(item.start_at - buffer, w_end) - cursor
        if gap > timedelta(0):
            free += gap
            longest = max(longest, gap)
        cursor = max(cursor, item.end_at)
    if w_end > cursor:
        free += w_end - cursor
        longest = max(longest, w_end - cursor)
    free_min, longest_min = int(free.total_seconds() // 60), int(longest.total_seconds() // 60)
    status = "free" if not hits else ("partial" if free_min > 0 else "busy")
    counts = status == "free" or (params.min_free is not None and longest_min >= params.min_free)
    return {"date": day.isoformat(), "weekday": weekday, "status": status, "counts": counts,
            "free_minutes": free_min, "longest_free": longest_min,
            "blockers": [{"event_id": i.id, "title": i.title[:200], "start": _iso(i.start_at),
                          "end": _iso(i.end_at), "kind": i.kind} for i in hits]}


def compute_free_time(items: list[BusyItem], params: FreeTimeParams,
                      covered: Callable[[date], bool] = lambda day: True) -> dict:
    days = []
    day = params.start
    while day <= params.end:
        days.append(_day_result(day, params, items, covered))
        day += timedelta(days=1)
    known = ("free", "partial", "busy")
    by_weekday = [{"weekday": w, "free": sum(1 for d in days if d["weekday"] == w and d["counts"]),
                   "total": sum(1 for d in days if d["weekday"] == w and d["status"] in known)} for w in range(7)]
    return {"window": {"from": params.window_from.strftime("%H:%M"), "to": params.window_to.strftime("%H:%M")},
            "start": params.start.isoformat(), "end": params.end.isoformat(),
            "buffer": params.buffer, "min_free": params.min_free,
            "counted_days": sum(1 for d in days if d["status"] != "off"),
            "uncovered_days": sum(1 for d in days if d["status"] == "unknown"),
            "free_days": sum(1 for d in days if d["counts"]),
            "by_weekday": by_weekday, "days": days}


def free_time_for_session(session: Session, params: FreeTimeParams) -> dict:
    semester = active_semester(session)
    items: list[BusyItem] = []
    missing: list[dict] = []
    semester_info = None

    def covered(day: date) -> bool:
        if semester is None:
            return False
        return ((semester.start_date is None or day >= semester.start_date)
                and (semester.end_date is None or day <= semester.end_date))

    if semester is not None:
        semester_info = {"id": semester.id, "name": semester.name,
                         "start": semester.start_date.isoformat() if semester.start_date else None,
                         "end": semester.end_date.isoformat() if semester.end_date else None}
        # busy time only reaches back before an event's start, so later events matter and earlier ones need no buffer
        lo = _utc(params.start, time(0))
        hi = _utc(params.end + timedelta(days=1), time(0)) + timedelta(minutes=params.buffer)
        visible, missing_names = scan_visible_events(session, semester.id, lo, hi, with_counts=False)
        items = [BusyItem(e.id, e.title, e.start_at, e.end_at, e.kind, e.status) for e in visible]
        missing = [{"subject_id": sid, "name": name} for name, sid in sorted(missing_names.items())]
    result = compute_free_time(items, params, covered)
    return {**result, "semester": semester_info, "missing_sections": missing}
