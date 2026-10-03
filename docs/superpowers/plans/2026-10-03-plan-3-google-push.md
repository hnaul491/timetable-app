# Plan 3 — Google Calendar Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-way push of my timetable (filtered school classes, exams, holidays, work shifts, external French) into a dedicated Google calendar "My Timetable", kept up to date after every daily sync and on demand, so phone reminders come from Google Calendar.

**Architecture:** The user connects once from Settings: the frontend re-runs the Supabase Google login with the extra calendar scope + offline access, reads the provider refresh token from the returned session and hands it to the backend, which stores it encrypted (existing `SecretStore`, Fernet) and creates the calendar. A push engine reconciles: for every event of the active semester (ending within the last 7 days or later) it computes the Google event body, compares a SHA-256 of it with the hash stored on the row, and inserts/updates/deletes only what differs; deleted rows leave a tombstone so their Google copy is removed too. Work stops at a time budget and resumes on the next call. Google is reached through a small `GoogleCalendar` protocol: an httpx implementation in production, a fake in tests.

**Tech Stack:** unchanged (FastAPI, SQLAlchemy 2, Alembic, httpx, cryptography · React 19, TanStack Query, supabase-js, Vitest). **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-10-03-timetable-app-design.md` §8 Google Calendar push, §10 step 6–7, §11 error table, §12 security.

**This is plan 3.** Plan 4: AI (Gemini).

## Decisions taken in this plan

- **Scope `calendar.app.created` instead of the spec's `calendar.events`.** `calendar.events` cannot create a calendar, and the spec wants the app to create "My Timetable". `calendar.app.created` lets the app create its own calendars and manage events only in those — it cannot read or touch any other calendar. Better for privacy too.
- **Hash reconciliation instead of a `gcal_dirty` flag.** Each event row stores `gcal_event_id` + `gcal_hash` (hash of the body last sent). A push compares the wanted body with the stored hash. This automatically covers every change the spec lists (sync changes, my-group choice, hide, rename, merge, kind toggles) without marking rows dirty in many places, and is self-healing.
- **Refresh token stored in `app_secret`** (name `google_refresh_token`, Fernet-encrypted by the existing `SecretStore`) rather than a `refresh_token_encrypted` column; `google_account` keeps email, calendar id, chosen kinds and push status.
- **Window:** only events of the active semester that end after *now − 7 days* are pushed, updated or deleted. Older events are never touched (matches "past events never modified"). Events of other semesters stay in Google as they were.
- **When pushes run:** after every `/api/sync` (the daily GitHub Action), plus a **Push now** button in Settings that repeats until nothing is left (the first push of ~400 events needs several calls because of Vercel's 60 s limit).
- **Event look in Google:** title = subject name (+ " · GR5" when a group), exams prefixed "Exam: ", holidays as all-day "free" events, location = room, description = link back to the class page. Notes are never sent. Reminders: Google's defaults for that calendar (set them once in Google Calendar).

## Global Constraints

- Budget **$0**; no new dependencies (httpx, cryptography already present).
- No network in tests: Google is faked (`tests/gcal_fakes.py`) or reached through `httpx.MockTransport`.
- The refresh token is **never** returned by the API, logged, or put in an error message; it is stored only Fernet-encrypted (`SecretStore`, key `TOKEN_ENCRYPTION_KEY`). Google error messages are built from status codes / Google reason strings only.
- The app only writes to the calendar it created (`google_account.calendar_id`) and only deletes Google events whose ids it stored.
- DB timestamps naive UTC; API returns ISO `Z` strings (`iso_utc`); Paris dates via `PARIS` from `app.services.recurrence`.
- Every new table has RLS enabled (migration + RLS test list: now 13 tables).
- Single user: every `/api/google*` route requires `require_user`; `/api/sync` keeps `require_cron_or_user`.
- No browser `confirm()`/`alert()`; destructive buttons use two-click confirm with blur reset.
- uv not on PATH: `export PATH="$LOCALAPPDATA/Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"`; run tests with `uv run python -m pytest` (pytest.exe may be blocked by Windows Application Control).
- Implementers use Sonnet or stronger (never Haiku). Do not switch git branches in `C:/Users/huynh/timetable-app` while local dev servers run.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Pushing twice with nothing changed makes zero Google calls** — Task 3 `test_second_push_changes_nothing`.
2. **The user deletes the calendar or one event by hand in Google** → the next pushes recreate them instead of failing forever — Task 3 `test_calendar_deleted_in_google_is_recreated`, `test_event_deleted_by_hand_is_sent_again_when_it_changes`.
3. **Google access revoked** → push stops, account flagged, banner "Reconnect Google", rest of the app and the daily sync keep working, reconnecting clears it — Task 3 `test_revoked_access_asks_to_reconnect`, Task 4 `test_revoked_access_shows_reconnect_and_reconnect_clears_it`, Task 5 banner test.
4. **Cancelled classes, hidden subjects, groups I don't attend and switched-off kinds disappear from Google; old events are left alone** — Task 3 `test_first_push_creates_calendar_and_sends_only_wanted_events`, `test_changes_update_and_cancellations_delete`, `test_hiding_a_subject_or_a_kind_removes_its_events`.
5. **Holidays land on the right Paris days across the 25 Oct clock change (Toussaint 1 Nov)** — Task 3 `test_holidays_are_all_day_in_paris_dates`.
6. **The first push (~400 events) cannot finish in one 60 s call** → it resumes; "Push now" keeps going until done — Task 3 `test_time_budget_leaves_the_rest_for_next_time`, Task 5 push-loop test.

---

## File Structure

```
backend/
├─ migrations/versions/0004_google_push.py      (new)  event.gcal_event_id/gcal_hash, google_account, gcal_tombstone (+RLS)
├─ app/config.py                     # + google_client_id, google_client_secret, app_url, google_configured
├─ app/models.py                     # + Event.gcal_event_id/gcal_hash, GoogleAccount, GcalTombstone
├─ app/services/recurrence.py        # delete_event_cascade leaves a tombstone
├─ app/gcal/__init__.py              (new, empty)
├─ app/gcal/api.py                   (new)  constants, errors, GoogleCalendar protocol, GcalFactory
├─ app/gcal/http_client.py           (new)  HttpGoogleCalendar (httpx)
├─ app/gcal/push.py                  (new)  event_body, body_hash, plan_ops, push, run_push, reset_calendar
├─ app/deps.py                       # + get_gcal_factory
├─ app/schemas.py                    # + Google schemas
├─ app/routers/google.py             (new)  GET/DELETE /api/google, POST connect, PUT kinds, POST push
├─ app/routers/sync.py               # push after sync
├─ app/main.py                       # register google router
├─ .env.example                      # + GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL
└─ tests/ test_gcal_models.py, test_gcal_http.py, gcal_fakes.py, test_gcal_push.py, test_api_google.py, test_migrations.py
frontend/src/
├─ types.ts                          # + GoogleKind, GoogleStatus, PushResult
├─ lib/google.ts (+ test)            (new)  start connect, connect flag, read provider refresh token
├─ components/GoogleSettings.tsx (+ test) (new)
├─ components/Banners.tsx (+ test)   # + GoogleBanner
├─ pages/SettingsPage.tsx            # render GoogleSettings
└─ pages/CalendarPage.tsx            # render GoogleBanner
docs/SETUP.md                        # + "8. Google Calendar" (user steps)
```

**Execution order:** Task 1 first (shared models/protocol). Then Tasks 2, 3 and 5 are independent (parallel lanes possible). Task 4 needs 2 and 3. Task 6 ships.

---

### Task 1: Data model, migration 0004, Google protocol and tombstones

**Files:**
- Create: `backend/migrations/versions/0004_google_push.py`, `backend/app/gcal/__init__.py` (empty), `backend/app/gcal/api.py`, `backend/tests/test_gcal_models.py`
- Modify: `backend/app/models.py`, `backend/app/config.py`, `backend/app/services/recurrence.py`, `backend/tests/test_migrations.py`

**Interfaces:**
- Produces:
  - `Event.gcal_event_id: str | None`, `Event.gcal_hash: str | None`
  - model `GoogleAccount(id=1 single row, email, calendar_id: str|None, kinds: list[str] (JSON, default []), needs_reconnect: bool=False, connected_at, last_push_at: datetime|None, last_push_error: str|None)`
  - model `GcalTombstone(gcal_event_id PK, created_at)`
  - `Settings.google_client_id`, `Settings.google_client_secret`, `Settings.app_url` (default `"https://timetable-app-lake.vercel.app"`), property `Settings.google_configured -> bool`
  - `app.gcal.api`: `ACCOUNT_ID = 1`, `CALENDAR_NAME = "My Timetable"`, `TIME_ZONE = "Europe/Paris"`, `REFRESH_TOKEN_NAME = "google_refresh_token"`, `ALL_KINDS`, `DEFAULT_KINDS`, errors `GoogleError` ⊃ `GoogleAuthError`, `GoogleNotFound`, `GoogleRateLimited`, `Protocol GoogleCalendar` (`create_calendar`, `insert_event`, `update_event`, `delete_event`), `GcalFactory = Callable[[str], GoogleCalendar]`
  - `delete_event_cascade` adds a `GcalTombstone` when the deleted event had a `gcal_event_id`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_gcal_models.py`:

```python
from datetime import datetime

from sqlalchemy import select

from app.config import Settings
from app.models import Event, GcalTombstone, GoogleAccount
from app.services.recurrence import delete_event_cascade


def test_deleting_a_pushed_event_leaves_a_tombstone(session, semester):
    pushed = Event(source="custom", semester_id=semester.id, title_raw="Work shift", start_at=datetime(2026, 10, 20, 8),
                   end_at=datetime(2026, 10, 20, 12), kind="work", gcal_event_id="g123", gcal_hash="h")
    local = Event(source="custom", semester_id=semester.id, title_raw="Work shift", start_at=datetime(2026, 10, 21, 8),
                  end_at=datetime(2026, 10, 21, 12), kind="work")
    session.add_all([pushed, local])
    session.flush()
    delete_event_cascade(session, pushed)
    delete_event_cascade(session, local)
    session.commit()
    assert [t.gcal_event_id for t in session.scalars(select(GcalTombstone))] == ["g123"]


def test_google_account_defaults(session):
    account = GoogleAccount(id=1, email="me@example.com", connected_at=datetime(2026, 10, 15, 12))
    session.add(account)
    session.commit()
    assert (account.kinds, account.needs_reconnect, account.calendar_id, account.last_push_at) == ([], False, None, None)


def test_google_configured_needs_client_and_encryption_key():
    assert Settings(google_client_id="id", google_client_secret="s", token_encryption_key="k").google_configured
    assert not Settings(google_client_id="id", google_client_secret="", token_encryption_key="k").google_configured
    assert not Settings(google_client_id="id", google_client_secret="s", token_encryption_key="").google_configured
```

