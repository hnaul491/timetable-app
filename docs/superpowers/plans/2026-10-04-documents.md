# Documents per subject — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload, list, open and delete course documents per subject/class, stored in the user's Google Drive folder `Timetable/<semester>/<subject>` (synced to the laptop by Google Drive for desktop).

**Architecture:** A shared Google HTTP session (token refresh + error mapping) used by the existing Calendar client and a new Drive client; backend-proxied chunked uploads into Drive resumable sessions; documents and in-progress uploads stored in two new tables; a Documents section on the subject page and in the class panel/page.

**Tech Stack:** FastAPI/SQLAlchemy/Alembic/httpx · React 19/TanStack Query/Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-04-documents-design.md`

## Global Constraints
- $0; no new dependencies; no network in tests (fake Drive / httpx.MockTransport / mocked apiFetch).
- Drive scope `drive.file` only; the refresh token never appears in responses, logs or errors; the Drive session URI never leaves the backend.
- Max file size 100 MB (104 857 600 bytes); chunk size 4 MiB (4 194 304 bytes).
- Every new table has RLS (test list: 16 tables). Migration `0006`.
- All UI text via `useT()` (en + vi; parity test), tokens only (guard test), confirm dialog for delete, toasts for results.
- Backend tests: `export PATH="$LOCALAPPDATA/Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"; cd backend && uv run python -m pytest -q`. Frontend: `cd frontend && npx vitest run && npm run build` (delete `tsconfig.tsbuildinfo`). CRLF files — prefer the Edit tool.
- Implementers Sonnet or stronger; commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **The subject folder was deleted in Drive by hand** → the next upload recreates it — Task 2 `deleted folder is recreated`.
2. **A chunk is sent twice or out of order** (flaky network retry) → 409 with the expected offset, no corruption — Task 2 `offset mismatch is rejected`.
3. **Google access lacks the Drive scope** (old connection) → clear "reconnect" message, nothing half-created — Task 2 `uploads need the drive scope`, Task 3 `shows reconnect when drive is off`.
4. **A 100 MB+ file** is refused before uploading — Task 2 `too large`, Task 3 `refuses files over 100 MB`.
5. **Deleting a document already removed in Drive** still removes it from the app — Task 2 `delete tolerates a file gone in Drive`.

---

### Task 1: Shared Google session + Drive client

**Files:** modify `backend/app/gcal/http_client.py` (extract the token/request/error logic into `GoogleSession`), create `backend/app/gdrive/__init__.py`, `backend/app/gdrive/api.py`, `backend/app/gdrive/http_client.py`, `backend/tests/gdrive_fakes.py`, `backend/tests/test_gdrive_http.py`.

**Interfaces (Produces):**
- `app/gcal/http_client.py`: `class GoogleSession(client_id, client_secret, refresh_token, http=None)` with `.request(method, url, *, json=None, content=None, headers=None, params=None, expect=(200,)) -> httpx.Response` (adds Bearer, refreshes once on 401, maps errors exactly like today: 401→GoogleAuthError, 403 scope/insufficientPermissions→GoogleAuthError, 404/410→GoogleNotFound, rate reasons/429→GoogleRateLimited, other ≥400→GoogleError(status, reason), transport/JSON errors→GoogleError fixed texts), `.granted_scopes() -> set[str]` (GET `https://oauth2.googleapis.com/tokeninfo?access_token=…`, parses `scope`), `.revoke()`, `.close()`. `HttpGoogleCalendar` keeps its public interface and behaviour, now built on `GoogleSession` (existing `test_gcal_http.py` must pass unchanged).
- `app/gdrive/api.py`: `DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"`, `FOLDER_MIME = "application/vnd.google-apps.folder"`, dataclass `DriveFile(id: str, name: str, mime_type: str, size: int, web_view_link: str)`, `Protocol GoogleDrive` with `create_folder(name, parent_id: str | None) -> str`, `folder_exists(folder_id) -> bool`, `start_upload(name, mime_type, size, parent_id) -> str` (session URI), `upload_chunk(session_uri, data: bytes, offset: int, total: int) -> DriveFile | None` (None while incomplete), `trash(file_id) -> None`; `DriveFactory = Callable[[str], GoogleDrive]`.
- `app/gdrive/http_client.py`: `HttpGoogleDrive(session: GoogleSession)` implementing it:
  - `create_folder`: POST `https://www.googleapis.com/drive/v3/files?fields=id` json `{name, mimeType: FOLDER_MIME, parents?: [parent_id]}`.
  - `folder_exists`: GET `.../files/{id}?fields=id,trashed` → `not trashed`; GoogleNotFound → False.
  - `start_upload`: POST `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink` json `{name, parents: [parent_id]}`, headers `X-Upload-Content-Type`, `X-Upload-Content-Length` → `Location` header (missing → GoogleError unexpected).
  - `upload_chunk`: PUT session URI (no Bearer needed but harmless — send without Authorization via a plain request through the same http client), headers `Content-Range: bytes {offset}-{offset+len-1}/{total}` → 308 → None; 200/201 → DriveFile from JSON (size as int); 404 → GoogleNotFound (session expired).
  - `trash`: PATCH `.../files/{id}` json `{trashed: true}`.
