# Documents per subject (approved idea, 2026-10-03)

Mockup the user approved: https://claude.ai/artifact/S5D9HES8gXSPxqtetBaTHd (subject page Documents section with upload modal, class popup with its documents, how-it-works diagram, laptop folder).

**Order:** after the UX plan (reuses its modal, confirm dialog, toasts, translations, dark mode tokens), before Plan 4 (AI can later read these documents).

## Decisions
- **Storage = the user's Google Drive** ($0; 15 GB+). Folder `My Drive / Timetable / <semester code> / <subject display name>`, created by the app.
- **Laptop sync = Google Drive for desktop** (official app, two-way, offline). No sync code of our own.
- **Access = option A, scope `https://www.googleapis.com/auth/drive.file`**: the app sees only files it created/uploaded. Files added from the laptop stay in Drive but are not listed in the app (option B = full `drive` scope, possible later).
- **One Google connection** shared with Calendar push: the connect flow requests both scopes; existing Calendar-only connections are asked to reconnect once.
- **Uploads go browser → Google directly** (resumable upload) using a short-lived access token minted by the backend, avoiding Vercel's ~4.5 MB request limit. The backend records the file id afterwards.

## Shape
- Table `document`: id, subject_id, event_id (nullable, "attached to a class"), drive_file_id, name, mime_type, size, tag (`slides` / `exercises` / `other`), created_at. Deleting in the app trashes the Drive file (with confirm dialog).
- Subject page: Documents section grouped by class, filter chips, Upload modal (choose files, attach to a class, tag), progress per file, Open (Drive web view link).
- Class popup / event page: "Documents for this class" with "+ Upload".
- Renaming/merging a subject renames/moves its Drive folder; a folder deleted in Drive by hand is recreated on next upload.
- Tests: Drive client faked (like `FakeCalendar`), no network in CI.
