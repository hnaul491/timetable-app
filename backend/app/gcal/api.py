from collections.abc import Callable
from typing import Any, Protocol

ACCOUNT_ID = 1
CALENDAR_NAME = "My Timetable"
TIME_ZONE = "Europe/Paris"
REFRESH_TOKEN_NAME = "google_refresh_token"
ALL_KINDS = ("class", "exam", "holiday", "work", "french_ext", "other")
DEFAULT_KINDS = ["class", "exam", "holiday", "work", "french_ext"]


class GoogleError(Exception):
    """A Google Calendar failure. The message is safe to show: it never contains a token."""


class GoogleAuthError(GoogleError):
    """The refresh token was revoked or expired: the user must connect Google again."""


class GoogleNotFound(GoogleError):
    """The calendar or the event no longer exists in Google."""


class GoogleRateLimited(GoogleError):
    """Google asked us to slow down: stop now and continue on the next push."""


class GoogleCalendar(Protocol):
    def create_calendar(self, name: str, time_zone: str) -> str: ...

    def insert_event(self, calendar_id: str, body: dict[str, Any]) -> str: ...

    def update_event(self, calendar_id: str, event_id: str, body: dict[str, Any]) -> None: ...

    def delete_event(self, calendar_id: str, event_id: str) -> None: ...

    def list_app_event_ids(self, calendar_id: str) -> list[tuple[str, str | None]]:
        """(Google event id, timetableEventId marker or None) of every event in the app's own calendar."""
        ...


GcalFactory = Callable[[str], GoogleCalendar]
"""Builds a client from a refresh token."""
