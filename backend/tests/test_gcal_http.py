import json

import httpx
import pytest

from app.gcal.api import GoogleAuthError, GoogleError, GoogleNotFound, GoogleRateLimited
from app.gcal.http_client import HttpGoogleCalendar

API = "https://www.googleapis.com/calendar/v3"


class Google:
    """Scripted Google: token responses and API responses are consumed in order."""

    def __init__(self, tokens=None, api=None):
        self.tokens = list(tokens or [httpx.Response(200, json={"access_token": "at1", "expires_in": 3599})])
        self.api = list(api or [])
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.host == "oauth2.googleapis.com":
            return self.tokens.pop(0)
        return self.api.pop(0)


def client(google: Google) -> HttpGoogleCalendar:
    return HttpGoogleCalendar("cid", "csecret", "1//refresh", http=httpx.Client(transport=httpx.MockTransport(google)))


def test_creates_calendar_and_reuses_the_access_token():
    google = Google(api=[httpx.Response(200, json={"id": "abc@group.calendar.google.com"}),
                         httpx.Response(200, json={"id": "ev1"})])
    gcal = client(google)
    assert gcal.create_calendar("My Timetable", "Europe/Paris") == "abc@group.calendar.google.com"
    assert gcal.insert_event("abc@group.calendar.google.com", {"summary": "x"}) == "ev1"
    token_request, create, insert = google.requests
    form = dict(httpx.QueryParams(token_request.content.decode()))
    assert form == {"client_id": "cid", "client_secret": "csecret", "refresh_token": "1//refresh",
                    "grant_type": "refresh_token"}
    assert (create.method, str(create.url)) == ("POST", f"{API}/calendars")
    assert json.loads(create.content) == {"summary": "My Timetable", "timeZone": "Europe/Paris"}
    assert create.headers["Authorization"] == "Bearer at1"
    assert str(insert.url) == f"{API}/calendars/abc%40group.calendar.google.com/events"


def test_update_and_delete_use_put_and_delete():
    google = Google(api=[httpx.Response(200, json={"id": "ev1"}), httpx.Response(204)])
    gcal = client(google)
    gcal.update_event("cal", "ev1", {"summary": "y"})
    gcal.delete_event("cal", "ev1")
    assert [(r.method, str(r.url)) for r in google.requests[1:]] == [
        ("PUT", f"{API}/calendars/cal/events/ev1"), ("DELETE", f"{API}/calendars/cal/events/ev1")]


def test_revoked_refresh_token_is_an_auth_error_without_secrets():
    google = Google(tokens=[httpx.Response(400, json={"error": "invalid_grant"})])
    with pytest.raises(GoogleAuthError) as caught:
        client(google).create_calendar("My Timetable", "Europe/Paris")
    assert "1//refresh" not in str(caught.value) and "csecret" not in str(caught.value)


def test_wrong_client_secret_is_not_reported_as_revoked():
    google = Google(tokens=[httpx.Response(401, json={"error": "invalid_client"})])
    with pytest.raises(GoogleError) as caught:
        client(google).create_calendar("My Timetable", "Europe/Paris")
    assert not isinstance(caught.value, GoogleAuthError)


def test_expired_access_token_is_refreshed_once():
    google = Google(tokens=[httpx.Response(200, json={"access_token": "at1"}), httpx.Response(200, json={"access_token": "at2"})],
                    api=[httpx.Response(401), httpx.Response(200, json={"id": "ev1"})])
    assert client(google).insert_event("cal", {}) == "ev1"
    assert google.requests[-1].headers["Authorization"] == "Bearer at2"


def test_api_401_twice_is_an_auth_error():
    google = Google(tokens=[httpx.Response(200, json={"access_token": "at1"}), httpx.Response(200, json={"access_token": "at2"})],
                    api=[httpx.Response(401), httpx.Response(401)])
    with pytest.raises(GoogleAuthError):
        client(google).insert_event("cal", {})


@pytest.mark.parametrize("status", [404, 410])
def test_missing_event_is_not_found(status):
    with pytest.raises(GoogleNotFound):
        client(Google(api=[httpx.Response(status)])).delete_event("cal", "ev1")


