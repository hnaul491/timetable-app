# Documents per subject — Design

**Status:** idea and mockup approved by the user (https://claude.ai/artifact/S5D9HES8gXSPxqtetBaTHd, "The documents upload propose looks good to me"); option A access; user asked to proceed without further approvals (2026-10-04). Backlog: `docs/superpowers/plans/2026-10-03-documents-backlog.md`.

## Goal
Keep course documents (slides, exercise sheets, past exams, photos) with each subject — and optionally a specific class — stored in the user's own Google Drive folder `Timetable / <semester code> / <subject name>`, which Google Drive for desktop mirrors on the laptop.

## Decisions
- **Storage:** the user's Google Drive, scope `https://www.googleapis.com/auth/drive.file` (the app sees only files it created). One Google connection carries both scopes (`calendar.app.created drive.file`); the connect flow asks for both. Existing connections without Drive see "Reconnect Google to enable documents".
- **Granted scopes are recorded** at connect (`google_account.scopes`, from Google's tokeninfo) so the UI knows whether documents are available.
- **Uploads go through the backend in chunks** (4 MiB, a multiple of 256 KiB, under Vercel's 4.5 MB body limit) into a Drive resumable upload session created by the backend. This avoids browser CORS uncertainty and keeps the Drive session URI server-side. Max 100 MB per file (checked in the browser and the API).
- **Folders:** the app creates `Timetable` (id kept in `app_setting["drive_root_folder"]`), one folder per semester (`semester.drive_folder_id`) and one per subject (`subject.drive_folder_id`), lazily on first upload; a folder deleted in Drive by hand is recreated (404 on upload → clear the id and retry once).
- **Records:** table `document` (id, subject_id, event_id nullable, drive_file_id unique, name, mime_type, size, tag `slides|exercises|other`, web_view_link, created_at); table `document_upload` (id uuid, session_uri, subject_id, event_id, tag, name, mime_type, size, received, created_at) for in-progress uploads (stale ones older than 1 day are deleted on the next upload).
- **Delete** in the app trashes the Drive file (recoverable in Drive's bin) after a confirm dialog. Renaming/merging subjects does not move Drive folders in this version (follow-up).
- **Open** uses Drive's `webViewLink` in a new tab.

## API (all `require_user`)
- `GET /api/subjects/{id}/documents` → list (newest first) with `event_start` for grouping.
- `GET /api/events/{id}/documents` → list for one class.
- `POST /api/documents/uploads {subject_id, event_id?, tag, name, mime_type, size}` → `{upload_id, chunk_size}`; 409 `{detail: "google-reconnect"}`-style message when Drive is not connected/allowed; 413 over 100 MB.
- `PUT /api/documents/uploads/{upload_id}?offset=N` (raw body = chunk) → `{received}` or, on the last chunk, `{document}`; offset must equal the received count (409 otherwise).
- `PATCH /api/documents/{id} {tag?, event_id?}`; `DELETE /api/documents/{id}` (trash in Drive, 404/410 in Drive still deletes the row).
- `GET /api/google` gains `drive_enabled: bool`.

## UI
- Subject page: **Documents** section (as in the mockup): grouped by class (newest class first, then "Not linked to a class"), filter chips All/Slides/Exercises & exams/Other, rows with type badge, name, size + tag, Open, Delete (confirm). **Upload** opens a dialog: choose files (multiple), attach to a class of this subject (or none), tag; per-file progress bars; toasts on success/failure (retry).
- Event details panel and event page: "Documents for this class" list + "+ Upload" (dialog prefilled with that class).
- When Drive is not enabled: the section shows an explanation and a button to Settings (reconnect).
- English + Vietnamese texts; tokens only.

## Testing
Backend with a fake Drive (no network): folder creation/reuse/recreate, chunked upload happy path and offset mismatch, size limit, trash on delete, scope check. Frontend with mocked API: upload flow chunks a file and shows progress, filters, delete confirm, disabled state without Drive.
