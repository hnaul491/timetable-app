# Timetable App — Design Spec

- **Date:** 2026-10-03
- **Status:** Draft for review
- **UI proposal (canvas, 8 screens):** https://claude.ai/artifact/FrMfhBtKZezMzRmjT41AnR

## 1. Goal

A personal, single-user web app that replaces the messy school timetable (EPITA Zeus) with a clean view of **my** classes, plus my own events (work shifts, external French class), with notes per class, a task board built from those notes, a per-subject view, a weekend review, Google Calendar push, and an AI assistant.

**Success looks like:** on any weekend (or any time) I open the app and see my week plus every open task and important notice in one place, without pasting tokens or fixing data by hand.

### Context

- Program: SE, three semesters — S1 `SE S1` (Fundamental, Zeus group 802, 12 Oct 2026 – 30 Jan 2027), S2 `SE S2` (Common Core), S3 `SE S3` (Specialization). S2/S3 Zeus group IDs are not known yet.
- Budget: **$0**. Everything runs on free tiers.
- Single user. I am the only person who logs in.

## 2. Scope

### In v1

1. Automatic daily import of the school timetable from the Zeus ICS subscription link.
2. Section filtering ("my sections") and subject normalization.
3. Week view and day view (desktop + phone layout, installable PWA).
4. Custom events: one-off and weekly recurring (work shifts, external French class).
5. Notes per event ("After class" and "Before next class"), with an Important flag.
6. Tasks from checkbox lines in notes, plus manually added tasks; Kanban board (To do / Doing / Done).
7. "Suggest tasks" from a note via AI (suggestions must be accepted).
8. Subjects page per semester: sessions, notes, tasks, exam date.
9. Weekend review page.
10. One-way push to a dedicated Google Calendar ("My Timetable").
11. AI assistant chat: questions about my data, actions with confirmation, study help/quiz, weekly planning.
12. Settings: semesters, Zeus link, my sections, subject aliases, recurring events, Google, AI provider.

### Not in v1

- Enriching events with teacher / course type via the Zeus JSON API (needs a 24 h JWT). Possible later.
- Web push / email notifications (reminders come from Google Calendar).
- Two-way Google sync or importing other Google calendars.
- Offline mode.
- Multiple users.

## 3. Architecture

```
GitHub Actions cron (daily 06:00 Europe/Paris) ──► POST /api/sync (secret header)
                                                        │
┌─ Vercel (Hobby, free) ───────────────────────────────┼──────────────────┐
│  React + Vite + TS (SPA, PWA)  ◄──JSON──►  FastAPI (Python serverless)  │
└───────────────────────────────────────────────────────┼──────────────────┘
        │ Google login (Supabase Auth)                  ├─► Zeus ICS link (whole semester, 1 request)
        ▼                                               ├─► Google Calendar API (push)
   Supabase Postgres (free)  ◄──────────────────────────┤
                                                        └─► LLM provider (Gemini free tier)
```

| Layer | Choice |
|---|---|
| Frontend | React, Vite, TypeScript, TanStack Query, Tailwind, dnd-kit (board), TipTap (note editor with task lists). Custom week grid. |
| Backend | FastAPI on Vercel Python serverless functions |
| DB / Auth | Supabase Postgres + Supabase Auth (Google provider) |
| Scheduler | GitHub Actions cron calling `/api/sync` |
| AI | `LLMProvider` interface; first implementation Google Gemini (AI Studio API key, free tier) |

### Backend modules

Each module has one job and a small interface.

| Module | Responsibility |
|---|---|
| `zeus_sync` | Fetch ICS, parse, normalize, diff against DB, record `sync_run` |
| `subjects` | Split event title into subject + section; apply aliases; classify kind |
| `events` | School + custom events; week/day queries with section filtering; recurrence expansion |
| `notes` | CRUD notes per event; extract checkbox lines into tasks |
| `tasks` | Board columns, status, due date, ordering |
| `gcal_push` | One-way push of dirty events to the "My Timetable" calendar |
| `llm` | `LLMProvider` interface + Gemini implementation |
| `ai_suggest` | "Suggest tasks" for one note |
| `assistant` | Chat endpoint, function definitions, pending actions |
| `auth` | Verify Supabase JWT + email allowlist on every request |

## 4. School timetable source (Zeus)

Findings from exploring Zeus on 2026-10-03:

- The JSON endpoint `GET /api/reservation/filter/displayable?groups=802&startDate=…&endDate=…` needs a Bearer JWT that **expires after 24 h**, and rejects long date ranges (`"Dates interval is not valid"`).
- Zeus has a **personal ICS subscription link**: `GET https://zeus.ionis-it.com/api/group/{groupId}/ics/{personalKey}`. The 10-character personal key comes from `POST /api/User/UserProfile` (what the "Generate link" button in Zeus does).
  - Works **without** a Bearer token.
  - Returns the **whole semester in one response** (346 events for group 802, 12 Oct 2026 → 26 Jan 2027).
  - Event `UID`s are **stable** across requests.
  - Fields: `SUMMARY`, `DTSTART`, `DTEND` (UTC), `LOCATION`, `DESCRIPTION` (usually empty). No teacher, no course type, no online flag.
