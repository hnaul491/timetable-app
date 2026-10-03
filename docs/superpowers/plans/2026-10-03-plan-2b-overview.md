# Plan 2B — Overview & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Subjects pages, the Weekend review, subject management (rename / colour / hide / merge), a semester switcher, and an installable phone app — and close the most useful Plan 2A follow-ups (smarter sync guard, safe note write-back, discard draft, readable validation errors, board accessibility).

**Architecture:** Extends the live app. Backend: one small migration (0003, `week_review`), new services `subjects_query` and `review`, new routers `subjects`, `semesters`, `review`; the sync guard now applies changes and only skips cancellations. Frontend: new pages `/subjects`, `/subjects/:id`, `/review`, Settings gains semester and subject management, the sidebar gets a semester switcher, plus a web manifest and generated icons.

**Tech Stack:** unchanged (FastAPI, SQLAlchemy 2, Alembic, pytest · React 19, Vite, TS, TanStack Query, React Router v8, Vitest). No new dependencies (icons are generated with Node's built-in `zlib`).

**Spec:** `docs/superpowers/specs/2026-10-03-timetable-app-design.md` (§7 screens 4 Weekend review, 5 Subjects, 6 Settings; semester switcher; PWA) · Follow-ups: `docs/superpowers/plans/2026-10-03-plan-2a-followups.md`

**This is plan 2B.** Plan 3: Google Calendar push. Plan 4: AI.

## Decisions taken in this plan (for the user to confirm when reviewing)

- **Subject aliases are managed by "Merge into…"** (e.g. merge "French for Spring F26 T1" into "French for Fall 26 T1"): events, tasks and names move to the target and future syncs map the old name there. No free-text alias editor.
- **When the sync guard trips** (more than 30 % of upcoming classes missing), the sync still applies new and changed classes and only *keeps* the missing ones; the run is recorded as `partial` with a warning banner (the daily GitHub Action turns red so you get an email).
- **Default review week:** on Saturday/Sunday the review shows the coming week; Monday–Friday it shows the current week. Arrows move between weeks.
- **No offline mode** in the phone app (installable, opens full-screen; still needs a connection).

## Global Constraints

- Budget **$0**; no new dependencies.
- DB timestamps **naive UTC**; API returns ISO strings ending in `Z`; UI shows **`Europe/Paris`** via `src/lib/time.ts`; backend Paris dates use `zoneinfo.ZoneInfo("Europe/Paris")` (constant `PARIS` in `app.services.recurrence`).
- Single user: every new `/api` route requires `require_user` (router-level dependency).
- Every new Supabase table has RLS enabled (migration + RLS test lists every table: now 11).
- School (`source="zeus"`) events are never edited or deleted through the API.
- Subject display name 1–200 chars (non-blank), unique per semester (case-insensitive); colour `#RRGGBB`.
- No browser `confirm()`/`alert()`; destructive buttons use two-click confirm.
- UI tokens: Plus Jakarta Sans + JetBrains Mono; accent `#2E55E6`; ink `#15171C`; muted `#5B6170`; line `#E4E7EC`; canvas `#F4F5F7`.
- uv is not on PATH: `export PATH="$LOCALAPPDATA/Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"`; no system Python (`uv run`).
- Implementers use Sonnet or stronger (never Haiku). Do not switch git branches while local dev servers run.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Merging a subject loses nothing**: its events, tasks and notes move to the target, its name becomes an alias of the target, and the target's group choice still applies. Test: Task 3 `test_merge_moves_events_tasks_and_names`.
2. **The sync guard trips but room/time changes still land**; missing classes stay, nothing is cancelled. Test: Task 1 `test_partial_feed_keeps_missing_events_but_applies_changes`.
3. **Ticking a task whose note line is longer than 300 characters** keeps the whole line text. Test: Task 2 `test_update_line_keeps_full_text_of_long_lines`.
4. **The weekend review uses Paris weeks across the 25 Oct clock change** (week of 19 Oct ends Sunday 25 Oct 23:00Z) and rejects a non-Monday week. Tests: Task 5 `test_review_week_spans_dst_and_counts_hours`, `test_week_start_must_be_monday`.
5. **Switching to a semester without a Zeus group id** never breaks the app: calendar is empty for it, sync reports "active semester has no Zeus group id", switching back restores S1. Test: Task 4 `test_activate_switches_and_back`.

---

## File Structure

```
backend/
├─ migrations/versions/0003_week_review.py
├─ app/models.py                     # + WeekReview
├─ app/schemas.py                    # + subject/semester/review models
├─ app/zeus/sync.py                  # guard keeps missing events, applies changes; status "partial"
├─ app/routers/sync.py               # last_success counts "partial"
├─ app/services/note_tasks.py        # update_line keeps line text
├─ app/services/subjects_query.py    (new)  # summaries, sessions, note snippets, merge
├─ app/services/review.py            (new)  # Paris week maths + review assembly
├─ app/routers/subjects.py           (new)
├─ app/routers/semesters.py          (new)  # GET moved here from settings.py; activate; patch
├─ app/routers/review.py             (new)
├─ app/routers/settings.py           # GET /semesters removed (moved)
├─ app/main.py                       # register routers
└─ tests/ test_sync.py, test_api_sync.py, test_note_tasks.py, test_migrations.py,
          test_api_subjects.py, test_api_semesters.py, test_api_review.py
frontend/
├─ scripts/make-icons.mjs (new) · public/manifest.webmanifest (new) · public/icons/*.png (generated)
├─ index.html                        # manifest + apple-touch-icon links
└─ src/
   ├─ types.ts                       # + Subject*, Review*, Semester; SyncRun "partial"
   ├─ lib/api.ts                     # readable 422 messages
   ├─ components/Banners.tsx         # partial-sync banner
   ├─ components/Layout.tsx          # Subjects + Review links, semester switcher
   ├─ components/SemesterSettings.tsx, components/SubjectSettings.tsx (new)
   ├─ pages/EventPage.tsx            # Discard changes
   ├─ pages/BoardPage.tsx            # a11y + keep board on refetch error
   ├─ pages/SubjectsPage.tsx, pages/SubjectPage.tsx, pages/ReviewPage.tsx (new)
   ├─ pages/SettingsPage.tsx, App.tsx
   └─ *.test.ts(x), pwa.test.ts
```

---

### Task 1: Sync guard keeps missing classes but applies changes

**Files:**
- Modify: `backend/app/zeus/sync.py`, `backend/app/routers/sync.py`, `frontend/src/types.ts`, `frontend/src/components/Banners.tsx`
- Test: `backend/tests/test_sync.py`, `backend/tests/test_api_sync.py`, `frontend/src/components/Banners.test.tsx`

**Interfaces:**
- Produces: `SyncResult.kept: int = 0` (missing upcoming events left untouched because the guard tripped); `apply_feed` never raises for the ratio any more; `run_sync` sets `status="partial"` and `error="kept N upcoming classes that disappeared from the feed (guard: more than 30% would be cancelled)"` when `kept > 0`; `/api/sync/status.last_success_at` considers `ok` and `partial`. Frontend `SyncRun.status` gains `"partial"`; `SyncBanner` shows a warning for it.

- [ ] **Step 1: Rewrite the guard test** — in `backend/tests/test_sync.py` replace the whole `test_partial_feed_guard_blocks_mass_cancellation` function with:

```python
def test_partial_feed_keeps_missing_events_but_applies_changes(session, semester):
    events = many(20)
    apply_feed(session, semester, feed(*events), NOW)
    session.commit()
    moved = replace(events[0], room="KB999")
    result = apply_feed(session, semester, feed(moved, *events[1:5]), LATER)
    assert (result.kept, result.cancelled, result.updated) == (15, 0, 1)
    statuses = sorted(e.status for e in session.scalars(select(Event)))
    assert statuses == ["changed"] + ["normal"] * 19
    assert event_by_uid(session, "m0").room == "KB999"

    text = "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//t//EN",
                        "BEGIN:VEVENT", "UID:m0", "SUMMARY:Relational Databases",
                        "DTSTART:20261102T080000Z", "DTEND:20261102T100000Z", "LOCATION:KB999", "END:VEVENT",
                        "END:VCALENDAR", ""])
    run = run_sync(session, lambda sem: text, LATER)
    assert run.status == "partial"
    assert run.error.startswith("kept 19 upcoming classes")
    assert run.cancelled == 0
```

Append to `backend/tests/test_api_sync.py`:

```python
def test_partial_run_counts_as_last_success(client, session, semester):
    from datetime import datetime
    from app.models import SyncRun

    session.add(SyncRun(started_at=datetime(2026, 10, 15, 4), finished_at=datetime(2026, 10, 15, 4),
                        status="partial", fetched=5, inserted=0, updated=0, cancelled=0, skipped=0,
                        error="kept 15 upcoming classes that disappeared from the feed"))
    session.commit()
    body = client.get("/api/sync/status", headers=AUTH).json()
    assert body["last_run"]["status"] == "partial"
    assert body["last_success_at"] == "2026-10-15T04:00:00Z"
```

Append to `frontend/src/components/Banners.test.tsx` (inside the `describe`):

```tsx
  it("warns about a partial sync with the reason", () => {
    wrap(
      <SyncBanner
        status={{ last_run: { ...run("ok"), status: "partial", error: "kept 15 upcoming classes that disappeared from the feed" }, last_success_at: "2026-10-15T04:00:02Z" }}
        now={new Date("2026-10-15T10:00:00Z")}
      />,
    );
    expect(screen.getByText(/kept 15 upcoming classes/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_sync.py tests/test_api_sync.py -q` → the new tests fail (InvalidFeedError raised / last_success_at null). `cd frontend && npx vitest run src/components/Banners.test.tsx` → the partial test fails (type error or text missing).

- [ ] **Step 3: Implement the backend**

In `backend/app/zeus/sync.py`, add `kept: int = 0` as the last field of `SyncResult`. In `apply_feed`, replace the two-line `if len(upcoming) >= ... raise InvalidFeedError(...)` block with:

```python
    # A truncated feed (wrong group, Zeus hiccup) must not wipe the semester: still apply
    # new/changed classes, but keep the missing ones instead of cancelling them.
    keep_missing = len(upcoming) >= MIN_EVENTS_FOR_GUARD and would_cancel / len(upcoming) > MAX_CANCEL_RATIO
```

and replace the final cancellation loop with:

```python
    for event in existing.values():
        if event.start_at >= now and event.status != "cancelled":
            if keep_missing:
                result.kept += 1
                continue
            event.status, event.changed_at = "cancelled", now
            result.cancelled += 1
```

In `run_sync`, replace the `else:` branch with:

```python
    else:
        run.fetched, run.inserted, run.updated = result.fetched, result.inserted, result.updated
        run.cancelled, run.skipped = result.cancelled, result.skipped
        if result.kept:
            run.status = "partial"
            run.error = (f"kept {result.kept} upcoming classes that disappeared from the feed "
                         "(guard: more than 30% would be cancelled)")
        else:
            run.status = "ok"
```

In `backend/app/routers/sync.py`, change the `last_ok` query's filter from `SyncRun.status == "ok"` to `SyncRun.status.in_(("ok", "partial"))`.

- [ ] **Step 4: Implement the frontend**

`frontend/src/types.ts`: in `SyncRun`, change `status` to `"running" | "ok" | "partial" | "failed" | "auth_failed";`.

`frontend/src/components/Banners.tsx`: in `SyncBanner`, directly after the `if (run.status === "failed") {...}` block add:

```tsx
  if (run.status === "partial") {
    return (
      <Banner tone="warn">
        School sync: {run.error}. Check Zeus — if those classes were really removed, they will be cancelled once the feed is complete.
      </Banner>
    );
  }
```

- [ ] **Step 5: Run the suites**

Run: `cd backend && rm -rf tests/__pycache__ && uv run pytest -q` and `cd frontend && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/zeus/sync.py backend/app/routers/sync.py backend/tests/test_sync.py backend/tests/test_api_sync.py frontend/src/types.ts frontend/src/components/Banners.tsx frontend/src/components/Banners.test.tsx
git commit -m "feat(sync): keep missing classes but apply changes when the feed looks truncated" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Board write-back keeps the note line text

**Files:**
- Modify: `backend/app/services/note_tasks.py`
- Test: `backend/tests/test_note_tasks.py`

**Interfaces:**
- Produces: `update_line(body, title, done, due, occurrence=0) -> str` now only changes the checkbox mark and the trailing `@YYYY-MM-DD` of the matched line; all other text on the line (including text beyond 300 characters and inner spacing) is preserved. Signature unchanged.

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_note_tasks.py`:

```python
def test_update_line_keeps_full_text_of_long_lines():
    long_text = "Read " + "x" * 400
    body = f"intro\n[ ] {long_text}\nend"
    title = parse_task_lines(body)[0].title
    assert len(title) == 300
    updated = update_line(body, title, True, None)
    assert updated == f"intro\n[x] {long_text}\nend"


def test_update_line_keeps_inner_spacing_and_replaces_due():
    body = "  [ ] Read   chapter 4 @2026-10-22"
    assert update_line(body, "Read   chapter 4", False, date(2026, 10, 30)) == "  [ ] Read   chapter 4 @2026-10-30"
    assert update_line(body, "Read   chapter 4", True, None) == "  [x] Read   chapter 4"


def test_update_line_keeps_invalid_date_text():
    body = "[ ] Bad date stays @2026-13-40"
    assert update_line(body, "Bad date stays @2026-13-40", True, None) == "[x] Bad date stays @2026-13-40"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_note_tasks.py -v`
Expected: `test_update_line_keeps_full_text_of_long_lines` fails (tail lost).

- [ ] **Step 3: Implement** — in `backend/app/services/note_tasks.py`, inside `update_line`, replace the two lines

```python
            indent = LINE_RE.match(line).group(1)
            lines[index] = indent + render_line(title, done, due) + carriage
```

with:

```python
            match = LINE_RE.match(line)
            indent, text = match.group(1), match.group(3)
            due_match = DUE_RE.search(text)
            if due_match:
                try:
                    date.fromisoformat(due_match.group(1))
                    text = text[: due_match.start()].rstrip()
                except ValueError:
                    pass  # not a real date: it is part of the text
            rewritten = f"{indent}[{'x' if done else ' '}] {text}"
            if due:
                rewritten += f" @{due.isoformat()}"
            lines[index] = rewritten + carriage
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run pytest tests/test_note_tasks.py tests/test_api_tasks.py -v` then the full suite.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/note_tasks.py backend/tests/test_note_tasks.py
git commit -m "fix(backend): board write-back only flips the checkbox and due date" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: API — subjects (list, detail, rename/colour/hide, merge)

**Files:**
- Create: `backend/app/services/subjects_query.py`, `backend/app/routers/subjects.py`, `backend/tests/test_api_subjects.py`
- Modify: `backend/app/schemas.py`, `backend/app/main.py`

**Interfaces:**
- Consumes: `list_visible_events(session, semester_id, start, end) -> (list[VisibleEvent], missing)`, `active_semester`, `VisibleEvent` (has `note_count`, `open_tasks`, `important`), `task_out_list`, `iso_utc`, `get_now`, `Title` schema alias.
- Produces:
  - `subjects_query.SubjectSummary` (frozen dataclass: `id, display_name, color, hidden, aliases: list[str], sessions, sessions_done, next_start: datetime|None, exam_start: datetime|None, exam_room: str|None, open_tasks, note_count`)
  - `subject_summaries(session, semester_id, now) -> list[SubjectSummary]` (ordered by display name), `subject_sessions(session, semester_id, subject_id) -> list[VisibleEvent]`, `note_snippets(session, event_ids) -> dict[int, str]` (first 160 chars of the after-note, else the before-note), `merge_subjects(session, source, target) -> None`
  - schemas `SubjectSummaryOut` (same fields; datetimes as ISO `Z` strings), `SessionOut{id, start, end, room, kind, status, section, note_snippet: str|None, note_count, open_tasks, important}`, `SubjectDetailOut{subject: SubjectSummaryOut, sessions: list[SessionOut], tasks: list[TaskOut]}`, `SubjectPatch{display_name: Title|None, color: Color|None, hidden: bool|None}`, `MergeIn{into_id: int}`, `Color = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]`
  - HTTP: `GET /api/subjects`, `GET /api/subjects/{id}` (404), `PATCH /api/subjects/{id}` (409 on duplicate name), `POST /api/subjects/{id}/merge` (422 same subject / other semester; 404)

Counting rules: sessions = visible (per My groups) `class`/`exam` events that are not cancelled; done = those that started before now; hidden subjects show 0 sessions (their events are hidden everywhere).

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_api_subjects.py`

```python
from datetime import datetime

from sqlalchemy import select

from app.models import Event, MySection, Note, Subject, Task
from tests.conftest import AUTH

T = datetime(2026, 10, 15, 12, 0)  # conftest NOW


def ev(session, semester, subject, uid, start, kind="class", section=None, status="normal", room="KB602"):
    e = Event(source="zeus", zeus_uid=uid, semester_id=semester.id, subject_id=subject.id, section=section,
              title_raw=uid, start_at=start, end_at=start.replace(hour=start.hour + 2), room=room, kind=kind, status=status)
    session.add(e)
    session.flush()
    return e


def seed(session, semester):
    db = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[], color="#2E55E6")
    fr = Subject(semester_id=semester.id, display_name="French for Fall 26 T1", aliases=[], color="#0E7F72")
    spring = Subject(semester_id=semester.id, display_name="French for Spring F26 T1", aliases=[], color="#6A45D8")
    session.add_all([db, fr, spring])
    session.flush()
    past = ev(session, semester, db, "db1", datetime(2026, 10, 12, 11))
    ev(session, semester, db, "db2", datetime(2026, 11, 9, 12))
    ev(session, semester, db, "db3", datetime(2026, 11, 16, 12), status="cancelled")
    ev(session, semester, db, "dbx", datetime(2027, 1, 26, 8), kind="exam", room="KB003 (amphi 3)")
    ev(session, semester, fr, "f5", datetime(2026, 10, 20, 12), section="GR5")
    ev(session, semester, fr, "f1", datetime(2026, 10, 20, 12), section="GR1")
    sp = ev(session, semester, spring, "s2", datetime(2026, 10, 21, 12), section="GR2")
    session.add(MySection(subject_id=fr.id, section="GR5"))
    session.add(Note(event_id=past.id, tab="after", body="Covered ER diagrams " + "y" * 200, important=True, updated_at=T))
    session.add(Task(subject_id=db.id, event_id=past.id, title="Draw ER diagram", status="todo", source="manual", created_at=T))
    session.add(Task(subject_id=spring.id, title="Spring vocab", status="todo", source="manual", created_at=T))
    session.commit()
    return db, fr, spring, sp


