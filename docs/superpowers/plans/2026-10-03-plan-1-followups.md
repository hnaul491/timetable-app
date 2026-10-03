# Plan 1 follow-ups (deferred review findings)

Collected from the per-task and final whole-branch reviews of plan 1. None blocks use; items marked **before Plan 3** must land before Google Calendar push.

## Before Plan 3 (Google push)
- Partial-feed guard: fail the sync if more than ~30% of future events would be cancelled (a truncated but valid feed currently cancels the rest of the semester; Plan 3 would delete them from Google).
- Stale-sync banner: warn when `last_success_at` is older than ~36 h (a broken cron currently shows nothing).

## Verify against the real feed
- Multi-day holidays (date-only `Vacances` spanning days) render only on their start date.
- Group id inside a pasted Zeus link is ignored; the semester's `zeus_group_id` is used.

## Deferred minors (raw, from the execution ledger)
- Task 1: minor (deferred): pytest shows Starlette TestClient deprecation warning (httpx) — output not pristine; candidate filterwarnings/pin
- Task 2: minor (deferred): env.py offline mode lacks render_as_batch; SQLite FKs not enforced in tests; no CHECK constraints on status/kind/source; title_raw String(300) may overflow on Postgres
- Task 3: minor (deferred): no test for section+exam combo ("GR5 - X Exam") or case-insensitive exam/holiday; "GR5 - Vacances" not holiday; "GR5 -" yields base_name with dash
- Task 4: minor (deferred): parse_ics only catches ValueError from icalendar; floating times treated as UTC (undocumented); empty VCALENDAR returns 0 events (guarded in Task 7 apply_feed)
- Task 5: minor (deferred): seed never merges new aliases into existing subjects and ignores subjects auto-created under an alias name; resolver does no whitespace normalization (parse_title already collapses); seed test does not assert subject count stable; resolver subject list is a snapshot
- Task 6: minor (deferred): ZeusFetchError keeps original httpx exc in __context__ (suppressed but reachable if traceback logged) — run_sync stores only str(exc), so not logged today; httpx.InvalidURL not caught; wrong TOKEN_ENCRYPTION_KEY silently falls back to env key
- Task 7: minor (deferred): run_sync catches only ZeusFetchError/InvalidFeedError (other exceptions leave session dirty, no failed SyncRun); resolver runs before past-event skip (possible orphan Subject); "no active semester" raised as ZeusFetchError; missing tests for description-only change / title change updating subject
- Task 8: minor (deferred, security hardening — final review should triage, recommend fixing pre-merge): (1) non-ASCII X-Cron-Secret makes hmac.compare_digest(str) raise TypeError → 500 on public POST /api/sync; fix compare bytes; (2) jwt.decode does not require exp/aud/email — add options require + issuer; (4) JWKS connection failure maps to 401 not 503; empty SUPABASE_URL → 500; (5) no tests for alg none / HS256 confusion / missing email / ES256
- Task 9: minor (deferred): conftest has mid-file imports (plan-mandated) — would trip ruff E402 if linting added
- Task 9: minor (deferred): 401/403 tested only on /api/events (not semesters/settings/sync status); no 42-day / 0 boundary test; hidden subjects still listed in section chooser; missing_sections falls back to title_raw when subject None
- Task 10: minor (deferred): apiFetch throws on 204/empty 2xx body; detail array (pydantic 422) shows statusText; AuthGate getSession has no catch and races onAuthStateChange; no client-side 401 handling; package.json npm-init leftovers + no engines>=22; fonts lack gstatic preconnect; installed versions react-router 8.4/vite 8/vitest 5/TS 7 (plan written for RR v7)
- Task 11: minor (deferred): two zero-length events at same minute stack (degenerate); no tests for non-mutation / zero-length / separate clusters / autumn-day midnight; shortOffset regex silently falls back to 0 on old ICU; parisParts throws on invalid ISO
- Task 12: minor (deferred): Sync now / section pick mutation errors not shown; "Choose…" placeholder can submit empty section; events crossing midnight clamped (multi-day holidays one chip); holiday chip key collision; overlap test checks data attrs not styles; cancelled not in aria-label; no page-level tests; build chunk-size advisory 523 kB
- Task 13: minor (deferred): sync.yml no curl --max-time / timeout-minutes; ci setup-uv no cache; SETUP sets env for Preview too (shares prod DB); SETUP could note ZEUS_ICS_KEY intentionally absent (pasted in Settings); Vercel path preservation after rewrite unverified until deploy
- Final review M8–M12: finished_at equals started_at; no loading/error states on Calendar and Settings queries; ambiguous cross-month week title; seed "Data Privacy by Design" spelling; ci.yml permissions: contents: read.
