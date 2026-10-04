# UX-2 — Look & Language (dark mode + Vietnamese) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen can be shown in English or Vietnamese (choice saved in the account) and in light or dark mode (System/Light/Dark per device), with colour tokens and a translation layer that later UI work reuses.

**Architecture:** A tiny typed translation layer (`src/i18n`) with per-area message files, a `useT()` hook and a `LanguageRoot` that reads the language from a new `/api/preferences` endpoint (cached in localStorage). Colours become CSS-variable tokens wired into Tailwind 4 (`@theme inline`), redefined under `[data-theme="dark"]`, applied before first paint by an inline script. Server texts are mapped to translations on the frontend.

**Tech Stack:** unchanged (FastAPI/SQLAlchemy/Alembic · React 19, Tailwind 4, TanStack Query, Vitest). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-04-ux2-look-and-language-design.md`

## Global Constraints
- $0, no new dependencies.
- English texts stay **exactly** as they are today (existing tests query them); Vietnamese is added beside them.
- School data (subject names, rooms, Zeus titles) is never translated.
- Language preference: server (`/api/preferences`), cached in localStorage `timetable:language`; theme: localStorage `timetable:theme` only. Every storage access wrapped in try/catch.
- Light mode looks the same as today; no hard-coded colour classes (`[#xxxxxx]`, `bg-white`, `text-white`, `*-black`) remain in `src/**/*.tsx` (guard test).
- New tables get RLS (RLS test list: 14 tables).
- uv not on PATH: `export PATH="$LOCALAPPDATA/Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH"`; run backend tests with `uv run python -m pytest`.
- Implementers use Sonnet or stronger. Do not switch branches in `C:/Users/huynh/timetable-app`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **Language chosen on the laptop shows on the phone** (server preference wins over the local cache) — Task 2 `LanguageRoot uses the server language over the cached one`.
2. **Private mode / blocked storage** never breaks theme or language (defaults used) — Task 2 `language helpers survive blocked storage`, Task 3 `theme helpers survive blocked storage`.
3. **Unknown server error in Vietnamese mode** falls back to the English text instead of a key or blank — Task 2 `unknown server texts are kept`.
4. **Login page before sign-in** uses the browser language (no server yet) — Task 2 `initial language follows the browser`.
5. **Vietnamese dates across the 25 Oct clock change** still show the right Paris day — Task 2 `formatLongDate in Vietnamese`.

---

## File Structure
```
backend/
├─ migrations/versions/0005_app_setting.py   (new)
├─ app/models.py                              # + AppSetting
├─ app/schemas.py                             # + Preferences
├─ app/routers/preferences.py                 (new)
├─ app/main.py                                # register router
└─ tests/test_api_preferences.py (new), tests/test_migrations.py
frontend/
├─ index.html                                 # pre-paint theme script
└─ src/
   ├─ index.css                               # tokens (light + dark)
   ├─ theme.guard.test.ts                     (new)
   ├─ lib/theme.ts (+test)                    (new)
   ├─ lib/language.ts (+test)                 (new)
   ├─ lib/time.ts                             # locale parameter
   ├─ lib/api.ts                              # translate server messages
   ├─ i18n/locale.ts, current.ts, index.tsx, types.ts, LanguageRoot.tsx, serverMessages.ts (+tests)   (new)
   ├─ i18n/en/{index,common,errors,nav,calendar,event,board,subjects,review,settings,google}.ts      (new)
   ├─ i18n/vi/{same}.ts                                                                               (new)
   ├─ components/AppearanceSettings.tsx (+test) (new)
   ├─ App.tsx                                 # providers
   └─ every component/page                    # tokens (Task 3), t() (Tasks 4–6)
```

**Order:** Wave 1 in parallel — lane A: Task 1 → Task 2; lane B: Task 3. Merge. Wave 2 in parallel (disjoint files) — Tasks 4, 5, 6. Merge. Task 7 ships.

---

### Task 1: Language preference API (backend)

**Files:** Create `backend/migrations/versions/0005_app_setting.py`, `backend/app/routers/preferences.py`, `backend/tests/test_api_preferences.py`; modify `backend/app/models.py`, `backend/app/schemas.py`, `backend/app/main.py`, `backend/tests/test_migrations.py`.

**Interfaces:** Produces `GET /api/preferences` → `{"language": "en"|"vi"|null}`; `PUT /api/preferences {"language": "en"|"vi"|null}` → same shape; both `require_user`; invalid language → 422.

- [ ] **Step 1: Failing tests** — `backend/tests/test_api_preferences.py`:

```python
from tests.conftest import AUTH


def test_requires_login(client):
    assert client.get("/api/preferences").status_code == 401
    assert client.put("/api/preferences", json={"language": "vi"}).status_code == 401


def test_default_is_no_language(client):
    assert client.get("/api/preferences", headers=AUTH).json() == {"language": None}


def test_set_read_and_clear_language(client):
    assert client.put("/api/preferences", headers=AUTH, json={"language": "vi"}).json() == {"language": "vi"}
    assert client.get("/api/preferences", headers=AUTH).json() == {"language": "vi"}
    assert client.put("/api/preferences", headers=AUTH, json={"language": "en"}).json() == {"language": "en"}
    assert client.put("/api/preferences", headers=AUTH, json={"language": None}).json() == {"language": None}
    assert client.get("/api/preferences", headers=AUTH).json() == {"language": None}


def test_unknown_language_is_rejected(client):
    assert client.put("/api/preferences", headers=AUTH, json={"language": "fr"}).status_code == 422
```

In `backend/tests/test_migrations.py` add `"app_setting"` to the RLS table list (before `"alembic_version"`).

- [ ] **Step 2: Run, expect FAIL** — `cd backend && uv run python -m pytest tests/test_api_preferences.py tests/test_migrations.py -q`.

- [ ] **Step 3: Model** — append to `backend/app/models.py`:

```python
class AppSetting(Base):
    __tablename__ = "app_setting"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[object] = mapped_column(JSON)
```

- [ ] **Step 4: Migration** — `backend/migrations/versions/0005_app_setting.py` (match the style of 0004, positional `sa.String(64)`):

```python
"""app settings (language preference)

Revision ID: 0005
Revises: 0004
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_setting",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False),
    )
    if op.get_context().dialect.name == "postgresql":
        op.execute("ALTER TABLE app_setting ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("app_setting")
```

- [ ] **Step 5: Schema + router** — append to `backend/app/schemas.py`:

```python
Language = Literal["en", "vi"]


class Preferences(BaseModel):
    language: Language | None = None
```

`backend/app/routers/preferences.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.models import AppSetting
from app.schemas import Preferences

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
LANGUAGE_KEY = "language"


def _read(session: Session) -> Preferences:
    row = session.get(AppSetting, LANGUAGE_KEY)
    return Preferences(language=row.value if row else None)


@router.get("/preferences", response_model=Preferences)
def get_preferences(session: Session = Depends(get_session)) -> Preferences:
    return _read(session)


@router.put("/preferences", response_model=Preferences)
def put_preferences(body: Preferences, session: Session = Depends(get_session)) -> Preferences:
    row = session.get(AppSetting, LANGUAGE_KEY)
    if body.language is None:
        if row is not None:
            session.delete(row)
    elif row is None:
        session.add(AppSetting(key=LANGUAGE_KEY, value=body.language))
    else:
        row.value = body.language
    session.commit()
    return _read(session)
```

Register `preferences` in `backend/app/main.py` (import list and router tuple).

- [ ] **Step 6: Run the full suite** — `cd backend && rm -rf tests/__pycache__ && uv run python -m pytest -q` → all pass (`test_migrations_match_models` no diff).

- [ ] **Step 7: Commit** — `git add backend && git commit -m "feat(api): language preference saved in the account" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 2: Translation layer core (frontend)

**Files:** Create everything under `frontend/src/i18n/` listed in File Structure, `frontend/src/lib/language.ts`, tests `frontend/src/i18n/i18n.test.tsx`, `frontend/src/lib/language.test.ts`; modify `frontend/src/lib/time.ts`, `frontend/src/lib/time.test.ts`, `frontend/src/lib/api.ts`, `frontend/src/App.tsx`.

**Interfaces (Produces):**
- `i18n/locale.ts`: `type Locale = "en" | "vi"`, `INTL_LOCALE: Record<Locale, string>` (`en-GB`, `vi-VN`).
- `i18n/types.ts`: `type Messages = typeof en`.
- `i18n/index.tsx`: `translate(locale, key, vars?) -> string`, `MessageKey` (dotted keys of `en`), `Vars`, `I18nProvider({locale, children})`, `useLocale(): Locale`, `useT(): (key, vars?) => string`. Default context locale `"en"` (so components render English without a provider — existing tests keep working).
- `i18n/current.ts`: `getMessageLocale()`, `setMessageLocale(locale)` (module variable used by `apiFetch`).
- `i18n/serverMessages.ts`: `translateServerMessage(text, locale) -> string`.
- `i18n/LanguageRoot.tsx`: `Preferences`, `usePreferences()`, `useSetLanguage()`, `LanguageRoot({children})`.
- `lib/language.ts`: `LANGUAGE_KEY`, `browserLanguage(lang?)`, `readStoredLanguage()`, `storeLanguage(locale)`, `initialLanguage()`.
- `lib/time.ts`: `dayLabel(date, locale = "en")`, `formatLongDate(date, locale = "en")`.
- Message files: `en/common.ts` and `en/errors.ts` complete (below); `en/{nav,calendar,event,board,subjects,review,settings,google}.ts` start as `export const X = {};` — Tasks 4–6 fill them. `vi/*` mirror with type `Messages["<area>"]`.

- [ ] **Step 1: Failing tests** — `frontend/src/i18n/i18n.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { en } from "./en";
import { I18nProvider, translate, useT } from "./index";
import { translateServerMessage } from "./serverMessages";
import { vi } from "./vi";

function leaves(node: unknown, prefix = ""): [string, unknown][] {
  if (typeof node === "string") return [[prefix, node]];
  if (node && typeof node === "object" && "other" in node) return [[prefix, node]];
  return Object.entries(node as object).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

// Words that are the same in both languages.
const SAME_IN_BOTH = new Set(["OK", "Zeus", "Google", "Google Calendar", "Timetable", "Email", "ICS"]);

describe("i18n", () => {
  it("fills placeholders and picks plurals", () => {
    expect(translate("en", "common.itemsCount", { count: 1 })).toBe("1 item");
    expect(translate("en", "common.itemsCount", { count: 3 })).toBe("3 items");
    expect(translate("vi", "common.itemsCount", { count: 3 })).toBe("3 mục");
  });

  it("has every English key in Vietnamese, translated", () => {
    const enLeaves = leaves(en);
    const viMap = new Map(leaves(vi));
    for (const [key, value] of enLeaves) {
      expect(viMap.has(key), `missing vi key ${key}`).toBe(true);
      const viValue = viMap.get(key);
      expect(JSON.stringify(viValue).length, `empty vi text ${key}`).toBeGreaterThan(2);
      if (typeof value === "string" && !SAME_IN_BOTH.has(value)) {
        expect(viValue, `untranslated ${key}`).not.toBe(value);
      }
    }
  });

  it("renders through the provider and defaults to English", () => {
    function Hello() {
      const t = useT();
      return <p>{t("common.save")}</p>;
    }
    const { unmount } = render(<Hello />);
    expect(screen.getByText("Save")).toBeInTheDocument();
    unmount();
    render(
      <I18nProvider locale="vi">
        <Hello />
      </I18nProvider>,
    );
    expect(screen.getByText("Lưu")).toBeInTheDocument();
  });

  it("translates known server texts, with numbers", () => {
    expect(translateServerMessage("end date must be on or after start date", "vi")).toBe("Ngày kết thúc phải bằng hoặc sau ngày bắt đầu");
    expect(translateServerMessage("Google Calendar returned 500 (backendError)", "vi")).toBe("Google Lịch trả về lỗi 500 (backendError)");
    expect(translateServerMessage("end date must be on or after start date", "en")).toBe("end date must be on or after start date");
  });

  it("unknown server texts are kept", () => {
    expect(translateServerMessage("something new from the server", "vi")).toBe("something new from the server");
  });
});
```

`frontend/src/lib/language.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserLanguage, initialLanguage, readStoredLanguage, storeLanguage } from "./language";

describe("language helpers", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("initial language follows the browser", () => {
    expect(browserLanguage("vi-VN")).toBe("vi");
    expect(browserLanguage("fr-FR")).toBe("en");
    vi.spyOn(navigator, "language", "get").mockReturnValue("vi");
    expect(initialLanguage()).toBe("vi");
  });

  it("prefers the stored language", () => {
    storeLanguage("vi");
    expect(readStoredLanguage()).toBe("vi");
    expect(initialLanguage()).toBe("vi");
    localStorage.setItem("timetable:language", "xx");
    expect(readStoredLanguage()).toBeNull();
  });

  it("language helpers survive blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStoredLanguage()).toBeNull();
    expect(() => storeLanguage("vi")).not.toThrow();
  });
});
```

Append to `frontend/src/lib/time.test.ts` (inside its `describe`):

```ts
  it("formatLongDate in Vietnamese", () => {
    expect(formatLongDate("2026-11-01", "vi")).toContain("tháng 11");
    expect(formatLongDate("2026-11-01")).toBe("1 November 2026");
    expect(dayLabel("2026-10-26", "vi").day).toBe("26");
  });
```

Add a LanguageRoot test `frontend/src/i18n/LanguageRoot.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useT } from "./index";
import { LanguageRoot } from "./LanguageRoot";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

function Hello() {
  const t = useT();
  return <p>{t("common.save")}</p>;
}

function renderRoot() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguageRoot>
        <Hello />
      </LanguageRoot>
    </QueryClientProvider>,
  );
}

describe("LanguageRoot", () => {
  beforeEach(() => {
    localStorage.clear();
    apiFetch.mockReset();
  });

  it("uses the server language over the cached one", async () => {
    localStorage.setItem("timetable:language", "en");
    apiFetch.mockResolvedValue({ language: "vi" });
    renderRoot();
    expect(await screen.findByText("Lưu")).toBeInTheDocument();
    expect(localStorage.getItem("timetable:language")).toBe("vi");
    expect(document.documentElement.lang).toBe("vi");
  });

  it("keeps the cached language when the server has none", async () => {
    localStorage.setItem("timetable:language", "vi");
    apiFetch.mockResolvedValue({ language: null });
    renderRoot();
    expect(await screen.findByText("Lưu")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd frontend && npx vitest run src/i18n src/lib/language.test.ts src/lib/time.test.ts`.

- [ ] **Step 3: Core files**

`src/i18n/locale.ts`:

```ts
export type Locale = "en" | "vi";

export const INTL_LOCALE: Record<Locale, string> = { en: "en-GB", vi: "vi-VN" };
```

`src/i18n/current.ts`:

```ts
import type { Locale } from "./locale";

let current: Locale = "en";

/** The language used for texts produced outside React (apiFetch error messages). */
export function getMessageLocale(): Locale {
  return current;
}

export function setMessageLocale(locale: Locale): void {
  current = locale;
}
```

`src/i18n/types.ts`:

```ts
import type { en } from "./en";

export type Messages = typeof en;
export type Plural = { one: string; other: string };
```

`src/i18n/index.tsx`:

```tsx
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { setMessageLocale } from "./current";
import { en } from "./en";
import type { Locale } from "./locale";
import type { Messages, Plural } from "./types";
import { vi } from "./vi";

export type { Locale } from "./locale";
export type Vars = Record<string, string | number>;

type Leaf = string | Plural;
type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];
/** Dotted keys of the English messages, e.g. "common.save". */
export type MessageKey = Paths<Messages>;