- **Decision:** the ICS link is the only school source in v1.
- **Open check:** the personal key was created 2026-10-03. Re-test the link after the JWT expires (2026-10-04) to confirm the key outlives the session. If it does not, fall back to a "paste token" flow (out of scope until needed).

The full ICS URL is a secret (anyone holding it can read the timetable). It is stored server-side only.

## 5. Data model

All timestamps stored in UTC; displayed in `Europe/Paris`.

| Table | Key fields |
|---|---|
| `semester` | id, code (`S1`/`S2`/`S3`), name, zeus_group_id (nullable), start_date, end_date, is_active |
| `subject` | id, semester_id, display_name, color, aliases (text[]), hidden (bool) |
| `my_section` | subject_id, section (e.g. `G1`, `GR5`) |
| `event` | id, source (`zeus`/`custom`), zeus_uid (unique, nullable), semester_id, subject_id (nullable), section (nullable), title_raw, start_at, end_at, room, description, kind (`class`/`exam`/`holiday`/`work`/`french_ext`/`other`), status (`normal`/`changed`/`cancelled`), changed_at, recurring_rule_id (nullable), gcal_event_id, gcal_dirty (bool) |
| `recurring_rule` | id, title, kind, weekdays (int[]), start_time, end_time, from_date, until_date, location, notes_enabled (bool) |
| `note` | id, event_id, tab (`after`/`before`), body (TipTap JSON), important (bool), updated_at |
| `task` | id, note_id (nullable), subject_id (nullable), title, status (`todo`/`doing`/`done`), due_date (nullable), important (bool), position, source (`note`/`manual`/`ai`), created_at |
| `pending_action` | id, kind (`task`/`event`/`note`/`study_block`), payload (jsonb), created_at, expires_at, status (`pending`/`confirmed`/`dismissed`) |
| `chat_message` | id, role, content, created_at (keep last 50) |
| `sync_run` | id, started_at, finished_at, status, fetched, inserted, updated, cancelled, error |
| `google_account` | id, email, refresh_token_encrypted, calendar_id |

Custom recurring events are expanded into concrete `event` rows for the active semester (so notes can attach to a specific occurrence). Editing the rule regenerates future occurrences that have no notes.

## 6. Subject normalization rules

Derived from the real S1 feed:

- Title `^(G\d+|GR\d+) - (.+)$` → section = group 1, subject = group 2. Otherwise no section.
- Events with a section are shown only if it matches `my_section` for that subject. Events without a section are always shown (unless the subject is hidden).
- Default aliases for S1 (editable in Settings):
  - `French for Spring F26 T1` → `French for Fall 26 T1`
  - `Data Privacy By Design` → `Data Privacy by Design`
  - `Relational Databases Exam` → subject `Relational Databases`, kind `exam`
- `Vacances`, `Bank Holiday` → kind `holiday`, shown as all-day markers.
- `Tutorat & French for Fall 26 T1` (no section, combined session for everyone) → alias to subject `French for Fall 26 T1`, always shown.
- Titles are trimmed (e.g. `Interpersonnal Communication ` has a trailing space).
- If a section's subject has no `my_section` yet, the app prompts once ("Which group are you in for French for Fall 26 T1?").

S1 subjects (12): Algorithms & Data Structures; Relational Databases; Introduction to Python; Data Privacy by Design; Engineering Tools (Terminal · Git · CI · Docker); Harmonization; GenAI 101; Adapting to a New Culture; French for Fall 26 T1; Tutorat Fall 26 T1; Interpersonal Communication; Sustainable & Responsible IT.

## 7. Screens

See the canvas for visuals. Summary:

1. **Week view** — Mon–Sun grid 08:00–21:00, events colored by subject, custom work events in slate, external French with dashed outline, badges (notes/tasks, Important, Changed). Filter chips (School / Work / French ext). Week ↔ Day toggle, prev/next/today, Add event. Side rail: due this week, important notices, link to weekend review.
2. **Class notes** — event header (subject, time, room, session n of N, next class link); tabs "After class" / "Before next class"; TipTap editor with Task and Important tools; checkbox lines become board tasks (two-way: ticking in either place updates both); "Suggest tasks" shows AI suggestions with Add / Dismiss.
3. **Task board** — To do / Doing / Done; cards show subject, due date, source link to the class; filter by subject and due; drag between columns.
4. **Weekend review** — overdue; due next week; important notices; last week's classes without notes (with "Add note"); school timetable changes since last review; next week at a glance with hour totals; "Mark week as reviewed".
5. **Subjects** — list for the active semester with session counts and open tasks; detail with progress, exam date, sessions timeline with notes, tasks, important items.
6. **Settings** — semesters (S1/S2/S3 + Zeus group IDs), Zeus ICS link (write-only field) and sync status/"Sync now", my sections, subject aliases, recurring events, Google Calendar connection and push scope, AI provider and key.
7. **AI assistant** — chat page (and panel on other screens) with context chip, suggested prompts, confirm cards for actions, quiz cards.
8. **Phone day view** — day strip, agenda with free gaps, due today, quick-note button, bottom tabs.

