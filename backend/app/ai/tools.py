"""Assistant tools. Read tools query the DB; propose tools only create pending_action rows.

The model has no write tool: every write happens in routers/ai.py when the user confirms an action.
"""
import logging
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.provider import ToolDecl
from app.models import Event, Note, PendingAction, Subject, Task
from app.services.events_query import active_semester, list_visible_events
from app.services.free_time import DEFAULT_WEEKDAYS, MAX_BUFFER, MAX_DAYS, MAX_MIN_FREE, FreeTimeParams, free_time_for_session
from app.services.recurrence import PARIS

MAX_EVENTS = 200
MAX_TASKS = 100
MAX_NOTES = 30
NOTE_BODY = 1500
MAX_BLOCKS = 10
MAX_RANGE_DAYS = 31
MAX_SLOTS = 60
ACTION_TTL = timedelta(hours=24)
EVENT_KINDS = ("work", "french_ext", "other")


log = logging.getLogger(__name__)


def _int_arg(value: object) -> int | None:
    """Models send whole numbers as 3 or 3.0; anything else is not an id."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


class ToolError(Exception):
    pass


def _obj(properties: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": properties, "required": required or []}


_DATE = {"type": "string", "description": "Date as YYYY-MM-DD (Paris time)"}
_TIME = {"type": "string", "description": "Time as HH:MM (Paris time, 24h)"}

READ_TOOLS = [
    ToolDecl("get_events", "List timetable events (classes and own events) between two dates, inclusive.",
             _obj({"from_date": _DATE, "to_date": _DATE,
                   "kind": {"type": "string", "description": "Optional: class, work, french_ext or other"}},
                  ["from_date", "to_date"])),
    ToolDecl("get_tasks", "List tasks, optionally filtered by status, due date or subject name.",
             _obj({"status": {"type": "string", "enum": ["todo", "doing", "done"]},
                   "due_before": {"type": "string", "description": "Only tasks due on or before this YYYY-MM-DD"},
                   "subject": {"type": "string", "description": "Subject name (partial match)"}})),
    ToolDecl("get_notes", "List class notes (before/after tabs), optionally filtered.",
             _obj({"subject": {"type": "string"}, "from_date": _DATE, "to_date": _DATE,
                   "search": {"type": "string", "description": "Text to look for in the note"}})),
    ToolDecl("get_subjects", "List the subjects of the active semester.", _obj({})),
    ToolDecl("find_free_slots", "Find free time slots between classes and events.",
             _obj({"from_date": _DATE, "to_date": _DATE,
                   "min_minutes": {"type": "integer", "description": "Minimum slot length in minutes"},
                   "day_start": {**_TIME, "description": "Default 08:00"},
                   "day_end": {**_TIME, "description": "Default 20:00"}},
                  ["from_date", "to_date", "min_minutes"])),
    ToolDecl("count_free_days", "Count the days in a period when a daily time window (for example 06:00-08:00) is "
             "completely free of classes and events, optionally keeping travel minutes before each class.",
             _obj({"from": _TIME, "to": _TIME, "start": _DATE, "end": _DATE,
                   "weekdays": {"type": "array", "items": {"type": "integer"},
                                "description": "Weekdays to count, Monday=0 .. Sunday=6 (default Monday-Friday)"},
                   "buffer": {"type": "integer", "description": "Travel minutes before each class (0-240)"},
                   "min_free": {"type": "integer",
                                "description": "Also count days with at least this many free minutes in the window"}},
                  ["from", "to", "start", "end"])),
]

PROPOSE_TOOLS = [
    ToolDecl("propose_task", "Propose a task. The user must confirm before it is saved.",
             _obj({"title": {"type": "string"}, "due_date": _DATE,
                   "subject": {"type": "string", "description": "Subject name"},
                   "event_id": {"type": "integer"}}, ["title"])),
    ToolDecl("propose_event", "Propose an own calendar event. The user must confirm before it is saved.",
             _obj({"title": {"type": "string"}, "date": _DATE, "start": _TIME, "end": _TIME,
                   "kind": {"type": "string", "enum": list(EVENT_KINDS)}, "room": {"type": "string"}},
                  ["title", "date", "start", "end", "kind"])),
    ToolDecl("propose_note", "Propose text to append to a class note. The user must confirm.",
             _obj({"event_id": {"type": "integer"}, "tab": {"type": "string", "enum": ["after", "before"]},
                   "text": {"type": "string"}}, ["event_id", "tab", "text"])),
    ToolDecl("propose_study_blocks", "Propose study sessions for a subject (max 10). The user must confirm.",
             _obj({"subject": {"type": "string"},
                   "blocks": {"type": "array", "items": _obj({"date": _DATE, "start": _TIME, "end": _TIME},
                                                              ["date", "start", "end"])}},
                  ["subject", "blocks"])),
]

TOOLS = READ_TOOLS + PROPOSE_TOOLS


def paris_iso(value: datetime) -> str:
    return value.replace(tzinfo=timezone.utc).astimezone(PARIS).isoformat()


def _day(value: object, field: str = "date") -> date:
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ToolError(f"{field} must be YYYY-MM-DD") from None


def _clock(value: object, field: str = "time") -> time:
    try:
        return time.fromisoformat(str(value))
    except ValueError:
        raise ToolError(f"{field} must be HH:MM") from None


def _utc(day: date, at: time) -> datetime:
    return datetime.combine(day, at, PARIS).astimezone(timezone.utc).replace(tzinfo=None)


def _range(args: dict) -> tuple[date, date]:
    first, last = _day(args.get("from_date"), "from_date"), _day(args.get("to_date"), "to_date")
    if last < first:
        raise ToolError("to_date is before from_date")
    if (last - first).days > MAX_RANGE_DAYS:
        raise ToolError(f"range is limited to {MAX_RANGE_DAYS} days")
    return first, last


def _semester(session: Session):
    semester = active_semester(session)
    if semester is None:
        raise ToolError("no active semester")
    return semester


def _find_subject(session: Session, semester_id: int, name: object) -> Subject:
    needle = str(name or "").strip().lower()
    subjects = list(session.scalars(select(Subject).where(Subject.semester_id == semester_id)))
    exact = [s for s in subjects if s.display_name.lower() == needle]
    partial = [s for s in subjects if needle and needle in s.display_name.lower()]
    found = exact or partial
    if len(found) != 1:
        raise ToolError(f"unknown or ambiguous subject '{name}'")
    return found[0]


def _event_json(event) -> dict:
    return {"id": event.id, "title": event.title, "subject": event.subject_name, "kind": event.kind,
            "status": event.status, "start": paris_iso(event.start_at), "end": paris_iso(event.end_at),
            "room": event.room, "has_notes": event.note_count > 0, "open_tasks": event.open_tasks}


# ---- read tools -----------------------------------------------------------------------------------------

def _get_events(session: Session, args: dict) -> dict:
    semester = _semester(session)
    first, last = _range(args)
    events, _ = list_visible_events(session, semester.id, _utc(first, time(0)), _utc(last + timedelta(days=1), time(0)))
    kind = args.get("kind")
    if kind:
        events = [e for e in events if e.kind == kind]
    return {"events": [_event_json(e) for e in events[:MAX_EVENTS]], "truncated": len(events) > MAX_EVENTS}


def _get_tasks(session: Session, args: dict) -> dict:
    semester = _semester(session)
    subjects = {s.id: s.display_name for s in session.scalars(select(Subject).where(Subject.semester_id == semester.id))}
    query = select(Task).where((Task.subject_id.is_(None)) | (Task.subject_id.in_(list(subjects))))
    if args.get("status"):
        query = query.where(Task.status == args["status"])
    if args.get("due_before"):
        query = query.where(Task.due_date.is_not(None), Task.due_date <= _day(args["due_before"], "due_before"))
    if args.get("subject"):
        needle = str(args["subject"]).lower()
        ids = [i for i, n in subjects.items() if needle in n.lower()]
        query = query.where(Task.subject_id.in_(ids))
    rows = list(session.scalars(query.order_by(Task.due_date.is_(None), Task.due_date, Task.id).limit(MAX_TASKS + 1)))
    return {"tasks": [{"id": t.id, "title": t.title, "status": t.status,
                       "due_date": t.due_date.isoformat() if t.due_date else None,
                       "subject": subjects.get(t.subject_id), "event_id": t.event_id} for t in rows[:MAX_TASKS]],
            "truncated": len(rows) > MAX_TASKS}


def _get_notes(session: Session, args: dict) -> dict:
    semester = _semester(session)
    subjects = {s.id: s.display_name for s in session.scalars(select(Subject).where(Subject.semester_id == semester.id))}
    query = (select(Note, Event).join(Event, Event.id == Note.event_id)
             .where(Event.semester_id == semester.id, Note.body != ""))
    if args.get("subject"):
        needle = str(args["subject"]).lower()
        query = query.where(Event.subject_id.in_([i for i, n in subjects.items() if needle in n.lower()]))
    if args.get("from_date"):
        query = query.where(Event.start_at >= _utc(_day(args["from_date"], "from_date"), time(0)))
    if args.get("to_date"):
        query = query.where(Event.start_at < _utc(_day(args["to_date"], "to_date") + timedelta(days=1), time(0)))
    if args.get("search"):
        query = query.where(Note.body.ilike(f"%{str(args['search']).replace('%', '').replace('_', '')}%"))
    rows = session.execute(query.order_by(Event.start_at.desc(), Note.id).limit(MAX_NOTES)).all()
    return {"notes": [{"event_id": e.id, "subject": subjects.get(e.subject_id), "title": e.title_raw,
                       "date": paris_iso(e.start_at)[:10], "tab": n.tab, "body": n.body[:NOTE_BODY]}
                      for n, e in rows]}


def _get_subjects(session: Session, args: dict) -> dict:
    semester = _semester(session)
    rows = session.scalars(select(Subject).where(Subject.semester_id == semester.id, Subject.hidden.is_(False))
                           .order_by(Subject.display_name))
    return {"subjects": [{"id": s.id, "name": s.display_name} for s in rows]}


def _find_free_slots(session: Session, args: dict) -> dict:
    semester = _semester(session)
    first, last = _range(args)
    try:
        minimum = max(int(args.get("min_minutes", 60)), 1)
    except (TypeError, ValueError):
        raise ToolError("min_minutes must be a number") from None
    open_at = _clock(args.get("day_start") or "08:00", "day_start")
    close_at = _clock(args.get("day_end") or "20:00", "day_end")
    if close_at <= open_at:
        raise ToolError("day_end must be after day_start")
    events, _ = list_visible_events(session, semester.id, _utc(first, time(0)), _utc(last + timedelta(days=1), time(0)))
    busy = [(e.start_at, e.end_at) for e in events if e.status != "cancelled"]
    slots: list[dict] = []
    day = first
    while day <= last and len(slots) < MAX_SLOTS:
        start, end = _utc(day, open_at), _utc(day, close_at)
        cursor = start
        for b_start, b_end in sorted(b for b in busy if b[0] < end and b[1] > start):
            if b_start - cursor >= timedelta(minutes=minimum):
                slots.append((cursor, b_start))
            cursor = max(cursor, b_end)
        if end - cursor >= timedelta(minutes=minimum):
            slots.append((cursor, end))
        day += timedelta(days=1)
    return {"slots": [{"start": paris_iso(a), "end": paris_iso(b), "minutes": int((b - a).total_seconds() // 60),
                       "date": paris_iso(a)[:10]} for a, b in slots[:MAX_SLOTS]]}


def _opt_int(args: dict, field: str, low: int, high: int) -> int | None:
    if args.get(field) is None:
        return None
    value = _int_arg(args[field])
    if value is None or not low <= value <= high:
        raise ToolError(f"{field} must be a whole number from {low} to {high}")
    return value


def _local_hm(iso_utc_z: str) -> str:
    return paris_iso(datetime.fromisoformat(iso_utc_z[:-1]))[11:16]


def _count_free_days(session: Session, args: dict) -> dict:
    t_from, t_to = _clock(args.get("from"), "from"), _clock(args.get("to"), "to")
    if t_from >= t_to:
        raise ToolError("from must be before to")
    first, last = _day(args.get("start"), "start"), _day(args.get("end"), "end")
    if last < first:
        raise ToolError("end is before start")
    if (last - first).days + 1 > MAX_DAYS:
        raise ToolError(f"period is limited to {MAX_DAYS} days")
    raw = args.get("weekdays")
    if raw is None:
        weekdays = DEFAULT_WEEKDAYS
    else:
        found = [_int_arg(w) for w in raw] if isinstance(raw, list) else []
        if not found or any(w is None or not 0 <= w <= 6 for w in found):
            raise ToolError("weekdays must be a list of numbers 0 (Monday) to 6 (Sunday)")
        weekdays = tuple(sorted(set(found)))
    buffer = _opt_int(args, "buffer", 0, MAX_BUFFER) or 0
    min_free = _opt_int(args, "min_free", 1, MAX_MIN_FREE)
    result = free_time_for_session(session, FreeTimeParams(t_from, t_to, first, last, weekdays, buffer, min_free))
    blocked = [{"date": d["date"], "status": d["status"],
                "blockers": [f"{b['title']} {_local_hm(b['start'])}-{_local_hm(b['end'])}" for b in d["blockers"]]}
               for d in result["days"] if d["status"] in ("partial", "busy") and not d["counts"]]
    out = {"free_days": result["free_days"], "counted_days": result["counted_days"],
           "uncovered_days": result["uncovered_days"],
           "by_weekday": result["by_weekday"], "blocked_days": blocked[:10]}
    notes = []
    if result["uncovered_days"]:
        notes.append(f"{result['uncovered_days']} of the counted days are outside the active semester "
                     "(or there is no active semester), so they have no timetable data and are NOT counted as free. "
                     "Tell the user.")
    if result["missing_sections"]:
        names = ", ".join(m["name"] for m in result["missing_sections"][:10])
        notes.append(f"Classes of these subjects are ignored because the student has not chosen a section: {names}. "
                     "The result may be too optimistic. Tell the user to choose sections in Settings.")
    if notes:
        out["note"] = " ".join(notes)
    return out


# ---- propose tools --------------------------------------------------------------------------------------

def _pending(session: Session, kind: str, summary: str, payload: dict, now: datetime) -> dict:
    action = PendingAction(kind=kind, payload={**payload, "summary": summary}, status="pending", created_at=now,
                           expires_at=now + ACTION_TTL)
    session.add(action)
    session.flush()
    return {"action_id": action.id, "summary": summary,
            "note": "Proposed only: the user must confirm it before anything is saved."}


def _text(value: object, field: str, limit: int) -> str:
    text = str(value or "").strip()
    if not text:
        raise ToolError(f"{field} is required")
    return text[:limit]


def _window(args: dict) -> tuple[str, str, str]:
    day = _day(args.get("date"))
    start, end = _clock(args.get("start"), "start"), _clock(args.get("end"), "end")
    if end <= start:
        raise ToolError("end must be after start")
    return day.isoformat(), start.strftime("%H:%M"), end.strftime("%H:%M")


def _propose_task(session: Session, args: dict, now: datetime) -> dict:
    title = _text(args.get("title"), "title", 300)
    semester = _semester(session)
    subject_id = None
    event_id = None
    subject_name = None
    if args.get("event_id") is not None:
        found = _int_arg(args["event_id"])
        event = session.get(Event, found) if found is not None else None
        if event is None:
            raise ToolError("unknown event_id")
        event_id, subject_id = event.id, event.subject_id
    if args.get("subject"):
        subject_id = _find_subject(session, semester.id, args["subject"]).id
    if subject_id is not None:
        found_subject = session.get(Subject, subject_id)
        subject_name = found_subject.display_name if found_subject else None
    due = _day(args["due_date"], "due_date").isoformat() if args.get("due_date") else None
    summary = f"Task: {title}" + (f" (due {due})" if due else "")
    return _pending(session, "task", summary, {"title": title, "due_date": due, "subject_id": subject_id,
                                               "subject_name": subject_name, "event_id": event_id}, now)


def _propose_event(session: Session, args: dict, now: datetime) -> dict:
    title = _text(args.get("title"), "title", 200)
    kind = args.get("kind")
    if kind not in EVENT_KINDS:
        raise ToolError("kind must be work, french_ext or other")
    day, start, end = _window(args)
    room = str(args.get("room") or "").strip()[:200]
    return _pending(session, "event", f"Event: {title}, {day} {start}-{end}",
                    {"title": title, "date": day, "start": start, "end": end, "kind": kind, "room": room}, now)


def _propose_note(session: Session, args: dict, now: datetime) -> dict:
    found = _int_arg(args.get("event_id"))
    event = session.get(Event, found) if found is not None else None
    if event is None:
        raise ToolError("unknown event_id")
    if args.get("tab") not in ("after", "before"):
        raise ToolError("tab must be after or before")
    text = _text(args.get("text"), "text", 5000)
    return _pending(session, "note", f"Add to the {args['tab']}-class note of {event.title_raw}: {text[:80]}",
                    {"event_id": event.id, "tab": args["tab"], "text": text,
                     "event_title": event.title_raw[:200], "event_date": paris_iso(event.start_at)[:10]}, now)


def _propose_study_blocks(session: Session, args: dict, now: datetime) -> dict:
    semester = _semester(session)
    subject = _find_subject(session, semester.id, args.get("subject"))
    raw = args.get("blocks")
    if not isinstance(raw, list) or not raw or len(raw) > MAX_BLOCKS:
        raise ToolError(f"blocks must contain 1 to {MAX_BLOCKS} items")
    blocks = []
    for item in raw:
        if not isinstance(item, dict):
            raise ToolError("each block needs date, start and end")
        day, start, end = _window(item)
        blocks.append({"date": day, "start": start, "end": end})
    return _pending(session, "study_blocks", f"{len(blocks)} study block(s) for {subject.display_name}",
                    {"subject_id": subject.id, "subject_name": subject.display_name, "blocks": blocks}, now)


_READ = {"get_events": _get_events, "get_tasks": _get_tasks, "get_notes": _get_notes,
         "get_subjects": _get_subjects, "find_free_slots": _find_free_slots,
         "count_free_days": _count_free_days}
_PROPOSE = {"propose_task": _propose_task, "propose_event": _propose_event, "propose_note": _propose_note,
            "propose_study_blocks": _propose_study_blocks}


def execute_tool(session: Session, name: str, args: dict, now: datetime) -> dict:
    """Run one tool call; failures come back as {"error": ...} data for the model, never as exceptions."""
    args = args if isinstance(args, dict) else {}
    try:
        if name in _READ:
            return _READ[name](session, args)
        if name in _PROPOSE:
            return _PROPOSE[name](session, args, now)
        return {"error": f"unknown tool '{name}'"}
    except ToolError as exc:
        return {"error": str(exc)}
    except Exception as exc:
        log.warning("assistant tool %s failed: %s", name, type(exc).__name__)
        session.rollback()
        return {"error": "tool failed"}