In `backend/tests/test_migrations.py`, change the RLS table list to:

```python
    for table in ["semester", "subject", "my_section", "event", "sync_run", "app_secret",
                  "recurring_rule", "note", "task", "week_review", "google_account", "gcal_tombstone",
                  "alembic_version"]:
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m pytest tests/test_gcal_models.py tests/test_migrations.py -q`
Expected: FAIL (import error for `GcalTombstone`; RLS lines missing).

- [ ] **Step 3: Models** — in `backend/app/models.py` add to `Event` (after `recurring_rule_id`):

```python
    gcal_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    gcal_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
```

and append:

```python
class GoogleAccount(Base):
    __tablename__ = "google_account"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320))
    calendar_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    kinds: Mapped[list[str]] = mapped_column(JSON, default=list)
    needs_reconnect: Mapped[bool] = mapped_column(Boolean, default=False)
    connected_at: Mapped[datetime] = mapped_column(DateTime)
    last_push_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_push_error: Mapped[str | None] = mapped_column(String(500), nullable=True)


class GcalTombstone(Base):
    __tablename__ = "gcal_tombstone"

    gcal_event_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
```

- [ ] **Step 4: Migration** — `backend/migrations/versions/0004_google_push.py`:

```python
"""google calendar push

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("event", sa.Column("gcal_event_id", sa.String(length=255), nullable=True))
    op.add_column("event", sa.Column("gcal_hash", sa.String(length=64), nullable=True))
    op.create_table(
        "google_account",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("calendar_id", sa.String(length=255), nullable=True),
        sa.Column("kinds", sa.JSON(), nullable=False),
        sa.Column("needs_reconnect", sa.Boolean(), nullable=False),
        sa.Column("connected_at", sa.DateTime(), nullable=False),
        sa.Column("last_push_at", sa.DateTime(), nullable=True),
        sa.Column("last_push_error", sa.String(length=500), nullable=True),
    )
    op.create_table(
        "gcal_tombstone",
        sa.Column("gcal_event_id", sa.String(length=255), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    if op.get_context().dialect.name == "postgresql":
        op.execute("ALTER TABLE google_account ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE gcal_tombstone ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("gcal_tombstone")
    op.drop_table("google_account")
    with op.batch_alter_table("event") as batch:
        batch.drop_column("gcal_hash")
        batch.drop_column("gcal_event_id")
```

(Check 0001/0003 for the exact style, e.g. `sa.String(length=…)` vs `sa.String(…)`; `test_migrations_match_models` must report no diff — fix the migration, never the model/test.)

- [ ] **Step 5: Settings** — in `backend/app/config.py` add fields after `zeus_base_url`:

```python
    google_client_id: str = ""
    google_client_secret: str = ""
    app_url: str = "https://timetable-app-lake.vercel.app"
```

and the property:

```python
    @property
    def google_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret and self.token_encryption_key)
```

- [ ] **Step 6: Google protocol** — `backend/app/gcal/__init__.py` (empty) and `backend/app/gcal/api.py`:

```python
from collections.abc import Callable
from typing import Any, Protocol

ACCOUNT_ID = 1
CALENDAR_NAME = "My Timetable"
TIME_ZONE = "Europe/Paris"
REFRESH_TOKEN_NAME = "google_refresh_token"
ALL_KINDS = ("class", "exam", "holiday", "work", "french_ext", "other")
DEFAULT_KINDS = ["class", "exam", "holiday", "work", "french_ext"]


class GoogleError(Exception):
    """A Google Calendar failure. The message is safe to show: it never contains a token."""


class GoogleAuthError(GoogleError):
    """The refresh token was revoked or expired: the user must connect Google again."""


class GoogleNotFound(GoogleError):
    """The calendar or the event no longer exists in Google."""


class GoogleRateLimited(GoogleError):
    """Google asked us to slow down: stop now and continue on the next push."""


class GoogleCalendar(Protocol):
    def create_calendar(self, name: str, time_zone: str) -> str: ...

    def insert_event(self, calendar_id: str, body: dict[str, Any]) -> str: ...

    def update_event(self, calendar_id: str, event_id: str, body: dict[str, Any]) -> None: ...

    def delete_event(self, calendar_id: str, event_id: str) -> None: ...


GcalFactory = Callable[[str], GoogleCalendar]
"""Builds a client from a refresh token."""
```

- [ ] **Step 7: Tombstones** — in `backend/app/services/recurrence.py`, import `GcalTombstone` (with the other models) and `timezone` (with `datetime`), and make `delete_event_cascade`:

```python
def delete_event_cascade(session: Session, event: Event) -> None:
    if event.gcal_event_id:
        # The Google copy is removed by the next push.
        session.merge(GcalTombstone(gcal_event_id=event.gcal_event_id,
                                    created_at=datetime.now(timezone.utc).replace(tzinfo=None)))
    session.execute(delete(Task).where(Task.event_id == event.id))
    session.execute(delete(Note).where(Note.event_id == event.id))
    session.delete(event)
    session.flush()
```

- [ ] **Step 8: Run the suite**

Run: `cd backend && rm -rf tests/__pycache__ && uv run python -m pytest -q`
Expected: all pass (163 + 3 new).

- [ ] **Step 9: Commit**

```bash
git add backend/migrations/versions/0004_google_push.py backend/app/gcal backend/app/models.py backend/app/config.py backend/app/services/recurrence.py backend/tests/test_gcal_models.py backend/tests/test_migrations.py
git commit -m "feat(backend): data model and protocol for Google Calendar push" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Google Calendar HTTP client

**Files:**
- Create: `backend/app/gcal/http_client.py`, `backend/tests/test_gcal_http.py`

**Interfaces:**
- Consumes: `app.gcal.api` errors (Task 1).
- Produces: `HttpGoogleCalendar(client_id: str, client_secret: str, refresh_token: str, http: httpx.Client | None = None)` implementing `GoogleCalendar`. Behaviour: gets an access token from `https://oauth2.googleapis.com/token` on first use (cached); on an API 401 refreshes once and retries; maps errors — token `invalid_client` → `GoogleError("Google rejected the server's client id/secret")`, other token 400/401 → `GoogleAuthError`, API 401 after retry → `GoogleAuthError`, 404/410 → `GoogleNotFound`, 429 or 403 with reason `rateLimitExceeded`/`userRateLimitExceeded` → `GoogleRateLimited`, other errors → `GoogleError(f"Google Calendar returned {status} ({reason})")`. Calendar/event ids are URL-encoded.

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_gcal_http.py`

```python
import json

import httpx
import pytest

from app.gcal.api import GoogleAuthError, GoogleError, GoogleNotFound, GoogleRateLimited
from app.gcal.http_client import HttpGoogleCalendar

API = "https://www.googleapis.com/calendar/v3"


class Google:
    """Scripted Google: token responses and API responses are consumed in order."""

    def __init__(self, tokens=None, api=None):
        self.tokens = list(tokens or [httpx.Response(200, json={"access_token": "at1", "expires_in": 3599})])
        self.api = list(api or [])
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.host == "oauth2.googleapis.com":
            return self.tokens.pop(0)
        return self.api.pop(0)


def client(google: Google) -> HttpGoogleCalendar:
    return HttpGoogleCalendar("cid", "csecret", "1//refresh", http=httpx.Client(transport=httpx.MockTransport(google)))


def test_creates_calendar_and_reuses_the_access_token():
    google = Google(api=[httpx.Response(200, json={"id": "abc@group.calendar.google.com"}),
                         httpx.Response(200, json={"id": "ev1"})])
    gcal = client(google)
    assert gcal.create_calendar("My Timetable", "Europe/Paris") == "abc@group.calendar.google.com"
    assert gcal.insert_event("abc@group.calendar.google.com", {"summary": "x"}) == "ev1"
    token_request, create, insert = google.requests
    form = dict(httpx.QueryParams(token_request.content.decode()))
    assert form == {"client_id": "cid", "client_secret": "csecret", "refresh_token": "1//refresh",
                    "grant_type": "refresh_token"}
    assert (create.method, str(create.url)) == ("POST", f"{API}/calendars")
    assert json.loads(create.content) == {"summary": "My Timetable", "timeZone": "Europe/Paris"}
    assert create.headers["Authorization"] == "Bearer at1"
    assert str(insert.url) == f"{API}/calendars/abc%40group.calendar.google.com/events"


def test_update_and_delete_use_put_and_delete():
    google = Google(api=[httpx.Response(200, json={"id": "ev1"}), httpx.Response(204)])
    gcal = client(google)
    gcal.update_event("cal", "ev1", {"summary": "y"})
    gcal.delete_event("cal", "ev1")
    assert [(r.method, str(r.url)) for r in google.requests[1:]] == [
        ("PUT", f"{API}/calendars/cal/events/ev1"), ("DELETE", f"{API}/calendars/cal/events/ev1")]


def test_revoked_refresh_token_is_an_auth_error_without_secrets():
    google = Google(tokens=[httpx.Response(400, json={"error": "invalid_grant"})])
    with pytest.raises(GoogleAuthError) as caught:
        client(google).create_calendar("My Timetable", "Europe/Paris")
    assert "1//refresh" not in str(caught.value) and "csecret" not in str(caught.value)


def test_wrong_client_secret_is_not_reported_as_revoked():
    google = Google(tokens=[httpx.Response(401, json={"error": "invalid_client"})])
    with pytest.raises(GoogleError) as caught:
        client(google).create_calendar("My Timetable", "Europe/Paris")
    assert not isinstance(caught.value, GoogleAuthError)