def test_requires_login(client, semester):
    assert client.get("/api/subjects").status_code == 401


def test_list_counts(client, session, semester):
    db, fr, spring, _ = seed(session, semester)
    rows = {r["display_name"]: r for r in client.get("/api/subjects", headers=AUTH).json()}
    assert list(rows) == ["French for Fall 26 T1", "French for Spring F26 T1", "Relational Databases"]
    r = rows["Relational Databases"]
    assert (r["sessions"], r["sessions_done"], r["open_tasks"], r["note_count"]) == (3, 1, 1, 1)
    assert r["next_start"] == "2026-11-09T12:00:00Z"
    assert (r["exam_start"], r["exam_room"]) == ("2027-01-26T08:00:00Z", "KB003 (amphi 3)")
    assert rows["French for Fall 26 T1"]["sessions"] == 1  # only my group GR5
    assert rows["French for Spring F26 T1"]["sessions"] == 0  # group not chosen yet


def test_detail_has_sessions_snippets_and_tasks(client, session, semester):
    db, *_ = seed(session, semester)
    body = client.get(f"/api/subjects/{db.id}", headers=AUTH).json()
    assert body["subject"]["display_name"] == "Relational Databases"
    assert [s["start"] for s in body["sessions"]] == [
        "2026-10-12T11:00:00Z", "2026-11-09T12:00:00Z", "2026-11-16T12:00:00Z", "2027-01-26T08:00:00Z"]
    first = body["sessions"][0]
    assert first["note_snippet"].startswith("Covered ER diagrams") and len(first["note_snippet"]) == 160
    assert (first["note_count"], first["important"]) == (1, True)
    assert body["sessions"][2]["status"] == "cancelled"
    assert [t["title"] for t in body["tasks"]] == ["Draw ER diagram"]
    assert client.get("/api/subjects/999", headers=AUTH).status_code == 404


def test_patch_rename_colour_hide(client, session, semester):
    db, fr, *_ = seed(session, semester)
    r = client.patch(f"/api/subjects/{db.id}", headers=AUTH,
                     json={"display_name": "  Databases ", "color": "#AA00FF", "hidden": True}).json()
    assert (r["display_name"], r["color"], r["hidden"], r["sessions"]) == ("Databases", "#AA00FF", True, 0)
    assert client.patch(f"/api/subjects/{db.id}", headers=AUTH, json={"display_name": "french for fall 26 t1"}).status_code == 409
    assert client.patch(f"/api/subjects/{db.id}", headers=AUTH, json={"color": "blue"}).status_code == 422
    assert client.patch(f"/api/subjects/{db.id}", headers=AUTH, json={"display_name": "   "}).status_code == 422


def test_merge_moves_events_tasks_and_names(client, session, semester):
    db, fr, spring, spring_event = seed(session, semester)
    resp = client.post(f"/api/subjects/{spring.id}/merge", headers=AUTH, json={"into_id": fr.id})
    assert resp.status_code == 200
    merged = resp.json()
    assert merged["display_name"] == "French for Fall 26 T1"
    assert merged["aliases"] == ["French for Spring F26 T1"]
    session.expire_all()
    assert session.get(Subject, spring.id) is None
    assert session.get(Event, spring_event.id).subject_id == fr.id
    assert session.scalar(select(Task).where(Task.title == "Spring vocab")).subject_id == fr.id
    assert session.get(MySection, fr.id).section == "GR5"


def test_merge_validation(client, session, semester):
    db, fr, *_ = seed(session, semester)
    assert client.post(f"/api/subjects/{db.id}/merge", headers=AUTH, json={"into_id": db.id}).status_code == 422
    assert client.post(f"/api/subjects/{db.id}/merge", headers=AUTH, json={"into_id": 999}).status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_api_subjects.py -v`
Expected: FAIL (404 on `/api/subjects`).

- [ ] **Step 3: Implement schemas** — append to `backend/app/schemas.py`:

```python
Color = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]


class SubjectSummaryOut(BaseModel):
    id: int
    display_name: str
    color: str
    hidden: bool
    aliases: list[str]
    sessions: int
    sessions_done: int
    next_start: str | None
    exam_start: str | None
    exam_room: str | None
    open_tasks: int
    note_count: int


class SessionOut(BaseModel):
    id: int
    start: str
    end: str
    room: str
    kind: str
    status: str
    section: str | None
    note_snippet: str | None
    note_count: int
    open_tasks: int
    important: bool


class SubjectDetailOut(BaseModel):
    subject: SubjectSummaryOut
    sessions: list[SessionOut]
    tasks: list[TaskOut]


class SubjectPatch(BaseModel):
    display_name: Title | None = None
    color: Color | None = None
    hidden: bool | None = None


class MergeIn(BaseModel):
    into_id: int
```

- [ ] **Step 4: Implement the service** — `backend/app/services/subjects_query.py`

```python
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.models import Event, MySection, Note, Subject, Task
from app.services.events_query import VisibleEvent, list_visible_events

FAR_PAST = datetime(2000, 1, 1)
FAR_FUTURE = datetime(2100, 1, 1)
SESSION_KINDS = ("class", "exam")
SNIPPET_LENGTH = 160


@dataclass(frozen=True)
class SubjectSummary:
    id: int
    display_name: str
    color: str
    hidden: bool
    aliases: list[str]
    sessions: int
    sessions_done: int
    next_start: datetime | None
    exam_start: datetime | None
    exam_room: str | None
    open_tasks: int
    note_count: int


def _sessions_by_subject(session: Session, semester_id: int) -> dict[int, list[VisibleEvent]]:
    events, _ = list_visible_events(session, semester_id, FAR_PAST, FAR_FUTURE)
    grouped: dict[int, list[VisibleEvent]] = {}
    for event in events:
        if event.subject_id is not None and event.kind in SESSION_KINDS:
            grouped.setdefault(event.subject_id, []).append(event)
    return grouped


