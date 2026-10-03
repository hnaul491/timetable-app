from typing import Any
from urllib.parse import quote

import httpx

from app.gcal.api import GoogleAuthError, GoogleError, GoogleNotFound, GoogleRateLimited

TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/calendar/v3"
RATE_REASONS = {"rateLimitExceeded", "userRateLimitExceeded"}


def _q(value: str) -> str:
    return quote(value, safe="")


def _reason(response: httpx.Response) -> str:
    try:
        errors = response.json().get("error", {}).get("errors", [])
        return str(errors[0].get("reason", "")) if errors else ""
    except (ValueError, AttributeError):
        return ""


class HttpGoogleCalendar:
    def __init__(self, client_id: str, client_secret: str, refresh_token: str,
                 http: httpx.Client | None = None) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._refresh_token = refresh_token
        self._http = http or httpx.Client(timeout=10.0)
        self._access_token: str | None = None

    def _token(self) -> str:
        if self._access_token is None:
            response = self._http.post(TOKEN_URL, data={
                "client_id": self._client_id, "client_secret": self._client_secret,
                "refresh_token": self._refresh_token, "grant_type": "refresh_token",
            })
            if response.status_code != 200:
                try:
                    error = response.json().get("error", "")
                except ValueError:
                    error = ""
                if error == "invalid_client":
                    raise GoogleError("Google rejected the server's client id/secret")
                if response.status_code in (400, 401):
                    raise GoogleAuthError("Google access was revoked or expired — reconnect Google in Settings")
                raise GoogleError(f"Google sign-in returned {response.status_code}")
            self._access_token = str(response.json()["access_token"])
        return self._access_token

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> httpx.Response:
        response = self._send(method, path, body)
        if response.status_code == 401:
            self._access_token = None  # expired access token: refresh once and retry
            response = self._send(method, path, body)
        status = response.status_code
        if status < 400:
            return response
        reason = _reason(response)
        if status == 401:
            raise GoogleAuthError("Google access was revoked or expired — reconnect Google in Settings")
        if status in (404, 410):
            raise GoogleNotFound(f"Google Calendar returned {status}")
        if status == 429 or (status == 403 and reason in RATE_REASONS):
            raise GoogleRateLimited("Google rate limit reached; the rest is sent on the next push")
        raise GoogleError(f"Google Calendar returned {status} ({reason or 'no reason'})")

    def _send(self, method: str, path: str, body: dict[str, Any] | None) -> httpx.Response:
        return self._http.request(method, API + path, json=body,
                                  headers={"Authorization": f"Bearer {self._token()}"})

    def create_calendar(self, name: str, time_zone: str) -> str:
        return str(self._request("POST", "/calendars", {"summary": name, "timeZone": time_zone}).json()["id"])

    def insert_event(self, calendar_id: str, body: dict[str, Any]) -> str:
        return str(self._request("POST", f"/calendars/{_q(calendar_id)}/events", body).json()["id"])

    def update_event(self, calendar_id: str, event_id: str, body: dict[str, Any]) -> None:
        self._request("PUT", f"/calendars/{_q(calendar_id)}/events/{_q(event_id)}", body)

    def delete_event(self, calendar_id: str, event_id: str) -> None:
        self._request("DELETE", f"/calendars/{_q(calendar_id)}/events/{_q(event_id)}")
