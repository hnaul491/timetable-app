# Plan 2A — Study Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let me add my own events (one-off and weekly), write notes on any class, turn `[ ]` lines into tasks, manage those tasks on a board — and make the daily sync safe against partial feeds and silent stops.

**Architecture:** Extends the live Plan 1 app. New tables `recurring_rule`, `note`, `task` (+ `event.recurring_rule_id`) via Alembic migration 0002. Backend gains small services (`note_tasks`, `recurrence`, `task_query`) and routers (`notes`, `custom_events`, `tasks`). Frontend gains an event detail page, an add-event page, a task board, and a recurring-events list in Settings; the week grid becomes clickable.

**Tech Stack:** unchanged from Plan 1 (FastAPI, SQLAlchemy 2, Alembic, pytest · React 19, Vite, TS, TanStack Query, React Router, Vitest). New backend dependency: `tzdata` (Windows has no system time-zone database; `zoneinfo` needs it).

**Spec:** `docs/superpowers/specs/2026-10-03-timetable-app-design.md` · Plan 1: `docs/superpowers/plans/2026-10-03-plan-1-foundation-timetable.md` · Follow-ups: `docs/superpowers/plans/2026-10-03-plan-1-followups.md`

**This is plan 2A.** Plan 2B: subjects page, weekend review, semester switcher, subject alias editing + hide, PWA manifest. Plan 3: Google Calendar push. Plan 4: AI.

## Spec deviations (for the user to confirm when reviewing this plan)

- **Note editor is a plain textarea**, not TipTap. Tasks come from lines written as `[ ] text` (open) or `[x] text` (done), optional due date as a trailing `@YYYY-MM-DD`. Simpler, works the same on phone, no editor dependency.
- **Board moves cards with a status dropdown**, not drag-and-drop (dnd-kit). Works on phone and keyboard; drag can be added later.
- **Tasks inherit the note's Important flag.**

## Global Constraints

- Budget **$0**: only free tiers.
- Python `>=3.12` (uv). Node `>=22`.
- DB timestamps are **naive UTC**; API returns ISO strings ending in `Z`; UI displays **`Europe/Paris`** via `src/lib/time.ts` helpers only.
- **Recurring events are defined in Paris local time** (`start_time`/`end_time` as `"HH:MM"`), so a 19:30 class stays 19:30 across the clock change; conversion to UTC uses `zoneinfo.ZoneInfo("Europe/Paris")`.
- Single user: every new `/api` route requires `require_user` (router-level dependency, like Plan 1).
- Secrets never in responses, logs, errors, git.
- Every new Supabase table has RLS enabled (migration enables it on PostgreSQL; the RLS test lists every table).
- School (`source="zeus"`) events can never be edited or deleted through the API; only `source="custom"` events.
- Note/task text limits: note body ≤ 20 000 characters, task title ≤ 300, event title ≤ 200.
- UI tokens: Plus Jakarta Sans + JetBrains Mono; accent `#2E55E6`; ink `#15171C`; muted `#5B6170`; line `#E4E7EC`; canvas `#F4F5F7`; work events `#3B4252`; external French `#0E7F72` with dashed outline.
- No browser `confirm()`/`alert()` dialogs: destructive buttons use a two-click confirm ("Delete" → "Click again to delete").
- uv is not on PATH: prefix commands with `export PATH="$LOCALAPPDATA/Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"`. No system Python — always `uv run`.
- Implementers use Sonnet or stronger (never Haiku) — user instruction.
- Do not switch git branches while local dev servers run.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A partial but valid Zeus feed** (e.g. 5 of 80 upcoming events) must not cancel the semester → sync fails with a clear error, nothing cancelled. Test: Task 1 `test_partial_feed_guard_blocks_mass_cancellation`.
2. **A weekly event across the 25 Oct clock change** keeps its Paris time (19:30 → 17:30Z before, 18:30Z after). Test: Task 5 `test_occurrences_keep_paris_time_across_dst`.
3. **Changing or deleting a weekly rule** must never delete an occurrence that has a note. Tests: Task 5 `test_regenerate_keeps_noted_and_past_occurrences`, `test_delete_rule_keeps_noted_occurrences`.
4. **Ticking a note-task on the board** must write `[x]` back into the note, so re-saving the note does not undo it. Test: Task 8 `test_status_change_writes_back_to_note`.
5. **Editing a note with repeated or removed task lines** keeps board status for unchanged lines and deletes tasks whose lines were removed. Tests: Task 4 `test_sync_keeps_doing_status_and_deletes_removed_lines`, `test_sync_handles_duplicate_titles`.

---

## File Structure

```
backend/
├─ pyproject.toml, uv.lock, ../requirements.txt     # + tzdata
├─ migrations/versions/0002_notes_tasks_recurring.py
├─ app/models.py                                     # + RecurringRule, Note, Task, Event.recurring_rule_id
├─ app/schemas.py                                    # + note/task/event-detail/custom/recurring models
├─ app/zeus/sync.py                                  # + partial-feed guard
├─ app/services/events_query.py                      # + counts on VisibleEvent, describe_event, next_event
├─ app/services/note_tasks.py      (new)             # parse [ ] lines, update a line, sync note → tasks
├─ app/services/recurrence.py      (new)             # expand weekly rules (Paris time), regenerate, delete
├─ app/services/task_query.py      (new)             # Task rows → TaskOut with subject names / event starts
├─ app/routers/events.py                             # + event_out() helper, counts in list
├─ app/routers/notes.py            (new)             # GET /api/events/{id}, PUT /api/events/{id}/notes/{tab}
├─ app/routers/custom_events.py    (new)             # POST/PUT/DELETE custom events, /api/recurring CRUD
├─ app/routers/tasks.py            (new)             # /api/tasks list/create/patch/delete
├─ app/main.py                                       # register new routers
└─ tests/ test_sync.py, test_migrations.py, test_models.py, test_note_tasks.py, test_recurrence.py,
          test_api_notes.py, test_api_custom_events.py, test_api_tasks.py
frontend/src/
├─ lib/api.ts (+204), lib/time.ts (+parisLocalToUtc, weekdayIndex)
├─ types.ts                                          # + note/task/detail/recurring types
├─ components/Banners.tsx (+stale warning), components/WeekGrid.tsx (+onSelect, badges, custom colours)
├─ components/Layout.tsx (+Board link), components/RecurringList.tsx (new)
├─ pages/CalendarPage.tsx (+Add event, open event), pages/EventPage.tsx (new),
│  pages/NewEventPage.tsx (new), pages/BoardPage.tsx (new), pages/SettingsPage.tsx (+RecurringList)
├─ App.tsx (+routes)
└─ *.test.ts(x) next to each
```

---

### Task 1: Partial-feed guard in the sync engine

**Files:**
- Modify: `backend/app/zeus/sync.py`
- Test: `backend/tests/test_sync.py`

**Interfaces:**
- Consumes: `apply_feed(session, semester, feed, now)`, `run_sync(...)`, `FeedEvent`, `ParsedFeed`, `InvalidFeedError` (Plan 1).
- Produces: constants `MIN_EVENTS_FOR_GUARD = 10`, `MAX_CANCEL_RATIO = 0.3` in `app.zeus.sync`; `apply_feed` raises `InvalidFeedError("feed would cancel N of M upcoming events")` before any write when the ratio is exceeded.

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_sync.py`

```python
from datetime import timedelta


def many(n: int) -> list[FeedEvent]:
    base = datetime(2026, 11, 2, 8, 0)
    return [FeedEvent(f"m{i}", "Relational Databases", base + timedelta(days=i),
                      base + timedelta(days=i, hours=2), "KB602", "") for i in range(n)]


def test_partial_feed_guard_blocks_mass_cancellation(session, semester):
    events = many(20)
    apply_feed(session, semester, feed(*events), NOW)
    session.commit()
    with pytest.raises(InvalidFeedError, match="would cancel 15 of 20"):
        apply_feed(session, semester, feed(*events[:5]), LATER)
    statuses = {e.status for e in session.scalars(select(Event))}
    assert statuses == {"normal"}

    text = "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//t//EN",
                        "BEGIN:VEVENT", "UID:m0", "SUMMARY:Relational Databases",
                        "DTSTART:20261102T080000Z", "DTEND:20261102T100000Z", "END:VEVENT",
                        "END:VCALENDAR", ""])
    run = run_sync(session, lambda sem: text, LATER)
    assert run.status == "failed"
    assert "would cancel 19 of 20" in run.error


def test_small_cancellations_still_apply(session, semester):
    events = many(20)
    apply_feed(session, semester, feed(*events), NOW)
    result = apply_feed(session, semester, feed(*events[:18]), LATER)
    assert result.cancelled == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_sync.py -k "partial_feed or small_cancellations" -v`
Expected: `test_partial_feed_guard_blocks_mass_cancellation` FAILS (no exception raised); the other passes.

- [ ] **Step 3: Implement** — in `backend/app/zeus/sync.py`, add the constants under `Fetcher = ...`:

```python
MIN_EVENTS_FOR_GUARD = 10
MAX_CANCEL_RATIO = 0.3
```

and in `apply_feed`, directly after the `existing = {...}` dict is built and **before** `result = SyncResult(...)`, insert:

```python
    feed_uids = {item.uid for item in feed.events}
    upcoming = [e for e in existing.values() if e.start_at >= now and e.status != "cancelled"]
    would_cancel = sum(1 for e in upcoming if e.zeus_uid not in feed_uids)
    if len(upcoming) >= MIN_EVENTS_FOR_GUARD and would_cancel / len(upcoming) > MAX_CANCEL_RATIO:
        # A truncated feed (wrong group, Zeus hiccup) must not wipe the semester.
        raise InvalidFeedError(f"feed would cancel {would_cancel} of {len(upcoming)} upcoming events")
```

- [ ] **Step 4: Run the sync tests**

Run: `cd backend && uv run pytest tests/test_sync.py -v`
Expected: all pass (the Plan 1 tests use fewer than 10 events, so the guard does not affect them).

- [ ] **Step 5: Commit**

```bash
git add backend/app/zeus/sync.py backend/tests/test_sync.py
git commit -m "feat(sync): refuse feeds that would cancel most upcoming events" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Stale-sync banner and 204-safe API client

**Files:**
- Modify: `frontend/src/components/Banners.tsx`, `frontend/src/lib/api.ts`
- Test: `frontend/src/components/Banners.test.tsx`, `frontend/src/lib/api.test.ts`