def _summary(subject: Subject, events: list[VisibleEvent], open_tasks: int, now: datetime) -> SubjectSummary:
    live = [e for e in events if e.status != "cancelled"]
    upcoming = [e for e in live if e.start_at >= now]
    exams = [e for e in live if e.kind == "exam"]
    return SubjectSummary(
        id=subject.id, display_name=subject.display_name, color=subject.color, hidden=subject.hidden,
        aliases=list(subject.aliases), sessions=len(live), sessions_done=sum(1 for e in live if e.start_at < now),
        next_start=upcoming[0].start_at if upcoming else None,
        exam_start=exams[0].start_at if exams else None, exam_room=exams[0].room if exams else None,
        open_tasks=open_tasks, note_count=sum(e.note_count for e in events),
    )


def subject_summaries(session: Session, semester_id: int, now: datetime) -> list[SubjectSummary]:
    subjects = session.scalars(
        select(Subject).where(Subject.semester_id == semester_id).order_by(Subject.display_name)
    ).all()
    grouped = _sessions_by_subject(session, semester_id)
    open_tasks = dict(session.execute(
        select(Task.subject_id, func.count())
        .where(Task.status != "done", Task.subject_id.is_not(None))
        .group_by(Task.subject_id)
    ).all())
    return [_summary(s, grouped.get(s.id, []), open_tasks.get(s.id, 0), now) for s in subjects]


def subject_sessions(session: Session, semester_id: int, subject_id: int) -> list[VisibleEvent]:
    return _sessions_by_subject(session, semester_id).get(subject_id, [])


def note_snippets(session: Session, event_ids: list[int]) -> dict[int, str]:
    if not event_ids:
        return {}
    snippets: dict[int, str] = {}
    rows = session.execute(
        select(Note.event_id, Note.tab, Note.body).where(Note.event_id.in_(event_ids), Note.body != "")
    ).all()
    for event_id, tab, body in sorted(rows, key=lambda r: (r[0], r[1] != "after")):
        snippets.setdefault(event_id, body.strip()[:SNIPPET_LENGTH])
    return snippets


def merge_subjects(session: Session, source: Subject, target: Subject) -> None:
    session.execute(update(Event).where(Event.subject_id == source.id).values(subject_id=target.id))
    session.execute(update(Task).where(Task.subject_id == source.id).values(subject_id=target.id))
    session.execute(delete(MySection).where(MySection.subject_id == source.id))
    known = {target.display_name.casefold(), *(a.casefold() for a in target.aliases)}
    aliases = list(target.aliases)
    for name in [source.display_name, *source.aliases]:
        if name.casefold() not in known:
            aliases.append(name)
            known.add(name.casefold())
    target.aliases = aliases  # new list so the JSON column is marked dirty
    session.delete(source)
    session.flush()
```

- [ ] **Step 5: Implement the router** — `backend/app/routers/subjects.py`

```python
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.deps import get_now
from app.models import Subject, Task
from app.schemas import MergeIn, SessionOut, SubjectDetailOut, SubjectPatch, SubjectSummaryOut
from app.services.events_query import active_semester
from app.services.subjects_query import (SubjectSummary, merge_subjects, note_snippets, subject_sessions,
                                         subject_summaries)
from app.services.task_query import task_out_list
from app.timeutil import iso_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


def _out(s: SubjectSummary) -> SubjectSummaryOut:
    return SubjectSummaryOut(
        id=s.id, display_name=s.display_name, color=s.color, hidden=s.hidden, aliases=s.aliases,
        sessions=s.sessions, sessions_done=s.sessions_done,
        next_start=iso_utc(s.next_start) if s.next_start else None,
        exam_start=iso_utc(s.exam_start) if s.exam_start else None, exam_room=s.exam_room,
        open_tasks=s.open_tasks, note_count=s.note_count,
    )


def _subject(session: Session, subject_id: int) -> Subject:
    subject = session.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="subject not found")
    return subject


def _summary_of(session: Session, subject: Subject, now: datetime) -> SubjectSummaryOut:
    summary = next(s for s in subject_summaries(session, subject.semester_id, now) if s.id == subject.id)
    return _out(summary)


@router.get("/subjects", response_model=list[SubjectSummaryOut])
def list_subjects(session: Session = Depends(get_session), now: datetime = Depends(get_now)) -> list[SubjectSummaryOut]:
    semester = active_semester(session)
    if semester is None:
        return []
    return [_out(s) for s in subject_summaries(session, semester.id, now)]


@router.get("/subjects/{subject_id}", response_model=SubjectDetailOut)
def get_subject(subject_id: int, session: Session = Depends(get_session),
                now: datetime = Depends(get_now)) -> SubjectDetailOut:
    subject = _subject(session, subject_id)
    events = subject_sessions(session, subject.semester_id, subject.id)
    snippets = note_snippets(session, [e.id for e in events])
    tasks = session.scalars(
        select(Task).where(Task.subject_id == subject.id)
        .order_by(Task.status == "done", Task.due_date.is_(None), Task.due_date, Task.id)
    ).all()
    return SubjectDetailOut(
        subject=_summary_of(session, subject, now),
        sessions=[
            SessionOut(id=e.id, start=iso_utc(e.start_at), end=iso_utc(e.end_at), room=e.room, kind=e.kind,
                       status=e.status, section=e.section, note_snippet=snippets.get(e.id),
                       note_count=e.note_count, open_tasks=e.open_tasks, important=e.important)
            for e in events
        ],
        tasks=task_out_list(session, list(tasks)),
    )


@router.patch("/subjects/{subject_id}", response_model=SubjectSummaryOut)
def patch_subject(subject_id: int, body: SubjectPatch, session: Session = Depends(get_session),
                  now: datetime = Depends(get_now)) -> SubjectSummaryOut:
    subject = _subject(session, subject_id)
    if body.display_name is not None:
        clash = session.scalar(select(Subject.id).where(
            Subject.semester_id == subject.semester_id, Subject.id != subject.id,
            func.lower(Subject.display_name) == body.display_name.lower()))
        if clash is not None:
            raise HTTPException(status_code=409, detail="another subject already has this name")
        subject.display_name = body.display_name
    if body.color is not None:
        subject.color = body.color
    if body.hidden is not None:
        subject.hidden = body.hidden
    session.commit()
    return _summary_of(session, subject, now)


@router.post("/subjects/{subject_id}/merge", response_model=SubjectSummaryOut)
def merge_subject(subject_id: int, body: MergeIn, session: Session = Depends(get_session),
                  now: datetime = Depends(get_now)) -> SubjectSummaryOut:
    source = _subject(session, subject_id)
    target = _subject(session, body.into_id)
    if source.id == target.id or source.semester_id != target.semester_id:
        raise HTTPException(status_code=422, detail="choose a different subject of the same semester")
    merge_subjects(session, source, target)
    session.commit()
    return _summary_of(session, target, now)
```

Register it in `backend/app/main.py`: add `subjects` to the router import list and to the `for module in (...)` tuple (after `tasks`).

- [ ] **Step 6: Run the suite**

Run: `cd backend && rm -rf tests/__pycache__ && uv run pytest -q`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas.py backend/app/services/subjects_query.py backend/app/routers/subjects.py backend/app/main.py backend/tests/test_api_subjects.py
git commit -m "feat(api): subjects overview, rename/colour/hide and merge" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: API — semesters (list, activate, set Zeus group / dates)

**Files:**
- Create: `backend/app/routers/semesters.py`, `backend/tests/test_api_semesters.py`
- Modify: `backend/app/routers/settings.py` (remove `GET /api/semesters` and its now-unused imports), `backend/app/schemas.py`, `backend/app/main.py`

**Interfaces:**
- Produces: `GET /api/semesters` (moved, unchanged response `list[SemesterOut]`); `PUT /api/semesters/{id}/activate` → `list[SemesterOut]` with exactly one active; `PATCH /api/semesters/{id}` body `SemesterPatch{zeus_group_id: int|None (>0), start_date: date|None, end_date: date|None}` (only fields sent are applied; `zeus_group_id: null` clears it; end before start → 422) → `SemesterOut`; unknown id → 404.

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_api_semesters.py`

```python
from datetime import date

from app.models import Semester
from app.seed import seed
from tests.conftest import AUTH


def seeded(session):
    seed(session)
    session.commit()
    return {s.code: s for s in session.query(Semester).all()}


def test_list_is_moved_and_unchanged(client, session):
    seeded(session)
    rows = client.get("/api/semesters", headers=AUTH).json()
    assert [(r["code"], r["is_active"]) for r in rows] == [("S1", True), ("S2", False), ("S3", False)]


def test_activate_switches_and_back(client, session, monkeypatch):
    from app.deps import get_fetcher
    from app.zeus.ics_client import ZeusFetchError

    def fetch(semester):
        if semester.zeus_group_id is None:
            raise ZeusFetchError("active semester has no Zeus group id")
        return ""

    monkeypatch.setitem(client.app.dependency_overrides, get_fetcher, lambda: fetch)  # auto-restored
    sems = seeded(session)
    rows = client.put(f"/api/semesters/{sems['S2'].id}/activate", headers=AUTH).json()
    assert [r["code"] for r in rows if r["is_active"]] == ["S2"]
    events = client.get("/api/events?start=2026-10-18T22:00:00Z&end=2026-10-25T23:00:00Z", headers=AUTH).json()
    assert events["events"] == []
    run = client.post("/api/sync", headers=AUTH).json()
    assert (run["status"], run["error"]) == ("failed", "active semester has no Zeus group id")
    rows = client.put(f"/api/semesters/{sems['S1'].id}/activate", headers=AUTH).json()
    assert [r["code"] for r in rows if r["is_active"]] == ["S1"]
    assert client.put("/api/semesters/999/activate", headers=AUTH).status_code == 404


def test_patch_group_and_dates(client, session):
    sems = seeded(session)
    r = client.patch(f"/api/semesters/{sems['S2'].id}", headers=AUTH,
                     json={"zeus_group_id": 905, "start_date": "2027-02-01", "end_date": "2027-06-30"}).json()
    assert (r["zeus_group_id"], r["start_date"], r["end_date"]) == (905, "2027-02-01", "2027-06-30")
    r = client.patch(f"/api/semesters/{sems['S2'].id}", headers=AUTH, json={"zeus_group_id": None}).json()
    assert (r["zeus_group_id"], r["start_date"]) == (None, "2027-02-01")
    assert client.patch(f"/api/semesters/{sems['S2'].id}", headers=AUTH, json={"zeus_group_id": 0}).status_code == 422
    assert client.patch(f"/api/semesters/{sems['S2'].id}", headers=AUTH,
                        json={"start_date": "2027-07-01", "end_date": "2027-06-30"}).status_code == 422
    assert client.patch("/api/semesters/999", headers=AUTH, json={"zeus_group_id": 1}).status_code == 404
```

The test client has no Zeus key, so the real fetcher would fail on the key check first; the test overrides the fetcher (already in the code above) so the group-id check is what runs.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_api_semesters.py -v`
Expected: FAIL (405/404 on the new routes).

- [ ] **Step 3: Implement** — append to `backend/app/schemas.py`:

```python
class SemesterPatch(BaseModel):
    zeus_group_id: int | None = Field(default=None, gt=0)
    start_date: date | None = None
    end_date: date | None = None
```

Create `backend/app/routers/semesters.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.models import Semester
from app.schemas import SemesterOut, SemesterPatch

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


def _all(session: Session) -> list[SemesterOut]:
    rows = session.scalars(select(Semester).order_by(Semester.code))
    return [SemesterOut.model_validate(row, from_attributes=True) for row in rows]


def _semester(session: Session, semester_id: int) -> Semester:
    semester = session.get(Semester, semester_id)
    if semester is None:
        raise HTTPException(status_code=404, detail="semester not found")
    return semester


@router.get("/semesters", response_model=list[SemesterOut])
def list_semesters(session: Session = Depends(get_session)) -> list[SemesterOut]:
    return _all(session)


@router.put("/semesters/{semester_id}/activate", response_model=list[SemesterOut])
def activate(semester_id: int, session: Session = Depends(get_session)) -> list[SemesterOut]:
    target = _semester(session, semester_id)
    for semester in session.scalars(select(Semester)):
        semester.is_active = semester.id == target.id
    session.commit()
    return _all(session)


@router.patch("/semesters/{semester_id}", response_model=SemesterOut)
def patch_semester(semester_id: int, body: SemesterPatch, session: Session = Depends(get_session)) -> SemesterOut:
    semester = _semester(session, semester_id)
    sent = body.model_fields_set
    if "zeus_group_id" in sent:
        semester.zeus_group_id = body.zeus_group_id
    if "start_date" in sent:
        semester.start_date = body.start_date
    if "end_date" in sent:
        semester.end_date = body.end_date
    if semester.start_date and semester.end_date and semester.end_date < semester.start_date:
        session.rollback()
        raise HTTPException(status_code=422, detail="end date must be on or after start date")
    session.commit()
    return SemesterOut.model_validate(semester, from_attributes=True)
