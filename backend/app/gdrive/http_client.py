import json
import re
import uuid
from typing import Any
from urllib.parse import quote

import httpx

from app.gcal.api import GoogleAuthError, GoogleError, GoogleNotFound, GoogleRateLimited
from app.gcal.http_client import UNEXPECTED, GoogleSession, _json
from app.gdrive.api import FOLDER_MIME, DriveFile

FILES = "https://www.googleapis.com/drive/v3/files"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
SERVICE = "Google Drive"
FILE_FIELDS = "id,name,mimeType,size,webViewLink"
UPLOAD_TIMEOUT = httpx.Timeout(5.0, read=40.0)  # Drive can be slow to answer the last chunk
SMALL_UPLOAD_TIMEOUT = httpx.Timeout(5.0, read=10.0)  # a backup is small: fail fast inside the cron budget
_RANGE = re.compile(r"^bytes=0-(\d+)$")


def _drive_file(body: dict[str, Any]) -> DriveFile | None:
    file_id, name, link = body.get("id"), body.get("name"), body.get("webViewLink")
    if not isinstance(file_id, str) or not isinstance(name, str):
        return None
    try:
        size = int(body.get("size", 0))
    except (TypeError, ValueError):
        return None
    return DriveFile(id=file_id, name=name, mime_type=str(body.get("mimeType", "")), size=size,
                     web_view_link=link if isinstance(link, str) else "")


def _file_url(file_id: str) -> str:
    return f"{FILES}/{quote(file_id, safe='')}"


class HttpGoogleDrive:
    def __init__(self, session: GoogleSession) -> None:
        self._session = session

    def close(self) -> None:
        self._session.close()

    def _call(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        return self._session.request(method, url, service=SERVICE, **kwargs)

    def create_folder(self, name: str, parent_id: str | None) -> str:
        body: dict[str, Any] = {"name": name, "mimeType": FOLDER_MIME}
        if parent_id is not None:
            body["parents"] = [parent_id]
        value = _json(self._call("POST", f"{FILES}?fields=id", json=body)).get("id")
        if not isinstance(value, str) or not value:
            raise GoogleError(UNEXPECTED)
        return value

    def folder_exists(self, folder_id: str) -> bool:
        try:
            response = self._call("GET", _file_url(folder_id), params={"fields": "id,trashed"})
        except GoogleNotFound:
            return False
        return not _json(response).get("trashed", False)

    def start_upload(self, name: str, mime_type: str, size: int, parent_id: str) -> str:
        response = self._call(
            "POST", UPLOAD, params={"uploadType": "resumable", "fields": FILE_FIELDS},
            json={"name": name, "parents": [parent_id]},
            headers={"X-Upload-Content-Type": mime_type, "X-Upload-Content-Length": str(size)})
        location = response.headers.get("Location")
        if not location:
            raise GoogleError(UNEXPECTED)
        return location

    def upload_chunk(self, session_uri: str, data: bytes, offset: int, total: int) -> tuple[DriveFile | None, int]:
        if data:
            content_range = f"bytes {offset}-{offset + len(data) - 1}/{total}"
        else:
            content_range = f"bytes */{total}"  # a zero-byte file is finished by an empty range
        try:
            return self._put(session_uri, data, content_range, total)
        except (GoogleAuthError, GoogleNotFound, GoogleRateLimited):
            raise
        except GoogleError:  # timeout, network error or 5xx: ask Drive what it actually received
            return self._put(session_uri, b"", f"bytes */{total}", total)

    def _put(self, session_uri: str, data: bytes, content_range: str, total: int) -> tuple[DriveFile | None, int]:
        # The session URI is its own credential: no Bearer token is sent to it.
        response = self._call("PUT", session_uri, content=data, bearer=False, expect=(308,),
                              headers={"Content-Range": content_range}, timeout=UPLOAD_TIMEOUT)
        if response.status_code == 308:
            match = _RANGE.match(response.headers.get("Range", ""))
            return None, int(match.group(1)) + 1 if match else 0
        body = _json(response)
        file_id, name = body.get("id"), body.get("name")
        link = body.get("webViewLink")
        if not isinstance(file_id, str) or not isinstance(name, str):
            raise GoogleError(UNEXPECTED)
        try:
            size = int(body.get("size", total))
        except (TypeError, ValueError):
            raise GoogleError(UNEXPECTED) from None
        return DriveFile(id=file_id, name=name, mime_type=str(body.get("mimeType", "")), size=size,
                         web_view_link=link if isinstance(link, str) else ""), total

    def upload_file(self, name: str, mime_type: str, data: bytes, parent_id: str) -> DriveFile:
        boundary = f"tt{uuid.uuid4().hex}"
        meta = json.dumps({"name": name, "parents": [parent_id]})
        body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n"
                f"--{boundary}\r\nContent-Type: {mime_type}\r\n\r\n").encode() + data + f"\r\n--{boundary}--".encode()
        response = self._call("POST", UPLOAD, params={"uploadType": "multipart", "fields": FILE_FIELDS},
                              content=body, headers={"Content-Type": f"multipart/related; boundary={boundary}"},
                              timeout=SMALL_UPLOAD_TIMEOUT)
        file = _drive_file(_json(response))
        if file is None:
            raise GoogleError(UNEXPECTED)
        return file

    def list_files(self, parent_id: str) -> list[DriveFile]:
        found: list[DriveFile] = []
        page_token: str | None = None
        for _ in range(10):  # a folder of backups never holds more than a few hundred files
            params = {"q": f"'{parent_id}' in parents and trashed = false and mimeType != '{FOLDER_MIME}'",
                      "fields": f"nextPageToken,files({FILE_FIELDS})", "pageSize": "100"}
            if page_token:
                params["pageToken"] = page_token
            body = _json(self._call("GET", FILES, params=params))
            for item in body.get("files", []):
                file = _drive_file(item) if isinstance(item, dict) else None
                if file is not None:
                    found.append(file)
            page_token = body.get("nextPageToken")
            if not isinstance(page_token, str) or not page_token:
                break
        return found

    def trash(self, file_id: str) -> None:
        self._call("PATCH", _file_url(file_id), json={"trashed": True})

    def rename(self, file_id: str, name: str) -> None:
        self._call("PATCH", _file_url(file_id), json={"name": name})

    def move(self, file_id: str, add_parent: str, remove_parent: str) -> None:
        self._call("PATCH", _file_url(file_id), params={"addParents": add_parent, "removeParents": remove_parent},
                   json={})
