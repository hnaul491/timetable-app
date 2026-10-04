from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"
FOLDER_MIME = "application/vnd.google-apps.folder"


@dataclass(frozen=True)
class DriveFile:
    id: str
    name: str
    mime_type: str
    size: int
    web_view_link: str


class GoogleDrive(Protocol):
    def create_folder(self, name: str, parent_id: str | None) -> str: ...

    def folder_exists(self, folder_id: str) -> bool: ...

    def start_upload(self, name: str, mime_type: str, size: int, parent_id: str) -> str:
        """Open a resumable upload and return its session URI (never shown to the browser)."""
        ...

    def upload_chunk(self, session_uri: str, data: bytes, offset: int, total: int) -> tuple[DriveFile | None, int]:
        """Send one chunk; (file, total) when finished, else (None, bytes Drive kept so far)."""
        ...

    def trash(self, file_id: str) -> None: ...

    def rename(self, file_id: str, name: str) -> None: ...

    def move(self, file_id: str, add_parent: str, remove_parent: str) -> None: ...


DriveFactory = Callable[[str], GoogleDrive]
"""Builds a client from a refresh token."""