const DICTS: Record<Locale, Messages> = { en, vi };

function lookup(dict: Messages, key: string): Leaf | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && "other" in node) return node as Plural;
  return undefined;
}

export function translate(locale: Locale, key: MessageKey, vars: Vars = {}): string {
  const leaf = lookup(DICTS[locale], key) ?? lookup(en, key) ?? key;
  const text = typeof leaf === "string" ? leaf : Number(vars.count) === 1 ? leaf.one : leaf.other;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

const LocaleContext = createContext<Locale>("en");

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  useEffect(() => setMessageLocale(locale), [locale]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): (key: MessageKey, vars?: Vars) => string {
  const locale = useLocale();
  return useMemo(() => (key: MessageKey, vars?: Vars) => translate(locale, key, vars), [locale]);
}
```

`src/i18n/en/common.ts`:

```ts
export const common = {
  save: "Save",
  cancel: "Cancel",
  delete: "Delete",
  edit: "Edit",
  close: "Close",
  loading: "Loading…",
  retry: "Try again",
  today: "Today",
  week: "Week",
  day: "Day",
  never: "never",
  itemsCount: { one: "{count} item", other: "{count} items" },
};
```

`src/i18n/vi/common.ts`:

```ts
import type { Messages } from "../types";

export const common: Messages["common"] = {
  save: "Lưu",
  cancel: "Huỷ",
  delete: "Xoá",
  edit: "Sửa",
  close: "Đóng",
  loading: "Đang tải…",
  retry: "Thử lại",
  today: "Hôm nay",
  week: "Tuần",
  day: "Ngày",
  never: "chưa bao giờ",
  itemsCount: { one: "{count} mục", other: "{count} mục" },
};
```

`src/i18n/en/errors.ts`:

```ts
export const errors = {
  subjectNameTaken: "another subject already has this name",
  mergeTarget: "choose a different subject of the same semester",
  renameInNote: "edit the class note to rename this task",
  deleteInNote: "remove the line from the class note to delete this task",
  endBeforeStartDate: "end date must be on or after start date",
  endBeforeStart: "end must be after start and within 24 hours",
  eventNotFound: "event not found",
  ruleNotFound: "repeating event not found",
  semesterNotFound: "semester not found",
  subjectNotFound: "subject not found",
  taskNotFound: "task not found",
  unknownSubject: "unknown subject",
  unknownSection: "unknown subject or section",
  schoolReadOnly: "school classes cannot be edited or deleted",
  noActiveSemester: "no active semester",
  rangeTooLong: "range must be longer than 0 and at most 42 days",
  weekStartMonday: "week_start must be a Monday",
  pasteZeusLink: "Paste the Zeus ICS link (or its key)",
  signInAgain: "missing bearer token",
  missingKey: "server is missing TOKEN_ENCRYPTION_KEY",
  noZeusLink: "no Zeus ICS link configured",
  noGroupId: "active semester has no Zeus group id",
  zeusRejected: "Zeus rejected the ICS link",
  zeusHttp: "Zeus returned HTTP {status}",
  network: "network error ({type})",
  invalidFeed: "invalid feed: {detail}",
  emptyFeed: "feed contains no events",
  notIcal: "response is not an iCalendar document",
  unparsable: "could not parse calendar",
  unexpected: "unexpected error ({type})",
  keptMissing: "kept {count} upcoming classes that disappeared from the feed (guard: more than 30% would be cancelled)",
  otherGroup: "the feed looks like a different group, so nothing was changed",
  googleNotConnected: "Google Calendar is not connected",
  googleNotSetUp: "Google Calendar is not set up on the server yet",
  googleRefused: "Google Calendar refused the connection: {detail}",
  googleTokenInvalid: "That Google token is not valid",
  googleRevoked: "Google access was revoked or expired — reconnect Google in Settings",
  googlePermission: "Google Calendar permission is missing — reconnect Google in Settings",
  googleClientRejected: "Google rejected the server's client id/secret",
  googleStatusReason: "Google Calendar returned {status} ({reason})",
  googleStatus: "Google Calendar returned {status}",
  googleSignIn: "Google sign-in returned {status}",
  googleRateLimited: "Google rate limit reached; the rest is sent on the next push",
  googleBusy: "Another push is already running",
  googleGone: "Google is not connected any more — connect it again in Settings",
  googleRowChanged: "A timetable row changed while pushing; it is retried on the next push",
  googleUnreachable: "Could not reach Google",
  googleUnexpected: "Google sent an unexpected response",
  calendarGone: 'The "My Timetable" calendar is gone from Google; it will be recreated on the next push.',
};
```

`src/i18n/vi/errors.ts`:

```ts
import type { Messages } from "../types";

export const errors: Messages["errors"] = {
  subjectNameTaken: "Đã có môn học khác dùng tên này",
  mergeTarget: "Hãy chọn một môn khác trong cùng học kỳ",
  renameInNote: "Hãy sửa ghi chú của buổi học để đổi tên việc này",
  deleteInNote: "Hãy xoá dòng này trong ghi chú buổi học để xoá việc",
  endBeforeStartDate: "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu",
  endBeforeStart: "Giờ kết thúc phải sau giờ bắt đầu và trong vòng 24 giờ",
  eventNotFound: "Không tìm thấy sự kiện",
  ruleNotFound: "Không tìm thấy sự kiện lặp lại",
  semesterNotFound: "Không tìm thấy học kỳ",
  subjectNotFound: "Không tìm thấy môn học",
  taskNotFound: "Không tìm thấy việc cần làm",
  unknownSubject: "Không rõ môn học",
  unknownSection: "Không rõ môn học hoặc nhóm",
  schoolReadOnly: "Không thể sửa hoặc xoá lịch học của trường",
  noActiveSemester: "Chưa có học kỳ nào đang hoạt động",
  rangeTooLong: "Khoảng thời gian phải từ 1 đến 42 ngày",
  weekStartMonday: "Tuần phải bắt đầu từ thứ Hai",
  pasteZeusLink: "Hãy dán liên kết ICS của Zeus (hoặc mã của nó)",
  signInAgain: "Bạn cần đăng nhập lại",
  missingKey: "Máy chủ thiếu TOKEN_ENCRYPTION_KEY",
  noZeusLink: "Chưa có liên kết ICS của Zeus",
  noGroupId: "Học kỳ đang hoạt động chưa có mã nhóm Zeus",
  zeusRejected: "Zeus từ chối liên kết ICS",
  zeusHttp: "Zeus trả về lỗi HTTP {status}",
  network: "Lỗi mạng ({type})",
  invalidFeed: "Dữ liệu lịch không hợp lệ: {detail}",
  emptyFeed: "Lịch không có sự kiện nào",
  notIcal: "Phản hồi không phải tệp iCalendar",
  unparsable: "Không đọc được lịch",
  unexpected: "Lỗi không mong muốn ({type})",
  keptMissing: "Đã giữ lại {count} buổi học sắp tới bị mất khỏi lịch Zeus (an toàn: hơn 30% sẽ bị huỷ)",
  otherGroup: "Lịch có vẻ thuộc nhóm khác nên không có gì bị thay đổi",
  googleNotConnected: "Chưa kết nối Google Lịch",
  googleNotSetUp: "Máy chủ chưa được cấu hình Google Lịch",
  googleRefused: "Google Lịch từ chối kết nối: {detail}",
  googleTokenInvalid: "Mã Google không hợp lệ",
  googleRevoked: "Quyền truy cập Google đã bị thu hồi hoặc hết hạn — hãy kết nối lại trong Cài đặt",
  googlePermission: "Thiếu quyền Google Lịch — hãy kết nối lại trong Cài đặt",
  googleClientRejected: "Google từ chối client id/secret của máy chủ",
  googleStatusReason: "Google Lịch trả về lỗi {status} ({reason})",
  googleStatus: "Google Lịch trả về lỗi {status}",
  googleSignIn: "Đăng nhập Google trả về lỗi {status}",
  googleRateLimited: "Google đang giới hạn số yêu cầu; phần còn lại sẽ gửi ở lần sau",
  googleBusy: "Đang có một lần gửi khác chạy",
  googleGone: "Google không còn được kết nối — hãy kết nối lại trong Cài đặt",
  googleRowChanged: "Một sự kiện đã thay đổi trong lúc gửi; sẽ thử lại lần sau",
  googleUnreachable: "Không kết nối được tới Google",
  googleUnexpected: "Google trả về phản hồi không mong muốn",
  calendarGone: 'Lịch "My Timetable" đã bị xoá khỏi Google; sẽ tạo lại ở lần gửi sau.',
};
```

`src/i18n/en/{nav,calendar,event,board,subjects,review,settings,google}.ts` — each `export const <name> = {};` (e.g. `export const nav = {};`). `src/i18n/vi/<same>.ts` — `import type { Messages } from "../types";\n\nexport const <name>: Messages["<name>"] = {};`.

`src/i18n/en/index.ts`:

```ts
import { board } from "./board";
import { calendar } from "./calendar";
import { common } from "./common";
import { errors } from "./errors";
import { event } from "./event";
import { google } from "./google";
import { nav } from "./nav";
import { review } from "./review";
import { settings } from "./settings";
import { subjects } from "./subjects";

export const en = { common, errors, nav, calendar, event, board, subjects, review, settings, google };
```

`src/i18n/vi/index.ts`: the same imports from `./…` and `export const vi: Messages = { common, errors, nav, calendar, event, board, subjects, review, settings, google };` with `import type { Messages } from "../types";`.

`src/i18n/serverMessages.ts`:

```ts
import { translate, type MessageKey, type Vars } from "./index";
import type { Locale } from "./locale";

type Rule = { match: RegExp; key: MessageKey; vars?: (m: RegExpMatchArray) => Vars };

const exact = (text: string, key: MessageKey): Rule => ({
  match: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
  key,
});

const RULES: Rule[] = [
  exact("another subject already has this name", "errors.subjectNameTaken"),
  exact("choose a different subject of the same semester", "errors.mergeTarget"),
  exact("edit the class note to rename this task", "errors.renameInNote"),
  exact("remove the line from the class note to delete this task", "errors.deleteInNote"),
  exact("end date must be on or after start date", "errors.endBeforeStartDate"),
  exact("end must be after start and within 24 hours", "errors.endBeforeStart"),
  exact("event not found", "errors.eventNotFound"),
  exact("repeating event not found", "errors.ruleNotFound"),
  exact("semester not found", "errors.semesterNotFound"),
  exact("subject not found", "errors.subjectNotFound"),
  exact("task not found", "errors.taskNotFound"),
  exact("unknown subject", "errors.unknownSubject"),
  exact("unknown subject or section", "errors.unknownSection"),
  exact("school classes cannot be edited or deleted", "errors.schoolReadOnly"),
  exact("no active semester", "errors.noActiveSemester"),
  exact("range must be longer than 0 and at most 42 days", "errors.rangeTooLong"),
  exact("week_start must be a Monday", "errors.weekStartMonday"),
  exact("Paste the Zeus ICS link (or its key)", "errors.pasteZeusLink"),
  exact("missing bearer token", "errors.signInAgain"),
  exact("server is missing TOKEN_ENCRYPTION_KEY", "errors.missingKey"),
  exact("no Zeus ICS link configured", "errors.noZeusLink"),
  exact("active semester has no Zeus group id", "errors.noGroupId"),
  exact("Zeus rejected the ICS link", "errors.zeusRejected"),
  { match: /^Zeus returned HTTP (\d+)$/, key: "errors.zeusHttp", vars: (m) => ({ status: m[1] }) },
  { match: /^network error \((\w+)\)$/, key: "errors.network", vars: (m) => ({ type: m[1] }) },
  { match: /^invalid feed: feed looks like a different group/, key: "errors.otherGroup" },
  { match: /^invalid feed: (.*)$/, key: "errors.invalidFeed", vars: (m) => ({ detail: m[1] }) },
  exact("feed contains no events", "errors.emptyFeed"),
  exact("response is not an iCalendar document", "errors.notIcal"),
  { match: /^could not parse calendar/, key: "errors.unparsable" },
  { match: /^unexpected error \((\w+)\)$/, key: "errors.unexpected", vars: (m) => ({ type: m[1] }) },
  { match: /^kept (\d+) upcoming classes that disappeared from the feed/, key: "errors.keptMissing", vars: (m) => ({ count: m[1] }) },
  exact("Google Calendar is not connected", "errors.googleNotConnected"),
  { match: /^Google Calendar is not set up on the server yet/, key: "errors.googleNotSetUp" },
  { match: /^Google Calendar refused the connection: (.*)$/, key: "errors.googleRefused", vars: (m) => ({ detail: m[1] }) },
  exact("That Google token is not valid", "errors.googleTokenInvalid"),
  exact("Google access was revoked or expired — reconnect Google in Settings", "errors.googleRevoked"),
  exact("Google Calendar permission is missing — reconnect Google in Settings", "errors.googlePermission"),
  exact("Google rejected the server's client id/secret", "errors.googleClientRejected"),
  { match: /^Google Calendar returned (\d+) \((.*)\)$/, key: "errors.googleStatusReason", vars: (m) => ({ status: m[1], reason: m[2] }) },
  { match: /^Google Calendar returned (\d+)$/, key: "errors.googleStatus", vars: (m) => ({ status: m[1] }) },
  { match: /^Google sign-in returned (\d+)$/, key: "errors.googleSignIn", vars: (m) => ({ status: m[1] }) },
  exact("Google rate limit reached; the rest is sent on the next push", "errors.googleRateLimited"),
  exact("Another push is already running", "errors.googleBusy"),
  exact("Google is not connected any more — connect it again in Settings", "errors.googleGone"),
  exact("A timetable row changed while pushing; it is retried on the next push", "errors.googleRowChanged"),
  exact("Could not reach Google", "errors.googleUnreachable"),
  exact("Google sent an unexpected response", "errors.googleUnexpected"),
  exact('The "My Timetable" calendar is gone from Google; it will be recreated on the next push.', "errors.calendarGone"),
];

/** Shows a known English server text in the chosen language; unknown texts stay as they are. */
export function translateServerMessage(text: string, locale: Locale): string {
  if (locale === "en") return text;
  for (const rule of RULES) {
    const m = text.match(rule.match);
    if (m) return translate(locale, rule.key, rule.vars?.(m));
  }
  return text;
}
```

(Check the exact backend wording of each message with `grep -rn` in `backend/app` before finalising; the brief's strings were copied from the code on 2026-10-04.)

`src/lib/language.ts`:

```ts
import type { Locale } from "../i18n/locale";

export const LANGUAGE_KEY = "timetable:language";

export function browserLanguage(lang: string | undefined = typeof navigator === "undefined" ? undefined : navigator.language): Locale {
  return lang?.toLowerCase().startsWith("vi") ? "vi" : "en";
}

export function readStoredLanguage(): Locale | null {
  try {
    const value = localStorage.getItem(LANGUAGE_KEY);
    return value === "en" || value === "vi" ? value : null;
  } catch {
    return null;
  }
}

export function storeLanguage(locale: Locale): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, locale);
  } catch {
    // storage blocked: the server copy still applies after sign-in
  }
}