```

In `backend/app/routers/settings.py` delete the `list_semesters` route and drop `Semester`/`SemesterOut` from its imports if no longer used. In `backend/app/main.py` add `semesters` to the import list and the router tuple.

- [ ] **Step 4: Run the suite**

Run: `cd backend && rm -rf tests/__pycache__ && uv run pytest -q`
Expected: all pass (`test_api_settings.py::test_semesters_list` still passes via the moved route).

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/semesters.py backend/app/routers/settings.py backend/app/main.py backend/tests/test_api_semesters.py
git commit -m "feat(api): switch semester and set its Zeus group" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Weekend review API + migration 0003

**Files:**
- Create: `backend/migrations/versions/0003_week_review.py`, `backend/app/services/review.py`, `backend/app/routers/review.py`, `backend/tests/test_api_review.py`
- Modify: `backend/app/models.py`, `backend/app/schemas.py`, `backend/app/main.py`, `backend/tests/test_migrations.py`

**Interfaces:**
- Consumes: `list_visible_events`, `active_semester`, `event_out` (`app.routers.events`), `task_out_list`, `iso_utc`, `to_naive_utc`, `PARIS` (`app.services.recurrence`), `get_now`.
- Produces:
  - model `WeekReview(week_start: date PK, reviewed_at: datetime)`; migration 0003 (RLS on `week_review`).
  - `review.paris_today(now) -> date`; `review.default_week_start(today) -> date` (Sat/Sun → next Monday, else this week's Monday); `review.paris_midnight_utc(day) -> datetime`.
  - schemas `ImportantNoteOut{event_id, title, start, tab, body}`, `ReviewOut{week_start: date, week_end: date, reviewed_at: str|None, overdue: list[TaskOut], due_this_week: list[TaskOut], important: list[ImportantNoteOut], without_notes: list[EventOut], changes: list[EventOut], week: list[EventOut], hours: dict[str, float]}`, `ReviewMarkOut{week_start: date, reviewed_at: str}`
  - HTTP: `GET /api/review?week_start=YYYY-MM-DD` (optional; must be a Monday else 422); `POST /api/review/{week_start}/done`.

Rules (all weeks are Paris Monday 00:00 → next Monday 00:00):
- `overdue`: tasks not done with `due_date < today` (Paris).
- `due_this_week`: tasks not done with `week_start <= due_date <= week_end`.
- `important`: non-empty notes flagged important on events starting in [previous week start, this week end].
- `without_notes`: visible school (`zeus`) `class`/`exam` events of the **previous** week, not cancelled, with no note.
- `changes`: visible events in [previous week start, this week end] whose status is `changed` or `cancelled`.
- `week`: visible events of this week (any kind, including holidays and own events).
- `hours`: total hours of `week` events, keys `school` (zeus class/exam), `work`, `french_ext`, `other`; holidays and cancelled events excluded; each rounded to 0.1.

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_api_review.py`

```python
from datetime import date, datetime

from app.models import Event, Note, Subject, Task
from app.services.review import default_week_start, paris_today
from tests.conftest import AUTH

T = datetime(2026, 10, 15, 12, 0)  # conftest NOW (Thursday)


def add(session, semester, uid, start, end, kind="class", source="zeus", subject=None, status="normal", changed=None):
    e = Event(source=source, zeus_uid=uid if source == "zeus" else None, semester_id=semester.id,
              subject_id=subject.id if subject else None, title_raw=uid, start_at=start, end_at=end,
              kind=kind, status=status, changed_at=changed)
    session.add(e)
    session.flush()
    return e


def test_paris_week_helpers():
    assert paris_today(datetime(2026, 10, 25, 22, 30)) == date(2026, 10, 25)  # 23:30 Paris (CET)
    assert paris_today(datetime(2026, 10, 25, 23, 30)) == date(2026, 10, 26)
    assert default_week_start(date(2026, 10, 17)) == date(2026, 10, 19)  # Saturday → next week
    assert default_week_start(date(2026, 10, 15)) == date(2026, 10, 12)  # Thursday → this week


def test_week_start_must_be_monday(client, semester):
    assert client.get("/api/review?week_start=2026-10-20", headers=AUTH).status_code == 422


def test_default_week_uses_today(client, semester):
    assert client.get("/api/review", headers=AUTH).json()["week_start"] == "2026-10-12"


def test_review_week_spans_dst_and_counts_hours(client, session, semester):
    db = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[])
    session.add(db)
    session.flush()
    add(session, semester, "mon", datetime(2026, 10, 19, 11), datetime(2026, 10, 19, 13), subject=db)
    add(session, semester, "sun-late", datetime(2026, 10, 25, 22, 30), datetime(2026, 10, 25, 23, 30), subject=db)  # Sun 23:30 CET → in week
    add(session, semester, "next-mon", datetime(2026, 10, 25, 23, 30), datetime(2026, 10, 26, 1, 0), subject=db)  # Mon 00:30 → next week
    add(session, semester, "work", datetime(2026, 10, 21, 10), datetime(2026, 10, 21, 14), kind="work", source="custom")
    add(session, semester, "hol", datetime(2026, 10, 22, 6), datetime(2026, 10, 22, 18), kind="holiday")
    session.commit()
    body = client.get("/api/review?week_start=2026-10-19", headers=AUTH).json()
    assert (body["week_start"], body["week_end"]) == ("2026-10-19", "2026-10-25")
    assert [e["title"] for e in body["week"]] == ["Relational Databases", "work", "hol", "Relational Databases"]
    assert body["hours"] == {"school": 3.0, "work": 4.0, "french_ext": 0.0, "other": 0.0}


def test_review_sections(client, session, semester):
    db = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[])
    session.add(db)
    session.flush()
    last_noted = add(session, semester, "a", datetime(2026, 10, 13, 7), datetime(2026, 10, 13, 9), subject=db)
    last_bare = add(session, semester, "b", datetime(2026, 10, 14, 7), datetime(2026, 10, 14, 9), subject=db)
    add(session, semester, "c", datetime(2026, 10, 14, 12), datetime(2026, 10, 14, 14), subject=db, status="cancelled")
    moved = add(session, semester, "d", datetime(2026, 10, 21, 7), datetime(2026, 10, 21, 9), subject=db,
                status="changed", changed=datetime(2026, 10, 15, 4))
    session.add(Note(event_id=last_noted.id, tab="after", body="Quiz next Thursday!", important=True, updated_at=T))
    session.add_all([
        Task(title="Old homework", status="todo", due_date=date(2026, 10, 14), source="manual", created_at=T),
        Task(title="Done thing", status="done", due_date=date(2026, 10, 14), source="manual", created_at=T),
        Task(title="Read ch. 4", status="doing", due_date=date(2026, 10, 22), source="manual", created_at=T),
        Task(title="Far future", status="todo", due_date=date(2026, 11, 30), source="manual", created_at=T),
    ])
    session.commit()
    body = client.get("/api/review?week_start=2026-10-19", headers=AUTH).json()
    assert [t["title"] for t in body["overdue"]] == ["Old homework"]
    assert [t["title"] for t in body["due_this_week"]] == ["Read ch. 4"]
    assert [(n["event_id"], n["body"]) for n in body["important"]] == [(last_noted.id, "Quiz next Thursday!")]
    assert [e["id"] for e in body["without_notes"]] == [last_bare.id]
    assert [(e["id"], e["status"]) for e in body["changes"]] == [(moved.id, "changed")]
    assert body["reviewed_at"] is None


def test_mark_week_reviewed(client, semester):
    first = client.post("/api/review/2026-10-19/done", headers=AUTH).json()
    assert first == {"week_start": "2026-10-19", "reviewed_at": "2026-10-15T12:00:00Z"}
    assert client.post("/api/review/2026-10-19/done", headers=AUTH).status_code == 200
    assert client.get("/api/review?week_start=2026-10-19", headers=AUTH).json()["reviewed_at"] == "2026-10-15T12:00:00Z"
    assert client.post("/api/review/2026-10-20/done", headers=AUTH).status_code == 422
```

Change the table list in `backend/tests/test_migrations.py::test_postgres_migration_enables_rls_on_every_table` to:

```python
    for table in ["semester", "subject", "my_section", "event", "sync_run", "app_secret",
                  "recurring_rule", "note", "task", "week_review", "alembic_version"]:
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_api_review.py tests/test_migrations.py -v`
Expected: FAIL (import error for `app.services.review`, missing RLS line).

- [ ] **Step 3: Model + migration**

Append to `backend/app/models.py`:

```python
class WeekReview(Base):
    __tablename__ = "week_review"

    week_start: Mapped[date] = mapped_column(Date, primary_key=True)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime)
```

`backend/migrations/versions/0003_week_review.py`:

```python
"""week review marks

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "week_review",
        sa.Column("week_start", sa.Date(), primary_key=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=False),
    )
    if op.get_context().dialect.name == "postgresql":
        op.execute("ALTER TABLE week_review ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("week_review")
```

- [ ] **Step 4: Schemas** — append to `backend/app/schemas.py`:

```python
class ImportantNoteOut(BaseModel):
    event_id: int
    title: str
    start: str
    tab: str
    body: str


class ReviewOut(BaseModel):
    week_start: date
    week_end: date
    reviewed_at: str | None
    overdue: list[TaskOut]
    due_this_week: list[TaskOut]
    important: list[ImportantNoteOut]
    without_notes: list[EventOut]
    changes: list[EventOut]
    week: list[EventOut]
    hours: dict[str, float]


class ReviewMarkOut(BaseModel):
    week_start: date
    reviewed_at: str
```

- [ ] **Step 5: Service** — `backend/app/services/review.py`

```python
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Event, Note, Subject, Task
from app.services.events_query import VisibleEvent, list_visible_events
from app.services.recurrence import PARIS
from app.timeutil import to_naive_utc

SCHOOL_KINDS = ("class", "exam")


def paris_today(now: datetime) -> date:
    return now.replace(tzinfo=timezone.utc).astimezone(PARIS).date()


def default_week_start(today: date) -> date:
    monday = today - timedelta(days=today.weekday())
    return monday + timedelta(days=7) if today.weekday() >= 5 else monday


def paris_midnight_utc(day: date) -> datetime:
    return to_naive_utc(datetime.combine(day, time(0, 0), PARIS))


def week_events(session: Session, semester_id: int, week_start: date) -> list[VisibleEvent]:
    events, _ = list_visible_events(session, semester_id, paris_midnight_utc(week_start),
                                    paris_midnight_utc(week_start + timedelta(days=7)))
    return events


def hours_by_kind(events: list[VisibleEvent]) -> dict[str, float]:
    totals = {"school": 0.0, "work": 0.0, "french_ext": 0.0, "other": 0.0}
    for e in events:
        if e.kind == "holiday" or e.status == "cancelled":
            continue
        key = "school" if e.source == "zeus" and e.kind in SCHOOL_KINDS else e.kind if e.kind in totals else "other"
        totals[key] += (e.end_at - e.start_at).total_seconds() / 3600
    return {k: round(v, 1) for k, v in totals.items()}


def open_tasks_due(session: Session, before: date | None = None, start: date | None = None,
                   end: date | None = None) -> list[Task]:
    query = select(Task).where(Task.status != "done", Task.due_date.is_not(None))
    if before is not None:
        query = query.where(Task.due_date < before)
    if start is not None:
        query = query.where(Task.due_date >= start)
    if end is not None:
        query = query.where(Task.due_date <= end)
    return list(session.scalars(query.order_by(Task.due_date, Task.position, Task.id)))


def important_notes(session: Session, semester_id: int, start: datetime, end: datetime) -> list[tuple[Note, Event, str]]:
    rows = session.execute(
        select(Note, Event, Subject.display_name)
        .join(Event, Note.event_id == Event.id)
        .outerjoin(Subject, Event.subject_id == Subject.id)
        .where(Event.semester_id == semester_id, Note.important.is_(True), Note.body != "",
               Event.start_at >= start, Event.start_at < end)
        .order_by(Event.start_at, Note.tab)
    ).all()
    return [(note, event, name or event.title_raw) for note, event, name in rows]
```

- [ ] **Step 6: Router** — `backend/app/routers/review.py`