Semester switcher in the sidebar changes the active semester for all screens.

## 8. Google Calendar push

- OAuth via Supabase Google login with the `calendar.events` scope plus offline access; refresh token stored encrypted.
- App creates (once) a calendar named "My Timetable" and only ever writes to it.
- Pushed: my filtered school classes, exams, holidays (all-day), work shifts, external French — each toggleable in Settings.
- Event description includes a link back to the class page in the app. Notes content is **not** pushed.
- Only `gcal_dirty` events are pushed; cancelled events are deleted from Google; work is batched and resumable.

## 9. AI

### Provider

`LLMProvider` interface (`chat(messages, tools) -> stream`, `complete(prompt) -> text`). First implementation: Gemini via Google AI Studio API key (free tier). Provider and key set in Settings / env. AI can be turned off entirely.

### Suggest tasks (note screen)

Sends one note's text + class context; returns up to 5 `{title, due_date?}` suggestions. Nothing is saved until the user clicks Add.

### Assistant (chat)

- `POST /api/chat`: user message + current screen context → streamed reply.
- **Read functions** (executed directly): `get_events(from, to, kind?)`, `get_tasks(status?, due_before?, subject?)`, `get_notes(subject?, from?, to?, search?)`, `get_subjects()`, `find_free_slots(from, to, min_minutes)`.
- **Propose functions** (never write): `propose_task`, `propose_event`, `propose_note`, `propose_study_blocks`. Each creates a `pending_action` and the UI renders a confirm card.
- **Writes happen only** through `POST /api/actions/{id}/confirm`, called by the user's click. Enforced server-side.
- Quiz: model reads notes via `get_notes` and generates questions on the fly; not stored.
- Max ~5 function calls per user message.
- Text from Zeus (descriptions) and notes is passed as data, never as instructions.
- Privacy notice in the UI: messages and notes the assistant reads are sent to Google; on the free tier Google may use them to improve its products.

## 10. Sync flow

1. Cron (or "Sync now") → `POST /api/sync` with `X-Cron-Secret`.
2. Fetch active semester's ICS (timeout 8 s).
3. Parse with `icalendar`; normalize via `subjects`.
4. Diff by `zeus_uid`:
   - new → insert, `gcal_dirty = true`
   - start/end/room/title changed → update, `status = changed`, `changed_at = now`, `gcal_dirty = true`
   - missing from feed and `start_at > now` → `status = cancelled`, `gcal_dirty = true`
   - past events never modified
5. Commit, write `sync_run`.
6. Push dirty events to Google in batches within the request time budget; leftovers go next run.
7. Changing `my_section` or aliases marks affected events `gcal_dirty`.

Idempotent: same feed twice → no changes.

## 11. Error handling

| Failure | Behavior |
|---|---|
| Zeus unreachable / timeout / parse error | Keep last data; `sync_run.status = failed`; banner "School sync failed since …" |
| Zeus returns 401/403 on ICS link | Banner: "Generate a new link in Zeus and paste it in Settings" |
| Google token revoked | Banner "Reconnect Google"; local app unaffected |
| Google API error on one event | Leave `gcal_dirty`, retry next run |
| LLM rate limit (429) / error | "AI limit reached, try again later"; rest of app unaffected |
| Request time limit near | Stop batch work early, resume next run |

## 12. Security

- Supabase Auth with Google; backend verifies the JWT on every request **and** checks the email against an allowlist (only my account).
- Secrets in Vercel env vars: `ZEUS_ICS_KEY`, `GEMINI_API_KEY`, `CRON_SECRET`, `TOKEN_ENCRYPTION_KEY`, Supabase keys. Google refresh token encrypted at rest (Fernet).
- Settings shows secrets as write-only fields; the API never returns them.
- GitHub repository private. No secrets or real ICS key in git; test fixtures use the ICS body only.

## 13. Testing

- **Backend (pytest):** subject/section parser against real feed titles; ICS diff (insert/changed/cancelled/past untouched/idempotent); note checkbox → task extraction and two-way sync; recurrence expansion; pending-action confirm flow (propose never writes); Google push with a fake client (dirty handling, deletes, batching); assistant read functions against a seeded DB with the LLM mocked; auth allowlist.
- **Frontend (Vitest + React Testing Library):** week-grid positioning math; overlap layout; note task-line parsing; confirm-card behavior.
- **CI:** GitHub Actions runs both suites on every push. No live calls to Zeus, Google or Gemini in CI.

## 14. Open items to resolve during planning/build

1. Re-test the ICS link on 2026-10-04 (key lifetime).
2. My real sections for S1 (Adapting G?, French GR?, Tutorat GR?) — set in Settings on first run.
3. Confirm Vercel Hobby request time limit for Python functions; if too short for chat streaming, host the chat endpoint separately.
4. S2/S3 Zeus group IDs — added in Settings when known.
5. Gemini student offer: check whether it includes API access; the free API tier works regardless.