export function initialLanguage(): Locale {
  return readStoredLanguage() ?? browserLanguage();
}
```

`src/i18n/LanguageRoot.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { initialLanguage, storeLanguage } from "../lib/language";
import { I18nProvider } from "./index";
import type { Locale } from "./locale";

export interface Preferences {
  language: Locale | null;
}

export function usePreferences() {
  return useQuery({ queryKey: ["preferences"], queryFn: () => apiFetch<Preferences>("/api/preferences"), staleTime: Infinity });
}

export function useSetLanguage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (language: Locale) => apiFetch<Preferences>("/api/preferences", { method: "PUT", body: JSON.stringify({ language }) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["preferences"], data);
      if (data.language) storeLanguage(data.language);
    },
  });
}

/** Language from the account (server); until it answers, the cached or browser language. */
export function LanguageRoot({ children }: { children: ReactNode }) {
  const preferences = usePreferences();
  const server = preferences.data?.language ?? null;
  const locale = server ?? initialLanguage();
  useEffect(() => {
    document.documentElement.lang = locale;
    if (server) storeLanguage(server);
  }, [locale, server]);
  return <I18nProvider locale={locale}>{children}</I18nProvider>;
}
```

- [ ] **Step 4: Dates, apiFetch, App wiring**

`src/lib/time.ts`: add `import { INTL_LOCALE, type Locale } from "../i18n/locale";` and change:

```ts
export function dayLabel(date: string, locale: Locale = "en"): { weekday: string; day: string } {
  const dt = utcNoon(date);
  return { weekday: dt.toLocaleDateString(INTL_LOCALE[locale], { weekday: "short", timeZone: "UTC" }), day: String(dt.getUTCDate()) };
}