- `tests/gdrive_fakes.py`: `FakeDrive` (folders dict, files dict, sessions dict; `fail` queue like FakeCalendar; `upload_chunk` assembles bytes, validates offsets, returns DriveFile on completion with `web_view_link=f"https://drive.example/{id}"`).

- [ ] Tests (`test_gdrive_http.py`, MockTransport): create folder sends name/mime/parents and Bearer; start_upload returns Location and sends the X-Upload headers; upload_chunk sends Content-Range and returns None on 308 and DriveFile on 200; trash PATCHes `trashed: true`; folder_exists false on 404 and on `trashed: true`; granted_scopes parses `"a b"` → `{"a","b"}`; no secrets in error texts. Existing `test_gcal_http.py` unchanged and green.
- [ ] Implement, full suite green, commit `feat(backend): shared Google session and Drive client`.

### Task 2: Documents API, folders, chunked uploads (backend)

**Files:** modify `backend/app/models.py` (+`Document`, `DocumentUpload`, `Subject.drive_folder_id`, `Semester.drive_folder_id`, `GoogleAccount.scopes`), create `backend/migrations/versions/0006_documents.py` (RLS on both new tables), `backend/app/services/documents.py`, `backend/app/routers/documents.py`, `backend/tests/test_api_documents.py`; modify `backend/app/schemas.py`, `backend/app/deps.py` (`get_drive_factory`), `backend/app/routers/google.py` (record scopes on connect, `drive_enabled` in status), `backend/app/main.py`, `backend/tests/test_migrations.py`, `backend/tests/test_api_google.py`, `frontend/src/lib/google.ts` (scope string includes Drive — one-line change so the consent asks for both).

**Interfaces (Produces):** HTTP as in the spec. Schemas: `DocumentOut{id, subject_id, event_id, event_start: str|None, name, mime_type, size, tag, web_view_link, created_at}`, `UploadStartIn{subject_id, event_id: int|None, tag: Literal["slides","exercises","other"], name (1–255), mime_type (1–255), size (1–104857600)}`, `UploadStartOut{upload_id, chunk_size}`, `UploadChunkOut{received: int, document: DocumentOut|None}`, `DocumentPatch{tag?, event_id?}`; `GoogleStatusOut.drive_enabled`.
Rules: uploads need a connected account with `DRIVE_SCOPE` in `scopes` (else 409 detail `"Reconnect Google to enable documents"`); `event_id` must belong to the subject; folders created lazily (`Timetable` root in `app_setting["drive_root_folder"]`, then semester code, then subject display name); if `start_upload` raises GoogleNotFound (folder gone) clear the stored folder ids along the path and retry once; chunk PUT requires `offset == received` (409 `"expected offset {received}"`), body length ≤ chunk size and ≤ remaining; on completion create the Document (drive_file_id unique) and delete the upload row; stale uploads (> 1 day) deleted at upload start; Google errors map to 502 with the safe Google message, GoogleAuthError to 409 with its message; delete → `trash` (GoogleNotFound ignored) → delete row.
On connect (`routers/google.py`): after the calendar step, store `" ".join(sorted(session.granted_scopes()))` in `account.scopes` (errors there are ignored, scopes left empty).