```python
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.deps import get_now
from app.models import WeekReview
from app.routers.events import event_out
from app.schemas import ImportantNoteOut, ReviewMarkOut, ReviewOut
from app.services.events_query import active_semester
from app.services.review import (SCHOOL_KINDS, default_week_start, hours_by_kind, important_notes, open_tasks_due,
                                 paris_midnight_utc, paris_today, week_events)
from app.services.task_query import task_out_list
from app.timeutil import iso_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


def _monday(value: date) -> date:
    if value.weekday() != 0:
        raise HTTPException(status_code=422, detail="week_start must be a Monday")
    return value


@router.get("/review", response_model=ReviewOut)
def get_review(week_start: date | None = None, session: Session = Depends(get_session),
               now: datetime = Depends(get_now)) -> ReviewOut:
    today = paris_today(now)
    start = _monday(week_start) if week_start else default_week_start(today)
    end = start + timedelta(days=6)
    previous = start - timedelta(days=7)
    mark = session.get(WeekReview, start)
    semester = active_semester(session)
    week = week_events(session, semester.id, start) if semester else []
    last_week = week_events(session, semester.id, previous) if semester else []
    notes = important_notes(session, semester.id, paris_midnight_utc(previous),
                            paris_midnight_utc(start + timedelta(days=7))) if semester else []
    return ReviewOut(
        week_start=start,
        week_end=end,
        reviewed_at=iso_utc(mark.reviewed_at) if mark else None,
        overdue=task_out_list(session, open_tasks_due(session, before=today)),
        due_this_week=task_out_list(session, open_tasks_due(session, start=start, end=end)),
        important=[ImportantNoteOut(event_id=event.id, title=title, start=iso_utc(event.start_at), tab=note.tab,
                                    body=note.body) for note, event, title in notes],
        without_notes=[event_out(e) for e in last_week
                       if e.source == "zeus" and e.kind in SCHOOL_KINDS and e.status != "cancelled" and e.note_count == 0],
        changes=[event_out(e) for e in week if e.source == "zeus" and e.status in ("changed", "cancelled")],
        week=[event_out(e) for e in week],
        hours=hours_by_kind(week),
    )


@router.post("/review/{week_start}/done", response_model=ReviewMarkOut)
def mark_reviewed(week_start: date, session: Session = Depends(get_session),
                  now: datetime = Depends(get_now)) -> ReviewMarkOut:
    start = _monday(week_start)
    mark = session.get(WeekReview, start)
    if mark is None:
        mark = WeekReview(week_start=start, reviewed_at=now)
        session.add(mark)
    else:
        mark.reviewed_at = now
    session.commit()
    return ReviewMarkOut(week_start=start, reviewed_at=iso_utc(mark.reviewed_at))
```

Register the router in `backend/app/main.py` (`review` in the import list and tuple).

- [ ] **Step 7: Run the suite**

Run: `cd backend && rm -rf tests/__pycache__ && uv run pytest -q`
Expected: all pass. If `test_migrations_match_models` reports a diff, fix the migration (not the model/test).

- [ ] **Step 8: Commit**

```bash
git add backend/app/models.py backend/migrations/versions/0003_week_review.py backend/app/schemas.py backend/app/services/review.py backend/app/routers/review.py backend/app/main.py backend/tests/test_api_review.py backend/tests/test_migrations.py
git commit -m "feat(api): weekend review with week overview and reviewed marks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Frontend polish — readable errors, discard draft, board accessibility

**Files:**
- Modify: `frontend/src/lib/api.ts`, `frontend/src/pages/EventPage.tsx`, `frontend/src/pages/BoardPage.tsx`
- Test: `frontend/src/lib/api.test.ts`, `frontend/src/pages/EventPage.test.tsx`, `frontend/src/pages/BoardPage.test.tsx`

**Interfaces:**
- Produces: `apiFetch` turns an array `detail` (FastAPI validation errors) into one message: each item's `msg` with a leading `"Value error, "` removed, joined with `"; "`. EventPage shows a **Discard changes** button whenever the current tab is dirty (removes the draft and its saved copy). Board: Delete buttons are named `Delete <title>` / `Click again to delete <title>`, the confirmation resets when the button loses focus, the status select is disabled while that card's move is pending, and a failed background refresh shows a warning above the (still visible) board instead of replacing it.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/api.test.ts` (inside the `describe`):

```ts
  it("joins FastAPI validation messages", async () => {
    const detail = [
      { loc: ["body", "until_date"], msg: "Value error, a repeating event can span at most 400 days", type: "value_error" },
      { loc: ["body", "title"], msg: "String should have at least 1 character", type: "string_too_short" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail }), { status: 422 })));
    const error = await apiFetch("/api/x").catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 422,
      message: "a repeating event can span at most 400 days; String should have at least 1 character",
    });
  });
```

Append to `frontend/src/pages/EventPage.test.tsx` (inside the `describe`; it uses the existing `renderPage`, `detail`, `apiFetch` helpers):

```tsx
  it("discards unsaved changes", async () => {
    apiFetch.mockResolvedValue(detail());
    renderPage();
    const box = await screen.findByRole("textbox", { name: "After class note" });
    fireEvent.change(box, { target: { value: "scratch" } });
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(box).toHaveValue("[ ] Redo ex 3");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(localStorage.getItem("timetable:draft:7:after")).toBeNull();
  });
```

Append to `frontend/src/pages/BoardPage.test.tsx` (inside the `describe`):

```tsx
  it("names delete buttons per task and resets the confirmation on blur", async () => {
    renderBoard();
    const del = await screen.findByRole("button", { name: "Delete Buy notebook" });
    await userEvent.click(del);
    expect(screen.getByRole("button", { name: "Click again to delete Buy notebook" })).toBeInTheDocument();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Delete Buy notebook" })).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith("/api/tasks/3", { method: "DELETE" });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/api.test.ts src/pages/EventPage.test.tsx src/pages/BoardPage.test.tsx`
Expected: the three new tests fail.

- [ ] **Step 3: Implement `apiFetch`** — in `frontend/src/lib/api.ts`, replace the line `if (typeof body.detail === "string") message = body.detail;` with:

```ts
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail))
        message = body.detail
          .map((d: { msg?: unknown }) => String(d?.msg ?? "").replace(/^Value error, /, ""))
          .filter(Boolean)
          .join("; ");
```

- [ ] **Step 4: Implement Discard** — in `frontend/src/pages/EventPage.tsx`, add next to `setCurrent`:

```tsx
  const discard = () =>
    setDrafts((d) => {
      const out = { ...d };
      delete out[tab];
      return out;
    });
```

and directly after the "Save note" button add:

```tsx
          {dirty && (
            <button type="button" onClick={discard} className="h-10 rounded-xl border border-line px-4 text-sm font-semibold text-[#3A3F4B]">
              Discard changes
            </button>
          )}
```

(The existing `useEffect` that stores drafts removes the localStorage key when the draft is gone.)

- [ ] **Step 5: Implement board accessibility** — in `frontend/src/pages/BoardPage.tsx`:

Replace `if (tasks.error) return <ErrorPanel error={tasks.error} onRetry={() => tasks.refetch()} />;` with:

```tsx
  if (tasks.error && !tasks.data) return <ErrorPanel error={tasks.error} onRetry={() => tasks.refetch()} />;
```

and right after `{mutationError && ...}` add:

```tsx
      {tasks.error && tasks.data && <ErrorPanel error={tasks.error} onRetry={() => tasks.refetch()} />}
```

In the columns map, pass a pending flag: `<TaskCard key={t.id} task={t} pending={move.isPending && move.variables?.id === t.id} onMove={...} onDelete={...} />`, and change `TaskCard` to:

```tsx
function TaskCard({ task, pending, onMove, onDelete }: { task: Task; pending: boolean; onMove: (s: TaskStatus) => void; onDelete: () => void }) {
```

with the select getting `disabled={pending}`, and the delete button becoming:

```tsx
          <button
            type="button"
            aria-label={confirm ? `Click again to delete ${task.title}` : `Delete ${task.title}`}
            onClick={() => (confirm ? onDelete() : setConfirm(true))}
            onBlur={() => setConfirm(false)}
            className="h-9 rounded-lg px-2 text-sm font-semibold text-[#8B1A1A]"
          >
            {confirm ? "Click again to delete" : "Delete"}
          </button>
```

- [ ] **Step 6: Run tests and build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all pass (no act() warnings); build OK.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.test.ts frontend/src/pages/EventPage.tsx frontend/src/pages/EventPage.test.tsx frontend/src/pages/BoardPage.tsx frontend/src/pages/BoardPage.test.tsx
git commit -m "feat(frontend): readable validation errors, discard note changes, board accessibility" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Subjects pages

**Files:**
- Create: `frontend/src/pages/SubjectsPage.tsx`, `frontend/src/pages/SubjectPage.tsx`, `frontend/src/pages/SubjectsPage.test.tsx`
- Modify: `frontend/src/types.ts`, `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `GET /api/subjects`, `GET /api/subjects/{id}` (Task 3); `apiFetch`; time helpers `parisParts`, `formatTime`, `formatLongDate`, `dayLabel`.
- Produces: types `SubjectSummary`, `SubjectSession`, `SubjectDetail`, `Semester`, `ImportantNote`, `Review`; routes `/subjects` and `/subjects/:id`; nav gains **Subjects** (and **Review**, used by Task 8 — add both links now; the mobile bar becomes 5 columns with `text-xs`).

- [ ] **Step 1: Types** — append to `frontend/src/types.ts`:

```ts
export interface SubjectSummary {
  id: number;
  display_name: string;
  color: string;
  hidden: boolean;
  aliases: string[];
  sessions: number;
  sessions_done: number;
  next_start: string | null;
  exam_start: string | null;
  exam_room: string | null;
  open_tasks: number;
  note_count: number;
}

export interface SubjectSession {
  id: number;
  start: string;
  end: string;
  room: string;
  kind: ApiEvent["kind"];
  status: ApiEvent["status"];
  section: string | null;
  note_snippet: string | null;
  note_count: number;
  open_tasks: number;
  important: boolean;
}

export interface SubjectDetail {
  subject: SubjectSummary;
  sessions: SubjectSession[];
  tasks: Task[];
}

export interface Semester {
  id: number;
  code: string;
  name: string;
  zeus_group_id: number | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
}

export interface ImportantNote {
  event_id: number;
  title: string;
  start: string;
  tab: NoteTab;
  body: string;
}

