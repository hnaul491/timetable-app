import json

import httpx
import pytest

from app.gcal.api import GoogleError, GoogleNotFound
from app.gcal.http_client import GoogleSession
from app.gdrive.api import FOLDER_MIME, DriveFile
from app.gdrive.http_client import HttpGoogleDrive

FILES = "https://www.googleapis.com/drive/v3/files"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
SESSION_URI = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=SECRET-SESSION"


class Google:
    def __init__(self, api=None):
        self.api = list(api or [])
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.host == "oauth2.googleapis.com" and request.url.path == "/token":
            return httpx.Response(200, json={"access_token": "at1"})
        return self.api.pop(0)


def make_session(google: Google) -> GoogleSession:
    return GoogleSession("cid", "csecret", "1//refresh", http=httpx.Client(transport=httpx.MockTransport(google)))


def drive(google: Google) -> HttpGoogleDrive:
    return HttpGoogleDrive(make_session(google))


def test_create_folder_sends_name_mime_parents_and_bearer():
    google = Google([httpx.Response(200, json={"id": "f1"})])
    assert drive(google).create_folder("Timetable", "root1") == "f1"
    request = google.requests[1]
    assert (request.method, str(request.url)) == ("POST", f"{FILES}?fields=id")
    assert json.loads(request.content) == {"name": "Timetable", "mimeType": FOLDER_MIME, "parents": ["root1"]}
    assert request.headers["Authorization"] == "Bearer at1"


def test_create_folder_without_parent_omits_parents():
    google = Google([httpx.Response(200, json={"id": "f1"})])
    drive(google).create_folder("Timetable", None)
    assert "parents" not in json.loads(google.requests[1].content)


def test_start_upload_returns_location_and_sends_upload_headers():
    google = Google([httpx.Response(200, headers={"Location": SESSION_URI})])
    assert drive(google).start_upload("a.pdf", "application/pdf", 123, "folder1") == SESSION_URI
    request = google.requests[1]
    assert request.method == "POST" and str(request.url).startswith(f"{UPLOAD}?uploadType=resumable")
    assert json.loads(request.content) == {"name": "a.pdf", "parents": ["folder1"]}
    assert request.headers["X-Upload-Content-Type"] == "application/pdf"
    assert request.headers["X-Upload-Content-Length"] == "123"


def test_start_upload_without_location_is_an_error():
    with pytest.raises(GoogleError):
        drive(Google([httpx.Response(200)])).start_upload("a.pdf", "application/pdf", 1, "f")


def test_upload_chunk_308_then_200():
    done = {"id": "d1", "name": "a.pdf", "mimeType": "application/pdf", "size": "6",
            "webViewLink": "https://drive.google.com/file/d/d1/view"}
    google = Google([httpx.Response(308), httpx.Response(200, json=done)])
    gdrive = drive(google)
    assert gdrive.upload_chunk(SESSION_URI, b"abc", 0, 6) is None
    result = gdrive.upload_chunk(SESSION_URI, b"def", 3, 6)
    assert result == DriveFile("d1", "a.pdf", "application/pdf", 6, "https://drive.google.com/file/d/d1/view")
    first, second = google.requests[-2:]
    assert first.method == "PUT" and str(first.url) == SESSION_URI
    assert first.headers["Content-Range"] == "bytes 0-2/6" and second.headers["Content-Range"] == "bytes 3-5/6"
    assert first.content == b"abc"


def test_upload_chunk_expired_session_is_not_found_and_hides_the_uri():
    with pytest.raises(GoogleNotFound) as caught:
        drive(Google([httpx.Response(404)])).upload_chunk(SESSION_URI, b"abc", 0, 3)
    assert "SECRET-SESSION" not in str(caught.value)


def test_trash_patches_trashed_true():
    google = Google([httpx.Response(200, json={})])
    drive(google).trash("d1")
    request = google.requests[1]
    assert (request.method, request.url.path) == ("PATCH", "/drive/v3/files/d1")
    assert json.loads(request.content) == {"trashed": True}


def test_folder_exists():
    google = Google([httpx.Response(200, json={"id": "f1", "trashed": False}),
                     httpx.Response(200, json={"id": "f1", "trashed": True}), httpx.Response(404)])
    gdrive = drive(google)
    assert [gdrive.folder_exists("f1") for _ in range(3)] == [True, False, False]


def test_granted_scopes_parses_the_scope_string():
    google = Google([httpx.Response(200, json={"scope": "a b"})])
    assert make_session(google).granted_scopes() == {"a", "b"}
    assert google.requests[-1].url.host == "oauth2.googleapis.com"
    assert google.requests[-1].url.params["access_token"] == "at1"


def test_errors_never_contain_secrets():
    google = Google([httpx.Response(500, json={"error": {"errors": [{"reason": "backendError"}]}})])
    with pytest.raises(GoogleError) as caught:
        drive(google).create_folder("x", None)
    text = str(caught.value)
    assert "1//refresh" not in text and "csecret" not in text and "at1" not in text
    assert "500" in text and "backendError" in text