export function formatLongDate(date: string, locale: Locale = "en"): string {
  return utcNoon(date).toLocaleDateString(INTL_LOCALE[locale], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
```

`src/lib/api.ts`: import `getMessageLocale` from `../i18n/current` and `translateServerMessage` from `../i18n/serverMessages`; right before `throw new ApiError(...)`, set `message = translateServerMessage(message, getMessageLocale());`.

`src/App.tsx`: wrap — `<I18nProvider locale={initialLanguage()}>` around `<AuthGate>` (so the login page follows the browser/cached language), and inside `AuthGate` wrap `<BrowserRouter>` with `<LanguageRoot>`. Translate `src/auth/LoginPage.tsx` with `useT()`: add keys to `en/settings.ts`? No — put them in `common`: `signInTitle: "Sign in with your Google account to see your timetable."`, `continueWithGoogle: "Continue with Google"` (vi: "Đăng nhập bằng tài khoản Google để xem thời khoá biểu của bạn.", "Tiếp tục với Google"). Keep `Timetable` as is.

- [ ] **Step 5: Run** — `cd frontend && npx vitest run && npm run build` → all pass; delete `tsconfig.tsbuildinfo` if created.

- [ ] **Step 6: Commit** — `git add frontend && git commit -m "feat(frontend): translation layer, language from the account, Vietnamese dates" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 3: Colour tokens and dark mode

**Files:** Create `frontend/src/lib/theme.ts`, `frontend/src/lib/theme.test.ts`, `frontend/src/theme.guard.test.ts`; modify `frontend/index.html`, `frontend/src/index.css`, and every `src/**/*.tsx` that uses hard-coded colours (components, pages, auth).

**Interfaces (Produces):** `lib/theme.ts`: `type ThemeChoice = "system" | "light" | "dark"`, `THEME_KEY = "timetable:theme"`, `readTheme(): ThemeChoice`, `storeTheme(choice)`, `resolveTheme(choice, prefersDark: boolean): "light" | "dark"`, `applyTheme(choice): void`, `useTheme(): [ThemeChoice, (c: ThemeChoice) => void]`. Tailwind token classes: `bg-canvas bg-surface bg-surface-2 bg-subtle text-ink text-ink-2 text-muted border-line border-line-strong bg-accent text-accent text-accent-strong bg-accent-soft border-accent-line text-on-accent text-danger bg-danger bg-danger-soft border-danger-line text-on-danger text-warn bg-warn-soft border-warn-line text-changed bg-changed text-on-changed text-success bg-success-soft text-important`.

- [ ] **Step 1: Failing tests**

`frontend/src/theme.guard.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname);
const BANNED = /\[#[0-9A-Fa-f]{3,8}\]|\b(?:bg|text|border)-(?:white|black)\b/g;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") && !path.endsWith(".test.tsx") ? [path] : [];
  });
}

describe("colours", () => {
  it("components use colour tokens, not hard-coded colours", () => {
    const offenders = tsxFiles(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(BANNED)].map((m) => `${file.slice(SRC.length + 1)}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });
});
```

`frontend/src/lib/theme.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, readTheme, resolveTheme, storeTheme } from "./theme";

