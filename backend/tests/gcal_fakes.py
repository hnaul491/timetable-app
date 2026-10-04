import threading
from collections.abc import Callable
from typing import Any

from app.gcal.api import GoogleNotFound


class FakeCalendar:
    """In-memory Google Calendar. `fail` maps a method name to a queue of exceptions (None = succeed)."""

    def __init__(self, fail: dict[str, list[Exception | None]] | None = None,
                 scopes: set[str] | None = None, before_insert: Callable[[], None] | None = None) -> None:
        self._lock = threading.Lock()
        self.before_insert = before_insert  # runs outside the lock, e.g. to prove calls overlap
        self.scopes = set(scopes or ())
        self.calendars: dict[str, str] = {}
        self.events: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, str]] = []
        self._fail = {name: list(queue) for name, queue in (fail or {}).items()}
        self._created = 0
        self._next = 0

    def granted_scopes(self) -> set[str]:
        self._check("granted_scopes")
        return set(self.scopes)

    def _check(self, method: str) -> None:
        with self._lock:
            queue = self._fail.get(method)
            error = queue.pop(0) if queue else None
        if error is not None:
            raise error

    def create_calendar(self, name: str, time_zone: str) -> str:
        self._check("create_calendar")
        with self._lock:
            self._created += 1
            calendar_id = f"cal{self._created}"
            self.calendars[calendar_id] = name
            self.calls.append(("create_calendar", calendar_id))
        return calendar_id

    def insert_event(self, calendar_id: str, body: dict[str, Any]) -> str:
        if self.before_insert is not None:
            self.before_insert()
        self._check("insert_event")
        with self._lock:
            if calendar_id not in self.calendars:
                raise GoogleNotFound("Google Calendar returned 404")
            self._next += 1
            event_id = f"g{self._next}"
            self.events[event_id] = body
            self.calls.append(("insert_event", event_id))
        return event_id

    def update_event(self, calendar_id: str, event_id: str, body: dict[str, Any]) -> None:
        self._check("update_event")
        with self._lock:
            if calendar_id not in self.calendars or event_id not in self.events:
                raise GoogleNotFound("Google Calendar returned 404")
            self.events[event_id] = body
            self.calls.append(("update_event", event_id))

    def delete_event(self, calendar_id: str, event_id: str) -> None:
        self._check("delete_event")
        with self._lock:
            if calendar_id not in self.calendars or event_id not in self.events:
                raise GoogleNotFound("Google Calendar returned 410")
            del self.events[event_id]
            self.calls.append(("delete_event", event_id))
