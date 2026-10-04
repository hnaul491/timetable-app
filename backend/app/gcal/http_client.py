from typing import Any
from urllib.parse import quote

import httpx

from app.gcal.api import GoogleAuthError, GoogleError, GoogleNotFound, GoogleRateLimited

TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
API = "https://www.googleapis.com/calendar/v3"
RATE_REASONS = {"rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"}


def _q(value: str) -> str:
    return quote(value, safe="")


UNREACHABLE = "Could not reach Google"
UNEXPECTED = "Google sent an unexpected response"
CALENDAR = "Google Calendar"


def _json(response: httpx.Response) -> dict[str, Any]:
    """The JSON object body, or {} when the body is not a JSON object."""
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _reason(response: httpx.Response) -> str:
    error = _json(response).get("error")
    errors = error.get("errors") if isinstance(error, dict) else None
    if isinstance(errors, list) and errors and isinstance(errors[0], dict):
        return str(errors[0].get("reason", ""))
    return ""


def _scope_missing(response: httpx.Response) -> bool:
    error = _json(response).get("error")
    details = error.get("details") if isinstance(error, dict) else None
    return isinstance(details, list) and any(
        isinstance(d, dict) and d.get("reason") == "ACCESS_TOKEN_SCOPE_INSUFFICIENT" for d in details)


class GoogleSession:
    """One Google login (refresh token -> access token) shared by the Calendar and Drive clients.

    Error texts are fixed or built from status codes and Google's error reason only: they never
    contain a token, a secret or a URL.
    """

    def __init__(self, client_id: str, client_secret: str, refresh_token: str,
                 http: httpx.Client | None = None) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._refresh_token = refresh_token
        self._owns_http = http is None
        self._http = http or httpx.Client(timeout=httpx.Timeout(5.0))
        self._access_token: str | None = None

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    def revoke(self) -> None:
        """Best-effort: tell Google to forget the refresh token. Never raises."""
        try:
            self._http.post(REVOKE_URL, data={"token": self._refresh_token})
        except Exception:  # noqa: BLE001
            pass

    def _token(self) -> str:
        if self._access_token is None:
            try:
                response = self._http.post(TOKEN_URL, data={
                    "client_id": self._client_id, "client_secret": self._client_secret,
                    "refresh_token": self._refresh_token, "grant_type": "refresh_token",
                })
            except httpx.HTTPError:
                raise GoogleError(UNREACHABLE) from None
            if response.status_code != 200:
                if _json(response).get("error") == "invalid_client":
                    raise GoogleError("Google rejected the server's client id/secret")
                if response.status_code in (400, 401):
                    raise GoogleAuthError("Google access was revoked or expired — reconnect Google in Settings")
                raise GoogleError(f"Google sign-in returned {response.status_code}")
            token = _json(response).get("access_token")
            if not isinstance(token, str) or not token:
                raise GoogleError(UNEXPECTED)
            self._access_token = token
        return self._access_token

    def granted_scopes(self) -> set[str]:
        """The scopes Google granted to the current access token."""
        try:
            response = self._http.get(TOKENINFO_URL, params={"access_token": self._token()})
        except httpx.HTTPError:
            raise GoogleError(UNREACHABLE) from None
        if response.status_code != 200:
            raise GoogleError(f"Google token check returned {response.status_code}")
        scope = _json(response).get("scope")
        if not isinstance(scope, str):
            raise GoogleError(UNEXPECTED)
        return set(scope.split())

    def request(self, method: str, url: str, *, json: Any = None, content: bytes | None = None,
                headers: dict[str, str] | None = None, params: dict[str, str] | None = None,
                expect: tuple[int, ...] = (200,), service: str = CALENDAR,
                bearer: bool = True) -> httpx.Response:
        """Send a request as the user. Statuses below 400 and those in `expect` are returned as they are."""
        response = self._send(method, url, json, content, headers, params, bearer)
        if response.status_code == 401 and bearer:
            self._access_token = None  # expired access token: refresh once and retry
            response = self._send(method, url, json, content, headers, params, bearer)
        status = response.status_code
        if status < 400 or status in expect:
            return response
        reason = _reason(response)
        if status == 401:
            raise GoogleAuthError("Google access was revoked or expired — reconnect Google in Settings")
        if status in (404, 410):
            raise GoogleNotFound(f"{service} returned {status}")
        if status == 403 and (reason == "insufficientPermissions" or _scope_missing(response)):
            raise GoogleAuthError(f"{service} permission is missing — reconnect Google in Settings")
        if status == 429 or (status == 403 and reason in RATE_REASONS):
            raise GoogleRateLimited(
                "Google rate limit reached; the rest is sent on the next push" if service == CALENDAR
                else "Google rate limit reached; try again in a moment")
        raise GoogleError(f"{service} returned {status} ({reason or 'no reason'})")

    def _send(self, method: str, url: str, json: Any, content: bytes | None, headers: dict[str, str] | None,
              params: dict[str, str] | None, bearer: bool) -> httpx.Response:
        sent = dict(headers or {})
        if bearer:
            sent["Authorization"] = f"Bearer {self._token()}"
        try:
            return self._http.request(method, url, json=json, content=content, headers=sent, params=params)
        except httpx.HTTPError:
            raise GoogleError(UNREACHABLE) from None


class HttpGoogleCalendar:
    def __init__(self, client_id: str, client_secret: str, refresh_token: str,
                 http: httpx.Client | None = None, session: GoogleSession | None = None) -> None:
        self._session = session or GoogleSession(client_id, client_secret, refresh_token, http)

    def close(self) -> None:
        self._session.close()

    def revoke(self) -> None:
        self._session.revoke()

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> httpx.Response:
        return self._session.request(method, API + path, json=body)

    @staticmethod
    def _id(response: httpx.Response) -> str:
        value = _json(response).get("id")
        if not isinstance(value, str) or not value:
            raise GoogleError(UNEXPECTED)
        return value

    def create_calendar(self, name: str, time_zone: str) -> str:
        return self._id(self._request("POST", "/calendars", {"summary": name, "timeZone": time_zone}))

    def insert_event(self, calendar_id: str, body: dict[str, Any]) -> str:
        return self._id(self._request("POST", f"/calendars/{_q(calendar_id)}/events", body))

    def update_event(self, calendar_id: str, event_id: str, body: dict[str, Any]) -> None:
        self._request("PUT", f"/calendars/{_q(calendar_id)}/events/{_q(event_id)}", body)

    def delete_event(self, calendar_id: str, event_id: str) -> None:
        self._request("DELETE", f"/calendars/{_q(calendar_id)}/events/{_q(event_id)}")