export interface Review {
  week_start: string;
  week_end: string;
  reviewed_at: string | null;
  overdue: Task[];
  due_this_week: Task[];
  important: ImportantNote[];
  without_notes: ApiEvent[];
  changes: ApiEvent[];
  week: ApiEvent[];
  hours: Record<"school" | "work" | "french_ext" | "other", number>;
}
```

- [ ] **Step 2: Write the failing test** — `frontend/src/pages/SubjectsPage.test.tsx`

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubjectDetail, SubjectSummary } from "../types";
import { SubjectPage } from "./SubjectPage";
import { SubjectsPage } from "./SubjectsPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const db: SubjectSummary = {
  id: 1, display_name: "Relational Databases", color: "#2E55E6", hidden: false, aliases: [], sessions: 10,
  sessions_done: 1, next_start: "2026-11-09T12:00:00Z", exam_start: "2027-01-26T08:00:00Z", exam_room: "KB003 (amphi 3)",
  open_tasks: 2, note_count: 3,
};
const hidden: SubjectSummary = { ...db, id: 2, display_name: "GenAI 101", hidden: true, sessions: 0, sessions_done: 0, next_start: null, exam_start: null, exam_room: null, open_tasks: 0, note_count: 0 };
const detail: SubjectDetail = {
  subject: db,
  sessions: [
    { id: 11, start: "2026-10-19T11:00:00Z", end: "2026-10-19T13:00:00Z", room: "KB602", kind: "class", status: "normal", section: null,
      note_snippet: "Covered ER diagrams", note_count: 1, open_tasks: 1, important: true },
    { id: 12, start: "2026-11-09T12:00:00Z", end: "2026-11-09T14:00:00Z", room: "KB602", kind: "class", status: "cancelled", section: null,
      note_snippet: null, note_count: 0, open_tasks: 0, important: false },
  ],
  tasks: [],
};

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/subjects" element={<SubjectsPage />} />
          <Route path="/subjects/:id" element={<SubjectPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Subjects", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string) => (path === "/api/subjects" ? [db, hidden] : detail));
  });

  it("lists subjects with progress and links", async () => {
    renderAt("/subjects");
    const link = await screen.findByRole("link", { name: /Relational Databases/ });
    expect(link).toHaveAttribute("href", "/subjects/1");
    expect(screen.getByText(/1 of 10 sessions · 2 open tasks/)).toBeInTheDocument();
    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("shows a subject's exam, sessions and note snippets", async () => {
    renderAt("/subjects/1");
    expect(await screen.findByRole("heading", { name: "Relational Databases" })).toBeInTheDocument();
    expect(screen.getByText(/Exam/)).toBeInTheDocument();
    expect(screen.getByText("KB003 (amphi 3)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Covered ER diagrams" })).toHaveAttribute("href", "/events/11");
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "1 of 10 sessions done" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/SubjectsPage.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the list** — `frontend/src/pages/SubjectsPage.tsx`

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { apiFetch } from "../lib/api";
import { formatLongDate, parisParts } from "../lib/time";
import type { SubjectSummary } from "../types";

export function SubjectsPage() {
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: () => apiFetch<SubjectSummary[]>("/api/subjects") });
  if (subjects.error) return <ErrorPanel error={subjects.error} onRetry={() => subjects.refetch()} />;
  if (!subjects.data) return <p className="text-sm text-muted">Loading subjects…</p>;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Subjects</h1>
      {subjects.data.length === 0 && <p className="text-sm text-muted">No subjects yet — sync your school timetable first.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {subjects.data.map((s) => (
          <Link key={s.id} to={`/subjects/${s.id}`} className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4 hover:border-[#C9D3F7]">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
                {s.display_name}
                {s.hidden && <span className="rounded-full bg-[#F0F1F4] px-2 py-0.5 text-[11px] font-semibold text-muted">Hidden</span>}
              </span>
              <span className="text-xs text-muted">
                {s.sessions_done} of {s.sessions} sessions · {s.open_tasks} open {s.open_tasks === 1 ? "task" : "tasks"}
                {s.next_start ? ` · next ${formatLongDate(parisParts(s.next_start).date)}` : ""}
              </span>
              {s.exam_start && (
                <span className="text-xs font-semibold text-[#8B1A1A]">Exam {formatLongDate(parisParts(s.exam_start).date)}</span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement the detail** — `frontend/src/pages/SubjectPage.tsx`

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { apiFetch } from "../lib/api";
import { dayLabel, formatLongDate, formatTime, parisParts } from "../lib/time";
import type { SubjectDetail } from "../types";

export function SubjectPage() {
  const { id } = useParams();
  const detail = useQuery({ queryKey: ["subject", id], queryFn: () => apiFetch<SubjectDetail>(`/api/subjects/${id}`) });
  if (detail.error) return <ErrorPanel error={detail.error} onRetry={() => detail.refetch()} />;
  if (!detail.data) return <p className="text-sm text-muted">Loading…</p>;
  const { subject, sessions, tasks } = detail.data;
  const pct = subject.sessions ? Math.round((subject.sessions_done / subject.sessions) * 100) : 0;
  return (
    <div className="flex flex-col gap-4">
      <Link to="/subjects" className="text-sm font-semibold text-accent">
        ‹ All subjects
      </Link>
      <article className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-5 md:p-7">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="flex items-center gap-2 text-xs font-semibold text-muted">
              <span className="size-2 rounded-full" style={{ background: subject.color }} />
              {subject.aliases.length > 0 ? `Also called: ${subject.aliases.join(", ")}` : "Subject"}
            </span>
            <h1 className="text-2xl font-bold tracking-tight">{subject.display_name}</h1>
            <span className="text-sm text-[#3A3F4B]">
              {subject.sessions} sessions · {subject.sessions_done} done · {subject.note_count} notes · {subject.open_tasks} open tasks
            </span>
          </div>
          {subject.exam_start && (
            <div className="flex flex-col gap-0.5 rounded-xl bg-[#FDECEC] px-4 py-2.5 text-[#8B1A1A]">
              <span className="text-xs font-bold uppercase tracking-wide">Exam</span>
              <span className="text-sm font-semibold">
                {dayLabel(parisParts(subject.exam_start).date).weekday} {formatLongDate(parisParts(subject.exam_start).date)} · {formatTime(subject.exam_start)}
              </span>
              {subject.exam_room && <span className="text-xs">{subject.exam_room}</span>}
            </div>
          )}
        </header>
        <div
          role="progressbar"
          aria-label={`${subject.sessions_done} of ${subject.sessions} sessions done`}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 overflow-hidden rounded-full bg-[#EEF0F3]"
        >
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <section className="flex flex-col">
          <h2 className="mb-2 text-sm font-bold">Sessions</h2>
          {sessions.length === 0 && <p className="text-sm text-muted">No sessions (hidden subject, or pick your group in Settings).</p>}
          <ol className="flex flex-col">
            {sessions.map((s) => {
              const day = parisParts(s.start).date;
              return (
                <li key={s.id} className="flex flex-wrap gap-4 border-b border-[#F0F1F4] py-3">
                  <Link to={`/events/${s.id}`} className="flex w-32 shrink-0 flex-col gap-0.5">
                    <span className={`text-sm font-semibold ${s.status === "cancelled" ? "text-muted line-through" : "text-ink"}`}>
                      {dayLabel(day).weekday} {formatLongDate(day)}
                    </span>
                    <span className="font-mono text-[11.5px] text-muted">
                      {formatTime(s.start)} · {s.room}
                    </span>
                  </Link>
                  <span className="flex min-w-[200px] flex-1 flex-col gap-1.5">
                    {s.note_snippet ? (
                      <Link to={`/events/${s.id}`} className="text-sm text-ink">
                        {s.note_snippet}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted">No notes yet</span>
                    )}
                    <span className="flex flex-wrap gap-1.5">
                      {s.kind === "exam" && <span className="rounded-full bg-[#8B1A1A] px-2 text-[11px] font-bold text-white">Exam</span>}
                      {s.status === "cancelled" && <span className="rounded-full bg-[#F0F1F4] px-2 text-[11px] font-semibold text-muted">Cancelled</span>}
                      {s.status === "changed" && <span className="rounded-full bg-[#9A3412] px-2 text-[11px] font-bold text-white">Changed</span>}
                      {s.important && <span className="rounded-full bg-[#FFF1E0] px-2 text-[11px] font-bold text-[#7C2D12]">Important</span>}
                      {s.open_tasks > 0 && <span className="rounded-full bg-accent-soft px-2 text-[11px] font-semibold text-accent-strong">{s.open_tasks} open</span>}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
        {tasks.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-bold">Tasks</h2>
            {tasks.map((t) => (
              <p key={t.id} className={`text-sm ${t.status === "done" ? "text-muted line-through" : ""}`}>
                {t.title}
                {t.due_date ? <span className="ml-2 font-mono text-xs text-muted">due {t.due_date}</span> : null}
              </p>
            ))}
            <Link to="/board" className="text-sm font-semibold text-accent">
              Open the board
            </Link>
          </section>
        )}
      </article>
    </div>
  );
}
```

- [ ] **Step 6: Routes and navigation**

`frontend/src/App.tsx`: import both pages and add (inside the Layout route) `<Route path="subjects" element={<SubjectsPage />} />` and `<Route path="subjects/:id" element={<SubjectPage />} />`.

`frontend/src/components/Layout.tsx`: change `links` to

```tsx
const links = [
  { to: "/", label: "Calendar" },
  { to: "/board", label: "Board" },
  { to: "/subjects", label: "Subjects" },
  { to: "/review", label: "Review" },
  { to: "/settings", label: "Settings" },
];
```

and in the mobile bar change `grid-cols-3` to `grid-cols-5` and the link class `text-sm` to `text-xs`. Change the `end` prop on `NavLink` to `end={l.to === "/"}` so `/subjects/1` keeps **Subjects** highlighted.