- [ ] Tests (`test_api_documents.py`, override `get_drive_factory` with FakeDrive and configure Google like `test_api_google.py`): full upload in two chunks creates the folder chain once and returns the document; second upload reuses folders; `deleted folder is recreated`; `offset mismatch is rejected`; `too large` (422 on size > limit); `uploads need the drive scope` (no scopes → 409, no folder created); event of another subject → 422; list by subject (grouping fields) and by event; patch tag/event; `delete tolerates a file gone in Drive`; 401 without login. `test_api_google.py`: connect records scopes from a fake `granted_scopes`, status shows `drive_enabled`.
- [ ] Implement, full suite green, commit `feat(api): documents per subject stored in Google Drive`.

### Task 3: Documents UI (frontend)

**Files:** create `frontend/src/lib/upload.ts` (+test), `frontend/src/components/DocumentsSection.tsx`, `frontend/src/components/UploadDialog.tsx`, tests `frontend/src/components/DocumentsSection.test.tsx`, `frontend/src/i18n/{en,vi}/documents.ts` (register in both index files); modify `frontend/src/types.ts` (`DocumentItem`, `GoogleStatus.drive_enabled`), `frontend/src/pages/SubjectPage.tsx` (render the section), `frontend/src/components/EventPanel.tsx` and `frontend/src/pages/EventPage.tsx` (class documents list + upload prefilled).

**Interfaces:**
- `uploadFile(file: File, meta: { subjectId: number; eventId: number | null; tag: Tag }, onProgress: (sent: number, total: number) => void): Promise<DocumentItem>` — POST start via `apiFetch`, then sequential `fetch` PUT chunks (`file.slice`) to `/api/documents/uploads/{id}?offset=N` with the Supabase bearer header (reuse the token logic from `lib/api.ts` — export a small `authHeaders()` there) and `Content-Type: application/octet-stream`; on a 409 with an expected offset, resume from it once; errors throw `ApiError` (translated message).
- `DocumentsSection({ subjectId, eventId? })` — when `eventId` is given shows only that class's documents (compact list) and the upload button presets the class.
- Behaviour/visuals as in the approved mockup: grouping by class (date via locale), filter chips, type badge (PDF/PPT/DOC/XLS/IMG/ZIP/FILE from mime/extension), size formatting (KB/MB, locale number format), Open (`web_view_link`, new tab, `rel="noopener"`), Delete with `useConfirm` + toast; Upload dialog: multiple files, class select (this subject's sessions from the existing subject detail data or `GET /api/subjects/{id}`), tag select, per-file progress bars, refuse > 100 MB with an inline message, toasts; invalidates `["documents", …]` queries.
- When `GET /api/google` says not connected or `drive_enabled: false`: explanation + link to Settings (no upload button).

- [ ] Tests: `upload.ts` chunks a 9 MiB fake file into 3 PUTs with correct offsets and reports progress; resumes after a 409 offset; DocumentsSection lists grouped documents and filters by tag; delete asks for confirmation (cancel → no request); upload dialog refuses files over 100 MB; `shows reconnect when drive is off`; Vietnamese render via `translate("vi", …)`.
- [ ] Implement, `npx vitest run && npm run build`, commit `feat(frontend): documents per subject with uploads to Google Drive`.

### Task 4: Ship
- [ ] Full verification; migrate production to 0006 (pg8000), 16 tables RLS; push main; deploy (retry once on "Not authorized"); smoke.
- [ ] User steps (report): Google Cloud → enable **Google Drive API**; Data access → add scope `https://www.googleapis.com/auth/drive.file`; in the app Settings → Google → Reconnect.