def test_expired_access_token_is_refreshed_once():
    google = Google(tokens=[httpx.Response(200, json={"access_token": "at1"}), httpx.Response(200, json={"access_token": "at2"})],
                    api=[httpx.Response(401), httpx.Response(200, json={"id": "ev1"})])
    assert client(google).insert_event("cal", {}) == "ev1"
    assert google.requests[-1].headers["Authorization"] == "Bearer at2"


def test_api_401_twice_is_an_auth_error():
    google = Google(tokens=[httpx.Response(200, json={"access_token": "at1"}), httpx.Response(200, json={"access_token": "at2"})],
                    api=[httpx.Response(401), httpx.Response(401)])
    with pytest.raises(GoogleAuthError):
        client(google).insert_event("cal", {})


@pytest.mark.parametrize("status", [404, 410])
def test_missing_event_is_not_found(status):
    with pytest.raises(GoogleNotFound):
        client(Google(api=[httpx.Response(status)])).delete_event("cal", "ev1")


def test_rate_limits():
    reason = {"error": {"errors": [{"reason": "rateLimitExceeded"}], "code": 403}}
    with pytest.raises(GoogleRateLimited):
        client(Google(api=[httpx.Response(403, json=reason)])).insert_event("cal", {})
    with pytest.raises(GoogleRateLimited):
        client(Google(api=[httpx.Response(429)])).insert_event("cal", {})


def test_other_errors_name_status_and_reason():
    body = {"error": {"errors": [{"reason": "accessNotConfigured"}], "code": 403}}
    with pytest.raises(GoogleError, match=r"Google Calendar returned 403 \(accessNotConfigured\)"):
        client(Google(api=[httpx.Response(403, json=body)])).insert_event("cal", {})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m pytest tests/test_gcal_http.py -q`
Expected: FAIL (module `app.gcal.http_client` not found).

- [ ] **Step 3: Implement** — `backend/app/gcal/http_client.py`

```python
from typing import Any
from urllib.parse import quote

import httpx

from app.gcal.api import GoogleAuthError, GoogleError, GoogleNotFound, GoogleRateLimited

TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/calendar/v3"
RATE_REASONS = {"rateLimitExceeded", "userRateLimitExceeded"}


def _q(value: str) -> str:
    return quote(value, safe="")


def _reason(response: httpx.Response) -> str:
    try:
        errors = response.json().get("error", {}).get("errors", [])
        return str(errors[0].get("reason", "")) if errors else ""
    except (ValueError, AttributeError):
        return ""


class HttpGoogleCalendar:
    def __init__(self, client_id: str, client_secret: str, refresh_token: str,
                 http: httpx.Client | None = None) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._refresh_token = refresh_token
        self._http = http or httpx.Client(timeout=10.0)
        self._access_token: str | None = None

    def _token(self) -> str:
        if self._access_token is None:
            response = self._http.post(TOKEN_URL, data={
                "client_id": self._client_id, "client_secret": self._client_secret,
                "refresh_token": self._refresh_token, "grant_type": "refresh_token",
            })
            if response.status_code != 200:
                try:
                    error = response.json().get("error", "")
                except ValueError:
                    error = ""
                if error == "invalid_client":
                    raise GoogleError("Google rejected the server's client id/secret")
                if response.status_code in (400, 401):
                    raise GoogleAuthError("Google access was revoked or expired — reconnect Google in Settings")
                raise GoogleError(f"Google sign-in returned {response.status_code}")
            self._access_token = str(response.json()["access_token"])
        return self._access_token

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> httpx.Response:
        response = self._send(method, path, body)
        if response.status_code == 401:
            self._access_token = None  # expired access token: refresh once and retry
            response = self._send(method, path, body)
        status = response.status_code
        if status < 400:
            return response
        reason = _reason(response)
        if status == 401:
            raise GoogleAuthError("Google access was revoked or expired — reconnect Google in Settings")
        if status in (404, 410):
            raise GoogleNotFound(f"Google Calendar returned {status}")
        if status == 429 or (status == 403 and reason in RATE_REASONS):
            raise GoogleRateLimited("Google rate limit reached; the rest is sent on the next push")
        raise GoogleError(f"Google Calendar returned {status} ({reason or 'no reason'})")

    def _send(self, method: str, path: str, body: dict[str, Any] | None) -> httpx.Response:
        return self._http.request(method, API + path, json=body,
                                  headers={"Authorization": f"Bearer {self._token()}"})

    def create_calendar(self, name: str, time_zone: str) -> str:
        return str(self._request("POST", "/calendars", {"summary": name, "timeZone": time_zone}).json()["id"])

    def insert_event(self, calendar_id: str, body: dict[str, Any]) -> str:
        return str(self._request("POST", f"/calendars/{_q(calendar_id)}/events", body).json()["id"])

    def update_event(self, calendar_id: str, event_id: str, body: dict[str, Any]) -> None:
        self._request("PUT", f"/calendars/{_q(calendar_id)}/events/{_q(event_id)}", body)

    def delete_event(self, calendar_id: str, event_id: str) -> None:
        self._request("DELETE", f"/calendars/{_q(calendar_id)}/events/{_q(event_id)}")
```

- [ ] **Step 4: Run tests**

Run: `cd backend && uv run python -m pytest tests/test_gcal_http.py -q` then the full suite.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/gcal/http_client.py backend/tests/test_gcal_http.py
git commit -m "feat(backend): Google Calendar HTTP client" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Push engine (event body, reconcile plan, resumable push)

**Files:**
- Create: `backend/app/gcal/push.py`, `backend/tests/gcal_fakes.py`, `backend/tests/test_gcal_push.py`

**Interfaces:**
- Consumes: Task 1 models/constants/errors; `list_visible_events`, `active_semester`, `VisibleEvent` (`app.services.events_query`); `PARIS` (`app.services.recurrence`); `iso_utc` (`app.timeutil`); `SecretStore` (`app.secret_store`); `Settings`.
- Produces (used by Task 4):
  - `event_body(e: VisibleEvent, app_url: str) -> dict`, `body_hash(body: dict) -> str`
  - `Op` (frozen dataclass: `action: "insert"|"update"|"delete"|"remove", event_id: int|None, gcal_event_id: str|None, body: dict|None, digest: str|None`)
  - `plan_ops(session, account, now, app_url) -> list[Op]`
  - `PushResult` (dataclass: `status: "ok"|"partial"|"failed"|"skipped"`, `done=0`, `failed=0`, `remaining=0`, `error: str|None=None`)
  - `push(session, account, gcal, now, app_url, deadline: float, clock=time.monotonic) -> PushResult`
  - `run_push(session, settings, factory: GcalFactory, now, deadline: float, clock=time.monotonic) -> PushResult` — never raises
  - `reset_calendar(session, account) -> None`
  - test helper `tests/gcal_fakes.FakeCalendar(fail: dict[str, list[Exception | None]] | None = None)` with `.calendars`, `.events`, `.calls`

- [ ] **Step 1: Fake calendar** — `backend/tests/gcal_fakes.py`

```python
from typing import Any

from app.gcal.api import GoogleNotFound


class FakeCalendar:
    """In-memory Google Calendar. `fail` maps a method name to a queue of exceptions (None = succeed)."""

    def __init__(self, fail: dict[str, list[Exception | None]] | None = None) -> None:
        self.calendars: dict[str, str] = {}
        self.events: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, str]] = []
        self._fail = {name: list(queue) for name, queue in (fail or {}).items()}
        self._created = 0
        self._next = 0

    def _check(self, method: str) -> None:
        queue = self._fail.get(method)
        if queue:
            error = queue.pop(0)
            if error is not None:
                raise error

    def create_calendar(self, name: str, time_zone: str) -> str:
        self._check("create_calendar")
        self._created += 1
        calendar_id = f"cal{self._created}"
        self.calendars[calendar_id] = name
        self.calls.append(("create_calendar", calendar_id))
        return calendar_id

    def insert_event(self, calendar_id: str, body: dict[str, Any]) -> str:
        self._check("insert_event")
        if calendar_id not in self.calendars:
            raise GoogleNotFound("Google Calendar returned 404")
        self._next += 1
        event_id = f"g{self._next}"
        self.events[event_id] = body
        self.calls.append(("insert_event", event_id))
        return event_id

    def update_event(self, calendar_id: str, event_id: str, body: dict[str, Any]) -> None:
        self._check("update_event")
        if calendar_id not in self.calendars or event_id not in self.events:
            raise GoogleNotFound("Google Calendar returned 404")
        self.events[event_id] = body
        self.calls.append(("update_event", event_id))

    def delete_event(self, calendar_id: str, event_id: str) -> None:
        self._check("delete_event")
        if calendar_id not in self.calendars or event_id not in self.events:
            raise GoogleNotFound("Google Calendar returned 410")
        del self.events[event_id]
        self.calls.append(("delete_event", event_id))
```

- [ ] **Step 2: Write the failing tests** — `backend/tests/test_gcal_push.py`

```python
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.gcal.api import DEFAULT_KINDS, GoogleAuthError, GoogleError, GoogleRateLimited
from app.gcal.push import body_hash, event_body, push
from app.models import Event, GcalTombstone, GoogleAccount, MySection, Subject
from app.services.events_query import VisibleEvent
from app.services.recurrence import delete_event_cascade
from tests.gcal_fakes import FakeCalendar

NOW = datetime(2026, 10, 15, 12, 0)
URL = "https://app.example"
NEVER = 1e12


def ev(session, semester, uid, start, *, subject=None, kind="class", section=None, status="normal", source="zeus",
       hours=2, title=None):
    event = Event(source=source, zeus_uid=uid if source == "zeus" else None, semester_id=semester.id,
                  subject_id=subject.id if subject else None, section=section, title_raw=title or uid,
                  start_at=start, end_at=start + timedelta(hours=hours), room="KB602", kind=kind, status=status)
    session.add(event)
    session.flush()
    return event