describe("theme", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    document.documentElement.removeAttribute("data-theme");
  });

  it("resolves system, light and dark", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("stores the choice and applies it to the page", () => {
    expect(readTheme()).toBe("system");
    storeTheme("dark");
    expect(readTheme()).toBe("dark");
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(meta.content).toBe("#121418");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    meta.remove();
  });

  it("theme helpers survive blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readTheme()).toBe("system");
    expect(() => storeTheme("dark")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd frontend && npx vitest run src/theme.guard.test.ts src/lib/theme.test.ts` (guard lists ~100 offenders; theme module missing).

- [ ] **Step 3: Tokens** — replace `frontend/src/index.css` with:

```css
@import "tailwindcss";

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme {
  --font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}

@theme inline {
  --color-canvas: var(--tt-canvas);
  --color-surface: var(--tt-surface);
  --color-surface-2: var(--tt-surface-2);
  --color-subtle: var(--tt-subtle);
  --color-ink: var(--tt-ink);
  --color-ink-2: var(--tt-ink-2);
  --color-muted: var(--tt-muted);
  --color-line: var(--tt-line);
  --color-line-strong: var(--tt-line-strong);
  --color-accent: var(--tt-accent);
  --color-accent-strong: var(--tt-accent-strong);
  --color-accent-soft: var(--tt-accent-soft);
  --color-accent-line: var(--tt-accent-line);
  --color-on-accent: var(--tt-on-accent);
  --color-danger: var(--tt-danger);
  --color-danger-soft: var(--tt-danger-soft);
  --color-danger-line: var(--tt-danger-line);
  --color-on-danger: var(--tt-on-danger);
  --color-warn: var(--tt-warn);
  --color-warn-soft: var(--tt-warn-soft);
  --color-warn-line: var(--tt-warn-line);
  --color-changed: var(--tt-changed);
  --color-on-changed: var(--tt-on-changed);
  --color-success: var(--tt-success);
  --color-success-soft: var(--tt-success-soft);
  --color-important: var(--tt-important);
}

:root {
  color-scheme: light;
  --tt-canvas: #f4f5f7;
  --tt-surface: #ffffff;
  --tt-surface-2: #f8f9fb;
  --tt-subtle: #f0f1f4;
  --tt-ink: #15171c;
  --tt-ink-2: #3a3f4b;
  --tt-muted: #5b6170;
  --tt-line: #e4e7ec;
  --tt-line-strong: #d5d9e0;
  --tt-accent: #2e55e6;
  --tt-accent-strong: #2445c4;
  --tt-accent-soft: #e8edfd;
  --tt-accent-line: #c9d3f7;
  --tt-on-accent: #ffffff;
  --tt-danger: #8b1a1a;
  --tt-danger-soft: #fdecec;
  --tt-danger-line: #f3c4c4;
  --tt-on-danger: #ffffff;
  --tt-warn: #7c2d12;
  --tt-warn-soft: #fff1e0;
  --tt-warn-line: #f5d9b8;
  --tt-changed: #9a3412;
  --tt-on-changed: #ffffff;
  --tt-success: #145c33;
  --tt-success-soft: #e7f5ec;
  --tt-important: #ea580c;
  --event-fill: 12%;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --tt-canvas: #121418;
  --tt-surface: #1a1d23;
  --tt-surface-2: #22262e;
  --tt-subtle: #262a33;
  --tt-ink: #e8eaee;
  --tt-ink-2: #c3c8d2;
  --tt-muted: #9aa1ae;
  --tt-line: #2c313a;
  --tt-line-strong: #3a404b;
  --tt-accent: #7c9bff;
  --tt-accent-strong: #a3b8ff;
  --tt-accent-soft: #1e2a4d;
  --tt-accent-line: #33446f;
  --tt-on-accent: #0b1020;
  --tt-danger: #ff8a8a;
  --tt-danger-soft: #3a1f22;
  --tt-danger-line: #5a2a2e;
  --tt-on-danger: #2a0e10;
  --tt-warn: #fdba74;
  --tt-warn-soft: #3a2a1a;
  --tt-warn-line: #5a3d1e;
  --tt-changed: #fdba74;
  --tt-on-changed: #2a170a;
  --tt-success: #7dd3a0;
  --tt-success-soft: #173326;
  --tt-important: #fb923c;
  --event-fill: 22%;
}

body {
  margin: 0;
  background: var(--tt-canvas);
  color: var(--tt-ink);
  font-family: var(--font-sans);
}
```

- [ ] **Step 4: Pre-paint script** — in `frontend/index.html`, directly after the `theme-color` meta, add:

```html
    <script>
      (function () {
        var choice = "system";
        try {
          choice = localStorage.getItem("timetable:theme") || "system";
        } catch (e) {}
        var dark = choice === "dark" || (choice !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
        document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", dark ? "#121418" : "#2E55E6");
      })();
    </script>
```

- [ ] **Step 5: Theme module** — `frontend/src/lib/theme.ts`:

```ts
import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export const THEME_KEY = "timetable:theme";
const META_COLOR = { light: "#2E55E6", dark: "#121418" } as const;

export function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function storeTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // storage blocked: the choice lasts until the page is reloaded
  }
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): "light" | "dark" {
  return choice === "system" ? (prefersDark ? "dark" : "light") : choice;
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(choice: ThemeChoice): void {
  const theme = resolveTheme(choice, systemPrefersDark());
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_COLOR[theme]);
}

/** Current choice plus a setter that saves and applies it; follows the system setting live in "system" mode. */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  useEffect(() => {
    applyTheme(choice);
    if (choice !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);
  return [
    choice,
    (next) => {
      storeTheme(next);
      setChoice(next);
    },
  ];
}
```

- [ ] **Step 6: Replace hard-coded colours in every component** — apply this mapping in all `src/**/*.tsx` (keep the same utility prefix — `bg-`, `text-`, `border-`, `hover:bg-` …):

| Today | Token |
|---|---|
| `#8B1A1A` | `danger` (with `text-white` on it → `text-on-danger`) |
| `#FDECEC` | `danger-soft` |
| `#F3C4C4` | `danger-line` |
| `#3A3F4B` | `ink-2` |
| `#D5D9E0` | `line-strong` |
| `#E1E4EA` | `line` |
| `#F8F9FB` | `surface-2` |
| `#F0F1F4`, `#EEF0F3`, `#EBEDF1`, `#E9EBEF` | `subtle` |
| `#7C2D12` | `warn` |
| `#FFF1E0`, `#FFF7ED` | `warn-soft` |
| `#F5D9B8` | `warn-line` |
| `#9A3412` | `changed` (with `text-white` on it → `text-on-changed`) |
| `#C9D3F7` | `accent-line` |
| `#145C33` | `success` |
| `#E7F5EC`, `#F2FAF5` | `success-soft` |
| `#EA580C` | `important` |
| `bg-white` | `bg-surface` |
| `text-white` on `bg-accent` | `text-on-accent` |

Inline styles in `WeekGrid.tsx`: the event fill `` `${color}1F` `` becomes `` `color-mix(in srgb, ${color} var(--event-fill), transparent)` ``; the dashed `french_ext` block background `"#FFFFFF"` becomes `"var(--tt-surface)"`; the important edge `"inset 3px 0 0 #EA580C"` becomes `"inset 3px 0 0 var(--tt-important)"`. Colour *data* (subject colours, `KIND_COLORS`, the dot colours in ReviewPage) stays as hex strings in TS objects/expressions — the guard only bans colour *classes*. Update test expectations that assert old inline style strings (e.g. `WeekGrid.test.tsx`) to the new values.

- [ ] **Step 7: Run** — `cd frontend && npx vitest run && npm run build` → all pass, guard empty; delete `tsconfig.tsbuildinfo` if created.

- [ ] **Step 8: Commit** — `git add frontend && git commit -m "feat(frontend): colour tokens and dark mode" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Tasks 4–6: Translate the screens (three parallel lanes)

Shared rules for Tasks 4, 5 and 6 (each task touches only its own files):

1. Every user-visible text in the lane's files goes through `const t = useT();` → `t("<area>.<key>")`: text nodes, button labels, `aria-label`s, `placeholder`s, `title`s, empty states, confirm texts, status/progress texts. Not translated: school data (subject names, rooms, event titles), user content (notes, task titles), emails, "Timetable", "Zeus", "Google" as product names inside sentences.
2. **English values are copied exactly from today's text** (existing tests rely on them). Sentences with values use placeholders (`"Next class: {date} {time}"`), never string concatenation; English plurals use `{ one, other }` with `count`.
3. Keys are camelCase, grouped by component inside the area file (e.g. `calendar.header.previous`, `event.markImportant`). Add every key to both `en/<area>.ts` and `vi/<area>.ts`. Never edit `common.ts`/`errors.ts` or another lane's area files; if a shared word is needed and not in `common`, add it to your own area.
4. Dates: pass `useLocale()` to `dayLabel(date, locale)` and `formatLongDate(date, locale)`. Times (`formatTime`) are 24-hour in both languages; leave as is.
5. Texts coming from the server that the user sees (sync `run.error`, Google `last_push_error` / push `error`) are shown through `translateServerMessage(text, locale)`. (`apiFetch` errors are already translated by Task 2.)
6. Vietnamese glossary (use consistently): Calendar Lịch · Board Bảng việc · Subjects Môn học · Review Ôn tập · Weekend review Ôn tập cuối tuần · Settings Cài đặt · Semester Học kỳ · Week Tuần · Day Ngày · Today Hôm nay · Add event Thêm sự kiện · Event Sự kiện · Class Buổi học · School timetable Lịch học của trường · Note Ghi chú · After class Sau buổi học · Before next class Trước buổi học tới · Task Việc · To do / Doing / Done Cần làm / Đang làm / Xong · Due Hạn · Important Quan trọng · Mark important Đánh dấu quan trọng · Exam Thi · Changed Đã đổi · Cancelled Đã huỷ · Room Phòng · Group Nhóm · Repeating event Sự kiện lặp lại · Work shift Ca làm · External French Tiếng Pháp (bên ngoài) · Other Khác · Sync now Đồng bộ ngay · Push now Gửi ngay · Connect Kết nối · Disconnect Ngắt kết nối · Merge Gộp · Hide Ẩn · Appearance Giao diện · Theme Chế độ màu · System / Light / Dark Theo hệ thống / Sáng / Tối · Language Ngôn ngữ · Overdue Quá hạn · Unsaved changes Chưa lưu thay đổi.
7. Tests: each lane adds `src/i18n/<lane>.vi.test.tsx` that renders 2–3 of its screens inside `<I18nProvider locale="vi">` (with the same `apiFetch` mocks the existing tests use) and asserts translated texts by key, e.g. `screen.getByRole("button", { name: translate("vi", "calendar.addEvent") })`. The global test from Task 2 (every key translated) must keep passing. All existing tests must pass unchanged (English).
8. Run `cd frontend && npx vitest run && npm run build`; delete `tsconfig.tsbuildinfo` if created; commit with the trailer.

### Task 4: Translate calendar, event and navigation
**Files:** `src/components/Layout.tsx`, `src/pages/CalendarPage.tsx`, `src/components/WeekGrid.tsx`, `src/components/Banners.tsx`, `src/pages/EventPage.tsx`, `src/pages/NewEventPage.tsx`; areas `nav`, `calendar` (Calendar page, WeekGrid, Banners), `event` (EventPage, NewEventPage); test `src/i18n/calendar.vi.test.tsx`.
Commit: `feat(frontend): Vietnamese for calendar, events and navigation`.

### Task 5: Translate board, subjects and review
**Files:** `src/pages/BoardPage.tsx`, `src/pages/SubjectsPage.tsx`, `src/pages/SubjectPage.tsx`, `src/pages/ReviewPage.tsx`; areas `board`, `subjects`, `review`; test `src/i18n/study.vi.test.tsx`.
Commit: `feat(frontend): Vietnamese for board, subjects and review`.

### Task 6: Translate settings, add the Appearance card
**Files:** `src/pages/SettingsPage.tsx`, `src/components/SemesterSettings.tsx`, `src/components/SubjectSettings.tsx`, `src/components/RecurringList.tsx`, `src/components/GoogleSettings.tsx`, new `src/components/AppearanceSettings.tsx` (+ `AppearanceSettings.test.tsx`); areas `settings`, `google`; test `src/i18n/settings.vi.test.tsx`.

`AppearanceSettings` (rendered first on the Settings page):

```tsx
import { useLocale, useT } from "../i18n";
import type { Locale } from "../i18n/locale";
import { useSetLanguage } from "../i18n/LanguageRoot";
import { useTheme, type ThemeChoice } from "../lib/theme";

const THEMES: ThemeChoice[] = ["system", "light", "dark"];

export function AppearanceSettings() {
  const t = useT();
  const locale = useLocale();
  const setLanguage = useSetLanguage();
  const [theme, setTheme] = useTheme();
  return (
    <section aria-labelledby="appearance-heading" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <h2 id="appearance-heading" className="text-base font-bold">
        {t("settings.appearance.title")}
      </h2>
      <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">
        {t("settings.appearance.language")}
        <select
          value={locale}
          onChange={(e) => setLanguage.mutate(e.target.value as Locale)}
          disabled={setLanguage.isPending}
          className="h-10 w-56 rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink"
        >
          <option value="en">English</option>
          <option value="vi">Tiếng Việt</option>
        </select>
      </label>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-semibold text-ink-2">{t("settings.appearance.theme")}</legend>
        <div className="flex flex-wrap gap-2">
          {THEMES.map((choice) => (
            <label key={choice} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
              <input type="radio" name="theme" value={choice} checked={theme === choice} onChange={() => setTheme(choice)} />
              {t(`settings.appearance.themes.${choice}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {setLanguage.error && <p className="text-sm text-danger">{(setLanguage.error as Error).message}</p>}
    </section>
  );
}
```

Keys: `settings.appearance.{title: "Appearance", language: "Language", theme: "Theme", themes: {system: "System", light: "Light", dark: "Dark"}}` (vi: Giao diện, Ngôn ngữ, Chế độ màu, Theo hệ thống/Sáng/Tối). `AppearanceSettings.test.tsx`: choosing "Tiếng Việt" calls `apiFetch("/api/preferences", { method: "PUT", body: JSON.stringify({ language: "vi" }) })`; choosing "Dark" sets `document.documentElement.dataset.theme` to `"dark"` and `localStorage["timetable:theme"]` to `"dark"`.
Commit: `feat(frontend): Vietnamese for settings, appearance card with language and theme`.

---

### Task 7: Ship
- [ ] Full verification: backend `uv run python -m pytest -q` + `uv export … | diff - ../requirements.txt`; frontend `npx vitest run && npm run build`.
- [ ] Migrate production to 0005 with pg8000 (as in Plan 3), verify 14 tables with RLS.
- [ ] Push to main, `npx --yes vercel deploy --prod --yes`, smoke: `/api/health` ok, `/api/preferences` 401 without login, `/privacy.html` 200.