**Interfaces:**
- Produces: `SyncBanner({ status, now? }: { status: SyncStatus | undefined; now?: Date })` — warns when the last run is `ok` but `last_success_at` is older than 36 hours; constant `STALE_AFTER_MS = 36 * 3600 * 1000` exported from `Banners.tsx`. `apiFetch` returns `undefined` for HTTP 204.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/Banners.test.tsx`, replace the test `"shows nothing when the last sync was ok"` with:

```tsx
  it("shows nothing when the last sync was ok and recent", () => {
    const { container } = wrap(
      <SyncBanner status={{ last_run: run("ok"), last_success_at: "2026-10-15T04:00:02Z" }} now={new Date("2026-10-15T10:00:00Z")} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("warns when the last successful sync is older than 36 hours", () => {
    wrap(
      <SyncBanner status={{ last_run: run("ok"), last_success_at: "2026-10-15T04:00:02Z" }} now={new Date("2026-10-17T10:00:00Z")} />,
    );
    expect(screen.getByText(/daily sync may have stopped/i)).toBeInTheDocument();
  });
```

Append to `frontend/src/lib/api.test.ts` (inside the `describe`):

```ts
  it("returns undefined for 204 No Content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(apiFetch("/api/x", { method: "DELETE" })).resolves.toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/Banners.test.tsx src/lib/api.test.ts`
Expected: the stale-warning test and the 204 test FAIL.

- [ ] **Step 3: Implement**

`frontend/src/lib/api.ts` — immediately before the final `return (await response.json()) as T;` add:

```ts
  if (response.status === 204) return undefined as T;
```

`frontend/src/components/Banners.tsx` — add below the `since` function:

```tsx
export const STALE_AFTER_MS = 36 * 3600 * 1000;
```

change the signature of `SyncBanner` to:

```tsx
export function SyncBanner({ status, now = new Date() }: { status: SyncStatus | undefined; now?: Date }) {
```

and replace its final `return null;` with:

```tsx
  if (status.last_success_at && now.getTime() - new Date(status.last_success_at).getTime() > STALE_AFTER_MS) {
    return (
      <Banner tone="warn">
        School timetable last updated {since(status.last_success_at)}. The daily sync may have stopped — press{" "}
        <Link to="/settings" className="font-semibold underline">Sync now in Settings</Link> or check GitHub Actions.
      </Banner>
    );
  }
  return null;
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all pass, build OK.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Banners.tsx frontend/src/components/Banners.test.tsx frontend/src/lib/api.ts frontend/src/lib/api.test.ts
git commit -m "feat(frontend): warn when the daily sync goes stale; handle 204 responses" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Data model — recurring rules, notes, tasks (migration 0002) + tzdata

**Files:**
- Modify: `backend/app/models.py`, `backend/pyproject.toml`, `backend/uv.lock`, `requirements.txt`, `backend/tests/test_migrations.py`, `backend/tests/test_models.py`
- Create: `backend/migrations/versions/0002_notes_tasks_recurring.py`

**Interfaces:**
- Produces models (exact fields):
  - `RecurringRule(id, semester_id, title: str(200), kind: str(16), weekdays: list[int] JSON (0=Mon … 6=Sun), start_time: str(5) "HH:MM", end_time: str(5), from_date: date, until_date: date, location: str(200)="")`
  - `Event.recurring_rule_id: int | None` (FK `recurring_rule.id`, named `fk_event_recurring_rule`)
  - `Note(id, event_id, tab: str(8) "after"|"before", body: Text="", important: bool=False, updated_at: datetime)`, unique `(event_id, tab)` named `uq_note_event_tab`
  - `Task(id, note_id: int|None, event_id: int|None, subject_id: int|None, title: str(300), status: str(8)="todo", due_date: date|None, important: bool=False, position: int=0, source: str(8) "note"|"manual", created_at: datetime)`

- [ ] **Step 1: Add tzdata**

```bash
cd backend
uv add "tzdata>=2024.1"
```
Then regenerate `requirements.txt` with exactly the flags used by the "requirements.txt is up to date" step in `.github/workflows/ci.yml` (it currently runs `uv export --no-dev --no-hashes --frozen --no-emit-project --no-header`), adding `-o ../requirements.txt`. Verify: `uv export --no-dev --no-hashes --frozen --no-emit-project --no-header | diff - ../requirements.txt` prints nothing.

- [ ] **Step 2: Write the failing tests**

In `backend/tests/test_migrations.py`, change the table list in `test_postgres_migration_enables_rls_on_every_table` to:

```python
    for table in ["semester", "subject", "my_section", "event", "sync_run", "app_secret",
                  "recurring_rule", "note", "task", "alembic_version"]:
```

Append to `backend/tests/test_models.py`:

```python
from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Note, RecurringRule, Task


def test_note_task_and_rule_defaults(session, semester):
    rule = RecurringRule(semester_id=semester.id, title="Work shift", kind="work", weekdays=[2, 6],
                         start_time="12:00", end_time="16:00", from_date=date(2026, 10, 19),
                         until_date=date(2026, 12, 20))
    session.add(rule)
    session.flush()
    event = Event(source="custom", semester_id=semester.id, title_raw="Work shift",
                  start_at=datetime(2026, 10, 21, 10, 0), end_at=datetime(2026, 10, 21, 14, 0),
                  kind="work", recurring_rule_id=rule.id)
    session.add(event)
    session.flush()
    note = Note(event_id=event.id, tab="after", updated_at=datetime(2026, 10, 21, 15, 0))
    session.add(note)
    session.flush()
    session.add(Task(note_id=note.id, event_id=event.id, title="Bring apron", source="note",
                     created_at=datetime(2026, 10, 21, 15, 0)))
    session.commit()
    task = session.scalar(select(Task))
    assert (task.status, task.important, task.position, task.due_date) == ("todo", False, 0, None)
    assert session.scalar(select(Note)).body == ""
    assert session.scalar(select(RecurringRule)).weekdays == [2, 6]
    assert session.scalar(select(Event)).recurring_rule_id == rule.id


def test_one_note_per_event_and_tab(session, semester):
    event = Event(source="custom", semester_id=semester.id, title_raw="x",
                  start_at=datetime(2026, 10, 21, 10, 0), end_at=datetime(2026, 10, 21, 11, 0), kind="other")
    session.add(event)
    session.flush()
    session.add_all([Note(event_id=event.id, tab="after", updated_at=datetime(2026, 10, 21)),
                     Note(event_id=event.id, tab="after", updated_at=datetime(2026, 10, 21))])
    with pytest.raises(IntegrityError):
        session.flush()
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_models.py tests/test_migrations.py -v`
Expected: FAIL — `ImportError: cannot import name 'Note'` and missing RLS statements.

- [ ] **Step 4: Implement the models** — append to `backend/app/models.py` (and add `recurring_rule_id` inside `Event`):

Inside `class Event`, after `changed_at`:

```python
    recurring_rule_id: Mapped[int | None] = mapped_column(
        ForeignKey("recurring_rule.id", name="fk_event_recurring_rule"), nullable=True
    )
```

At the end of the file:

```python
class RecurringRule(Base):
    __tablename__ = "recurring_rule"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    semester_id: Mapped[int] = mapped_column(ForeignKey("semester.id"))
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16))
    weekdays: Mapped[list[int]] = mapped_column(JSON, default=list)
    start_time: Mapped[str] = mapped_column(String(5))
    end_time: Mapped[str] = mapped_column(String(5))
    from_date: Mapped[date] = mapped_column(Date)
    until_date: Mapped[date] = mapped_column(Date)
    location: Mapped[str] = mapped_column(String(200), default="")


class Note(Base):
    __tablename__ = "note"
    __table_args__ = (UniqueConstraint("event_id", "tab", name="uq_note_event_tab"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("event.id"))
    tab: Mapped[str] = mapped_column(String(8))
    body: Mapped[str] = mapped_column(Text, default="")
    important: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime)


class Task(Base):
    __tablename__ = "task"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    note_id: Mapped[int | None] = mapped_column(ForeignKey("note.id"), nullable=True)
    event_id: Mapped[int | None] = mapped_column(ForeignKey("event.id"), nullable=True)
    subject_id: Mapped[int | None] = mapped_column(ForeignKey("subject.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(8), default="todo")
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    important: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(DateTime)
```

- [ ] **Step 5: Write the migration** — `backend/migrations/versions/0002_notes_tasks_recurring.py`

```python
"""notes, tasks, recurring rules

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

NEW_TABLES = ["recurring_rule", "note", "task"]


def upgrade() -> None:
    op.create_table(
        "recurring_rule",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("semester_id", sa.Integer(), sa.ForeignKey("semester.id"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("weekdays", sa.JSON(), nullable=False),
        sa.Column("start_time", sa.String(5), nullable=False),
        sa.Column("end_time", sa.String(5), nullable=False),
        sa.Column("from_date", sa.Date(), nullable=False),
        sa.Column("until_date", sa.Date(), nullable=False),
        sa.Column("location", sa.String(200), nullable=False),
    )
    with op.batch_alter_table("event") as batch:
        batch.add_column(sa.Column("recurring_rule_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_event_recurring_rule", "recurring_rule", ["recurring_rule_id"], ["id"])
    op.create_table(
        "note",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("event.id"), nullable=False),
        sa.Column("tab", sa.String(8), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("important", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("event_id", "tab", name="uq_note_event_tab"),
    )
    op.create_table(
        "task",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("note_id", sa.Integer(), sa.ForeignKey("note.id"), nullable=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("event.id"), nullable=True),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.id"), nullable=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("important", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    if op.get_context().dialect.name == "postgresql":
        for table in NEW_TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("task")
    op.drop_table("note")
    with op.batch_alter_table("event") as batch:
        batch.drop_constraint("fk_event_recurring_rule", type_="foreignkey")
        batch.drop_column("recurring_rule_id")
    op.drop_table("recurring_rule")
```

- [ ] **Step 6: Run the backend suite**

Run: `cd backend && rm -rf tests/__pycache__ && uv run pytest -q`
Expected: all pass. If `test_migrations_match_models` reports a diff, fix the migration (not the models or test) until it is empty.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/migrations/versions/0002_notes_tasks_recurring.py backend/tests/test_models.py backend/tests/test_migrations.py backend/pyproject.toml backend/uv.lock requirements.txt
git commit -m "feat(backend): tables for notes, tasks and recurring events" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Note → task lines service

**Files:**
- Create: `backend/app/services/note_tasks.py`
- Test: `backend/tests/test_note_tasks.py`

**Interfaces:**
- Consumes: models `Note`, `Task`, `Event` (Task 3).
- Produces:
  - `TaskLine(title: str, done: bool, due: date | None)` (frozen dataclass)
  - `parse_task_lines(body: str) -> list[TaskLine]` — lines `[ ] text` / `[x] text` (leading spaces allowed); trailing ` @YYYY-MM-DD` becomes `due` when it is a valid date (otherwise stays in the title); other lines ignored.
  - `render_line(title: str, done: bool, due: date | None) -> str`
  - `update_line(body: str, title: str, done: bool, due: date | None, occurrence: int = 0) -> str` — rewrites the `occurrence`-th task line with that title, keeping its indentation and `\r\n` endings; returns `body` unchanged if not found.
  - `sync_note_tasks(session, note: Note, event: Event, now: datetime) -> list[Task]` — make the note's `source="note"` tasks match its lines: new line → new task (`done` → status `done`); existing line → status `done` if ticked, `done`→`todo` if unticked, `doing` kept if unticked; due/position/important updated; tasks whose line disappeared are deleted. Matching is by exact title, in order (duplicates matched one-to-one). Flushes; does not commit.

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_note_tasks.py`

```python
from datetime import date, datetime

from sqlalchemy import select

from app.models import Event, Note, Subject, Task
from app.services.note_tasks import TaskLine, parse_task_lines, render_line, sync_note_tasks, update_line

T0 = datetime(2026, 10, 19, 15, 0)


def test_parse_task_lines():
    body = "\n".join([
        "Covered: ER diagrams",
        "[ ] Redo exercises 3-5",
        "  [x] Install PostgreSQL @2026-10-18",
        "[ ] Read chapter 4 @2026-10-22",
        "[ ] Bad date stays @2026-13-40",
        "[]  not a task",
        "[ ]   ",
    ])
    assert parse_task_lines(body) == [
        TaskLine("Redo exercises 3-5", False, None),
        TaskLine("Install PostgreSQL", True, date(2026, 10, 18)),
        TaskLine("Read chapter 4", False, date(2026, 10, 22)),
        TaskLine("Bad date stays @2026-13-40", False, None),
    ]


def test_render_and_update_line_keep_other_lines_and_crlf():
    assert render_line("Read", True, date(2026, 10, 22)) == "[x] Read @2026-10-22"
    body = "Intro\r\n  [ ] Read\r\n[ ] Read\r\nEnd"
    updated = update_line(body, "Read", True, None, occurrence=1)
    assert updated == "Intro\r\n  [ ] Read\r\n[x] Read\r\nEnd"
    assert update_line(body, "Missing", True, None) == body


def make_note(session, semester, body: str) -> tuple[Note, Event]:
    subject = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[])
    session.add(subject)
    session.flush()
    event = Event(source="zeus", zeus_uid="db1", semester_id=semester.id, subject_id=subject.id,
                  title_raw="Relational Databases", start_at=datetime(2026, 10, 19, 11, 0),
                  end_at=datetime(2026, 10, 19, 13, 0), kind="class")
    session.add(event)
    session.flush()
    note = Note(event_id=event.id, tab="after", body=body, important=True, updated_at=T0)
    session.add(note)
    session.flush()
    return note, event


def test_sync_creates_tasks_from_lines(session, semester):
    note, event = make_note(session, semester, "[ ] Redo ex 3 @2026-10-22\n[x] Install Postgres")
    tasks = sync_note_tasks(session, note, event, T0)
    assert [(t.title, t.status, t.due_date, t.position) for t in tasks] == [
        ("Redo ex 3", "todo", date(2026, 10, 22), 0),
        ("Install Postgres", "done", None, 1),
    ]
    assert all(t.subject_id == event.subject_id and t.event_id == event.id and t.important for t in tasks)
    assert all(t.source == "note" for t in tasks)


def test_sync_keeps_doing_status_and_deletes_removed_lines(session, semester):
    note, event = make_note(session, semester, "[ ] A\n[ ] B\n[x] C")
    a, b, c = sync_note_tasks(session, note, event, T0)
    b.status = "doing"
    note.body = "[ ] B\n[ ] C"
    tasks = sync_note_tasks(session, note, event, T0)
    assert [(t.id, t.title, t.status) for t in tasks] == [(b.id, "B", "doing"), (c.id, "C", "todo")]
    assert session.scalar(select(Task).where(Task.title == "A")) is None


def test_sync_handles_duplicate_titles(session, semester):
    note, event = make_note(session, semester, "[ ] Read\n[x] Read")
    first, second = sync_note_tasks(session, note, event, T0)
    assert (first.status, second.status) == ("todo", "done")
    note.body = "[x] Read"
    [only] = sync_note_tasks(session, note, event, T0)
    assert only.id == first.id and only.status == "done"
    assert len(session.scalars(select(Task)).all()) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_note_tasks.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.note_tasks'`

- [ ] **Step 3: Implement** — `backend/app/services/note_tasks.py`

```python
import re
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Event, Note, Task

LINE_RE = re.compile(r"^(\s*)\[( |x|X)\]\s+(.*?)\s*$")
DUE_RE = re.compile(r"\s+@(\d{4}-\d{2}-\d{2})$")


@dataclass(frozen=True)
class TaskLine:
    title: str
    done: bool
    due: date | None


def _parse(line: str) -> TaskLine | None:
    match = LINE_RE.match(line)
    if not match:
        return None
    text = match.group(3)
    due = None
    due_match = DUE_RE.search(text)
    if due_match:
        try:
            due = date.fromisoformat(due_match.group(1))
            text = text[: due_match.start()].rstrip()
        except ValueError:
            due = None
    if not text:
        return None
    return TaskLine(text, match.group(2) in "xX", due)


def parse_task_lines(body: str) -> list[TaskLine]:
    return [parsed for line in body.splitlines() if (parsed := _parse(line)) is not None]


def render_line(title: str, done: bool, due: date | None) -> str:
    line = f"[{'x' if done else ' '}] {title}"
    return f"{line} @{due.isoformat()}" if due else line


def update_line(body: str, title: str, done: bool, due: date | None, occurrence: int = 0) -> str:
    lines = body.split("\n")
    seen = 0
    for index, raw in enumerate(lines):
        carriage = "\r" if raw.endswith("\r") else ""
        line = raw[:-1] if carriage else raw
        parsed = _parse(line)
        if parsed is None or parsed.title != title:
            continue
        if seen == occurrence:
            indent = LINE_RE.match(line).group(1)
            lines[index] = indent + render_line(title, done, due) + carriage
            return "\n".join(lines)
        seen += 1
    return body


def sync_note_tasks(session: Session, note: Note, event: Event, now: datetime) -> list[Task]:
    existing = session.scalars(
        select(Task).where(Task.note_id == note.id, Task.source == "note").order_by(Task.position, Task.id)
    ).all()
    pool: dict[str, list[Task]] = {}
    for task in existing:
        pool.setdefault(task.title, []).append(task)

    kept: list[Task] = []
    for position, line in enumerate(parse_task_lines(note.body)):
        bucket = pool.get(line.title)
        task = bucket.pop(0) if bucket else None
        if task is None:
            task = Task(note_id=note.id, event_id=event.id, subject_id=event.subject_id, title=line.title,
                        status="done" if line.done else "todo", due_date=line.due, important=note.important,
                        position=position, source="note", created_at=now)
            session.add(task)
        else:
            if line.done:
                task.status = "done"
            elif task.status == "done":
                task.status = "todo"
            task.due_date, task.position, task.important = line.due, position, note.important
        kept.append(task)

    for leftovers in pool.values():
        for task in leftovers:
            session.delete(task)
    session.flush()
    return kept
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_note_tasks.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/note_tasks.py backend/tests/test_note_tasks.py
git commit -m "feat(backend): turn [ ] note lines into tasks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Weekly recurrence service

**Files:**
- Create: `backend/app/services/recurrence.py`
- Test: `backend/tests/test_recurrence.py`

**Interfaces:**
- Consumes: models `RecurringRule`, `Event`, `Note`, `Task` (Task 3); `to_naive_utc` (Plan 1).
- Produces:
  - `PARIS = ZoneInfo("Europe/Paris")`, `MAX_SPAN_DAYS = 400`
  - `occurrences(rule) -> list[tuple[datetime, datetime]]` — naive-UTC (start, end) for each date in `[from_date, until_date]` whose `weekday()` is in `rule.weekdays`; times interpreted in Paris; an end time ≤ start time means the next day.
  - `regenerate(session, rule, now) -> int` — deletes the rule's **future** events (`start_at >= now`) that have no non-empty note (and their empty notes), then creates missing future occurrences (`source="custom"`, `kind=rule.kind`, `title_raw=rule.title`, `room=rule.location`). Never touches past events or events with notes; returns the number created. Flushes.
  - `delete_event_cascade(session, event) -> None` — deletes the event's tasks, notes and the event.
  - `delete_rule(session, rule, now) -> None` — future events without notes are deleted; all remaining events of the rule are detached (`recurring_rule_id = None`); then the rule is deleted. Flushes.

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_recurrence.py`

```python
from datetime import date, datetime

from sqlalchemy import select

from app.models import Event, Note, RecurringRule
from app.services.recurrence import delete_rule, occurrences, regenerate

NOW = datetime(2026, 10, 15, 12, 0)


def rule(session, semester, **over) -> RecurringRule:
    values = dict(semester_id=semester.id, title="French (external)", kind="french_ext", weekdays=[0],
                  start_time="19:30", end_time="21:00", from_date=date(2026, 10, 19),
                  until_date=date(2026, 11, 2), location="Alliance")
    values.update(over)
    r = RecurringRule(**values)
    session.add(r)
    session.flush()
    return r


def test_occurrences_keep_paris_time_across_dst(session, semester):
    r = rule(session, semester)
    assert occurrences(r) == [
        (datetime(2026, 10, 19, 17, 30), datetime(2026, 10, 19, 19, 0)),
        (datetime(2026, 10, 26, 18, 30), datetime(2026, 10, 26, 20, 0)),
        (datetime(2026, 11, 2, 18, 30), datetime(2026, 11, 2, 20, 0)),
    ]


def test_occurrences_multiple_weekdays_and_midnight(session, semester):
    r = rule(session, semester, weekdays=[2, 6], start_time="22:00", end_time="01:00",
             from_date=date(2026, 11, 4), until_date=date(2026, 11, 8))
    assert occurrences(r) == [
        (datetime(2026, 11, 4, 21, 0), datetime(2026, 11, 5, 0, 0)),
        (datetime(2026, 11, 8, 21, 0), datetime(2026, 11, 9, 0, 0)),
    ]


def test_regenerate_creates_future_occurrences_only(session, semester):
    r = rule(session, semester, from_date=date(2026, 10, 12))
    created = regenerate(session, r, NOW)
    events = session.scalars(select(Event).order_by(Event.start_at)).all()
    assert created == 3
    assert [e.start_at.date() for e in events] == [date(2026, 10, 19), date(2026, 10, 26), date(2026, 11, 2)]
    assert {(e.source, e.kind, e.title_raw, e.room, e.recurring_rule_id) for e in events} == {
        ("custom", "french_ext", "French (external)", "Alliance", r.id)}


def test_regenerate_keeps_noted_and_past_occurrences(session, semester):
    r = rule(session, semester)
    regenerate(session, r, datetime(2026, 10, 1))
    first, second, third = session.scalars(select(Event).order_by(Event.start_at)).all()
    session.add(Note(event_id=second.id, tab="after", body="[ ] homework p.12", updated_at=NOW))
    session.add(Note(event_id=third.id, tab="after", body="", updated_at=NOW))
    r.weekdays = [3]  # move to Thursdays
    regenerate(session, r, datetime(2026, 10, 20))
    remaining = session.scalars(select(Event).order_by(Event.start_at)).all()
    assert first in remaining  # past
    assert second in remaining  # has a note
    assert third not in remaining  # future, only an empty note
    assert [e.start_at.date() for e in remaining if e.start_at.weekday() == 3] == [date(2026, 10, 22), date(2026, 10, 29)]
    assert session.scalar(select(Note).where(Note.body == "")) is None


def test_delete_rule_keeps_noted_occurrences(session, semester):
    r = rule(session, semester)
    regenerate(session, r, datetime(2026, 10, 1))
    first, second, third = session.scalars(select(Event).order_by(Event.start_at)).all()
    session.add(Note(event_id=third.id, tab="before", body="Bring textbook", updated_at=NOW))
    delete_rule(session, r, datetime(2026, 10, 20))
    remaining = session.scalars(select(Event).order_by(Event.start_at)).all()
    assert [e.id for e in remaining] == [first.id, third.id]
    assert all(e.recurring_rule_id is None for e in remaining)
    assert session.scalar(select(RecurringRule)) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_recurrence.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.recurrence'`

- [ ] **Step 3: Implement** — `backend/app/services/recurrence.py`

```python
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Event, Note, RecurringRule, Task
from app.timeutil import to_naive_utc

PARIS = ZoneInfo("Europe/Paris")
MAX_SPAN_DAYS = 400


def _hhmm(value: str) -> time:
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


def occurrences(rule: RecurringRule) -> list[tuple[datetime, datetime]]:
    start_t, end_t = _hhmm(rule.start_time), _hhmm(rule.end_time)
    last = min(rule.until_date, rule.from_date + timedelta(days=MAX_SPAN_DAYS))
    result: list[tuple[datetime, datetime]] = []
    day: date = rule.from_date
    while day <= last:
        if day.weekday() in rule.weekdays:
            start = datetime.combine(day, start_t, PARIS)
            end_day = day if end_t > start_t else day + timedelta(days=1)
            end = datetime.combine(end_day, end_t, PARIS)
            result.append((to_naive_utc(start), to_naive_utc(end)))
        day += timedelta(days=1)
    return result


def _has_note(session: Session, event_id: int) -> bool:
    return session.scalar(select(Note.id).where(Note.event_id == event_id, Note.body != "").limit(1)) is not None


def delete_event_cascade(session: Session, event: Event) -> None:
    session.execute(delete(Task).where(Task.event_id == event.id))
    session.execute(delete(Note).where(Note.event_id == event.id))
    session.delete(event)
    session.flush()


def regenerate(session: Session, rule: RecurringRule, now: datetime) -> int:
    kept_starts: set[datetime] = set()
    for event in session.scalars(select(Event).where(Event.recurring_rule_id == rule.id)).all():
        if event.start_at < now or _has_note(session, event.id):
            kept_starts.add(event.start_at)
        else:
            delete_event_cascade(session, event)
    created = 0
    for start, end in occurrences(rule):
        if start < now or start in kept_starts:
            continue
        session.add(Event(source="custom", semester_id=rule.semester_id, subject_id=None, section=None,
                          title_raw=rule.title, start_at=start, end_at=end, room=rule.location,
                          description="", kind=rule.kind, status="normal", recurring_rule_id=rule.id))
        created += 1
    session.flush()
    return created


def delete_rule(session: Session, rule: RecurringRule, now: datetime) -> None:
    for event in session.scalars(select(Event).where(Event.recurring_rule_id == rule.id)).all():
        if event.start_at >= now and not _has_note(session, event.id):
            delete_event_cascade(session, event)
        else:
            event.recurring_rule_id = None
    session.flush()
    session.delete(rule)
    session.flush()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_recurrence.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/recurrence.py backend/tests/test_recurrence.py
git commit -m "feat(backend): weekly recurring events in Paris time" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: API — event detail and notes

**Files:**
- Modify: `backend/app/schemas.py`, `backend/app/services/events_query.py`, `backend/app/routers/events.py`, `backend/app/main.py`
- Create: `backend/app/services/task_query.py`, `backend/app/routers/notes.py`
- Test: `backend/tests/test_api_notes.py`

**Interfaces:**
- Consumes: `sync_note_tasks` (Task 4); models (Task 3); `require_user`, `get_session`, `get_now`, `iso_utc` (Plan 1).
- Produces:
  - `EventOut` gains `note_count: int = 0`, `open_tasks: int = 0`, `important: bool = False`; `VisibleEvent` gains the same three fields (defaults 0/0/False).
  - `app.routers.events.event_out(e: VisibleEvent) -> EventOut`
  - `app.services.events_query.describe_event(session, event: Event) -> VisibleEvent`, `next_event(session, event: Event) -> Event | None`
  - `app.services.task_query.task_out_list(session, tasks: list[Task]) -> list[TaskOut]`
  - schemas `NoteOut{tab, body, important, updated_at: str|None}`, `TaskOut{id, title, status, due_date: date|None, important, source, note_id, event_id, subject_id, subject_name, event_start: str|None, position}`, `EventDetailOut{event: EventOut, notes: dict[str, NoteOut] (keys "after","before"), tasks: list[TaskOut], next_event_id: int|None, next_event_start: str|None, recurring_rule_id: int|None}`, `NoteUpdate{body: str (≤20000), important: bool=False}`
  - HTTP: `GET /api/events/{event_id}` → `EventDetailOut` (404 if missing); `PUT /api/events/{event_id}/notes/{tab}` (`tab` ∈ after|before, else 422) → `EventDetailOut`.

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_api_notes.py`

```python
from datetime import datetime

from app.models import Event, MySection, Subject
from tests.conftest import AUTH

WEEK = "start=2026-10-18T22:00:00Z&end=2026-10-25T23:00:00Z"


def seed(session, semester):
    db = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[], color="#2E55E6")
    session.add(db)
    session.flush()
    first = Event(source="zeus", zeus_uid="db1", semester_id=semester.id, subject_id=db.id,
                  title_raw="Relational Databases", start_at=datetime(2026, 10, 19, 11, 0),
                  end_at=datetime(2026, 10, 19, 13, 0), room="KB602", kind="class")
    second = Event(source="zeus", zeus_uid="db2", semester_id=semester.id, subject_id=db.id,
                   title_raw="Relational Databases", start_at=datetime(2026, 11, 9, 12, 0),
                   end_at=datetime(2026, 11, 9, 14, 0), room="KB602", kind="class")
    session.add_all([first, second])
    session.commit()
    return first, second


def test_requires_login(client, session, semester):
    first, _ = seed(session, semester)
    assert client.get(f"/api/events/{first.id}").status_code == 401


def test_detail_of_unknown_event_is_404(client, semester):
    assert client.get("/api/events/999", headers=AUTH).status_code == 404


def test_detail_has_empty_notes_and_next_class(client, session, semester):
    first, second = seed(session, semester)
    body = client.get(f"/api/events/{first.id}", headers=AUTH).json()
    assert body["event"]["title"] == "Relational Databases"
    assert body["notes"]["after"] == {"tab": "after", "body": "", "important": False, "updated_at": None}
    assert body["notes"]["before"]["body"] == ""
    assert body["tasks"] == []
    assert (body["next_event_id"], body["next_event_start"]) == (second.id, "2026-11-09T12:00:00Z")


def test_save_note_creates_tasks_and_counts_show_in_week(client, session, semester):
    first, _ = seed(session, semester)
    resp = client.put(f"/api/events/{first.id}/notes/after", headers=AUTH,
                      json={"body": "Covered ER\n[ ] Redo ex 3 @2026-10-22\n[x] Install Postgres", "important": True})
    assert resp.status_code == 200
    detail = resp.json()
    assert detail["notes"]["after"]["important"] is True
    assert detail["notes"]["after"]["updated_at"] == "2026-10-15T12:00:00Z"
    assert [(t["title"], t["status"], t["due_date"], t["subject_name"]) for t in detail["tasks"]] == [
        ("Redo ex 3", "todo", "2026-10-22", "Relational Databases"),
        ("Install Postgres", "done", None, "Relational Databases"),
    ]
    [event] = client.get(f"/api/events?{WEEK}", headers=AUTH).json()["events"]
    assert (event["note_count"], event["open_tasks"], event["important"]) == (1, 1, True)


def test_removing_a_line_removes_its_task(client, session, semester):
    first, _ = seed(session, semester)
    client.put(f"/api/events/{first.id}/notes/after", headers=AUTH, json={"body": "[ ] A\n[ ] B"})
    detail = client.put(f"/api/events/{first.id}/notes/after", headers=AUTH, json={"body": "[ ] B"}).json()
    assert [t["title"] for t in detail["tasks"]] == ["B"]


def test_invalid_tab_is_422(client, session, semester):
    first, _ = seed(session, semester)
    assert client.put(f"/api/events/{first.id}/notes/during", headers=AUTH, json={"body": "x"}).status_code == 422


def test_next_class_respects_section(client, session, semester):
    french = Subject(semester_id=semester.id, display_name="French for Fall 26 T1", aliases=[])
    session.add(french)
    session.flush()
    mine = Event(source="zeus", zeus_uid="f1", semester_id=semester.id, subject_id=french.id, section="GR5",
                 title_raw="GR5 - French", start_at=datetime(2026, 10, 20, 12, 30), end_at=datetime(2026, 10, 20, 14, 30), kind="class")
    other = Event(source="zeus", zeus_uid="f2", semester_id=semester.id, subject_id=french.id, section="GR1",
                  title_raw="GR1 - French", start_at=datetime(2026, 10, 21, 12, 30), end_at=datetime(2026, 10, 21, 14, 30), kind="class")
    next_mine = Event(source="zeus", zeus_uid="f3", semester_id=semester.id, subject_id=french.id, section="GR5",
                      title_raw="GR5 - French", start_at=datetime(2026, 10, 22, 12, 30), end_at=datetime(2026, 10, 22, 14, 30), kind="class")
    session.add_all([mine, other, next_mine, MySection(subject_id=french.id, section="GR5")])
    session.commit()
    assert client.get(f"/api/events/{mine.id}", headers=AUTH).json()["next_event_id"] == next_mine.id
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_api_notes.py -v`
Expected: FAIL (404/405 from missing routes, or import errors).

- [ ] **Step 3: Implement schemas** — append to `backend/app/schemas.py` (add `from datetime import date` already present; add `Field` to the pydantic import):

In `EventOut`, after `source: str` add:

```python
    note_count: int = 0
    open_tasks: int = 0
    important: bool = False
```

At the end of the file:

```python
class NoteOut(BaseModel):
    tab: str
    body: str
    important: bool
    updated_at: str | None


class TaskOut(BaseModel):
    id: int
    title: str
    status: str
    due_date: date | None
    important: bool
    source: str
    note_id: int | None
    event_id: int | None
    subject_id: int | None
    subject_name: str | None
    event_start: str | None
    position: int


class EventDetailOut(BaseModel):
    event: EventOut
    notes: dict[str, NoteOut]
    tasks: list[TaskOut]
    next_event_id: int | None
    next_event_start: str | None
    recurring_rule_id: int | None


class NoteUpdate(BaseModel):
    body: str = Field(default="", max_length=20000)
    important: bool = False
```

- [ ] **Step 4: Implement query helpers** — in `backend/app/services/events_query.py`:

Change the imports to:

```python
import re
from dataclasses import dataclass, replace
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Event, MySection, Note, Semester, Subject, Task
```

Add the three fields at the end of `VisibleEvent`:

```python
    note_count: int = 0
    open_tasks: int = 0
    important: bool = False
```

Add these functions after `_chosen`:

```python
def _to_visible(event: Event, subject: Subject | None) -> VisibleEvent:
    return VisibleEvent(
        id=event.id,
        title=subject.display_name if subject else event.title_raw,
        subject_id=event.subject_id,
        subject_name=subject.display_name if subject else None,
        color=subject.color if subject else None,
        section=event.section,
        start_at=event.start_at,
        end_at=event.end_at,
        room=event.room,
        kind=event.kind,
        status=event.status,
        source=event.source,
    )


def _with_counts(session: Session, events: list[VisibleEvent]) -> list[VisibleEvent]:
    if not events:
        return events
    ids = [e.id for e in events]
    note_counts: dict[int, int] = {}
    important: set[int] = set()
    for event_id, is_important in session.execute(
        select(Note.event_id, Note.important).where(Note.event_id.in_(ids), Note.body != "")
    ):
        note_counts[event_id] = note_counts.get(event_id, 0) + 1
        if is_important:
            important.add(event_id)
    open_tasks = dict(session.execute(
        select(Task.event_id, func.count()).where(Task.event_id.in_(ids), Task.status != "done").group_by(Task.event_id)
    ).all())
    return [replace(e, note_count=note_counts.get(e.id, 0), open_tasks=open_tasks.get(e.id, 0),
                    important=e.id in important) for e in events]


def describe_event(session: Session, event: Event) -> VisibleEvent:
    subject = session.get(Subject, event.subject_id) if event.subject_id is not None else None
    return _with_counts(session, [_to_visible(event, subject)])[0]


def next_event(session: Session, event: Event) -> Event | None:
    if event.recurring_rule_id is not None:
        query = select(Event).where(Event.recurring_rule_id == event.recurring_rule_id)
    elif event.subject_id is not None:
        query = select(Event).where(
            Event.subject_id == event.subject_id,
            or_(Event.section.is_(None), Event.section == event.section),
        )
    else:
        return None
    query = query.where(Event.start_at > event.start_at, Event.status != "cancelled")
    return session.scalars(query.order_by(Event.start_at).limit(1)).first()
```

In `list_visible_events`, replace the whole `visible.append(VisibleEvent(...))` call with:

```python
        visible.append(_to_visible(event, subject))
```

and change its final line to:

```python
    return _with_counts(session, visible), sorted(missing)
```

- [ ] **Step 5: Implement `task_query`** — `backend/app/services/task_query.py`

```python
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Event, Subject, Task
from app.schemas import TaskOut
from app.timeutil import iso_utc


def task_out_list(session: Session, tasks: list[Task]) -> list[TaskOut]:
    subject_ids = {t.subject_id for t in tasks if t.subject_id is not None}
    event_ids = {t.event_id for t in tasks if t.event_id is not None}
    names = dict(session.execute(
        select(Subject.id, Subject.display_name).where(Subject.id.in_(subject_ids))
    ).all()) if subject_ids else {}
    starts = dict(session.execute(
        select(Event.id, Event.start_at).where(Event.id.in_(event_ids))
    ).all()) if event_ids else {}
    return [
        TaskOut(id=t.id, title=t.title, status=t.status, due_date=t.due_date, important=t.important,
                source=t.source, note_id=t.note_id, event_id=t.event_id, subject_id=t.subject_id,
                subject_name=names.get(t.subject_id),
                event_start=iso_utc(starts[t.event_id]) if t.event_id in starts else None,
                position=t.position)
        for t in tasks
    ]
```

- [ ] **Step 6: Implement routers**

In `backend/app/routers/events.py`, add `from app.services.events_query import VisibleEvent` to the existing events_query import, add this function above `get_events`:

```python
def event_out(e: VisibleEvent) -> EventOut:
    return EventOut(id=e.id, title=e.title, subject_id=e.subject_id, subject_name=e.subject_name,
                    color=e.color, section=e.section, start=iso_utc(e.start_at), end=iso_utc(e.end_at),
                    room=e.room, kind=e.kind, status=e.status, source=e.source,
                    note_count=e.note_count, open_tasks=e.open_tasks, important=e.important)
```

and in `get_events` replace the list comprehension body with `events=[event_out(e) for e in events],`.

Create `backend/app/routers/notes.py`:

```python
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.deps import get_now
from app.models import Event, Note, Task
from app.routers.events import event_out
from app.schemas import EventDetailOut, NoteOut, NoteUpdate
from app.services.events_query import describe_event, next_event
from app.services.note_tasks import sync_note_tasks
from app.services.task_query import task_out_list
from app.timeutil import iso_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
TABS = ("after", "before")


def load_event(session: Session, event_id: int) -> Event:
    event = session.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    return event


def build_detail(session: Session, event: Event) -> EventDetailOut:
    notes = {n.tab: n for n in session.scalars(select(Note).where(Note.event_id == event.id))}
    following = next_event(session, event)
    tasks = session.scalars(select(Task).where(Task.event_id == event.id).order_by(Task.position, Task.id)).all()
    return EventDetailOut(
        event=event_out(describe_event(session, event)),
        notes={
            tab: NoteOut(
                tab=tab,
                body=notes[tab].body if tab in notes else "",
                important=notes[tab].important if tab in notes else False,
                updated_at=iso_utc(notes[tab].updated_at) if tab in notes else None,
            )
            for tab in TABS
        },
        tasks=task_out_list(session, list(tasks)),
        next_event_id=following.id if following else None,
        next_event_start=iso_utc(following.start_at) if following else None,
        recurring_rule_id=event.recurring_rule_id,
    )


@router.get("/events/{event_id}", response_model=EventDetailOut)
def get_event(event_id: int, session: Session = Depends(get_session)) -> EventDetailOut:
    return build_detail(session, load_event(session, event_id))


@router.put("/events/{event_id}/notes/{tab}", response_model=EventDetailOut)
def put_note(event_id: int, tab: Literal["after", "before"], body: NoteUpdate,
             session: Session = Depends(get_session), now: datetime = Depends(get_now)) -> EventDetailOut:
    event = load_event(session, event_id)
    note = session.scalar(select(Note).where(Note.event_id == event.id, Note.tab == tab))
    if note is None:
        note = Note(event_id=event.id, tab=tab, body="", important=False, updated_at=now)
        session.add(note)
        session.flush()
    note.body, note.important, note.updated_at = body.body, body.important, now
    sync_note_tasks(session, note, event, now)
    session.commit()
    return build_detail(session, event)
```

In `backend/app/main.py`, change the import and loop to:

```python
from app.routers import events, health, notes, settings, sync
```
```python
    for module in (health, events, notes, settings, sync):
```

- [ ] **Step 7: Run the backend suite**

Run: `cd backend && rm -rf tests/__pycache__ && uv run pytest -q`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas.py backend/app/services/events_query.py backend/app/services/task_query.py backend/app/routers/events.py backend/app/routers/notes.py backend/app/main.py backend/tests/test_api_notes.py
git commit -m "feat(api): event detail and notes with task extraction" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: API — custom events and weekly rules

**Files:**
- Modify: `backend/app/schemas.py`, `backend/app/main.py`
- Create: `backend/app/routers/custom_events.py`
- Test: `backend/tests/test_api_custom_events.py`

**Interfaces:**
- Consumes: `regenerate`, `delete_rule`, `delete_event_cascade` (Task 5); `event_out` (Task 6); `describe_event` (Task 6); `active_semester` (Plan 1).
- Produces:
  - schemas `CustomKind = Literal["work", "french_ext", "other"]`, `CustomEventIn{title (1–200), kind, start: datetime, end: datetime, room (≤200)=""}`, `RecurringRuleIn{title, kind, weekdays: list[int] (1–7 items, each 0–6, deduplicated+sorted), start_time/end_time "HH:MM", from_date, until_date (≥ from_date, ≤ 400 days later), location=""}` (start_time ≠ end_time), `RecurringRuleOut{id, title, kind, weekdays, start_time, end_time, from_date, until_date, location, occurrences: int}`, `Deleted{deleted: bool}`
  - HTTP: `POST /api/events` (201, `EventOut`); `PUT /api/events/{id}` (`EventOut`; detaches from its rule); `DELETE /api/events/{id}` (`{"deleted": true}`); school events → 400; end ≤ start or > 24 h → 422; no active semester → 409. `GET /api/recurring` (`list[RecurringRuleOut]`), `POST /api/recurring` (201), `PUT /api/recurring/{id}`, `DELETE /api/recurring/{id}` (`{"deleted": true}`); unknown id → 404.

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_api_custom_events.py`

```python
from datetime import datetime

from sqlalchemy import select

from app.models import Event, Note
from tests.conftest import AUTH

ONE_OFF = {"title": "Work shift", "kind": "work", "start": "2026-10-21T10:00:00Z",
           "end": "2026-10-21T14:00:00Z", "room": "Café"}
WEEKLY = {"title": "French (external)", "kind": "french_ext", "weekdays": [0, 3], "start_time": "19:30",
          "end_time": "21:00", "from_date": "2026-10-19", "until_date": "2026-11-01", "location": "Alliance"}


def test_create_one_off_event_shows_in_week(client, semester):
    resp = client.post("/api/events", headers=AUTH, json=ONE_OFF)
    assert resp.status_code == 201
    created = resp.json()
    assert (created["source"], created["kind"], created["title"], created["room"]) == ("custom", "work", "Work shift", "Café")
    events = client.get("/api/events?start=2026-10-18T22:00:00Z&end=2026-10-25T23:00:00Z", headers=AUTH).json()["events"]
    assert [e["id"] for e in events] == [created["id"]]


def test_create_validates_times_and_semester(client, session):
    from app.models import Semester

    assert client.post("/api/events", headers=AUTH, json=ONE_OFF).status_code == 409  # no active semester yet
    session.add(Semester(code="S1", name="SE S1", is_active=True))
    session.commit()
    assert client.post("/api/events", headers=AUTH, json={**ONE_OFF, "end": "2026-10-21T09:00:00Z"}).status_code == 422
    assert client.post("/api/events", headers=AUTH, json={**ONE_OFF, "end": "2026-10-23T10:00:00Z"}).status_code == 422
    assert client.post("/api/events", headers=AUTH, json={**ONE_OFF, "kind": "class"}).status_code == 422


def test_update_and_delete_custom_event(client, session, semester):
    created = client.post("/api/events", headers=AUTH, json=ONE_OFF).json()
    updated = client.put(f"/api/events/{created['id']}", headers=AUTH,
                         json={**ONE_OFF, "title": "Long shift", "end": "2026-10-21T16:00:00Z"}).json()
    assert (updated["title"], updated["end"]) == ("Long shift", "2026-10-21T16:00:00Z")
    client.put(f"/api/events/{created['id']}/notes/after", headers=AUTH, json={"body": "[ ] Return keys"})
    assert client.delete(f"/api/events/{created['id']}", headers=AUTH).json() == {"deleted": True}
    assert session.scalar(select(Event)) is None
    assert session.scalar(select(Note)) is None


def test_school_events_cannot_be_edited_or_deleted(client, session, semester):
    school = Event(source="zeus", zeus_uid="z1", semester_id=semester.id, title_raw="Harmonization",
                   start_at=datetime(2026, 10, 20, 7, 0), end_at=datetime(2026, 10, 20, 10, 0), kind="class")
    session.add(school)
    session.commit()
    assert client.put(f"/api/events/{school.id}", headers=AUTH, json=ONE_OFF).status_code == 400
    assert client.delete(f"/api/events/{school.id}", headers=AUTH).status_code == 400
    assert client.delete("/api/events/999", headers=AUTH).status_code == 404


def test_weekly_rule_crud(client, session, semester):
    resp = client.post("/api/recurring", headers=AUTH, json=WEEKLY)
    assert resp.status_code == 201
    rule = resp.json()
    assert (rule["weekdays"], rule["occurrences"]) == ([0, 3], 4)  # Mon 19, Thu 22, Mon 26, Thu 29 Oct
    assert [r["id"] for r in client.get("/api/recurring", headers=AUTH).json()] == [rule["id"]]

    changed = client.put(f"/api/recurring/{rule['id']}", headers=AUTH, json={**WEEKLY, "weekdays": [0]}).json()
    assert changed["occurrences"] == 2

    assert client.delete(f"/api/recurring/{rule['id']}", headers=AUTH).json() == {"deleted": True}
    assert client.get("/api/recurring", headers=AUTH).json() == []
    assert session.scalars(select(Event)).all() == []
    assert client.delete(f"/api/recurring/{rule['id']}", headers=AUTH).status_code == 404


def test_weekly_rule_validation(client, semester):
    for bad in ({**WEEKLY, "weekdays": []}, {**WEEKLY, "weekdays": [7]}, {**WEEKLY, "start_time": "25:00"},
                {**WEEKLY, "end_time": "19:30"}, {**WEEKLY, "until_date": "2026-10-01"},
                {**WEEKLY, "until_date": "2028-01-01"}):
        assert client.post("/api/recurring", headers=AUTH, json=bad).status_code == 422, bad
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_api_custom_events.py -v`
Expected: FAIL (405 Method Not Allowed / 404).

- [ ] **Step 3: Implement schemas** — append to `backend/app/schemas.py` (extend imports: `from typing import Literal`; `from pydantic import BaseModel, Field, field_validator, model_validator`):

```python
CustomKind = Literal["work", "french_ext", "other"]
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


class CustomEventIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: CustomKind
    start: datetime
    end: datetime
    room: str = Field(default="", max_length=200)


class RecurringRuleIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: CustomKind
    weekdays: list[int] = Field(min_length=1, max_length=7)
    start_time: str = Field(pattern=HHMM)
    end_time: str = Field(pattern=HHMM)
    from_date: date
    until_date: date
    location: str = Field(default="", max_length=200)

    @field_validator("weekdays")
    @classmethod
    def _valid_weekdays(cls, value: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in value):
            raise ValueError("weekdays must be 0 (Monday) to 6 (Sunday)")
        return sorted(set(value))

    @model_validator(mode="after")
    def _valid_range(self) -> "RecurringRuleIn":
        if self.until_date < self.from_date:
            raise ValueError("until_date must be on or after from_date")
        if (self.until_date - self.from_date).days > 400:
            raise ValueError("a repeating event can span at most 400 days")
        if self.start_time == self.end_time:
            raise ValueError("start and end time must differ")
        return self


class RecurringRuleOut(BaseModel):
    id: int
    title: str
    kind: str
    weekdays: list[int]
    start_time: str
    end_time: str
    from_date: date
    until_date: date
    location: str
    occurrences: int


class Deleted(BaseModel):
    deleted: bool
```

(`datetime` must be imported in schemas: `from datetime import date, datetime`.)

- [ ] **Step 4: Implement the router** — `backend/app/routers/custom_events.py`

```python
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.deps import get_now
from app.models import Event, RecurringRule, Semester
from app.routers.events import event_out
from app.schemas import CustomEventIn, Deleted, EventOut, RecurringRuleIn, RecurringRuleOut
from app.services.events_query import active_semester, describe_event
from app.services.recurrence import delete_event_cascade, delete_rule, regenerate
from app.timeutil import to_naive_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
MAX_EVENT = timedelta(hours=24)


def _semester(session: Session) -> Semester:
    semester = active_semester(session)
    if semester is None:
        raise HTTPException(status_code=409, detail="no active semester")
    return semester


def _span(body: CustomEventIn) -> tuple[datetime, datetime]:
    start, end = to_naive_utc(body.start), to_naive_utc(body.end)
    if end <= start or end - start > MAX_EVENT:
        raise HTTPException(status_code=422, detail="end must be after start and within 24 hours")
    return start, end


def _custom_event(session: Session, event_id: int) -> Event:
    event = session.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    if event.source != "custom":
        raise HTTPException(status_code=400, detail="school classes cannot be edited or deleted")
    return event


@router.post("/events", response_model=EventOut, status_code=201)
def create_event(body: CustomEventIn, session: Session = Depends(get_session)) -> EventOut:
    semester = _semester(session)
    start, end = _span(body)
    event = Event(source="custom", semester_id=semester.id, subject_id=None, section=None,
                  title_raw=body.title.strip(), start_at=start, end_at=end, room=body.room.strip(),
                  description="", kind=body.kind, status="normal")
    session.add(event)
    session.commit()
    return event_out(describe_event(session, event))


@router.put("/events/{event_id}", response_model=EventOut)
def update_event(event_id: int, body: CustomEventIn, session: Session = Depends(get_session)) -> EventOut:
    event = _custom_event(session, event_id)
    start, end = _span(body)
    event.title_raw, event.kind, event.room = body.title.strip(), body.kind, body.room.strip()
    event.start_at, event.end_at = start, end
    event.recurring_rule_id = None  # an edited occurrence no longer follows its weekly rule
    session.commit()
    return event_out(describe_event(session, event))


@router.delete("/events/{event_id}", response_model=Deleted)
def delete_event(event_id: int, session: Session = Depends(get_session)) -> Deleted:
    delete_event_cascade(session, _custom_event(session, event_id))
    session.commit()
    return Deleted(deleted=True)


def _rule_out(session: Session, rule: RecurringRule) -> RecurringRuleOut:
    count = session.scalar(select(func.count()).select_from(Event).where(Event.recurring_rule_id == rule.id))
    return RecurringRuleOut(id=rule.id, title=rule.title, kind=rule.kind, weekdays=rule.weekdays,
                            start_time=rule.start_time, end_time=rule.end_time, from_date=rule.from_date,
                            until_date=rule.until_date, location=rule.location, occurrences=count or 0)


def _rule(session: Session, rule_id: int) -> RecurringRule:
    rule = session.get(RecurringRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="repeating event not found")
    return rule


def _apply(rule: RecurringRule, body: RecurringRuleIn) -> None:
    rule.title, rule.kind, rule.weekdays = body.title.strip(), body.kind, body.weekdays
    rule.start_time, rule.end_time = body.start_time, body.end_time
    rule.from_date, rule.until_date, rule.location = body.from_date, body.until_date, body.location.strip()


@router.get("/recurring", response_model=list[RecurringRuleOut])
def list_rules(session: Session = Depends(get_session)) -> list[RecurringRuleOut]:
    semester = active_semester(session)
    if semester is None:
        return []
    rules = session.scalars(select(RecurringRule).where(RecurringRule.semester_id == semester.id).order_by(RecurringRule.id))
    return [_rule_out(session, r) for r in rules]


@router.post("/recurring", response_model=RecurringRuleOut, status_code=201)
def create_rule(body: RecurringRuleIn, session: Session = Depends(get_session),
                now: datetime = Depends(get_now)) -> RecurringRuleOut:
    rule = RecurringRule(semester_id=_semester(session).id)
    _apply(rule, body)
    session.add(rule)
    session.flush()
    regenerate(session, rule, now)
    session.commit()
    return _rule_out(session, rule)


@router.put("/recurring/{rule_id}", response_model=RecurringRuleOut)
def update_rule(rule_id: int, body: RecurringRuleIn, session: Session = Depends(get_session),
                now: datetime = Depends(get_now)) -> RecurringRuleOut:
    rule = _rule(session, rule_id)
    _apply(rule, body)
    regenerate(session, rule, now)
    session.commit()
    return _rule_out(session, rule)


@router.delete("/recurring/{rule_id}", response_model=Deleted)
def remove_rule(rule_id: int, session: Session = Depends(get_session), now: datetime = Depends(get_now)) -> Deleted:
    delete_rule(session, _rule(session, rule_id), now)
    session.commit()
    return Deleted(deleted=True)
```

Register it in `backend/app/main.py`:

```python
from app.routers import custom_events, events, health, notes, settings, sync
```
```python
    for module in (health, events, notes, custom_events, settings, sync):
```

Note on the test clock: the test client's `get_now` is `2026-10-15 12:00`, so all October 19+ occurrences are in the future.

- [ ] **Step 5: Run the backend suite**

Run: `cd backend && rm -rf tests/__pycache__ && uv run pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/custom_events.py backend/app/main.py backend/tests/test_api_custom_events.py
git commit -m "feat(api): create, edit and delete my own events and weekly repeats" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: API — tasks

**Files:**
- Modify: `backend/app/schemas.py`, `backend/app/main.py`
- Create: `backend/app/routers/tasks.py`
- Test: `backend/tests/test_api_tasks.py`

**Interfaces:**
- Consumes: `task_out_list` (Task 6), `update_line` (Task 4), models.
- Produces:
  - schemas `TaskCreate{title (1–300), due_date: date|None=None, subject_id: int|None=None, important: bool=False}`, `TaskPatch{status: "todo"|"doing"|"done"|None, due_date: date|None, title: str|None (1–300), important: bool|None}` (only fields actually sent are applied; `due_date: null` clears it)
  - HTTP: `GET /api/tasks?status=&subject_id=` → `list[TaskOut]` ordered by due date (none last), position, id; `POST /api/tasks` (201) → manual task; `PATCH /api/tasks/{id}` → `TaskOut` (note tasks: renaming → 422; status/due changes are written back into the note line); `DELETE /api/tasks/{id}` → `{"deleted": true}` (note tasks → 400); unknown → 404.

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_api_tasks.py`

```python
from datetime import datetime

from app.models import Event, Note, Subject
from tests.conftest import AUTH


def class_with_note(client, session, semester, body: str) -> int:
    subject = Subject(semester_id=semester.id, display_name="Introduction to Python", aliases=[])
    session.add(subject)
    session.flush()
    event = Event(source="zeus", zeus_uid="py1", semester_id=semester.id, subject_id=subject.id,
                  title_raw="Introduction to Python", start_at=datetime(2026, 10, 21, 15, 0),
                  end_at=datetime(2026, 10, 21, 18, 0), kind="class")
    session.add(event)
    session.commit()
    client.put(f"/api/events/{event.id}/notes/after", headers=AUTH, json={"body": body})
    return event.id


def test_list_orders_by_due_date_then_position(client, session, semester):
    class_with_note(client, session, semester, "[ ] No date\n[ ] Later @2026-10-30\n[ ] Soon @2026-10-22")
    client.post("/api/tasks", headers=AUTH, json={"title": "Buy notebook", "due_date": "2026-10-25"})
    titles = [t["title"] for t in client.get("/api/tasks", headers=AUTH).json()]
    assert titles == ["Soon", "Buy notebook", "Later", "No date"]
    assert [t["title"] for t in client.get("/api/tasks?status=todo", headers=AUTH).json()] == titles
    assert client.get("/api/tasks?status=done", headers=AUTH).json() == []


def test_create_manual_task(client, semester):
    resp = client.post("/api/tasks", headers=AUTH, json={"title": "  Buy notebook  ", "important": True})
    assert resp.status_code == 201
    task = resp.json()
    assert (task["title"], task["source"], task["status"], task["important"], task["event_id"]) == (
        "Buy notebook", "manual", "todo", True, None)
    assert client.post("/api/tasks", headers=AUTH, json={"title": "x", "subject_id": 999}).status_code == 422


def test_status_change_writes_back_to_note(client, session, semester):
    event_id = class_with_note(client, session, semester, "Lab notes\n[ ] Set up venv\n[ ] Read PEP 8")
    venv = client.get("/api/tasks", headers=AUTH).json()[0]
    assert venv["title"] == "Set up venv"

    done = client.patch(f"/api/tasks/{venv['id']}", headers=AUTH, json={"status": "done"}).json()
    assert done["status"] == "done"
    note_body = client.get(f"/api/events/{event_id}", headers=AUTH).json()["notes"]["after"]["body"]
    assert note_body == "Lab notes\n[x] Set up venv\n[ ] Read PEP 8"

    # re-saving the note as shown keeps the task done
    client.put(f"/api/events/{event_id}/notes/after", headers=AUTH, json={"body": note_body})
    statuses = {t["title"]: t["status"] for t in client.get("/api/tasks", headers=AUTH).json()}
    assert statuses == {"Set up venv": "done", "Read PEP 8": "todo"}


def test_doing_and_due_date_write_back(client, session, semester):
    event_id = class_with_note(client, session, semester, "[ ] Read PEP 8")
    task = client.get("/api/tasks", headers=AUTH).json()[0]
    client.patch(f"/api/tasks/{task['id']}", headers=AUTH, json={"status": "doing", "due_date": "2026-10-24"})
    body = client.get(f"/api/events/{event_id}", headers=AUTH).json()["notes"]["after"]["body"]
    assert body == "[ ] Read PEP 8 @2026-10-24"
    cleared = client.patch(f"/api/tasks/{task['id']}", headers=AUTH, json={"due_date": None}).json()
    assert (cleared["status"], cleared["due_date"]) == ("doing", None)


def test_note_tasks_cannot_be_renamed_or_deleted(client, session, semester):
    class_with_note(client, session, semester, "[ ] Read PEP 8")
    task = client.get("/api/tasks", headers=AUTH).json()[0]
    assert client.patch(f"/api/tasks/{task['id']}", headers=AUTH, json={"title": "Other"}).status_code == 422
    assert client.delete(f"/api/tasks/{task['id']}", headers=AUTH).status_code == 400


def test_manual_task_rename_and_delete(client, semester):
    task = client.post("/api/tasks", headers=AUTH, json={"title": "Buy notebook"}).json()
    renamed = client.patch(f"/api/tasks/{task['id']}", headers=AUTH, json={"title": "Buy 2 notebooks"}).json()
    assert renamed["title"] == "Buy 2 notebooks"
    assert client.delete(f"/api/tasks/{task['id']}", headers=AUTH).json() == {"deleted": True}
    assert client.get("/api/tasks", headers=AUTH).json() == []
    assert client.patch("/api/tasks/999", headers=AUTH, json={"status": "done"}).status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_api_tasks.py -v`
Expected: FAIL (404 on `/api/tasks`).

- [ ] **Step 3: Implement schemas** — append to `backend/app/schemas.py`:

```python
class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    due_date: date | None = None
    subject_id: int | None = None
    important: bool = False


class TaskPatch(BaseModel):
    status: Literal["todo", "doing", "done"] | None = None
    due_date: date | None = None
    title: str | None = Field(default=None, min_length=1, max_length=300)
    important: bool | None = None
```

- [ ] **Step 4: Implement the router** — `backend/app/routers/tasks.py`

```python
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.deps import get_now
from app.models import Note, Subject, Task
from app.schemas import Deleted, TaskCreate, TaskOut, TaskPatch
from app.services.note_tasks import update_line
from app.services.task_query import task_out_list

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


def _task(session: Session, task_id: int) -> Task:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(status: Literal["todo", "doing", "done"] | None = None, subject_id: int | None = None,
               session: Session = Depends(get_session)) -> list[TaskOut]:
    query = select(Task)
    if status is not None:
        query = query.where(Task.status == status)
    if subject_id is not None:
        query = query.where(Task.subject_id == subject_id)
    query = query.order_by(Task.due_date.is_(None), Task.due_date, Task.position, Task.id)
    return task_out_list(session, list(session.scalars(query)))


@router.post("/tasks", response_model=TaskOut, status_code=201)
def create_task(body: TaskCreate, session: Session = Depends(get_session),
                now: datetime = Depends(get_now)) -> TaskOut:
    if body.subject_id is not None and session.get(Subject, body.subject_id) is None:
        raise HTTPException(status_code=422, detail="unknown subject")
    task = Task(note_id=None, event_id=None, subject_id=body.subject_id, title=body.title.strip(),
                status="todo", due_date=body.due_date, important=body.important, position=0,
                source="manual", created_at=now)
    session.add(task)
    session.commit()
    return task_out_list(session, [task])[0]


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def patch_task(task_id: int, body: TaskPatch, session: Session = Depends(get_session)) -> TaskOut:
    task = _task(session, task_id)
    sent = body.model_fields_set
    if "title" in sent and body.title is not None:
        if task.source == "note":
            raise HTTPException(status_code=422, detail="edit the class note to rename this task")
        task.title = body.title.strip()
    if "status" in sent and body.status is not None:
        task.status = body.status
    if "due_date" in sent:
        task.due_date = body.due_date
    if "important" in sent and body.important is not None:
        task.important = body.important
    if task.source == "note" and task.note_id is not None and sent & {"status", "due_date"}:
        note = session.get(Note, task.note_id)
        twins = session.scalars(
            select(Task.id).where(Task.note_id == task.note_id, Task.title == task.title).order_by(Task.position, Task.id)
        ).all()
        note.body = update_line(note.body, task.title, task.status == "done", task.due_date, list(twins).index(task.id))
    session.commit()
    return task_out_list(session, [task])[0]


@router.delete("/tasks/{task_id}", response_model=Deleted)
def delete_task(task_id: int, session: Session = Depends(get_session)) -> Deleted:
    task = _task(session, task_id)
    if task.source == "note":
        raise HTTPException(status_code=400, detail="remove the line from the class note to delete this task")
    session.delete(task)
    session.commit()
    return Deleted(deleted=True)
```

Register it in `backend/app/main.py`:

```python
from app.routers import custom_events, events, health, notes, settings, sync, tasks
```
```python
    for module in (health, events, notes, custom_events, tasks, settings, sync):
```

- [ ] **Step 5: Run the backend suite**

Run: `cd backend && rm -rf tests/__pycache__ && uv run pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/tasks.py backend/app/main.py backend/tests/test_api_tasks.py
git commit -m "feat(api): task board endpoints with note write-back" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Frontend foundations — types, time helpers, clickable week grid

**Files:**
- Modify: `frontend/src/types.ts`, `frontend/src/lib/time.ts`, `frontend/src/components/WeekGrid.tsx`, `frontend/src/pages/CalendarPage.tsx`
- Test: `frontend/src/lib/time.test.ts`, `frontend/src/components/WeekGrid.test.tsx`

**Interfaces:**
- Consumes: HTTP shapes from Tasks 6–8.
- Produces:
  - types: `ApiEvent` + `note_count: number; open_tasks: number; important: boolean`; `NoteTab = "after" | "before"`; `Note`; `Task`; `TaskStatus`; `EventDetail`; `CustomKind`; `RecurringRule` (fields exactly as the backend schemas).
  - `parisLocalToUtc(date: "YYYY-MM-DD", hhmm: "HH:MM") -> ISO string`; `weekdayIndex(date) -> 0..6` (Mon = 0).
  - `WeekGrid` prop `onSelect?: (id: number) => void` — when given, each event block has a full-size button `aria-label="Open <title>"`; badges "Note", "N task(s)", "Important"; custom colours (work `#3B4252`, external French `#0E7F72` + dashed outline).
  - CalendarPage: "Add event" link to `/events/new`; clicking an event navigates to `/events/:id`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/time.test.ts` (and add `parisLocalToUtc, weekdayIndex` to its import):

```ts
describe("Paris local → UTC", () => {
  it("converts summer and winter local times", () => {
    expect(parisLocalToUtc("2026-10-19", "19:30")).toBe("2026-10-19T17:30:00.000Z");
    expect(parisLocalToUtc("2026-10-26", "19:30")).toBe("2026-10-26T18:30:00.000Z");
  });
  it("weekdayIndex is Monday-based", () => {
    expect(weekdayIndex("2026-10-19")).toBe(0);
    expect(weekdayIndex("2026-10-25")).toBe(6);
  });
});
```

In `frontend/src/components/WeekGrid.test.tsx`, extend the `event()` factory defaults with `note_count: 0, open_tasks: 0, important: false,` (so the object matches the new `ApiEvent` type), add `import userEvent from "@testing-library/user-event";` and `vi` to the vitest import, and append:

```tsx
  it("opens an event when onSelect is given", async () => {
    const onSelect = vi.fn();
    render(<WeekGrid days={WEEK} events={[event({ id: 42 })]} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "Open French for Fall 26 T1 GR5" }));
    expect(onSelect).toHaveBeenCalledWith(42);
  });

  it("shows note, task and important badges", () => {
    render(<WeekGrid days={WEEK} events={[event({ note_count: 1, open_tasks: 2, important: true })]} />);
    expect(screen.getByText("Note")).toBeInTheDocument();
    expect(screen.getByText("2 tasks")).toBeInTheDocument();
    expect(screen.getByText("Important")).toBeInTheDocument();
  });

  it("marks external French with a dashed outline", () => {
    render(<WeekGrid days={WEEK} events={[event({ title: "French (external)", kind: "french_ext", color: null, section: null, subject_id: null })]} />);
    expect(screen.getByRole("group").dataset.kind).toBe("french_ext");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/time.test.ts src/components/WeekGrid.test.tsx`
Expected: FAIL (missing exports / props).

- [ ] **Step 3: Implement types** — append to `frontend/src/types.ts` and extend `ApiEvent`:

In `ApiEvent`, after `source`, add:

```ts
  note_count: number;
  open_tasks: number;
  important: boolean;
```

At the end of the file:

```ts
export type NoteTab = "after" | "before";
export type TaskStatus = "todo" | "doing" | "done";
export type CustomKind = "work" | "french_ext" | "other";

export interface Note {
  tab: NoteTab;
  body: string;
  important: boolean;
  updated_at: string | null;
}

export interface Task {
  id: number;
  title: string;
  status: TaskStatus;
  due_date: string | null;
  important: boolean;
  source: "note" | "manual";
  note_id: number | null;
  event_id: number | null;
  subject_id: number | null;
  subject_name: string | null;
  event_start: string | null;
  position: number;
}

export interface EventDetail {
  event: ApiEvent;
  notes: Record<NoteTab, Note>;
  tasks: Task[];
  next_event_id: number | null;
  next_event_start: string | null;
  recurring_rule_id: number | null;
}

export interface RecurringRule {
  id: number;
  title: string;
  kind: CustomKind;
  weekdays: number[];
  start_time: string;
  end_time: string;
  from_date: string;
  until_date: string;
  location: string;
  occurrences: number;
}
```

- [ ] **Step 4: Implement time helpers** — append to `frontend/src/lib/time.ts`:

```ts
export function parisLocalToUtc(date: string, hhmm: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const firstGuess = naive - offsetMinutes(naive) * 60_000;
  return new Date(naive - offsetMinutes(firstGuess) * 60_000).toISOString();
}

export function weekdayIndex(date: string): number {
  return (utcNoon(date).getUTCDay() + 6) % 7;
}
```

- [ ] **Step 5: Implement the week grid changes** — in `frontend/src/components/WeekGrid.tsx`:

Change `interface Props` to add `onSelect?: (id: number) => void;`, destructure it in `WeekGrid({ days, events, hourHeight = 52, onSelect }: Props)`, and pass `onSelect={onSelect}` to every `<EventBlock .../>`.

Replace the whole `EventBlock` function with:

```tsx
const KIND_COLORS: Partial<Record<ApiEvent["kind"], string>> = { work: "#3B4252", french_ext: "#0E7F72" };

function EventBlock({
  ev,
  style,
  column,
  columns,
  onSelect,
}: {
  ev: ApiEvent;
  style: CSSProperties;
  column: number;
  columns: number;
  onSelect?: (id: number) => void;
}) {
  const color = ev.color ?? KIND_COLORS[ev.kind] ?? "#3B4252";
  const title = ev.section ? `${ev.title} ${ev.section}` : ev.title;
  const label = `${title}, ${formatTime(ev.start)} to ${formatTime(ev.end)}${ev.room ? `, ${ev.room}` : ""}`;
  const outline = ev.kind === "french_ext" ? { border: `1.5px dashed ${color}`, background: "#FFFFFF" } : { background: `${color}1F` };
  return (
    <div
      role="group"
      aria-label={label}
      data-column={column}
      data-columns={columns}
      data-kind={ev.kind}
      className={`absolute flex flex-col gap-0.5 overflow-hidden rounded-lg px-2 py-1.5 text-xs ${ev.status === "cancelled" ? "line-through opacity-60" : ""}`}
      style={{ ...style, ...outline }}
    >
      {onSelect && (
        <button
          type="button"
          aria-label={`Open ${title}`}
          className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => onSelect(ev.id)}
        />
      )}
      <span className="flex items-center gap-1.5 leading-tight font-bold">
        <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
        {ev.title}
        {ev.section ? ` · ${ev.section}` : ""}
      </span>
      <span className="font-mono text-[10.5px] text-[#3A3F4B]">
        {formatTime(ev.start)}–{formatTime(ev.end)}
      </span>
      {ev.room && <span className="text-[11px] text-[#3A3F4B]">{ev.room}</span>}
      <span className="flex flex-wrap gap-1">
        {ev.kind === "exam" && <span className="rounded-full bg-[#8B1A1A] px-1.5 text-[10.5px] font-bold text-white">Exam</span>}
        {ev.status === "changed" && <span className="rounded-full bg-[#9A3412] px-1.5 text-[10.5px] font-bold text-white">Changed</span>}
        {ev.important && <span className="rounded-full bg-[#FFF1E0] px-1.5 text-[10.5px] font-bold text-[#7C2D12]">Important</span>}
        {ev.note_count > 0 && <span className="rounded-full bg-white px-1.5 text-[10.5px] font-semibold">Note</span>}
        {ev.open_tasks > 0 && (
          <span className="rounded-full bg-white px-1.5 text-[10.5px] font-semibold">
            {ev.open_tasks} {ev.open_tasks === 1 ? "task" : "tasks"}
          </span>
        )}
      </span>
    </div>
  );
}
```

- [ ] **Step 6: Wire the calendar** — in `frontend/src/pages/CalendarPage.tsx`:

Add `import { Link, useNavigate } from "react-router";`, then inside the component `const navigate = useNavigate();`. In the header, after the View toggle group, add:

```tsx
        <Link to="/events/new" className="flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong">
          Add event
        </Link>
```

and change the grid to `<WeekGrid days={days} events={events.data?.events ?? []} onSelect={(id) => navigate(`/events/${id}`)} />`.

- [ ] **Step 7: Run tests and build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all pass; build OK.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types.ts frontend/src/lib/time.ts frontend/src/lib/time.test.ts frontend/src/components/WeekGrid.tsx frontend/src/components/WeekGrid.test.tsx frontend/src/pages/CalendarPage.tsx
git commit -m "feat(frontend): clickable events with note/task badges and custom event colours" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Event detail page (notes + tasks)

**Files:**
- Create: `frontend/src/pages/EventPage.tsx`, `frontend/src/pages/EventPage.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `apiFetch`; types `EventDetail`, `NoteTab`, `Task` (Task 9); time helpers.
- Produces: route `/events/:id` rendering `EventPage`: header (subject, source/kind, status, date/time/room, "Next class" link), tabs **After class / Before next class** each with its own unsaved draft, textarea `aria-label="After class note"` / `"Before next class note"`, Important checkbox, **Save note** button (disabled when nothing changed), task checklist (checkbox toggles done/todo via `PATCH /api/tasks/{id}`), and for custom events a two-click **Delete event** button.

- [ ] **Step 1: Write the failing test** — `frontend/src/pages/EventPage.test.tsx`

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDetail } from "../types";
import { EventPage } from "./EventPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const detail = (over: Partial<EventDetail["event"]> = {}): EventDetail => ({
  event: {
    id: 7, title: "Relational Databases", subject_id: 1, subject_name: "Relational Databases", color: "#2E55E6",
    section: null, start: "2026-10-19T11:00:00Z", end: "2026-10-19T13:00:00Z", room: "KB602", kind: "class",
    status: "normal", source: "zeus", note_count: 1, open_tasks: 1, important: false, ...over,
  },
  notes: {
    after: { tab: "after", body: "[ ] Redo ex 3", important: false, updated_at: "2026-10-19T15:00:00Z" },
    before: { tab: "before", body: "Bring laptop", important: false, updated_at: "2026-10-19T15:00:00Z" },
  },
  tasks: [{ id: 3, title: "Redo ex 3", status: "todo", due_date: null, important: false, source: "note", note_id: 1,
            event_id: 7, subject_id: 1, subject_name: "Relational Databases", event_start: "2026-10-19T11:00:00Z", position: 0 }],
  next_event_id: 8,
  next_event_start: "2026-11-09T12:00:00Z",
  recurring_rule_id: null,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/events/7"]}>
        <Routes>
          <Route path="/events/:id" element={<EventPage />} />
          <Route path="/" element={<p>Calendar home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EventPage", () => {
  beforeEach(() => apiFetch.mockReset());

  it("shows the class, its notes per tab and the next class", async () => {
    apiFetch.mockResolvedValue(detail());
    renderPage();
    expect(await screen.findByRole("heading", { name: "Relational Databases" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "After class note" })).toHaveValue("[ ] Redo ex 3");
    expect(screen.getByRole("link", { name: /Next class/ })).toHaveAttribute("href", "/events/8");
    await userEvent.click(screen.getByRole("tab", { name: "Before next class" }));
    expect(screen.getByRole("textbox", { name: "Before next class note" })).toHaveValue("Bring laptop");
  });

  it("saves the edited note with the Important flag", async () => {
    apiFetch.mockResolvedValue(detail());
    renderPage();
    const box = await screen.findByRole("textbox", { name: "After class note" });
    const save = screen.getByRole("button", { name: "Save note" });
    expect(save).toBeDisabled();
    fireEvent.change(box, { target: { value: "[ ] Redo ex 3\n[ ] Read ch. 4" } });
    await userEvent.click(screen.getByRole("checkbox", { name: "Important" }));
    await userEvent.click(save);
    expect(apiFetch).toHaveBeenCalledWith("/api/events/7/notes/after", {
      method: "PUT",
      body: JSON.stringify({ body: "[ ] Redo ex 3\n[ ] Read ch. 4", important: true }),
    });
  });

  it("ticks a task", async () => {
    apiFetch.mockResolvedValue(detail());
    renderPage();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Redo ex 3" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/tasks/3", { method: "PATCH", body: JSON.stringify({ status: "done" }) });
  });

  it("deletes a custom event only after a second click", async () => {
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) =>
      init?.method === "DELETE" ? { deleted: true } : detail({ source: "custom", kind: "work", subject_name: null, subject_id: null, title: "Work shift" }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Delete event" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/api/events/7", { method: "DELETE" });
    await userEvent.click(screen.getByRole("button", { name: "Click again to delete" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/events/7", { method: "DELETE" });
    expect(await screen.findByText("Calendar home")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/EventPage.test.tsx`
Expected: FAIL — cannot resolve `./EventPage`.

- [ ] **Step 3: Implement** — `frontend/src/pages/EventPage.tsx`

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { apiFetch } from "../lib/api";
import { dayLabel, formatLongDate, formatTime, parisParts } from "../lib/time";
import type { EventDetail, NoteTab, Task } from "../types";

const TABS: { id: NoteTab; label: string }[] = [
  { id: "after", label: "After class" },
  { id: "before", label: "Before next class" },
];
const KIND_LABEL: Record<string, string> = { work: "Work", french_ext: "French (external)", other: "My event" };
const chip = "rounded-full bg-[#F0F1F4] px-2.5 py-1 text-xs font-semibold text-[#3A3F4B]";

interface Draft {
  body: string;
  important: boolean;
}

export function EventPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<NoteTab>("after");
  const [drafts, setDrafts] = useState<Partial<Record<NoteTab, Draft>>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const detail = useQuery({ queryKey: ["event", id], queryFn: () => apiFetch<EventDetail>(`/api/events/${id}`) });

  const invalidateLists = () => {
    queryClient.invalidateQueries({ queryKey: ["events"] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };
  const save = useMutation({
    mutationFn: (v: { tab: NoteTab; draft: Draft }) =>
      apiFetch<EventDetail>(`/api/events/${id}/notes/${v.tab}`, { method: "PUT", body: JSON.stringify(v.draft) }),
    onSuccess: (data, v) => {
      queryClient.setQueryData(["event", id], data);
      setDrafts((d) => {
        const next = { ...d };
        delete next[v.tab];
        return next;
      });
      invalidateLists();
    },
  });
  const toggleTask = useMutation({
    mutationFn: (task: Task) =>
      apiFetch<Task>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: task.status === "done" ? "todo" : "done" }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event", id] });
      invalidateLists();
    },
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/events/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateLists();
      navigate("/");
    },
  });

  if (detail.error) return <ErrorPanel error={detail.error} onRetry={() => detail.refetch()} />;
  if (!detail.data) return <p className="text-muted">Loading…</p>;

  const { event, tasks, notes } = detail.data;
  const saved = notes[tab];
  const current: Draft = drafts[tab] ?? { body: saved.body, important: saved.important };
  const setCurrent = (patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [tab]: { ...current, ...patch } }));
  const dirty = current.body !== saved.body || current.important !== saved.important;
  const start = parisParts(event.start);
  const nextStart = detail.data.next_event_start;
  const tabLabel = TABS.find((t) => t.id === tab)!.label;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/" className="text-sm font-semibold text-accent">
        ‹ Back to calendar
      </Link>
      <article className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-5 md:p-7">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {event.subject_name && <span className={chip}>{event.subject_name}</span>}
            <span className={chip}>{event.source === "zeus" ? "School timetable" : KIND_LABEL[event.kind]}</span>
            {event.status !== "normal" && <span className={chip}>{event.status === "changed" ? "Changed" : "Cancelled"}</span>}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {event.title}
            {event.section ? ` · ${event.section}` : ""}
          </h1>
          <p className="text-sm text-[#3A3F4B]">
            {dayLabel(start.date).weekday} {formatLongDate(start.date)} ·{" "}
            <span className="font-mono">
              {formatTime(event.start)}–{formatTime(event.end)}
            </span>
            {event.room ? ` · ${event.room}` : ""}
          </p>
          {detail.data.next_event_id && nextStart && (
            <Link to={`/events/${detail.data.next_event_id}`} className="text-sm font-semibold text-accent">
              Next class: {formatLongDate(parisParts(nextStart).date)} {formatTime(nextStart)}
            </Link>
          )}
        </header>

        <div role="tablist" aria-label="Notes" className="flex gap-1 border-b border-line">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px px-3.5 py-2.5 text-sm ${tab === t.id ? "border-b-2 border-accent font-semibold text-accent-strong" : "font-medium text-muted"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <textarea
          aria-label={`${tabLabel} note`}
          value={current.body}
          onChange={(e) => setCurrent({ body: e.target.value })}
          rows={10}
          className="w-full rounded-xl border border-line p-4 font-sans text-[15px] leading-relaxed"
          placeholder="What was covered? Homework? Write [ ] at the start of a line to make it a task."
        />
        <p className="text-xs text-muted">
          Lines starting with <code>[ ]</code> become tasks on your board; <code>[x]</code> marks one done. Add{" "}
          <code>@2026-10-22</code> at the end of a task line for a due date.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={current.important} onChange={(e) => setCurrent({ important: e.target.checked })} />
            Important
          </label>
          <button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ tab, draft: current })}
            className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
          >
            Save note
          </button>
          {dirty ? <span className="text-sm text-muted">Unsaved changes</span> : saved.updated_at ? <span className="text-sm text-muted">Saved</span> : null}
          {save.error && <p className="text-sm text-[#8B1A1A]">{(save.error as Error).message}</p>}
        </div>

        {tasks.length > 0 && (
          <section aria-label="Tasks from this class" className="flex flex-col gap-2 border-t border-line pt-4">
            <h2 className="text-sm font-bold">Tasks from this class</h2>
            {tasks.map((task) => (
              <label key={task.id} className="flex items-center gap-2.5 text-sm">
                <input type="checkbox" checked={task.status === "done"} onChange={() => toggleTask.mutate(task)} />
                <span className={task.status === "done" ? "text-muted line-through" : ""}>{task.title}</span>
                {task.status === "doing" && <span className={chip}>Doing</span>}
                {task.due_date && <span className="font-mono text-xs text-muted">due {task.due_date}</span>}
              </label>
            ))}
            {toggleTask.error && <p className="text-sm text-[#8B1A1A]">{(toggleTask.error as Error).message}</p>}
          </section>
        )}

        {event.source === "custom" && (
          <div className="border-t border-line pt-4">
            <button
              type="button"
              onClick={() => (confirmDelete ? remove.mutate() : setConfirmDelete(true))}
              className="h-10 rounded-xl border border-[#F3C4C4] px-4 text-sm font-semibold text-[#8B1A1A]"
            >
              {confirmDelete ? "Click again to delete" : "Delete event"}
            </button>
            {remove.error && <p className="text-sm text-[#8B1A1A]">{(remove.error as Error).message}</p>}
          </div>
        )}
      </article>
    </div>
  );
}
```

- [ ] **Step 4: Add the route** — in `frontend/src/App.tsx` import `EventPage` and add inside the Layout route (after `settings`):

```tsx
              <Route path="events/:id" element={<EventPage />} />
```

- [ ] **Step 5: Run tests and build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all pass, no act() warnings; build OK.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/EventPage.tsx frontend/src/pages/EventPage.test.tsx frontend/src/App.tsx
git commit -m "feat(frontend): class page with notes and tasks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Add-event page (one-off or weekly)

**Files:**
- Create: `frontend/src/pages/NewEventPage.tsx`, `frontend/src/pages/NewEventPage.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `apiFetch`; `parisLocalToUtc`, `todayParis`, `addDays`, `weekdayIndex` (Tasks 9 / Plan 1); `CustomKind` type.
- Produces: route `/events/new` (registered **before** `events/:id`). Form: Title, Type (Work / French (external) / Other), Date, Start, End, Place, "Repeat weekly" checkbox revealing weekday toggles (Mon–Sun, default = the date's weekday) and "Until" (default date + 84 days). Submit → `POST /api/events` (UTC times; an end time earlier than the start means next day) or `POST /api/recurring`; on success invalidate `events`/`recurring` and go to `/`.

- [ ] **Step 1: Write the failing test** — `frontend/src/pages/NewEventPage.test.tsx`

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewEventPage } from "./NewEventPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/events/new"]}>
        <Routes>
          <Route path="/events/new" element={<NewEventPage />} />
          <Route path="/" element={<p>Calendar home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillCommon() {
  await userEvent.type(screen.getByLabelText("Title"), "French (external)");
  await userEvent.selectOptions(screen.getByLabelText("Type"), "french_ext");
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-26" } });
  fireEvent.change(screen.getByLabelText("Start"), { target: { value: "19:30" } });
  fireEvent.change(screen.getByLabelText("End"), { target: { value: "21:00" } });
  await userEvent.type(screen.getByLabelText("Place"), "Alliance");
}

describe("NewEventPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({});
  });

  it("creates a one-off event with Paris times converted to UTC", async () => {
    renderPage();
    await fillCommon();
    await userEvent.click(screen.getByRole("button", { name: "Save event" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/events", {
      method: "POST",
      body: JSON.stringify({ title: "French (external)", kind: "french_ext", start: "2026-10-26T18:30:00.000Z",
                             end: "2026-10-26T20:00:00.000Z", room: "Alliance" }),
    });
    expect(await screen.findByText("Calendar home")).toBeInTheDocument();
  });

  it("creates a weekly rule", async () => {
    renderPage();
    await fillCommon();
    await userEvent.click(screen.getByLabelText("Repeat weekly"));
    await userEvent.click(screen.getByRole("checkbox", { name: "Thu" }));
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2026-12-17" } });
    await userEvent.click(screen.getByRole("button", { name: "Save event" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/recurring", {
      method: "POST",
      body: JSON.stringify({ title: "French (external)", kind: "french_ext", weekdays: [0, 3], start_time: "19:30",
                             end_time: "21:00", from_date: "2026-10-26", until_date: "2026-12-17", location: "Alliance" }),
    });
  });

  it("requires a title", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Save event" }));
    expect(screen.getByText("Give the event a title.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/NewEventPage.test.tsx`
Expected: FAIL — cannot resolve `./NewEventPage`.

- [ ] **Step 3: Implement** — `frontend/src/pages/NewEventPage.tsx`

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { apiFetch } from "../lib/api";
import { addDays, parisLocalToUtc, todayParis, weekdayIndex } from "../lib/time";
import type { CustomKind } from "../types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const field = "h-10 rounded-xl border border-[#D5D9E0] bg-white px-3 text-sm";
const labelCls = "flex flex-col gap-1.5 text-sm font-semibold text-[#3A3F4B]";

export function NewEventPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const today = todayParis();
  const [form, setForm] = useState({
    title: "",
    kind: "work" as CustomKind,
    date: today,
    start: "09:00",
    end: "10:00",
    room: "",
    repeat: false,
    weekdays: [weekdayIndex(today)],
    until: addDays(today, 84),
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const create = useMutation({
    mutationFn: () =>
      form.repeat
        ? apiFetch("/api/recurring", {
            method: "POST",
            body: JSON.stringify({
              title: form.title.trim(),
              kind: form.kind,
              weekdays: [...form.weekdays].sort((a, b) => a - b),
              start_time: form.start,
              end_time: form.end,
              from_date: form.date,
              until_date: form.until,
              location: form.room.trim(),
            }),
          })
        : apiFetch("/api/events", {
            method: "POST",
            body: JSON.stringify({
              title: form.title.trim(),
              kind: form.kind,
              start: parisLocalToUtc(form.date, form.start),
              end: parisLocalToUtc(form.end > form.start ? form.date : addDays(form.date, 1), form.end),
              room: form.room.trim(),
            }),
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      navigate("/");
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return setError("Give the event a title.");
    if (form.start === form.end) return setError("Start and end time must differ.");
    if (form.repeat && form.weekdays.length === 0) return setError("Pick at least one weekday.");
    if (form.repeat && form.until < form.date) return setError("'Until' must be on or after the date.");
    setError(null);
    create.mutate();
  };

  const toggleDay = (day: number) =>
    set({ weekdays: form.weekdays.includes(day) ? form.weekdays.filter((d) => d !== day) : [...form.weekdays, day] });

  return (
    <div className="flex flex-col gap-4">
      <Link to="/" className="text-sm font-semibold text-accent">
        ‹ Back to calendar
      </Link>
      <form onSubmit={submit} className="flex max-w-xl flex-col gap-4 rounded-2xl border border-line bg-white p-5 md:p-7">
        <h1 className="text-2xl font-bold tracking-tight">Add event</h1>
        <label className={labelCls}>
          Title
          <input className={field} value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
        </label>
        <label className={labelCls}>
          Type
          <select className={field} value={form.kind} onChange={(e) => set({ kind: e.target.value as CustomKind })}>
            <option value="work">Work</option>
            <option value="french_ext">French (external)</option>
            <option value="other">Other</option>
          </select>
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className={labelCls}>
            Date
            <input type="date" className={field} value={form.date} onChange={(e) => set({ date: e.target.value, weekdays: [weekdayIndex(e.target.value)] })} />
          </label>
          <label className={labelCls}>
            Start
            <input type="time" className={field} value={form.start} onChange={(e) => set({ start: e.target.value })} />
          </label>
          <label className={labelCls}>
            End
            <input type="time" className={field} value={form.end} onChange={(e) => set({ end: e.target.value })} />
          </label>
        </div>
        <label className={labelCls}>
          Place
          <input className={field} value={form.room} onChange={(e) => set({ room: e.target.value })} maxLength={200} />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={form.repeat} onChange={(e) => set({ repeat: e.target.checked })} />
          Repeat weekly
        </label>
        {form.repeat && (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1.5 text-sm font-semibold text-[#3A3F4B]">On</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((name, day) => (
                <label key={name} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm">
                  <input type="checkbox" checked={form.weekdays.includes(day)} onChange={() => toggleDay(day)} />
                  {name}
                </label>
              ))}
            </div>
            <label className={labelCls}>
              Until
              <input type="date" className={field} value={form.until} onChange={(e) => set({ until: e.target.value })} />
            </label>
          </fieldset>
        )}
        {(error || create.error) && <p className="text-sm text-[#8B1A1A]">{error ?? (create.error as Error).message}</p>}
        <button type="submit" disabled={create.isPending} className="h-11 rounded-xl bg-accent text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50">
          Save event
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Add the route** — in `frontend/src/App.tsx` import `NewEventPage` and add **above** the `events/:id` route:

```tsx
              <Route path="events/new" element={<NewEventPage />} />
```

- [ ] **Step 5: Run tests and build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all pass; build OK.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/NewEventPage.tsx frontend/src/pages/NewEventPage.test.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add one-off or weekly events" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Task board, navigation and recurring-events list

**Files:**
- Create: `frontend/src/pages/BoardPage.tsx`, `frontend/src/pages/BoardPage.test.tsx`, `frontend/src/components/RecurringList.tsx`, `frontend/src/components/RecurringList.test.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: `apiFetch`; types `Task`, `TaskStatus`, `RecurringRule`; HTTP from Tasks 7–8.
- Produces: route `/board` (`BoardPage`): New-task form (title + optional due date), subject filter (`aria-label="Subject"`, options from tasks' `subject_name`), three columns **To do / Doing / Done**, each card with a status select `aria-label="Status for <title>"`, due date, Important tag, "From class" link to `/events/:event_id`, and a two-click delete for manual tasks. Nav gains **Board** (desktop sidebar + mobile bottom bar, 3 columns). Settings shows `<RecurringList />`: each rule's title, days, time, date range, occurrences count, two-click **Delete**.

- [ ] **Step 1: Write the failing tests**

`frontend/src/pages/BoardPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { BoardPage } from "./BoardPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const task = (over: Partial<Task>): Task => ({
  id: 1, title: "Redo ex 3", status: "todo", due_date: null, important: false, source: "note", note_id: 1, event_id: 7,
  subject_id: 1, subject_name: "Relational Databases", event_start: "2026-10-19T11:00:00Z", position: 0, ...over,
});
const TASKS = [
  task({}),
  task({ id: 2, title: "Set up venv", status: "doing", subject_id: 2, subject_name: "Introduction to Python", due_date: "2026-10-21" }),
  task({ id: 3, title: "Buy notebook", status: "done", source: "manual", note_id: null, event_id: null, subject_id: null, subject_name: null }),
];

function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BoardPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => (init?.method ? {} : TASKS));
  });

  it("groups tasks into the three columns", async () => {
    renderBoard();
    const todo = await screen.findByRole("region", { name: "To do" });
    expect(within(todo).getByText("Redo ex 3")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Doing" })).getByText("Set up venv")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Done" })).getByText("Buy notebook")).toBeInTheDocument();
    expect(within(todo).getByRole("link", { name: "From class" })).toHaveAttribute("href", "/events/7");
  });

  it("moves a task with the status select", async () => {
    renderBoard();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Status for Redo ex 3" }), "doing");
    expect(apiFetch).toHaveBeenCalledWith("/api/tasks/1", { method: "PATCH", body: JSON.stringify({ status: "doing" }) });
  });

  it("filters by subject", async () => {
    renderBoard();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Subject" }), "Introduction to Python");
    expect(screen.queryByText("Redo ex 3")).not.toBeInTheDocument();
    expect(screen.getByText("Set up venv")).toBeInTheDocument();
  });

  it("adds a manual task", async () => {
    renderBoard();
    await userEvent.type(await screen.findByLabelText("New task"), "Print slides");
    await userEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Print slides", due_date: null }) });
  });
});
```

`frontend/src/components/RecurringList.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecurringList } from "./RecurringList";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const RULE = { id: 5, title: "French (external)", kind: "french_ext", weekdays: [0, 3], start_time: "19:30", end_time: "21:00",
               from_date: "2026-10-19", until_date: "2026-12-17", location: "Alliance", occurrences: 18 };

describe("RecurringList", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (_p: string, init?: RequestInit) => (init?.method === "DELETE" ? { deleted: true } : [RULE]));
  });

  it("lists rules and deletes after a second click", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RecurringList />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("French (external)")).toBeInTheDocument();
    expect(screen.getByText(/Mon, Thu · 19:30–21:00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete French (external)" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/api/recurring/5", { method: "DELETE" });
    await userEvent.click(screen.getByRole("button", { name: "Click again to delete French (external)" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/recurring/5", { method: "DELETE" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/BoardPage.test.tsx src/components/RecurringList.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the board** — `frontend/src/pages/BoardPage.tsx`

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { apiFetch } from "../lib/api";
import type { Task, TaskStatus } from "../types";

const COLUMNS: { status: TaskStatus; label: string; dot: string }[] = [
  { status: "todo", label: "To do", dot: "#8A90A0" },
  { status: "doing", label: "Doing", dot: "#2E55E6" },
  { status: "done", label: "Done", dot: "#1F8A4C" },
];
const field = "h-10 rounded-xl border border-[#D5D9E0] bg-white px-3 text-sm";

export function BoardPage() {
  const queryClient = useQueryClient();
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => apiFetch<Task[]>("/api/tasks") });
  const [subject, setSubject] = useState("all");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["event"] });
    queryClient.invalidateQueries({ queryKey: ["events"] });
  };
  const move = useMutation({
    mutationFn: (v: { id: number; status: TaskStatus }) =>
      apiFetch(`/api/tasks/${v.id}`, { method: "PATCH", body: JSON.stringify({ status: v.status }) }),
    onSuccess: refresh,
  });
  const add = useMutation({
    mutationFn: () => apiFetch("/api/tasks", { method: "POST", body: JSON.stringify({ title: title.trim(), due_date: due || null }) }),
    onSuccess: () => {
      setTitle("");
      setDue("");
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: number) => apiFetch(`/api/tasks/${id}`, { method: "DELETE" }), onSuccess: refresh });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) add.mutate();
  };

  if (tasks.error) return <ErrorPanel error={tasks.error} onRetry={() => tasks.refetch()} />;
  const all = tasks.data ?? [];
  const subjects = [...new Set(all.map((t) => t.subject_name).filter((s): s is string => Boolean(s)))].sort();
  const visible = all.filter((t) => subject === "all" || t.subject_name === subject);
  const mutationError = (move.error ?? add.error ?? remove.error) as Error | null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold tracking-tight">Task board</h1>
          <p className="text-sm text-muted">{all.filter((t) => t.status !== "done").length} open · tasks come from [ ] lines in your class notes</p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Subject
          <select aria-label="Subject" className={field} value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="all">All subjects</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </header>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-white p-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs font-semibold text-muted">
          New task
          <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder="e.g. Print the lab sheet" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Due
          <input type="date" className={field} value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <button type="submit" disabled={add.isPending} className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50">
          Add task
        </button>
      </form>
      {mutationError && <p className="text-sm text-[#8B1A1A]">{mutationError.message}</p>}

      <div className="grid items-start gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const cards = visible.filter((t) => t.status === col.status);
          return (
            <section key={col.status} aria-label={col.label} className="flex flex-col gap-2.5 rounded-2xl bg-[#EBEDF1] p-3">
              <h2 className="flex items-center gap-2 px-1 text-sm font-bold">
                <span className="size-2.5 rounded-full" style={{ background: col.dot }} />
                {col.label}
                <span className="rounded-full bg-white px-2 text-xs font-semibold text-[#3A3F4B]">{cards.length}</span>
              </h2>
              {cards.map((t) => (
                <TaskCard key={t.id} task={t} onMove={(status) => move.mutate({ id: t.id, status })} onDelete={() => remove.mutate(t.id)} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard({ task, onMove, onDelete }: { task: Task; onMove: (s: TaskStatus) => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#E1E4EA] bg-white p-3">
      <div className="flex flex-wrap gap-1.5">
        {task.subject_name && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-semibold text-accent-strong">{task.subject_name}</span>}
        {task.important && <span className="rounded-full bg-[#FFF1E0] px-2 py-0.5 text-[11.5px] font-bold text-[#7C2D12]">Important</span>}
      </div>
      <p className={`text-[14.5px] font-semibold ${task.status === "done" ? "text-muted line-through" : ""}`}>{task.title}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="font-mono">{task.due_date ? `Due ${task.due_date}` : "No due date"}</span>
        {task.event_id !== null && (
          <Link to={`/events/${task.event_id}`} className="font-semibold text-accent">
            From class
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`Status for ${task.title}`}
          value={task.status}
          onChange={(e) => onMove(e.target.value as TaskStatus)}
          className="h-9 rounded-lg border border-[#D5D9E0] bg-white px-2 text-sm"
        >
          {COLUMNS.map((c) => (
            <option key={c.status} value={c.status}>
              {c.label}
            </option>
          ))}
        </select>
        {task.source === "manual" && (
          <button type="button" onClick={() => (confirm ? onDelete() : setConfirm(true))} className="h-9 rounded-lg px-2 text-sm font-semibold text-[#8B1A1A]">
            {confirm ? "Click again to delete" : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement the recurring list** — `frontend/src/components/RecurringList.tsx`

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "../lib/api";
import type { RecurringRule } from "../types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function RecurringList() {
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: ["recurring"], queryFn: () => apiFetch<RecurringRule[]>("/api/recurring") });
  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/recurring/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-5">
      <h2 className="text-base font-bold">My repeating events</h2>
      <p className="text-sm text-muted">Add new ones with "Add event" on the calendar. Deleting keeps any occurrence that has a note.</p>
      {rules.data?.length === 0 && <p className="text-sm">None yet.</p>}
      {rules.data?.map((rule) => (
        <RuleRow key={rule.id} rule={rule} onDelete={() => remove.mutate(rule.id)} />
      ))}
      {remove.error && <p className="text-sm text-[#8B1A1A]">{(remove.error as Error).message}</p>}
    </section>
  );
}

function RuleRow({ rule, onDelete }: { rule: RecurringRule; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-[#F8F9FB] px-3 py-2.5">
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">{rule.title}</span>
        <span className="text-xs text-muted">
          {rule.weekdays.map((d) => DAYS[d]).join(", ")} · {rule.start_time}–{rule.end_time} · {rule.from_date} → {rule.until_date}
          {rule.location ? ` · ${rule.location}` : ""} · {rule.occurrences} events
        </span>
      </span>
      <button
        type="button"
        aria-label={confirm ? `Click again to delete ${rule.title}` : `Delete ${rule.title}`}
        onClick={() => (confirm ? onDelete() : setConfirm(true))}
        className="h-9 rounded-lg px-3 text-sm font-semibold text-[#8B1A1A]"
      >
        {confirm ? "Click again to delete" : "Delete"}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Wire navigation and settings**

`frontend/src/App.tsx`: import `BoardPage` and add `<Route path="board" element={<BoardPage />} />` next to `settings`.

`frontend/src/components/Layout.tsx`: change `links` to

```tsx
const links = [
  { to: "/", label: "Calendar" },
  { to: "/board", label: "Board" },
  { to: "/settings", label: "Settings" },
];
```

and change the mobile bottom nav class `grid-cols-2` to `grid-cols-3`.

`frontend/src/pages/SettingsPage.tsx`: `import { RecurringList } from "../components/RecurringList";` and render `<RecurringList />` directly after the closing `</div>` of the two-column grid (inside the outer `flex flex-col gap-4` container).

- [ ] **Step 6: Run tests and build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all pass; build OK.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/BoardPage.tsx frontend/src/pages/BoardPage.test.tsx frontend/src/components/RecurringList.tsx frontend/src/components/RecurringList.test.tsx frontend/src/App.tsx frontend/src/components/Layout.tsx frontend/src/pages/SettingsPage.tsx
git commit -m "feat(frontend): task board, Board nav and repeating events list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Ship — migrate production, deploy, update follow-ups

**Files:**
- Modify: `docs/superpowers/plans/2026-10-03-plan-1-followups.md`

**Interfaces:**
- Consumes: everything above; gitignored `backend/.env.prod` (`MIGRATE_URL`), Vercel project `timetable-app` (linked in `.vercel/`).
- Produces: production running Plan 2A; follow-ups doc marks the two pre-Plan-3 items done.

- [ ] **Step 1: Full verification**

```bash
export PATH="$LOCALAPPDATA/Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"
cd backend && rm -rf tests/__pycache__ && uv run pytest -q && cd ../frontend && npx vitest run && npm run build
```
Expected: all green.

- [ ] **Step 2: Update the follow-ups doc** — in `docs/superpowers/plans/2026-10-03-plan-1-followups.md`, under "Before Plan 3 (Google push)", append ` — DONE in plan 2A (Task 1)` to the partial-feed line and ` — DONE in plan 2A (Task 2)` to the stale-sync line; commit:

```bash
git add docs/superpowers/plans/2026-10-03-plan-1-followups.md
git commit -m "docs: mark pre-Plan-3 follow-ups done" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Migrate the production database** (Windows blocks the psycopg DLL locally, so use pure-Python pg8000 for this one command; the URL is never printed):

```bash
cd backend
MIG=$(grep '^MIGRATE_URL=' .env.prod | cut -d= -f2- | sed 's#postgresql+psycopg://#postgresql+pg8000://#')
DATABASE_URL="$MIG" uv run --with pg8000 alembic upgrade head
MIG="$MIG" uv run --with pg8000 python -c "
import os
from sqlalchemy import create_engine, text
e = create_engine(os.environ['MIG'])
with e.connect() as c:
    print(c.execute(text('select version_num from alembic_version')).scalar())
    print(c.execute(text(\"select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname\")).all())
"
```
Expected: `0002`; every table (now 10) shows `True` for RLS.

- [ ] **Step 4: Push and deploy** (the user allowed direct pushes to `main`; push without switching branches)

```bash
git push origin plan-1-foundation
git push origin plan-1-foundation:main
npx --yes vercel deploy --prod --yes
```

- [ ] **Step 5: Smoke-test production**

```bash
curl -s https://timetable-app-lake.vercel.app/api/health                       # {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}\n" https://timetable-app-lake.vercel.app/api/tasks   # 401
curl -s -o /dev/null -w "%{http_code}\n" https://timetable-app-lake.vercel.app/board       # 200
```
Then in the browser (signed in): open a class → write a note with `[ ] test task` → Save → it appears on **Board**; tick it on the board → the note shows `[x]`; **Add event** → weekly work shift → it shows on the calendar and in **Settings → My repeating events**.