@pytest.fixture
def world(session, semester):
    db = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[], color="#2E55E6")
    fr = Subject(semester_id=semester.id, display_name="French for Fall 26 T1", aliases=[], color="#0E7F72")
    genai = Subject(semester_id=semester.id, display_name="GenAI 101", aliases=[], color="#6A45D8", hidden=True)
    session.add_all([db, fr, genai])
    session.flush()
    session.add(MySection(subject_id=fr.id, section="GR5"))
    events = {
        "class": ev(session, semester, "c1", datetime(2026, 10, 19, 11), subject=db),
        "exam": ev(session, semester, "x1", datetime(2027, 1, 26, 8), subject=db, kind="exam"),
        "mine": ev(session, semester, "f5", datetime(2026, 10, 20, 12), subject=fr, section="GR5"),
        "other_group": ev(session, semester, "f1", datetime(2026, 10, 20, 12), subject=fr, section="GR1"),
        "hidden": ev(session, semester, "g1", datetime(2026, 10, 21, 8), subject=genai),
        "old": ev(session, semester, "o1", datetime(2026, 10, 1, 8), subject=db),
        "cancelled": ev(session, semester, "k1", datetime(2026, 10, 22, 8), subject=db, status="cancelled"),
        "work": ev(session, semester, "w1", datetime(2026, 10, 23, 8), kind="work", source="custom",
                   title="Work shift", hours=4),
        "misc": ev(session, semester, "m1", datetime(2026, 10, 24, 8), kind="other", source="custom",
                   title="Dentist", hours=1),
    }
    account = GoogleAccount(id=1, email="me@example.com", kinds=list(DEFAULT_KINDS), connected_at=NOW)
    session.add(account)
    session.commit()
    return events, account


def run(session, account, fake, deadline=NEVER, clock=lambda: 0.0):
    return push(session, account, fake, NOW, URL, deadline, clock)


def summaries(fake):
    return sorted(body["summary"] for body in fake.events.values())


def test_first_push_creates_calendar_and_sends_only_wanted_events(session, world):
    events, account = world
    fake = FakeCalendar()
    result = run(session, account, fake)
    assert (result.status, result.done, result.failed, result.remaining) == ("ok", 4, 0, 0)
    assert fake.calendars == {"cal1": "My Timetable"} and account.calendar_id == "cal1"
    assert {name for name, e in events.items() if e.gcal_event_id} == {"class", "exam", "mine", "work"}
    assert summaries(fake) == ["Exam: Relational Databases", "French for Fall 26 T1 · GR5", "Relational Databases",
                               "Work shift"]
    assert (account.last_push_at, account.last_push_error) == (NOW, None)


def test_second_push_changes_nothing(session, world):
    _, account = world
    fake = FakeCalendar()
    run(session, account, fake)
    calls = list(fake.calls)
    result = run(session, account, fake)
    assert (result.status, result.done) == ("ok", 0)
    assert fake.calls == calls


def test_changes_update_and_cancellations_delete(session, world):
    events, account = world
    fake = FakeCalendar()
    run(session, account, fake)
    moved_id, cancelled_id = events["class"].gcal_event_id, events["mine"].gcal_event_id
    events["class"].room = "KB999"
    events["mine"].status = "cancelled"
    session.commit()
    result = run(session, account, fake)
    assert (result.status, result.done) == ("ok", 2)
    assert fake.events[moved_id]["location"] == "KB999"
    assert cancelled_id not in fake.events and events["mine"].gcal_event_id is None


def test_hiding_a_subject_or_a_kind_removes_its_events(session, world):
    events, account = world
    fake = FakeCalendar()
    run(session, account, fake)
    session.get(Subject, events["class"].subject_id).hidden = True
    account.kinds = ["class", "exam", "holiday", "french_ext"]
    session.commit()
    result = run(session, account, fake)
    assert (result.status, result.done) == ("ok", 3)
    assert summaries(fake) == ["French for Fall 26 T1 · GR5"]


def test_deleted_events_are_removed_from_google(session, world):
    events, account = world
    fake = FakeCalendar()
    run(session, account, fake)
    work_id = events["work"].gcal_event_id
    delete_event_cascade(session, events["work"])
    session.add(GcalTombstone(gcal_event_id="already-gone", created_at=NOW))
    session.commit()
    result = run(session, account, fake)
    assert (result.status, result.done) == ("ok", 2)
    assert work_id not in fake.events
    assert session.scalars(select(GcalTombstone)).all() == []


def test_time_budget_leaves_the_rest_for_next_time(session, world):
    _, account = world
    fake = FakeCalendar()
    ticks = iter(range(100))
    first = run(session, account, fake, deadline=2, clock=lambda: next(ticks))
    assert (first.status, first.done, first.remaining) == ("partial", 2, 2)
    second = run(session, account, fake)
    assert (second.status, second.done, second.remaining) == ("ok", 2, 0)
    assert len(fake.events) == 4


def test_revoked_access_asks_to_reconnect(session, world):
    _, account = world
    fake = FakeCalendar(fail={"insert_event": [GoogleAuthError("Google access was revoked")]})
    result = run(session, account, fake)
    assert (result.status, result.error) == ("failed", "Google access was revoked")
    assert account.needs_reconnect is True
    assert account.last_push_error == "Google access was revoked"


def test_calendar_deleted_in_google_is_recreated(session, world):
    events, account = world
    fake = FakeCalendar()
    run(session, account, fake)
    fake.calendars.clear()
    fake.events.clear()
    events["class"].room = "KB999"
    session.commit()
    result = run(session, account, fake)
    assert result.status == "failed" and "recreated" in result.error
    assert account.calendar_id is None
    assert all(e.gcal_event_id is None for e in session.scalars(select(Event)))
    again = run(session, account, fake)
    assert (again.status, again.done) == ("ok", 4)
    assert fake.calendars == {"cal2": "My Timetable"}


def test_event_deleted_by_hand_is_sent_again_when_it_changes(session, world):
    events, account = world
    fake = FakeCalendar()
    run(session, account, fake)
    del fake.events[events["class"].gcal_event_id]
    events["class"].room = "KB999"
    session.commit()
    result = run(session, account, fake)
    assert (result.status, result.done) == ("ok", 1)
    assert fake.events[events["class"].gcal_event_id]["location"] == "KB999"


def test_one_failing_event_does_not_stop_the_others(session, world):
    _, account = world
    fake = FakeCalendar(fail={"insert_event": [GoogleError("Google Calendar returned 500 (backendError)")]})
    result = run(session, account, fake)
    assert (result.status, result.done, result.failed) == ("partial", 3, 1)
    assert account.last_push_error == "Google Calendar returned 500 (backendError)"
    retry = run(session, account, fake)
    assert (retry.status, retry.done) == ("ok", 1)
    assert account.last_push_error is None


def test_rate_limit_stops_and_resumes(session, world):
    _, account = world
    fake = FakeCalendar(fail={"insert_event": [None, GoogleRateLimited("Google rate limit reached")]})
    result = run(session, account, fake)
    assert (result.status, result.done, result.remaining) == ("partial", 1, 3)
    assert (run(session, account, fake).done, len(fake.events)) == (3, 4)


def visible(**changes) -> VisibleEvent:
    base = dict(id=7, title="Relational Databases", subject_id=1, subject_name="Relational Databases",
                color="#2E55E6", section=None, start_at=datetime(2026, 10, 19, 11), end_at=datetime(2026, 10, 19, 13),
                room="KB602", kind="class", status="normal", source="zeus")
    base.update(changes)
    return VisibleEvent(**base)


def test_event_body_for_a_class():
    assert event_body(visible(section="G1"), "https://app.example/") == {
        "summary": "Relational Databases · G1",
        "location": "KB602",
        "description": "Open in Timetable: https://app.example/events/7",
        "extendedProperties": {"private": {"timetableEventId": "7"}},
        "start": {"dateTime": "2026-10-19T11:00:00Z", "timeZone": "Europe/Paris"},
        "end": {"dateTime": "2026-10-19T13:00:00Z", "timeZone": "Europe/Paris"},
    }


def test_holidays_are_all_day_in_paris_dates():
    # Toussaint after the 25 Oct clock change: 1 Nov 00:00 Paris = 31 Oct 23:00Z.
    toussaint = event_body(visible(kind="holiday", title="Toussaint", start_at=datetime(2026, 10, 31, 23),
                                   end_at=datetime(2026, 11, 1, 23)), URL)
    assert (toussaint["start"], toussaint["end"], toussaint["transparency"]) == (
        {"date": "2026-11-01"}, {"date": "2026-11-02"}, "transparent")
    until_late = event_body(visible(kind="holiday", start_at=datetime(2026, 10, 31, 23),
                                    end_at=datetime(2026, 11, 1, 22, 59)), URL)
    assert until_late["end"] == {"date": "2026-11-02"}


def test_exam_summary_and_stable_hash():
    body = event_body(visible(kind="exam"), URL)
    assert body["summary"] == "Exam: Relational Databases"
    assert body_hash(body) == body_hash(dict(reversed(list(body.items()))))
    assert body_hash(body) != body_hash({**body, "location": "KB003"})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && uv run python -m pytest tests/test_gcal_push.py -q`
Expected: FAIL (module `app.gcal.push` not found).

- [ ] **Step 4: Implement** — `backend/app/gcal/push.py`

```python
import hashlib
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.config import Settings
from app.gcal.api import (ACCOUNT_ID, CALENDAR_NAME, REFRESH_TOKEN_NAME, TIME_ZONE, GcalFactory, GoogleAuthError,
                          GoogleCalendar, GoogleError, GoogleNotFound, GoogleRateLimited)
from app.models import Event, GcalTombstone, GoogleAccount
from app.secret_store import SecretStore
from app.services.events_query import VisibleEvent, active_semester, list_visible_events
from app.services.recurrence import PARIS
from app.timeutil import iso_utc

KEEP_PAST = timedelta(days=7)
FAR_FUTURE = datetime(2100, 1, 1)
CALENDAR_GONE = 'The "My Timetable" calendar is gone from Google; it will be recreated on the next push.'


def _paris(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc).astimezone(PARIS)


