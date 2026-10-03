# UX-2 — Look & language (dark mode + Vietnamese) — Design

**Status:** approved by the user in chat 2026-10-04 ("ok A", "go with option 1", "just go ahead").
**Context:** first of two UX plans from `docs/superpowers/plans/2026-10-03-ux-backlog.md` (items 6 Vietnamese, 7 dark mode). UX-1 (popups, confirm dialog, toasts, shortcuts, full-screen, sidebar) follows and builds on the tokens and translation layer created here.

## Goals
- The whole app can be shown in **English or Vietnamese**; the choice is saved **in the account** so laptop and phone agree.
- The whole app has a **dark mode**: System (default) / Light / Dark, saved **per device**.
- New UI written after this plan uses colour tokens and `t()` from day one.

## Non-goals
- Translating school data (subject names, rooms, titles from Zeus) — shown as Zeus sends it.
- Translating the backend's API texts at the source; the frontend maps them (see 4).
- More languages than en/vi (the layer allows adding one later).

## 1. Colour tokens and dark mode
- `frontend/src/index.css` defines semantic tokens as CSS variables under Tailwind 4 `@theme`: `canvas`, `surface`, `surface-2` (subtle fill), `ink`, `ink-2` (secondary text, today `#3A3F4B`), `muted`, `line`, `line-strong` (inputs, today `#D5D9E0`), `accent`, `accent-strong`, `accent-soft`, `accent-line` (today `#C9D3F7`), and status pairs `danger`/`danger-soft`/`danger-line`, `warn`/`warn-soft`/`warn-line`, `success`/`success-soft`, `changed` (today `#9A3412`), `important` (orange star, `#EA580C`).
- Light values = today's colours (no visual change in light mode). Dark values: canvas `#121418`, surface `#1A1D23`, surface-2 `#22262E`, ink `#E8EAEE`, ink-2 `#C3C8D2`, muted `#9AA1AE`, line `#2C313A`, line-strong `#3A404B`, accent `#7C9BFF`, accent-strong `#A3B8FF`, accent-soft `#1E2A4D`, accent-line `#33446F`, danger `#FF8A8A` on `#3A1F22`, warn `#FDBA74` on `#3A2A1A`, success `#7DD3A0` on `#173326`, changed `#FDBA74`, important `#FB923C`.
- Dark mode = `[data-theme="dark"]` on `<html>` redefines the variables; Tailwind `dark:` variant mapped to it via `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *))`.
- Theme preference (`system|light|dark`) in localStorage `timetable:theme` (safe try/catch); `system` follows `prefers-color-scheme` live. An inline script in `index.html` sets `data-theme` before first paint (no white flash) and updates `<meta name="theme-color">`.
- Every hard-coded colour class in components (`[#xxxxxx]`, ~100 uses, 20 colours) is replaced by tokens. A test fails the build if a `[#xxxxxx]` class appears in `src/**/*.tsx` again.
- Calendar event blocks: subject colour stays the dot/edge colour; the block fill uses the subject colour at 12% alpha on light and 22% on dark; text uses `ink` (readable on both). Kind colours (`KIND_COLORS`) stay data.

## 2. Translation layer
- `src/i18n/` : `en/*.ts` and `vi/*.ts`, one file per area (`common`, `nav`, `calendar`, `event`, `board`, `subjects`, `review`, `settings`, `google`, `errors`), merged in `src/i18n/index.ts`. `vi` is typed as `Messages = typeof en` (deep same keys), so a missing Vietnamese text fails `tsc`.
- Messages are strings with `{name}` placeholders; plurals as `{ one, other }` objects chosen by `count` (Vietnamese uses `other` only).
- `useT()` hook → `t(key, vars?)` with dotted keys typed from the English messages; `useLocale()` → `"en" | "vi"`. `I18nProvider` at the app root.
- Dates/times: `lib/time.ts` formatting functions take a `locale` argument (`en-GB` / `vi-VN`) and keep the Europe/Paris time zone; components get the locale from `useLocale()`.
- Vietnamese wording: short and friendly; glossary fixed in the plan (e.g. Calendar = Lịch, Board = Bảng công việc, Subjects = Môn học, Weekend review = Ôn tập cuối tuần, Settings = Cài đặt, Note = Ghi chú, Task = Việc cần làm, Important = Quan trọng, Exam = Thi). The user, a native speaker, reviews after release.

## 3. Language preference in the account
- Backend: table `app_setting(key PK, value JSON)` (migration 0005, RLS on); `GET /api/preferences` → `{language: "en"|"vi"|null}`, `PUT /api/preferences {language}`; both `require_user`.
- Frontend: before the server answers, use localStorage `timetable:language`, else the browser language (`vi*` → vi, otherwise en). When the server answers with a language, use it and cache it. Settings → Appearance has Language (English / Tiếng Việt) and Theme (System / Light / Dark). `<html lang>` follows the language.

## 4. Server messages
- `src/i18n/serverMessages.ts`: maps known English server texts to translation keys — exact strings (e.g. "end date must be on or after start date") and a few patterns with numbers (e.g. `^Google Calendar returned (\d+)`, `^kept (\d+) upcoming classes`). `apiFetch` errors, sync errors and Google push errors shown in the UI pass through `translateServerMessage(text, t)`; unknown texts are shown as they are.

## Testing
- Unit: `t()` placeholders/plurals/fallback; `vi` key parity (tsc); server message mapping; theme script (system/light/dark, storage blocked).
- Components: a few screens rendered in Vietnamese (nav, calendar header, event page buttons, settings appearance); existing tests keep English (default in tests).
- Guard test: no `[#xxxxxx]` colour classes in `src/**/*.tsx`.
- Backend: preferences API (auth, default null, set/read, invalid value 422); migration RLS list grows to 14 tables.