- [ ] **Step 7: Run tests and build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all pass; build OK. (`/review` route arrives in Task 8; until then the link shows nothing — acceptable within the branch.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types.ts frontend/src/pages/SubjectsPage.tsx frontend/src/pages/SubjectPage.tsx frontend/src/pages/SubjectsPage.test.tsx frontend/src/App.tsx frontend/src/components/Layout.tsx
git commit -m "feat(frontend): subjects list and subject page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Weekend review page

**Files:**
- Create: `frontend/src/pages/ReviewPage.tsx`, `frontend/src/pages/ReviewPage.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `GET /api/review[?week_start=]`, `POST /api/review/{week_start}/done`, `PATCH /api/tasks/{id}` (tick a task done); type `Review`; time helpers incl. `addDays`.
- Produces: route `/review` (`ReviewPage`): week title with ‹ / › (moves `week_start` by 7 days; first load uses the server default), sections **Overdue**, **Due this week** (checkbox ticks → `PATCH {status: "done"}`), **Important notes** (link to the class), **Last week's classes without notes** ("Add note" link), **School timetable changes**, **Week at a glance** (grouped by day) with hour totals, and **Mark week as reviewed** (shows "Reviewed on …" once marked).

- [ ] **Step 1: Write the failing test** — `frontend/src/pages/ReviewPage.test.tsx`

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiEvent, Review, Task } from "../types";
import { ReviewPage } from "./ReviewPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const event = (over: Partial<ApiEvent>): ApiEvent => ({
  id: 1, title: "Relational Databases", subject_id: 1, subject_name: "Relational Databases", color: "#2E55E6", section: null,
  start: "2026-10-19T11:00:00Z", end: "2026-10-19T13:00:00Z", room: "KB602", kind: "class", status: "normal", source: "zeus",
  note_count: 0, open_tasks: 0, important: false, ...over,
});
const task = (over: Partial<Task>): Task => ({
  id: 1, title: "Old homework", status: "todo", due_date: "2026-10-14", important: false, source: "manual", note_id: null,
  event_id: null, subject_id: null, subject_name: null, event_start: null, position: 0, ...over,
});
const review = (over: Partial<Review> = {}): Review => ({
  week_start: "2026-10-19", week_end: "2026-10-25", reviewed_at: null,
  overdue: [task({})],
  due_this_week: [task({ id: 2, title: "Read ch. 4", due_date: "2026-10-22" })],
  important: [{ event_id: 5, title: "French for Fall 26 T1", start: "2026-10-15T12:30:00Z", tab: "after", body: "Oral presentation Thursday" }],
  without_notes: [event({ id: 6, title: "Harmonization", start: "2026-10-16T12:00:00Z", end: "2026-10-16T15:00:00Z" })],
  changes: [event({ id: 7, title: "Introduction to Python", status: "changed", start: "2026-10-21T15:00:00Z", end: "2026-10-21T18:00:00Z" })],
  week: [event({ id: 8 }), event({ id: 9, title: "Work shift", kind: "work", source: "custom", subject_id: null, subject_name: null, color: null,
                                    start: "2026-10-21T10:00:00Z", end: "2026-10-21T14:00:00Z" })],
  hours: { school: 2, work: 4, french_ext: 0, other: 0 },
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ReviewPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/review/2026-10-19/done") return { week_start: "2026-10-19", reviewed_at: "2026-10-18T17:00:00Z" };
      if (init?.method === "PATCH") return {};
      return path.includes("week_start=2026-10-26") ? review({ week_start: "2026-10-26", week_end: "2026-11-01", overdue: [] }) : review();
    });
  });

  it("shows every section for the week", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: /19 – 25 October 2026/ })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Overdue" })).getByText("Old homework")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Important notes" })).getByRole("link", { name: /Oral presentation Thursday/ })).toHaveAttribute("href", "/events/5");
    expect(within(screen.getByRole("region", { name: "Last week's classes without notes" })).getByRole("link", { name: /Add note/ })).toHaveAttribute("href", "/events/6");
    expect(within(screen.getByRole("region", { name: "School timetable changes" })).getByText(/Introduction to Python/)).toBeInTheDocument();
    expect(screen.getByText(/2 h school · 4 h work/)).toBeInTheDocument();
  });

  it("ticks a task done", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Read ch. 4" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/tasks/2", { method: "PATCH", body: JSON.stringify({ status: "done" }) });
  });

  it("marks the week reviewed and moves between weeks", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Mark week as reviewed" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/review/2026-10-19/done", { method: "POST" });
    await userEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(await screen.findByRole("heading", { name: /26 October – 1 November 2026/ })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/api/review?week_start=2026-10-26");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/ReviewPage.test.tsx`
Expected: FAIL — cannot resolve `./ReviewPage`.

- [ ] **Step 3: Implement** — `frontend/src/pages/ReviewPage.tsx`

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { apiFetch } from "../lib/api";
import { addDays, dayLabel, formatLongDate, formatTime, parisParts } from "../lib/time";
import type { ApiEvent, Review, Task } from "../types";

const card = "flex flex-col gap-2.5 rounded-2xl border border-line bg-white p-4";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function weekTitle(start: string, end: string): string {
  const [, sm] = start.split("-").map(Number);
  const [, em] = end.split("-").map(Number);
  const startDay = Number(start.slice(8));
  return sm === em ? `${startDay} – ${formatLongDate(end)}` : `${startDay} ${MONTHS[sm - 1]} – ${formatLongDate(end)}`;
}

function Section({ title, tone, children }: { title: string; tone?: "warn" | "error"; children: ReactNode }) {
  const border = tone === "error" ? "border-[#F3C4C4]" : tone === "warn" ? "border-[#F5D9B8] bg-[#FFF7ED]" : "";
  return (
    <section aria-label={title} className={`${card} ${border}`}>
      <h2 className="text-[15px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

function when(e: ApiEvent): string {
  const day = parisParts(e.start).date;
  return `${dayLabel(day).weekday} ${formatLongDate(day)} · ${formatTime(e.start)}`;
}

export function ReviewPage() {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const review = useQuery({
    queryKey: ["review", weekStart],
    queryFn: () => apiFetch<Review>(weekStart ? `/api/review?week_start=${weekStart}` : "/api/review"),
  });
  const tick = useMutation({
    mutationFn: (t: Task) => apiFetch(`/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const mark = useMutation({
    mutationFn: (start: string) => apiFetch(`/api/review/${start}/done`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["review"] }),
  });

  if (review.error) return <ErrorPanel error={review.error} onRetry={() => review.refetch()} />;
  if (!review.data) return <p className="text-sm text-muted">Loading review…</p>;
  const r = review.data;
  const days = Array.from({ length: 7 }, (_, i) => addDays(r.week_start, i));
  const error = (tick.error ?? mark.error) as Error | null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="text-sm text-muted">Weekend review</p>
          <h1 className="text-2xl font-bold tracking-tight">{weekTitle(r.week_start, r.week_end)}</h1>
        </div>
        <button type="button" aria-label="Previous week" onClick={() => setWeekStart(addDays(r.week_start, -7))} className="h-10 rounded-xl border border-line bg-white px-3.5 text-sm font-semibold">
          ‹
        </button>
        <button type="button" aria-label="Next week" onClick={() => setWeekStart(addDays(r.week_start, 7))} className="h-10 rounded-xl border border-line bg-white px-3.5 text-sm font-semibold">
          ›
        </button>
        {r.reviewed_at ? (
          <span className="rounded-xl bg-[#E7F5EC] px-4 py-2.5 text-sm font-semibold text-[#145C33]">
            Reviewed on {formatLongDate(parisParts(r.reviewed_at).date)}
          </span>
        ) : (
          <button type="button" onClick={() => mark.mutate(r.week_start)} disabled={mark.isPending} className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">
            Mark week as reviewed
          </button>
        )}
      </header>
      {error && <p className="text-sm text-[#8B1A1A]">{error.message}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="Overdue" tone="error">
          {r.overdue.length === 0 ? <p className="text-sm text-muted">Nothing overdue.</p> : r.overdue.map((t) => <TaskLine key={t.id} task={t} onTick={() => tick.mutate(t)} />)}
        </Section>
        <Section title="Due this week">
          {r.due_this_week.length === 0 ? <p className="text-sm text-muted">No deadlines this week.</p> : r.due_this_week.map((t) => <TaskLine key={t.id} task={t} onTick={() => tick.mutate(t)} />)}
        </Section>
        <Section title="Important notes" tone="warn">
          {r.important.length === 0 ? (
            <p className="text-sm text-muted">No important notes.</p>
          ) : (
            r.important.map((n) => (
              <Link key={`${n.event_id}-${n.tab}`} to={`/events/${n.event_id}`} className="flex flex-col gap-0.5 text-sm">
                <span className="font-semibold text-ink">{n.body.split("\n")[0]}</span>
                <span className="text-xs text-muted">
                  {n.title} · {formatLongDate(parisParts(n.start).date)}
                </span>
              </Link>
            ))
          )}
        </Section>
        <Section title="Last week's classes without notes">
          {r.without_notes.length === 0 ? (
            <p className="text-sm text-muted">Every class has a note.</p>
          ) : (
            r.without_notes.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex flex-col">
                  <span className="font-medium">{e.title}{e.section ? ` · ${e.section}` : ""}</span>
                  <span className="text-xs text-muted">{when(e)}</span>
                </span>
                <Link to={`/events/${e.id}`} className="rounded-lg border border-[#C9D3F7] bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent-strong">
                  Add note
                </Link>
              </div>
            ))
          )}
        </Section>
        <Section title="School timetable changes">
          {r.changes.length === 0 ? (
            <p className="text-sm text-muted">No changes from school this week.</p>
          ) : (
            r.changes.map((e) => (
              <Link key={e.id} to={`/events/${e.id}`} className="text-sm">
                <span className="mr-2 rounded-full bg-[#9A3412] px-2 text-[11px] font-bold text-white">{e.status === "cancelled" ? "Cancelled" : "Changed"}</span>
                {e.title} · {when(e)}
              </Link>
            ))
          )}
        </Section>
      </div>

      <section aria-label="Week at a glance" className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-bold">Week at a glance</h2>
          <span className="text-sm text-muted">
            {r.hours.school} h school · {r.hours.work} h work · {r.hours.french_ext} h French (external)
          </span>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {days.map((day) => {
            const items = r.week.filter((e) => parisParts(e.start).date === day);
            return (
              <div key={day} className="flex flex-col gap-1.5 rounded-xl bg-[#F8F9FB] p-3">
                <span className="text-xs font-bold uppercase tracking-wide text-muted">
                  {dayLabel(day).weekday} {dayLabel(day).day}
                </span>
                {items.length === 0 && <span className="text-xs text-muted">Free</span>}
                {items.map((e) => (
                  <span key={e.id} className={`flex items-baseline gap-1.5 text-[12.5px] ${e.status === "cancelled" ? "text-muted line-through" : ""}`}>
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: e.color ?? (e.kind === "french_ext" ? "#0E7F72" : "#3B4252") }} />
                    <span className="font-mono text-[11px] text-[#3A3F4B]">{e.kind === "holiday" ? "all day" : formatTime(e.start)}</span>
                    {e.title}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function TaskLine({ task, onTick }: { task: Task; onTick: () => void }) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" aria-label={task.title} checked={task.status === "done"} onChange={onTick} className="mt-0.5" />
      <span className="flex flex-col">
        <span className="font-medium">{task.title}</span>
        <span className="text-xs text-muted">
          {task.subject_name ? `${task.subject_name} · ` : ""}
          {task.due_date ? `due ${task.due_date}` : ""}
        </span>
      </span>
    </label>
  );
}
```

- [ ] **Step 4: Route** — `frontend/src/App.tsx`: import `ReviewPage` and add `<Route path="review" element={<ReviewPage />} />` inside the Layout route.

- [ ] **Step 5: Run tests and build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all pass; build OK.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ReviewPage.tsx frontend/src/pages/ReviewPage.test.tsx frontend/src/App.tsx
git commit -m "feat(frontend): weekend review page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Settings — semesters and subjects; sidebar semester switcher

**Files:**
- Create: `frontend/src/components/SemesterSettings.tsx`, `frontend/src/components/SubjectSettings.tsx`, `frontend/src/components/SemesterSettings.test.tsx`, `frontend/src/components/SubjectSettings.test.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx`, `frontend/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `GET/PUT/PATCH /api/semesters…` (Task 4), `GET/PATCH /api/subjects…` and `POST /api/subjects/{id}/merge` (Task 3), types `Semester`, `SubjectSummary`.
- Produces: `<SemesterSettings />` — per semester: name, **Zeus group** number input + **Save** (PATCH), **Make active** button (PUT activate; hidden for the active one). `<SubjectSettings />` — per subject: name input + **Save**, colour input (`type="color"`, PATCH on change), **Hide** checkbox, **Merge into…** select + two-click **Merge** (POST). Both invalidate all queries after a change (`queryClient.invalidateQueries()`). Sidebar: the active-semester box becomes a `<select aria-label="Semester">` that activates the chosen semester.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/SemesterSettings.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Semester } from "../types";
import { SemesterSettings } from "./SemesterSettings";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const SEMS: Semester[] = [
  { id: 1, code: "S1", name: "SE S1 (Fundamental)", zeus_group_id: 802, start_date: "2026-10-12", end_date: "2027-01-30", is_active: true },
  { id: 2, code: "S2", name: "SE S2 (Common Core)", zeus_group_id: null, start_date: null, end_date: null, is_active: false },
];

describe("SemesterSettings", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (_p: string, init?: RequestInit) => (init?.method ? {} : SEMS));
  });

  it("saves a Zeus group and activates a semester", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SemesterSettings />
      </QueryClientProvider>,
    );
    fireEvent.change(await screen.findByLabelText("Zeus group for SE S2 (Common Core)"), { target: { value: "905" } });
    await userEvent.click(screen.getByRole("button", { name: "Save SE S2 (Common Core)" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/semesters/2", { method: "PATCH", body: JSON.stringify({ zeus_group_id: 905 }) });
    expect(screen.queryByRole("button", { name: "Make SE S1 (Fundamental) active" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Make SE S2 (Common Core) active" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/semesters/2/activate", { method: "PUT" });
  });
});
```

`frontend/src/components/SubjectSettings.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubjectSummary } from "../types";
import { SubjectSettings } from "./SubjectSettings";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const base = { hidden: false, aliases: [], sessions: 0, sessions_done: 0, next_start: null, exam_start: null, exam_room: null, open_tasks: 0, note_count: 0 };
const SUBJECTS: SubjectSummary[] = [
  { ...base, id: 1, display_name: "French for Fall 26 T1", color: "#0E7F72" },
  { ...base, id: 2, display_name: "French for Spring F26 T1", color: "#6A45D8" },
];

function renderIt() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SubjectSettings />
    </QueryClientProvider>,
  );
}

describe("SubjectSettings", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (_p: string, init?: RequestInit) => (init?.method ? {} : SUBJECTS));
  });

  it("renames, recolours and hides a subject", async () => {
    renderIt();
    const name = await screen.findByLabelText("Name of French for Spring F26 T1");
    fireEvent.change(name, { target: { value: "French (spring)" } });
    await userEvent.click(screen.getByRole("button", { name: "Save name of French for Spring F26 T1" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/subjects/2", { method: "PATCH", body: JSON.stringify({ display_name: "French (spring)" }) });
    fireEvent.change(screen.getByLabelText("Colour of French for Spring F26 T1"), { target: { value: "#aa00ff" } });
    expect(apiFetch).toHaveBeenCalledWith("/api/subjects/2", { method: "PATCH", body: JSON.stringify({ color: "#aa00ff" }) });
    await userEvent.click(screen.getByRole("checkbox", { name: "Hide French for Spring F26 T1" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/subjects/2", { method: "PATCH", body: JSON.stringify({ hidden: true }) });
  });

  it("merges only after a second click", async () => {
    renderIt();
    await userEvent.selectOptions(await screen.findByLabelText("Merge French for Spring F26 T1 into"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Merge French for Spring F26 T1" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/api/subjects/2/merge", expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Click again to merge French for Spring F26 T1" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/subjects/2/merge", { method: "POST", body: JSON.stringify({ into_id: 1 }) });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/SemesterSettings.test.tsx src/components/SubjectSettings.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** — `frontend/src/components/SemesterSettings.tsx`

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "../lib/api";
import type { Semester } from "../types";

export function SemesterSettings() {
  const queryClient = useQueryClient();
  const semesters = useQuery({ queryKey: ["semesters"], queryFn: () => apiFetch<Semester[]>("/api/semesters") });
  const refresh = () => queryClient.invalidateQueries();
  const save = useMutation({
    mutationFn: (v: { id: number; zeus_group_id: number | null }) =>
      apiFetch(`/api/semesters/${v.id}`, { method: "PATCH", body: JSON.stringify({ zeus_group_id: v.zeus_group_id }) }),
    onSuccess: refresh,
  });
  const activate = useMutation({ mutationFn: (id: number) => apiFetch(`/api/semesters/${id}/activate`, { method: "PUT" }), onSuccess: refresh });
  const error = (save.error ?? activate.error) as Error | null;
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-5">
      <h2 className="text-base font-bold">Semesters</h2>
      <p className="text-sm text-muted">Set each semester's Zeus group when you know it, then make it active to switch the whole app.</p>
      {semesters.data?.map((s) => <SemesterRow key={s.id} semester={s} onSave={(g) => save.mutate({ id: s.id, zeus_group_id: g })} onActivate={() => activate.mutate(s.id)} />)}
      {error && <p className="text-sm text-[#8B1A1A]">{error.message}</p>}
    </section>
  );
}

function SemesterRow({ semester, onSave, onActivate }: { semester: Semester; onSave: (group: number | null) => void; onActivate: () => void }) {
  const [group, setGroup] = useState(semester.zeus_group_id?.toString() ?? "");
  return (
    <div className={`flex flex-wrap items-end gap-3 rounded-xl px-3 py-2.5 ${semester.is_active ? "bg-[#F2FAF5]" : "bg-[#F8F9FB]"}`}>
      <span className="flex min-w-[180px] flex-1 flex-col">
        <span className="text-sm font-semibold">{semester.name}</span>
        <span className="text-xs text-muted">{semester.is_active ? "Active" : "Not active"}</span>
      </span>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
        Zeus group
        <input
          aria-label={`Zeus group for ${semester.name}`}
          inputMode="numeric"
          value={group}
          onChange={(e) => setGroup(e.target.value.replace(/\D/g, ""))}
          className="h-9 w-24 rounded-lg border border-[#D5D9E0] bg-white px-2 text-sm text-ink"
        />
      </label>
      <button type="button" aria-label={`Save ${semester.name}`} onClick={() => onSave(group ? Number(group) : null)} className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-semibold">
        Save
      </button>
      {!semester.is_active && (
        <button type="button" aria-label={`Make ${semester.name} active`} onClick={onActivate} className="h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-white">
          Make active
        </button>
      )}
    </div>
  );
}
```

`frontend/src/components/SubjectSettings.tsx`

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "../lib/api";
import type { SubjectSummary } from "../types";

type Patch = Partial<Pick<SubjectSummary, "display_name" | "color" | "hidden">>;

export function SubjectSettings() {
  const queryClient = useQueryClient();
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: () => apiFetch<SubjectSummary[]>("/api/subjects") });
  const refresh = () => queryClient.invalidateQueries();
  const patch = useMutation({
    mutationFn: (v: { id: number; body: Patch }) => apiFetch(`/api/subjects/${v.id}`, { method: "PATCH", body: JSON.stringify(v.body) }),
    onSuccess: refresh,
  });
  const merge = useMutation({
    mutationFn: (v: { id: number; into: number }) => apiFetch(`/api/subjects/${v.id}/merge`, { method: "POST", body: JSON.stringify({ into_id: v.into }) }),
    onSuccess: refresh,
  });
  const error = (patch.error ?? merge.error) as Error | null;
  const all = subjects.data ?? [];
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-5">
      <h2 className="text-base font-bold">Subjects</h2>
      <p className="text-sm text-muted">Rename, recolour or hide subjects. "Merge into" combines duplicates (e.g. two names for the same French class); future syncs use the merged subject.</p>
      {all.map((s) => (
        <SubjectRow key={s.id} subject={s} others={all.filter((o) => o.id !== s.id)} onPatch={(body) => patch.mutate({ id: s.id, body })} onMerge={(into) => merge.mutate({ id: s.id, into })} />
      ))}
      {error && <p className="text-sm text-[#8B1A1A]">{error.message}</p>}
    </section>
  );
}

function SubjectRow({ subject, others, onPatch, onMerge }: { subject: SubjectSummary; others: SubjectSummary[]; onPatch: (b: Patch) => void; onMerge: (into: number) => void }) {
  const [name, setName] = useState(subject.display_name);
  const [into, setInto] = useState("");
  const [confirm, setConfirm] = useState(false);
  const label = subject.display_name;
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-xl bg-[#F8F9FB] px-3 py-2.5">
      <input type="color" aria-label={`Colour of ${label}`} value={subject.color.toLowerCase()} onChange={(e) => onPatch({ color: e.target.value })} className="size-8 rounded" />
      <input aria-label={`Name of ${label}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className="h-9 min-w-[200px] flex-1 rounded-lg border border-[#D5D9E0] bg-white px-2 text-sm" />
      <button type="button" aria-label={`Save name of ${label}`} disabled={!name.trim() || name.trim() === subject.display_name} onClick={() => onPatch({ display_name: name.trim() })} className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-semibold disabled:opacity-50">
        Save
      </button>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" aria-label={`Hide ${label}`} checked={subject.hidden} onChange={(e) => onPatch({ hidden: e.target.checked })} />
        Hide
      </label>
      <select aria-label={`Merge ${label} into`} value={into} onChange={(e) => { setInto(e.target.value); setConfirm(false); }} className="h-9 rounded-lg border border-[#D5D9E0] bg-white px-2 text-sm">
        <option value="">Merge into…</option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            {o.display_name}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={confirm ? `Click again to merge ${label}` : `Merge ${label}`}
        disabled={!into}
        onClick={() => (confirm ? onMerge(Number(into)) : setConfirm(true))}
        onBlur={() => setConfirm(false)}
        className="h-9 rounded-lg px-3 text-sm font-semibold text-[#8B1A1A] disabled:opacity-40"
      >
        {confirm ? "Click again to merge" : "Merge"}
      </button>
    </div>
  );
}
```

`frontend/src/pages/SettingsPage.tsx`: import both components and render `<SemesterSettings />` and `<SubjectSettings />` directly after `<RecurringList />`.

`frontend/src/components/Layout.tsx`: replace the `Semester` interface with `import type { Semester } from "../types";`, add `useMutation, useQueryClient` to the react-query import, and replace the `{active && (<div …>{active.name}</div>)}` block with:

```tsx
        {semesters.data && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Semester
            <select
              aria-label="Semester"
              value={active?.id ?? ""}
              onChange={(e) => switchSemester.mutate(Number(e.target.value))}
              className="h-10 rounded-xl border border-line bg-[#F8F9FB] px-2.5 text-sm font-semibold text-ink"
            >
              {semesters.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
```

with, at the top of `Layout()`:

```tsx
  const queryClient = useQueryClient();
  const switchSemester = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/semesters/${id}/activate`, { method: "PUT" }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
```

- [ ] **Step 4: Run tests and build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all pass (SettingsPage tests still pass: its mock returns `[]` for unknown paths); build OK.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SemesterSettings.tsx frontend/src/components/SemesterSettings.test.tsx frontend/src/components/SubjectSettings.tsx frontend/src/components/SubjectSettings.test.tsx frontend/src/pages/SettingsPage.tsx frontend/src/components/Layout.tsx
git commit -m "feat(frontend): semester switcher and subject management" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Installable phone app (web manifest + icons)

**Files:**
- Create: `frontend/scripts/make-icons.mjs`, `frontend/public/manifest.webmanifest`, `frontend/public/icons/icon-192.png`, `frontend/public/icons/icon-512.png`, `frontend/public/icons/apple-touch-icon.png` (generated), `frontend/src/pwa.test.ts`
- Modify: `frontend/index.html`, `frontend/package.json` (script `icons`)

**Interfaces:**
- Produces: manifest at `/manifest.webmanifest` (`name` "Timetable", `short_name` "Timetable", `start_url` "/", `display` "standalone", `background_color` "#F4F5F7", `theme_color` "#2E55E6", icons 192 + 512 PNG, 512 also `maskable`); `index.html` links the manifest and the apple-touch-icon and sets `apple-mobile-web-app-capable`.

- [ ] **Step 1: Write the failing test** — `frontend/src/pwa.test.ts`

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p));

function pngSize(buf: Buffer): [number, number] {
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe("installable app", () => {
  it("has a complete web manifest", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest").toString());
    expect(manifest).toMatchObject({ name: "Timetable", short_name: "Timetable", start_url: "/", display: "standalone", theme_color: "#2E55E6", background_color: "#F4F5F7" });
    expect(manifest.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ]);
  });

  it("ships real PNG icons of the right sizes", () => {
    expect(pngSize(read("public/icons/icon-192.png"))).toEqual([192, 192]);
    expect(pngSize(read("public/icons/icon-512.png"))).toEqual([512, 512]);
    expect(pngSize(read("public/icons/apple-touch-icon.png"))).toEqual([180, 180]);
  });

  it("links the manifest from index.html", () => {
    const html = read("index.html").toString();
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pwa.test.ts`
Expected: FAIL (files missing).

- [ ] **Step 3: Icon generator** — `frontend/scripts/make-icons.mjs` (white "T" on the accent colour, no dependencies):

```js
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  const bar = Math.round(size * 0.13);
  const top = Math.round(size * 0.27);
  const bottom = Math.round(size * 0.75);
  const left = Math.round(size * 0.27);
  const right = size - left;
  const mid = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const crossbar = y >= top && y < top + bar && x >= left && x < right;
      const stem = x >= mid - bar / 2 && x < mid + bar / 2 && y >= top && y < bottom;
      const [r, g, b] = crossbar || stem ? [255, 255, 255] : [0x2e, 0x55, 0xe6];
      const o = y * stride + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  writeFileSync(`public/icons/${name}`, png(size));
}
console.log("icons written to public/icons");
```

Add the script: `cd frontend && npm pkg set scripts.icons="node scripts/make-icons.mjs"` then run `npm run icons` (commit the generated PNGs).

- [ ] **Step 4: Manifest and HTML** — `frontend/public/manifest.webmanifest`:

```json
{
  "name": "Timetable",
  "short_name": "Timetable",
  "description": "My classes, notes and tasks",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#F4F5F7",
  "theme_color": "#2E55E6",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

In `frontend/index.html`, after the `theme-color` meta add:

```html
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Timetable" />
```

- [ ] **Step 5: Run tests and build**

Run: `cd frontend && npx vitest run && npm run build` and check `ls dist/manifest.webmanifest dist/icons`.
Expected: all pass; the build copies `public/` into `dist/`.

- [ ] **Step 6: Commit**

```bash
git add frontend/scripts/make-icons.mjs frontend/public frontend/index.html frontend/package.json frontend/src/pwa.test.ts
git commit -m "feat(frontend): installable app manifest and icons" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Ship — migrate production, push, deploy

**Files:** none (operations). Mark the 2A follow-ups done in `docs/superpowers/plans/2026-10-03-plan-2a-followups.md`.

- [ ] **Step 1: Full verification**

```bash
export PATH="$LOCALAPPDATA/Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"
cd backend && rm -rf tests/__pycache__ && uv run pytest -q && uv export --no-dev --no-hashes --frozen --no-emit-project --no-header | diff - ../requirements.txt
cd ../frontend && npx vitest run && npm run build
```
Expected: all green; no requirements drift.

- [ ] **Step 2: Update follow-ups** — in `docs/superpowers/plans/2026-10-03-plan-2a-followups.md`, append ` — DONE in plan 2B` to the bullets for: the sync guard, `update_line`, the stale-draft discard, the 422 formatter, and the board accessibility bullet. Commit with the trailer.

- [ ] **Step 3: Migrate production** (pg8000 because Windows blocks the psycopg DLL; URL never printed):

```bash
cd backend
MIG=$(grep '^MIGRATE_URL=' .env.prod | cut -d= -f2- | sed 's#postgresql+psycopg://#postgresql+pg8000://#')
DATABASE_URL="$MIG" uv run --with pg8000 alembic upgrade head
```
Then verify `select version_num from alembic_version` → `0003` and every table (now 11) has RLS on.

- [ ] **Step 4: Push and deploy** (migration first; user allows direct pushes to main; no branch switching):

```bash
git push origin plan-2b-overview
git push origin plan-2b-overview:main
npx --yes vercel deploy --prod --yes
```

- [ ] **Step 5: Smoke-test production**

```bash
B=https://timetable-app-lake.vercel.app
curl -s $B/api/health                                                   # {"status":"ok"}
for p in /api/subjects /api/review /api/semesters; do curl -s -o /dev/null -w "$p %{http_code}\n" $B$p; done   # 401
for p in /subjects /review /manifest.webmanifest /icons/icon-192.png; do curl -s -o /dev/null -w "$p %{http_code}\n" $B$p; done  # 200
curl -s $B/manifest.webmanifest | head -c 80                            # JSON, not HTML
```
Then trigger a sync with the cron secret and confirm `"status":"ok"`.