def event_body(e: VisibleEvent, app_url: str) -> dict[str, Any]:
    summary = e.title + (f" · {e.section}" if e.section else "")
    if e.kind == "exam":
        summary = f"Exam: {summary}"
    body: dict[str, Any] = {
        "summary": summary,
        "location": e.room,
        "description": f"Open in Timetable: {app_url.rstrip('/')}/events/{e.id}",
        "extendedProperties": {"private": {"timetableEventId": str(e.id)}},
    }
    if e.kind == "holiday":
        start, end = _paris(e.start_at), _paris(e.end_at)
        last = end.date() if (end.hour, end.minute) == (0, 0) else end.date() + timedelta(days=1)
        last = max(last, start.date() + timedelta(days=1))
        body["start"] = {"date": start.date().isoformat()}
        body["end"] = {"date": last.isoformat()}
        body["transparency"] = "transparent"
    else:
        body["start"] = {"dateTime": iso_utc(e.start_at), "timeZone": TIME_ZONE}
        body["end"] = {"dateTime": iso_utc(e.end_at), "timeZone": TIME_ZONE}
    return body


def body_hash(body: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


@dataclass(frozen=True)
class Op:
    action: str  # "insert" | "update" | "delete" (event no longer wanted) | "remove" (tombstone)
    event_id: int | None
    gcal_event_id: str | None
    body: dict[str, Any] | None
    digest: str | None


@dataclass
class PushResult:
    status: str  # "ok" | "partial" | "failed" | "skipped"
    done: int = 0
    failed: int = 0
    remaining: int = 0
    error: str | None = None


class _CalendarMissing(Exception):
    pass


def plan_ops(session: Session, account: GoogleAccount, now: datetime, app_url: str) -> list[Op]:
    ops = [Op("remove", None, t.gcal_event_id, None, None)
           for t in session.scalars(select(GcalTombstone).order_by(GcalTombstone.created_at))]
    semester = active_semester(session)
    if semester is None:
        return ops
    since = now - KEEP_PAST
    visible, _ = list_visible_events(session, semester.id, since, FAR_FUTURE)
    wanted = {e.id: e for e in visible if e.kind in account.kinds and e.status != "cancelled"}
    rows = session.scalars(select(Event).where(Event.semester_id == semester.id, Event.end_at > since)
                           .order_by(Event.start_at, Event.id))
    for row in rows:
        if row.id in wanted:
            body = event_body(wanted[row.id], app_url)
            digest = body_hash(body)
            if row.gcal_event_id is None:
                ops.append(Op("insert", row.id, None, body, digest))
            elif row.gcal_hash != digest:
                ops.append(Op("update", row.id, row.gcal_event_id, body, digest))
        elif row.gcal_event_id is not None:
            ops.append(Op("delete", row.id, row.gcal_event_id, None, None))
    return ops


def reset_calendar(session: Session, account: GoogleAccount) -> None:
    account.calendar_id = None
    session.execute(update(Event).where(Event.gcal_event_id.is_not(None)).values(gcal_event_id=None, gcal_hash=None))
    session.execute(delete(GcalTombstone))
    session.flush()


def _delete_quietly(gcal: GoogleCalendar, calendar_id: str, gcal_event_id: str) -> None:
    try:
        gcal.delete_event(calendar_id, gcal_event_id)
    except GoogleNotFound:
        pass  # already gone in Google


def _apply(session: Session, gcal: GoogleCalendar, calendar_id: str, op: Op) -> None:
    if op.action == "remove":
        _delete_quietly(gcal, calendar_id, op.gcal_event_id)
        session.execute(delete(GcalTombstone).where(GcalTombstone.gcal_event_id == op.gcal_event_id))
        return
    event = session.get(Event, op.event_id)
    if op.action == "delete":
        _delete_quietly(gcal, calendar_id, op.gcal_event_id)
        event.gcal_event_id = event.gcal_hash = None
        return
    if op.action == "update":
        try:
            gcal.update_event(calendar_id, op.gcal_event_id, op.body)
            event.gcal_hash = op.digest
            return
        except GoogleNotFound:
            pass  # deleted by hand in Google: create it again below
    event.gcal_event_id = gcal.insert_event(calendar_id, op.body)
    event.gcal_hash = op.digest


def push(session: Session, account: GoogleAccount, gcal: GoogleCalendar, now: datetime, app_url: str,
         deadline: float, clock: Callable[[], float] = time.monotonic) -> PushResult:
    result = PushResult(status="ok")
    try:
        if account.calendar_id is None:
            account.calendar_id = gcal.create_calendar(CALENDAR_NAME, TIME_ZONE)
            session.commit()
        ops = plan_ops(session, account, now, app_url)
        for index, op in enumerate(ops):
            if clock() >= deadline:
                result.remaining = len(ops) - index
                break
            try:
                _apply(session, gcal, account.calendar_id, op)
            except GoogleNotFound:
                raise _CalendarMissing() from None  # inserting failed: the calendar itself is gone
            except GoogleRateLimited as exc:
                session.rollback()
                result.remaining = len(ops) - index
                result.error = str(exc)
                break
            except GoogleAuthError:
                raise
            except GoogleError as exc:
                session.rollback()
                result.failed += 1
                result.error = str(exc)
                continue
            session.commit()
            result.done += 1
    except GoogleAuthError as exc:
        session.rollback()
        account.needs_reconnect = True
        result.status, result.error = "failed", str(exc)
    except _CalendarMissing:
        session.rollback()
        reset_calendar(session, account)
        result.status, result.error = "failed", CALENDAR_GONE
    else:
        if result.remaining or result.failed:
            result.status = "partial"
    account.last_push_at = now
    account.last_push_error = result.error
    session.commit()
    return result


def run_push(session: Session, settings: Settings, factory: GcalFactory, now: datetime, deadline: float,
             clock: Callable[[], float] = time.monotonic) -> PushResult:
    """Push for the connected account, if any. Never raises: the daily sync must not fail because of Google."""
    account = session.get(GoogleAccount, ACCOUNT_ID)
    if account is None or account.needs_reconnect or not settings.google_configured:
        return PushResult(status="skipped")
    try:
        token = SecretStore(session, settings.token_encryption_key).get(REFRESH_TOKEN_NAME)
        if not token:
            account.needs_reconnect = True
            account.last_push_error = "Google is not connected any more — connect it again in Settings"
            session.commit()
            return PushResult(status="failed", error=account.last_push_error)
        return push(session, account, factory(token), now, settings.app_url, deadline, clock)
    except Exception as exc:  # noqa: BLE001 — record and move on
        session.rollback()
        error = f"unexpected error ({type(exc).__name__})"
        account = session.get(GoogleAccount, ACCOUNT_ID)
        if account is not None:
            account.last_push_at, account.last_push_error = now, error
            session.commit()
        return PushResult(status="failed", error=error)
```

- [ ] **Step 5: Run tests**

Run: `cd backend && uv run python -m pytest tests/test_gcal_push.py -q` then the full suite.
Expected: all pass. (If `session.rollback()` after a `GoogleError` expires `account`/rows, that is fine — they reload on access.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/gcal/push.py backend/tests/gcal_fakes.py backend/tests/test_gcal_push.py
git commit -m "feat(backend): resumable Google Calendar push engine" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Google API routes, push after the daily sync, setup docs

**Files:**
- Create: `backend/app/routers/google.py`, `backend/tests/test_api_google.py`
- Modify: `backend/app/schemas.py`, `backend/app/deps.py`, `backend/app/routers/sync.py`, `backend/app/main.py`, `backend/.env.example`, `docs/SETUP.md`

**Interfaces:**
- Consumes: Tasks 1–3 (`HttpGoogleCalendar`, `plan_ops`, `run_push`, `reset_calendar`, `PushResult`, constants); `SecretStore`; `require_user` (returns `CurrentUser(email)`), `get_now`, `iso_utc`.
- Produces:
  - `deps.get_gcal_factory(settings) -> GcalFactory` (tests override it)
  - schemas `GoogleStatusOut{configured, connected, email: str|None, kinds: list[str], needs_reconnect, last_push_at: str|None, last_push_error: str|None, pending: int}`, `GoogleConnectIn{refresh_token: 10–2048 chars}`, `GoogleKindsIn{kinds: list[Literal[ALL_KINDS]]}`, `PushResultOut{status, done, failed, remaining, error}`
  - HTTP: `GET /api/google`; `POST /api/google/connect` (400 when not configured or Google fails); `PUT /api/google/kinds` (404 when not connected, 422 bad kind); `POST /api/google/push`; `DELETE /api/google` (204, idempotent); `POST /api/sync` also pushes (response unchanged).

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_api_google.py`

```python
from datetime import datetime

from sqlalchemy import select

from app.deps import get_fetcher, get_gcal_factory
from app.gcal.api import GoogleAuthError
from app.models import AppSecret, Event, Subject
from tests.conftest import AUTH
from tests.gcal_fakes import FakeCalendar

TOKEN = "1//refresh-token-value-123"
REVOKED = "Google access was revoked or expired — reconnect Google in Settings"


def configure(client, settings, fake, tokens=None):
    settings.google_client_id, settings.google_client_secret = "cid", "csecret"

    def factory(token):
        if tokens is not None:
            tokens.append(token)
        return fake

    client.app.dependency_overrides[get_gcal_factory] = lambda: factory


def seed(session, semester):
    db = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[], color="#2E55E6")
    session.add(db)
    session.flush()
    for uid, start, kind in [("c1", datetime(2026, 10, 19, 11), "class"), ("x1", datetime(2027, 1, 26, 8), "exam")]:
        session.add(Event(source="zeus", zeus_uid=uid, semester_id=semester.id, subject_id=db.id, title_raw=uid,
                          start_at=start, end_at=start.replace(hour=start.hour + 2), room="KB602", kind=kind))
    session.commit()


def connect(client):
    return client.post("/api/google/connect", headers=AUTH, json={"refresh_token": TOKEN})


def test_requires_login(client):
    assert client.get("/api/google").status_code == 401
    assert client.post("/api/google/push").status_code == 401


def test_not_configured(client, semester):
    body = client.get("/api/google", headers=AUTH).json()
    assert (body["configured"], body["connected"], body["pending"]) == (False, False, 0)
    response = connect(client)
    assert response.status_code == 400 and "not set up" in response.json()["detail"]


def test_connect_push_and_status(client, settings, session, semester):
    fake, tokens = FakeCalendar(), []
    configure(client, settings, fake, tokens)
    seed(session, semester)
    body = connect(client).json()
    assert (body["connected"], body["email"], body["pending"], body["needs_reconnect"]) == (
        True, "me@example.com", 2, False)
    assert body["kinds"] == ["class", "exam", "holiday", "work", "french_ext"]
    assert tokens == [TOKEN] and fake.calendars == {"cal1": "My Timetable"}
    stored = session.get(AppSecret, "google_refresh_token")
    assert stored is not None and TOKEN not in stored.value_encrypted
    assert TOKEN not in client.get("/api/google", headers=AUTH).text
    result = client.post("/api/google/push", headers=AUTH).json()
    assert result == {"status": "ok", "done": 2, "failed": 0, "remaining": 0, "error": None}
    after = client.get("/api/google", headers=AUTH).json()
    assert (after["pending"], after["last_push_at"], after["last_push_error"]) == (0, "2026-10-15T12:00:00Z", None)


def test_kinds(client, settings, session, semester):
    configure(client, settings, FakeCalendar())
    seed(session, semester)
    assert client.put("/api/google/kinds", headers=AUTH, json={"kinds": ["exam"]}).status_code == 404
    connect(client)
    client.post("/api/google/push", headers=AUTH)
    body = client.put("/api/google/kinds", headers=AUTH, json={"kinds": ["exam", "exam", "class"]}).json()
    assert body["kinds"] == ["class", "exam"]
    body = client.put("/api/google/kinds", headers=AUTH, json={"kinds": ["exam"]}).json()
    assert body["pending"] == 1  # the class has to be removed from Google
    assert client.put("/api/google/kinds", headers=AUTH, json={"kinds": ["party"]}).status_code == 422


def test_disconnect_forgets_everything(client, settings, session, semester):
    configure(client, settings, FakeCalendar())
    seed(session, semester)
    connect(client)
    client.post("/api/google/push", headers=AUTH)
    assert client.delete("/api/google", headers=AUTH).status_code == 204
    assert client.delete("/api/google", headers=AUTH).status_code == 204
    assert client.get("/api/google", headers=AUTH).json()["connected"] is False
    session.expire_all()
    assert session.get(AppSecret, "google_refresh_token") is None
    assert all(e.gcal_event_id is None for e in session.scalars(select(Event)))


def test_revoked_access_shows_reconnect_and_reconnect_clears_it(client, settings, session, semester):
    fake = FakeCalendar(fail={"insert_event": [GoogleAuthError(REVOKED)]})
    configure(client, settings, fake)
    seed(session, semester)
    connect(client)
    assert client.post("/api/google/push", headers=AUTH).json()["status"] == "failed"
    body = client.get("/api/google", headers=AUTH).json()
    assert (body["needs_reconnect"], body["last_push_error"]) == (True, REVOKED)
    assert client.post("/api/google/push", headers=AUTH).json()["status"] == "skipped"
    assert connect(client).json()["needs_reconnect"] is False
    assert client.post("/api/google/push", headers=AUTH).json()["done"] == 2


def test_connect_reports_google_errors(client, settings, semester):
    configure(client, settings, FakeCalendar(fail={"create_calendar": [GoogleAuthError(REVOKED)]}))
    response = connect(client)
    assert response.status_code == 400
    assert response.json()["detail"].startswith("Could not reach Google Calendar")
    assert client.get("/api/google", headers=AUTH).json()["connected"] is False


def test_daily_sync_also_pushes(client, settings, semester):
    fake = FakeCalendar()
    configure(client, settings, fake)
    connect(client)
    ics = "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//t//EN", "BEGIN:VEVENT", "UID:z1",
                       "SUMMARY:Relational Databases", "DTSTART:20261102T080000Z", "DTEND:20261102T100000Z",
                       "LOCATION:KB602", "END:VEVENT", "END:VCALENDAR", ""])
    client.app.dependency_overrides[get_fetcher] = lambda: (lambda sem: ics)
    response = client.post("/api/sync", headers={"X-Cron-Secret": "cron-secret"})
    assert response.json()["status"] == "ok"
    assert [body["summary"] for body in fake.events.values()] == ["Relational Databases"]


def test_sync_still_works_when_google_is_not_connected(client, semester):
    ics = "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//t//EN", "BEGIN:VEVENT", "UID:z1",
                       "SUMMARY:Relational Databases", "DTSTART:20261102T080000Z", "DTEND:20261102T100000Z",
                       "END:VEVENT", "END:VCALENDAR", ""])
    client.app.dependency_overrides[get_fetcher] = lambda: (lambda sem: ics)
    assert client.post("/api/sync", headers={"X-Cron-Secret": "cron-secret"}).json()["status"] == "ok"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run python -m pytest tests/test_api_google.py -q`
Expected: FAIL (`get_gcal_factory` import error).

- [ ] **Step 3: Schemas** — append to `backend/app/schemas.py`:

```python
GoogleKind = Literal["class", "exam", "holiday", "work", "french_ext", "other"]


class GoogleStatusOut(BaseModel):
    configured: bool
    connected: bool
    email: str | None
    kinds: list[str]
    needs_reconnect: bool
    last_push_at: str | None
    last_push_error: str | None
    pending: int


class GoogleConnectIn(BaseModel):
    refresh_token: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=2048)]


class GoogleKindsIn(BaseModel):
    kinds: list[GoogleKind]


class PushResultOut(BaseModel):
    status: str
    done: int
    failed: int
    remaining: int
    error: str | None
```

- [ ] **Step 4: Factory dependency** — in `backend/app/deps.py` add imports `from app.gcal.api import GcalFactory, GoogleCalendar` and `from app.gcal.http_client import HttpGoogleCalendar`, and:

```python
def get_gcal_factory(settings: Settings = Depends(get_settings)) -> GcalFactory:
    def make(refresh_token: str) -> GoogleCalendar:
        return HttpGoogleCalendar(settings.google_client_id, settings.google_client_secret, refresh_token)

    return make
```

- [ ] **Step 5: Router** — `backend/app/routers/google.py`

```python
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.auth import CurrentUser, require_user
from app.config import Settings, get_settings
from app.db import get_session
from app.deps import get_gcal_factory, get_now
from app.gcal.api import (ACCOUNT_ID, ALL_KINDS, CALENDAR_NAME, DEFAULT_KINDS, REFRESH_TOKEN_NAME, TIME_ZONE,
                          GcalFactory, GoogleError)
from app.gcal.push import plan_ops, reset_calendar, run_push
from app.models import AppSecret, GoogleAccount
from app.schemas import GoogleConnectIn, GoogleKindsIn, GoogleStatusOut, PushResultOut
from app.secret_store import SecretStore
from app.timeutil import iso_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])

PUSH_BUDGET_S = 40.0


def _status(session: Session, settings: Settings, now: datetime) -> GoogleStatusOut:
    account = session.get(GoogleAccount, ACCOUNT_ID)
    if account is None:
        return GoogleStatusOut(configured=settings.google_configured, connected=False, email=None,
                               kinds=list(DEFAULT_KINDS), needs_reconnect=False, last_push_at=None,
                               last_push_error=None, pending=0)
    return GoogleStatusOut(
        configured=settings.google_configured, connected=True, email=account.email, kinds=list(account.kinds),
        needs_reconnect=account.needs_reconnect,
        last_push_at=iso_utc(account.last_push_at) if account.last_push_at else None,
        last_push_error=account.last_push_error,
        pending=len(plan_ops(session, account, now, settings.app_url)),
    )


@router.get("/google", response_model=GoogleStatusOut)
def google_status(session: Session = Depends(get_session), settings: Settings = Depends(get_settings),
                  now: datetime = Depends(get_now)) -> GoogleStatusOut:
    return _status(session, settings, now)


@router.post("/google/connect", response_model=GoogleStatusOut)
def connect(body: GoogleConnectIn, user: CurrentUser = Depends(require_user),
            session: Session = Depends(get_session), settings: Settings = Depends(get_settings),
            factory: GcalFactory = Depends(get_gcal_factory), now: datetime = Depends(get_now)) -> GoogleStatusOut:
    if not settings.google_configured:
        raise HTTPException(status_code=400, detail="Google Calendar is not set up on the server yet "
                                                    "(GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)")
    account = session.get(GoogleAccount, ACCOUNT_ID)
    if account is None:
        account = GoogleAccount(id=ACCOUNT_ID, email=user.email, kinds=list(DEFAULT_KINDS), connected_at=now)
        session.add(account)
    account.email, account.needs_reconnect, account.connected_at = user.email, False, now
    try:
        if account.calendar_id is None:
            account.calendar_id = factory(body.refresh_token).create_calendar(CALENDAR_NAME, TIME_ZONE)
    except GoogleError as exc:
        session.rollback()
        raise HTTPException(status_code=400, detail=f"Could not reach Google Calendar: {exc}") from None
    SecretStore(session, settings.token_encryption_key).set(REFRESH_TOKEN_NAME, body.refresh_token)
    session.commit()
    return _status(session, settings, now)


@router.put("/google/kinds", response_model=GoogleStatusOut)
def set_kinds(body: GoogleKindsIn, session: Session = Depends(get_session), settings: Settings = Depends(get_settings),
              now: datetime = Depends(get_now)) -> GoogleStatusOut:
    account = session.get(GoogleAccount, ACCOUNT_ID)
    if account is None:
        raise HTTPException(status_code=404, detail="Google Calendar is not connected")
    account.kinds = [kind for kind in ALL_KINDS if kind in set(body.kinds)]
    session.commit()
    return _status(session, settings, now)


@router.post("/google/push", response_model=PushResultOut)
def push_now(session: Session = Depends(get_session), settings: Settings = Depends(get_settings),
             factory: GcalFactory = Depends(get_gcal_factory), now: datetime = Depends(get_now)) -> PushResultOut:
    result = run_push(session, settings, factory, now, time.monotonic() + PUSH_BUDGET_S)
    return PushResultOut(status=result.status, done=result.done, failed=result.failed, remaining=result.remaining,
                         error=result.error)


@router.delete("/google", status_code=204)
def disconnect(session: Session = Depends(get_session)) -> Response:
    account = session.get(GoogleAccount, ACCOUNT_ID)
    if account is not None:
        reset_calendar(session, account)
        session.delete(account)
    session.execute(delete(AppSecret).where(AppSecret.name == REFRESH_TOKEN_NAME))
    session.commit()
    return Response(status_code=204)
```

(Check `AppSecret`'s primary-key column name in models — the brief assumes `name`.)

- [ ] **Step 6: Push after the daily sync** — `backend/app/routers/sync.py`: add imports `import time`, `from app.config import Settings, get_settings`, `from app.deps import get_fetcher, get_gcal_factory, get_now`, `from app.gcal.api import GcalFactory`, `from app.gcal.push import run_push`; add `SYNC_AND_PUSH_BUDGET_S = 50.0` and change `trigger_sync` to:

```python
@router.post("/sync", response_model=SyncRunOut)
def trigger_sync(
    _caller: str = Depends(require_cron_or_user),
    session: Session = Depends(get_session),
    fetch: Fetcher = Depends(get_fetcher),
    now: datetime = Depends(get_now),
    settings: Settings = Depends(get_settings),
    gcal_factory: GcalFactory = Depends(get_gcal_factory),
) -> SyncRunOut:
    started = time.monotonic()
    out = to_out(run_sync(session, fetch, now))
    run_push(session, settings, gcal_factory, now, started + SYNC_AND_PUSH_BUDGET_S)  # never raises
    return out
```

Register the router in `backend/app/main.py` (`google` in the import list and the tuple, after `sync`).

- [ ] **Step 7: Docs** — append to `backend/.env.example`:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APP_URL=http://localhost:5173
```

Add this section to `docs/SETUP.md` before "## Local development":

```markdown
## 8. Google Calendar (optional)

The app pushes your timetable into a calendar it creates, "My Timetable". It can only see and change that calendar.

1. **Google Cloud Console** → the project whose OAuth client you use for the Supabase Google login.
   - APIs & Services → Library → enable **Google Calendar API**.
   - Google Auth Platform → **Data access** → Add or remove scopes → add `https://www.googleapis.com/auth/calendar.app.created` → Save.
   - Google Auth Platform → **Audience** → **Publish app** (status "In production"). In "Testing", Google expires the access after 7 days. You'll see a "Google hasn't verified this app" screen when connecting: Advanced → Go to … (it's your own app).
2. **Supabase** → Authentication → URL Configuration → Redirect URLs must include `https://timetable-app-lake.vercel.app/**` (and `http://localhost:5173/**` for local).
3. **Vercel** → Project → Settings → Environment Variables (Production): `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` = the same values as Supabase → Authentication → Sign In / Providers → Google; `APP_URL` = `https://timetable-app-lake.vercel.app`. Redeploy. Never paste the secret anywhere else.
4. **App** → Settings → Google Calendar → **Connect Google Calendar** → accept → back in Settings press **Push now** (it repeats until everything is sent).
5. **Google Calendar** → Settings → "My Timetable" → Event notifications: choose your reminder (e.g. 15 minutes before).

After that, every daily sync also updates Google. Disconnect in Settings stops it (the calendar stays in Google; delete it there if you want).
```

- [ ] **Step 8: Run the suite**

Run: `cd backend && rm -rf tests/__pycache__ && uv run python -m pytest -q`
Expected: all pass (existing sync tests unaffected: no account → push skipped).

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas.py backend/app/deps.py backend/app/routers/google.py backend/app/routers/sync.py backend/app/main.py backend/tests/test_api_google.py backend/.env.example docs/SETUP.md
git commit -m "feat(api): connect Google Calendar, push now, and push after every sync" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — connect, choose what to send, push, reconnect banner

**Files:**
- Create: `frontend/src/lib/google.ts`, `frontend/src/lib/google.test.ts`, `frontend/src/components/GoogleSettings.tsx`, `frontend/src/components/GoogleSettings.test.tsx`
- Modify: `frontend/src/types.ts`, `frontend/src/components/Banners.tsx`, `frontend/src/components/Banners.test.tsx`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/CalendarPage.tsx`

**Interfaces:**
- Consumes: the Task 4 HTTP contract (tests mock `apiFetch`, so the backend is not needed): `GET /api/google` → `GoogleStatus`; `POST /api/google/connect {refresh_token}`; `PUT /api/google/kinds {kinds}`; `POST /api/google/push` → `PushResult`; `DELETE /api/google`. `supabase` from `src/lib/supabase.ts`.
- Produces: `lib/google.ts` exports `CALENDAR_SCOPE`, `startGoogleConnect()`, `takeConnectFlag(): boolean`, `takeProviderRefreshToken(): Promise<string | null>`; `<GoogleSettings />`; `<GoogleBanner status />`.

How connecting works: `startGoogleConnect` remembers "connecting" in `sessionStorage` and re-runs the Supabase Google login with the calendar scope and offline access, coming back to `/settings`. On mount, `GoogleSettings` takes the flag once; if set, it reads `session.provider_refresh_token` and posts it to `/api/google/connect`.

- [ ] **Step 1: Types** — append to `frontend/src/types.ts`:

```ts
export type GoogleKind = "class" | "exam" | "holiday" | "work" | "french_ext" | "other";

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  kinds: GoogleKind[];
  needs_reconnect: boolean;
  last_push_at: string | null;
  last_push_error: string | null;
  pending: number;
}

export interface PushResult {
  status: "ok" | "partial" | "failed" | "skipped";
  done: number;
  failed: number;
  remaining: number;
  error: string | null;
}
```

- [ ] **Step 2: Write the failing tests**

`frontend/src/lib/google.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_SCOPE, startGoogleConnect, takeConnectFlag, takeProviderRefreshToken } from "./google";

const supabase = vi.hoisted(() => ({ auth: { signInWithOAuth: vi.fn(), getSession: vi.fn() } }));
vi.mock("./supabase", () => ({ supabase }));

describe("google connect helpers", () => {
  beforeEach(() => {
    sessionStorage.clear();
    supabase.auth.signInWithOAuth.mockReset();
    supabase.auth.getSession.mockReset();
  });

  it("asks Google for offline calendar access and comes back to Settings", async () => {
    await startGoogleConnect();
    expect(CALENDAR_SCOPE).toBe("https://www.googleapis.com/auth/calendar.app.created");
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/settings`,
        scopes: CALENDAR_SCOPE,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    expect(takeConnectFlag()).toBe(true);
    expect(takeConnectFlag()).toBe(false);
  });

  it("reads the provider refresh token from the session", async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { provider_refresh_token: "1//tok" } } });
    expect(await takeProviderRefreshToken()).toBe("1//tok");
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await takeProviderRefreshToken()).toBeNull();
  });
});
```

`frontend/src/components/GoogleSettings.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleStatus, PushResult } from "../types";
import { GoogleSettings } from "./GoogleSettings";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
const google = vi.hoisted(() => ({ startGoogleConnect: vi.fn(), takeConnectFlag: vi.fn(), takeProviderRefreshToken: vi.fn() }));
vi.mock("../lib/google", () => google);

