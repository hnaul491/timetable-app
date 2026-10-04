from app.gcal.api import GoogleNotFound
from app.gdrive.api import DriveFile


class FakeDrive:
    """In-memory Google Drive. `fail` maps a method name to a queue of exceptions (None = succeed)."""

    def __init__(self, fail: dict[str, list[Exception | None]] | None = None) -> None:
        self.folders: dict[str, tuple[str, str | None]] = {}  # id -> (name, parent id)
        self.files: dict[str, DriveFile] = {}
        self.contents: dict[str, bytes] = {}
        self.trashed: set[str] = set()
        self.trashed_folders: set[str] = set()
        self.keep_limit: int | None = None  # when set, Drive keeps at most this many bytes per chunk call
        self.sessions: dict[str, dict] = {}
        self.parents: dict[str, str] = {}  # file id -> parent folder id
        self.calls: list[tuple[str, str]] = []
        self._fail = {name: list(queue) for name, queue in (fail or {}).items()}
        self._folders = 0
        self._files = 0

    def _check(self, method: str) -> None:
        queue = self._fail.get(method)
        if queue:
            error = queue.pop(0)
            if error is not None:
                raise error

    def create_folder(self, name: str, parent_id: str | None) -> str:
        self._check("create_folder")
        self._folders += 1
        folder_id = f"folder{self._folders}"
        self.folders[folder_id] = (name, parent_id)
        self.calls.append(("create_folder", folder_id))
        return folder_id

    def folder_exists(self, folder_id: str) -> bool:
        self._check("folder_exists")
        return folder_id in self.folders and folder_id not in self.trashed_folders

    def start_upload(self, name: str, mime_type: str, size: int, parent_id: str) -> str:
        self._check("start_upload")
        if parent_id not in self.folders:
            raise GoogleNotFound("Google Drive returned 404")
        uri = f"https://upload.example/session{len(self.sessions) + 1}"
        self.sessions[uri] = {"name": name, "mime_type": mime_type, "size": size, "parent": parent_id,
                              "data": b""}
        self.calls.append(("start_upload", uri))
        return uri

    def upload_chunk(self, session_uri: str, data: bytes, offset: int, total: int) -> tuple[DriveFile | None, int]:
        self._check("upload_chunk")
        state = self.sessions.get(session_uri)
        if state is None:
            raise GoogleNotFound("Google Drive returned 404")
        assert offset == len(state["data"]), f"bad offset {offset}"
        assert total == state["size"]
        if self.keep_limit is not None and len(data) < total - offset:
            data = data[:self.keep_limit]
        state["data"] += data
        self.calls.append(("upload_chunk", session_uri))
        if len(state["data"]) < total:
            return None, len(state["data"])
        self._files += 1
        file_id = f"file{self._files}"
        done = DriveFile(id=file_id, name=state["name"], mime_type=state["mime_type"], size=total,
                         web_view_link=f"https://drive.example/{file_id}")
        self.files[file_id] = done
        self.contents[file_id] = state["data"]
        self.parents[file_id] = state["parent"]
        return done, total

    def upload_file(self, name: str, mime_type: str, data: bytes, parent_id: str) -> DriveFile:
        self._check("upload_file")
        if parent_id not in self.folders:
            raise GoogleNotFound("Google Drive returned 404")
        self._files += 1
        file_id = f"file{self._files}"
        done = DriveFile(id=file_id, name=name, mime_type=mime_type, size=len(data),
                         web_view_link=f"https://drive.example/{file_id}")
        self.files[file_id], self.contents[file_id], self.parents[file_id] = done, data, parent_id
        self.calls.append(("upload_file", file_id))
        return done

    def list_files(self, parent_id: str) -> list[DriveFile]:
        self._check("list_files")
        return [f for fid, f in self.files.items() if self.parents.get(fid) == parent_id and fid not in self.trashed]

    def rename(self, file_id: str, name: str) -> None:
        self._check("rename")
        if file_id not in self.folders and file_id not in self.files:
            raise GoogleNotFound("Google Drive returned 404")
        if file_id in self.folders:
            self.folders[file_id] = (name, self.folders[file_id][1])
        self.calls.append(("rename", file_id))

    def move(self, file_id: str, add_parent: str, remove_parent: str) -> None:
        self._check("move")
        if file_id not in self.files:
            raise GoogleNotFound("Google Drive returned 404")
        assert self.parents[file_id] == remove_parent, "moved from the wrong folder"
        self.parents[file_id] = add_parent
        self.calls.append(("move", file_id))

    def trash(self, file_id: str) -> None:
        self._check("trash")
        if file_id not in self.files:
            raise GoogleNotFound("Google Drive returned 404")
        self.trashed.add(file_id)
        self.calls.append(("trash", file_id))
