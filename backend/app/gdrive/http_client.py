from typing import Any
from urllib.parse import quote

import httpx

from app.gcal.api import GoogleError, GoogleNotFound
from app.gcal.http_client import UNEXPECTED, GoogleSession, _json
from app.gdrive.api import FOLDER_MIME, DriveFile

FILES = "https://www.googleapis.com/drive/v3/files"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
SERVICE = "Google Drive"
FILE_FIELDS = "id,name,mimeType,size,webViewLink"


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

    def upload_chunk(self, session_uri: str, data: bytes, offset: int, total: int) -> DriveFile | None:
        # The session URI is its own credential: no Bearer token is sent to it.
        response = self._call(
            "PUT", session_uri, content=data, bearer=False, expect=(308,),
            headers={"Content-Range": f"bytes {offset}-{offset + len(data) - 1}/{total}"})
        if response.status_code == 308:
            return None
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
                         web_view_link=link if isinstance(link, str) else "")

    def trash(self, file_id: str) -> None:
        self._call("PATCH", _file_url(file_id), json={"trashed": True})