const connected: GoogleStatus = {
  configured: true, connected: true, email: "me@example.com", kinds: ["class", "exam", "holiday", "work", "french_ext"],
  needs_reconnect: false, last_push_at: null, last_push_error: null, pending: 12,
};

function renderWith(status: GoogleStatus, pushes: PushResult[] = []) {
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/google/push") return pushes.shift();
    return init?.method === "DELETE" ? undefined : status;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GoogleSettings />
    </QueryClientProvider>,
  );
}

describe("GoogleSettings", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    google.startGoogleConnect.mockReset();
    google.takeConnectFlag.mockReset().mockReturnValue(false);
    google.takeProviderRefreshToken.mockReset();
  });

  it("explains when the server is not set up", async () => {
    renderWith({ ...connected, configured: false, connected: false });
    expect(await screen.findByText(/isn't set up on the server/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Google Calendar" })).not.toBeInTheDocument();
  });

  it("starts the Google consent when connecting", async () => {
    renderWith({ ...connected, connected: false, email: null });
    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Calendar" }));
    expect(google.startGoogleConnect).toHaveBeenCalled();
  });

  it("hands the refresh token to the server after coming back from Google", async () => {
    google.takeConnectFlag.mockReturnValue(true);
    google.takeProviderRefreshToken.mockResolvedValue("1//tok");
    renderWith({ ...connected, connected: false, email: null });
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/api/google/connect", { method: "POST", body: JSON.stringify({ refresh_token: "1//tok" }) }),
    );
  });

  it("explains when Google gave no offline access", async () => {
    google.takeConnectFlag.mockReturnValue(true);
    google.takeProviderRefreshToken.mockResolvedValue(null);
    renderWith({ ...connected, connected: false, email: null });
    expect(await screen.findByText(/didn't give offline access/)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith("/api/google/connect", expect.anything());
  });

  it("switches a kind off", async () => {
    renderWith(connected);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Work shifts" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/google/kinds", {
      method: "PUT",
      body: JSON.stringify({ kinds: ["class", "exam", "holiday", "french_ext"] }),
    });
  });

  it("keeps pushing until nothing is left", async () => {
    renderWith(connected, [
      { status: "partial", done: 5, failed: 0, remaining: 3, error: null },
      { status: "ok", done: 3, failed: 0, remaining: 0, error: null },
    ]);
    await userEvent.click(await screen.findByRole("button", { name: "Push now" }));
    expect(await screen.findByText("8 changes sent")).toBeInTheDocument();
    expect(apiFetch.mock.calls.filter(([path]) => path === "/api/google/push")).toHaveLength(2);
  });

  it("disconnects only after a second click", async () => {
    renderWith(connected);
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/api/google", { method: "DELETE" });
    await userEvent.click(screen.getByRole("button", { name: "Click again to disconnect" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/google", { method: "DELETE" });
  });

  it("offers to reconnect when access was revoked", async () => {
    renderWith({ ...connected, needs_reconnect: true, last_push_error: "Google access was revoked or expired — reconnect Google in Settings" });
    expect(await screen.findByText(/access was revoked or expired/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Push now" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Reconnect Google" }));
    expect(google.startGoogleConnect).toHaveBeenCalled();
  });
});
```

Append to `frontend/src/components/Banners.test.tsx` (import `GoogleBanner` alongside the others; inside the `describe`):

```tsx
  it("asks to reconnect Google when its access stopped", () => {
    wrap(
      <GoogleBanner
        status={{ configured: true, connected: true, email: "me@example.com", kinds: [], needs_reconnect: true,
                  last_push_at: null, last_push_error: "Google access was revoked or expired — reconnect Google in Settings", pending: 0 }}
      />,
    );
    expect(screen.getByText(/Google Calendar stopped updating/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect Google" })).toHaveAttribute("href", "/settings");
  });

  it("shows nothing for Google when all is well", () => {
    const { container } = wrap(<GoogleBanner status={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/google.test.ts src/components/GoogleSettings.test.tsx src/components/Banners.test.tsx`
Expected: FAIL (modules / export missing).

- [ ] **Step 4: Helpers** — `frontend/src/lib/google.ts`

```ts
import { supabase } from "./supabase";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const FLAG_KEY = "timetable:google-connect";

/** Re-run the Google login asking for calendar access that keeps working offline. */
export function startGoogleConnect() {
  try {
    sessionStorage.setItem(FLAG_KEY, "1");
  } catch {
    // storage blocked: the token can't be picked up after the redirect; connecting again shows why
  }
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/settings`,
      scopes: CALENDAR_SCOPE,
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
}

/** True once after coming back from startGoogleConnect. */
export function takeConnectFlag(): boolean {
  try {
    const set = sessionStorage.getItem(FLAG_KEY) === "1";
    sessionStorage.removeItem(FLAG_KEY);
    return set;
  } catch {
    return false;
  }
}

export async function takeProviderRefreshToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.provider_refresh_token ?? null;
}
```

- [ ] **Step 5: Settings card** — `frontend/src/components/GoogleSettings.tsx`

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { startGoogleConnect, takeConnectFlag, takeProviderRefreshToken } from "../lib/google";
import { formatTime, parisParts } from "../lib/time";
import type { GoogleKind, GoogleStatus, PushResult } from "../types";

const KINDS: [GoogleKind, string][] = [
  ["class", "Classes"],
  ["exam", "Exams"],
  ["holiday", "Holidays"],
  ["work", "Work shifts"],
  ["french_ext", "External French"],
  ["other", "Other events"],
];
const MAX_ROUNDS = 15;
const card = "flex flex-col gap-3 rounded-2xl border border-line bg-white p-5";
const primary = "h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-60";
const secondary = "h-10 rounded-xl border border-line bg-white px-4 text-sm font-semibold disabled:opacity-60";

export function GoogleSettings() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const handled = useRef(false);
  const status = useQuery({ queryKey: ["google"], queryFn: () => apiFetch<GoogleStatus>("/api/google") });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["google"] });

  const connect = useMutation({
    mutationFn: (refresh_token: string) =>
      apiFetch<GoogleStatus>("/api/google/connect", { method: "POST", body: JSON.stringify({ refresh_token }) }),
    onSuccess: () => {
      setNotice("Connected. Press “Push now” to fill your “My Timetable” calendar.");
      refresh();
    },
  });
  const kinds = useMutation({
    mutationFn: (next: GoogleKind[]) => apiFetch<GoogleStatus>("/api/google/kinds", { method: "PUT", body: JSON.stringify({ kinds: next }) }),
    onSuccess: refresh,
  });
  const disconnect = useMutation({
    mutationFn: () => apiFetch("/api/google", { method: "DELETE" }),
    onSuccess: () => {
      setConfirm(false);
      setProgress(null);
      refresh();
    },
  });
  const push = useMutation({
    mutationFn: async () => {
      let sent = 0;
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const result = await apiFetch<PushResult>("/api/google/push", { method: "POST" });
        sent += result.done;
        setProgress(result.remaining > 0 ? `${sent} changes sent, ${result.remaining} left…` : `${sent} changes sent`);
        if (result.status !== "partial" || result.remaining === 0) return result;
      }
      return null;
    },
    onSettled: refresh,
  });

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    if (!takeConnectFlag()) return;
    takeProviderRefreshToken().then((token) => {
      if (token) connect.mutate(token);
      else setNotice("Google didn't give offline access. Remove “Timetable” at myaccount.google.com/permissions, then connect again.");
    });
  }, [connect]);

  const s = status.data;
  const error = (connect.error ?? kinds.error ?? disconnect.error ?? push.error) as Error | null;
  return (
    <section className={card} aria-labelledby="google-heading">
      <h2 id="google-heading" className="text-base font-bold">
        Google Calendar
      </h2>
      {!s ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !s.configured ? (
        <p className="text-sm text-muted">Google Calendar push isn't set up on the server yet — follow “Google Calendar” in docs/SETUP.md.</p>
      ) : !s.connected ? (
        <>
          <p className="text-sm text-[#3A3F4B]">
            Creates a calendar called “My Timetable” in your Google account and keeps it up to date. Notes are never sent. Reminders come from Google
            Calendar — set them on that calendar.
          </p>
          <button type="button" className={primary} onClick={() => startGoogleConnect()} disabled={connect.isPending}>
            Connect Google Calendar
          </button>
        </>
      ) : (
        <>
          <p className="text-sm">
            Connected as <span className="font-semibold">{s.email}</span>
          </p>
          {s.needs_reconnect && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#F3C4C4] bg-[#FDECEC] px-4 py-3 text-sm text-[#8B1A1A]">
              <span>{s.last_push_error ?? "Google access stopped working."}</span>
              <button type="button" className={primary} onClick={() => startGoogleConnect()}>
                Reconnect Google
              </button>
            </div>
          )}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-semibold text-[#3A3F4B]">Send to Google</legend>
            {KINDS.map(([kind, label]) => (
              <label key={kind} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.kinds.includes(kind)}
                  disabled={kinds.isPending}
                  onChange={(e) => kinds.mutate(e.target.checked ? [...s.kinds, kind] : s.kinds.filter((k) => k !== kind))}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <p className="text-sm text-muted">
            {s.pending === 0 ? "Everything is up to date." : `${s.pending} ${s.pending === 1 ? "change" : "changes"} waiting to be sent.`} Last push:{" "}
            {s.last_push_at ? `${parisParts(s.last_push_at).date} ${formatTime(s.last_push_at)}` : "never"}.
          </p>
          {s.last_push_error && !s.needs_reconnect && <p className="text-sm text-[#8B1A1A]">Last push: {s.last_push_error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} onClick={() => push.mutate()} disabled={push.isPending || s.needs_reconnect}>
              {push.isPending ? "Pushing…" : "Push now"}
            </button>
            <button
              type="button"
              className={secondary}
              onClick={() => (confirm ? disconnect.mutate() : setConfirm(true))}
              onBlur={() => setConfirm(false)}
            >
              {confirm ? "Click again to disconnect" : "Disconnect"}
            </button>
          </div>
          {progress && <p className="text-sm text-[#3A3F4B]">{progress}</p>}
        </>
      )}
      {notice && <p className="text-sm text-[#3A3F4B]">{notice}</p>}
      {error && <p className="text-sm text-[#8B1A1A]">{error.message}</p>}
    </section>
  );
}
```

- [ ] **Step 6: Banner and wiring**

In `frontend/src/components/Banners.tsx` add `GoogleStatus` to the type import and:

```tsx
export function GoogleBanner({ status }: { status: GoogleStatus | undefined }) {
  if (!status?.connected || !status.needs_reconnect) return null;
  return (
    <Banner tone="error">
      Google Calendar stopped updating: {status.last_push_error ?? "access was revoked"}.{" "}
      <Link to="/settings" className="font-semibold underline">
        Reconnect Google
      </Link>
    </Banner>
  );
}
```

In `frontend/src/pages/CalendarPage.tsx`: import `GoogleBanner` and `GoogleStatus`; add `const google = useQuery({ queryKey: ["google"], queryFn: () => apiFetch<GoogleStatus>("/api/google") });` next to the other queries, and render `<GoogleBanner status={google.data} />` right after `<SyncBanner … />`.

In `frontend/src/pages/SettingsPage.tsx`: import `GoogleSettings` and render `<GoogleSettings />` directly after `<SubjectSettings />`. (SettingsPage tests mock `apiFetch` returning `[]` for unknown paths; with `[]` as status the card shows the "isn't set up" text — make sure those tests still pass.)

- [ ] **Step 7: Run tests and build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all pass, no act() warnings; build OK. Delete `frontend/tsconfig.tsbuildinfo` if a tool created it.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types.ts frontend/src/lib/google.ts frontend/src/lib/google.test.ts frontend/src/components/GoogleSettings.tsx frontend/src/components/GoogleSettings.test.tsx frontend/src/components/Banners.tsx frontend/src/components/Banners.test.tsx frontend/src/pages/SettingsPage.tsx frontend/src/pages/CalendarPage.tsx
git commit -m "feat(frontend): connect Google Calendar, choose what to send, push now, reconnect banner" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Ship — migrate, deploy, connect

**Files:** none (operations).

- [ ] **Step 1: Full verification** on the integration branch

```bash
export PATH="$LOCALAPPDATA/Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"
cd backend && rm -rf tests/__pycache__ && uv run python -m pytest -q && uv export --no-dev --no-hashes --frozen --no-emit-project --no-header | diff - ../requirements.txt
cd ../frontend && npx vitest run && npm run build
```

- [ ] **Step 2: Migrate production** (pg8000; URL never printed) — `MIG=$(grep '^MIGRATE_URL=' backend/.env.prod | cut -d= -f2- | sed 's#postgresql+psycopg://#postgresql+pg8000://#'); DATABASE_URL="$MIG" uv run --with pg8000 python -m alembic upgrade head`; verify `alembic_version` = `0004` and 13 tables with RLS on.

- [ ] **Step 3: Push and deploy** — push to `main`, `npx --yes vercel deploy --prod --yes` (from a checkout containing `.vercel/`).

- [ ] **Step 4: Smoke-test** — `/api/health` ok; `/api/google` → 401 without login; trigger `/api/sync` with the cron secret → `"status":"ok"` (Google not configured yet → push skipped).

- [ ] **Step 5: User steps** — the user follows `docs/SETUP.md` §8 (enable Calendar API, add scope, publish app, Supabase redirect URLs, Vercel env `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`APP_URL`), then the app is redeployed so the env vars apply, then Settings → Connect → Push now; check "My Timetable" in Google Calendar on the phone.