def test_rate_limits():
    reason = {"error": {"errors": [{"reason": "rateLimitExceeded"}], "code": 403}}
    with pytest.raises(GoogleRateLimited):
        client(Google(api=[httpx.Response(403, json=reason)])).insert_event("cal", {})
    with pytest.raises(GoogleRateLimited):
        client(Google(api=[httpx.Response(429)])).insert_event("cal", {})


def test_other_errors_name_status_and_reason():
    body = {"error": {"errors": [{"reason": "accessNotConfigured"}], "code": 403}}
    with pytest.raises(GoogleError, match=r"Google Calendar returned 403 \(accessNotConfigured\)"):
        client(Google(api=[httpx.Response(403, json=body)])).insert_event("cal", {})


def test_network_error_is_a_google_error_not_an_auth_error():
    def boom(request):
        raise httpx.ConnectTimeout("secret-detail")

    gcal = HttpGoogleCalendar("cid", "csecret", "1//refresh", http=httpx.Client(transport=httpx.MockTransport(boom)))
    with pytest.raises(GoogleError, match="Could not reach Google") as caught:
        gcal.insert_event("cal", {})
    assert not isinstance(caught.value, GoogleAuthError)
    assert "secret-detail" not in str(caught.value)


def test_non_json_token_response_is_an_unexpected_response():
    google = Google(tokens=[httpx.Response(200, content=b"<html>")])
    with pytest.raises(GoogleError, match="unexpected response"):
        client(google).insert_event("cal", {})


def test_token_error_body_that_is_not_an_object_is_still_an_auth_error():
    google = Google(tokens=[httpx.Response(400, json=[])])
    with pytest.raises(GoogleAuthError):
        client(google).insert_event("cal", {})


def test_insert_response_without_id_is_an_unexpected_response():
    with pytest.raises(GoogleError, match="unexpected response"):
        client(Google(api=[httpx.Response(200, json={})])).insert_event("cal", {})


def test_missing_scope_is_an_auth_error():
    body = {"error": {"errors": [{"reason": "insufficientPermissions"}], "code": 403}}
    with pytest.raises(GoogleAuthError, match="permission is missing"):
        client(Google(api=[httpx.Response(403, json=body)])).insert_event("cal", {})
    body = {"error": {"code": 403, "details": [{"reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}}
    with pytest.raises(GoogleAuthError, match="permission is missing"):
        client(Google(api=[httpx.Response(403, json=body)])).insert_event("cal", {})


def test_quota_exceeded_is_rate_limited():
    body = {"error": {"errors": [{"reason": "quotaExceeded"}], "code": 403}}
    with pytest.raises(GoogleRateLimited):
        client(Google(api=[httpx.Response(403, json=body)])).insert_event("cal", {})


def test_revoke_posts_the_token_and_ignores_errors():
    google = Google(tokens=[httpx.Response(400, json={"error": "invalid_token"})])
    client(google).revoke()
    (request,) = google.requests
    assert str(request.url) == "https://oauth2.googleapis.com/revoke"
    assert dict(httpx.QueryParams(request.content.decode())) == {"token": "1//refresh"}

    def boom(request):
        raise httpx.ConnectTimeout("x")

    HttpGoogleCalendar("cid", "s", "1//refresh", http=httpx.Client(transport=httpx.MockTransport(boom))).revoke()


def test_list_app_event_ids_pages_and_reads_the_marker():
    google = Google(api=[
        httpx.Response(200, json={"items": [
            {"id": "a", "extendedProperties": {"private": {"timetableEventId": "7"}}}, {"id": "b"}],
            "nextPageToken": "next"}),
        httpx.Response(200, json={"items": [{"id": "c", "extendedProperties": {"private": {"other": "x"}}}]}),
    ])
    assert client(google).list_app_event_ids("cal@x") == [("a", "7"), ("b", None), ("c", None)]
    first, second = google.requests[1:]
    assert first.method == "GET" and str(first.url).startswith(f"{API}/calendars/cal%40x/events?")
    params = dict(first.url.params)
    assert params["maxResults"] == "2500" and params["showDeleted"] == "false"
    assert params["fields"] == "items(id,extendedProperties/private/timetableEventId),nextPageToken"
    assert "pageToken" not in params and dict(second.url.params)["pageToken"] == "next"
