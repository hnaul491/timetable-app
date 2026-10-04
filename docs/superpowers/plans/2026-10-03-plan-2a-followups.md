# Plan 2A follow-ups (deferred review findings)

Collected from the per-task and final whole-branch reviews of plan 2A. None blocks use.

## Worth doing in Plan 2B
- Sync guard: apply inserts/updates and skip only the cancellations (today a tripped guard blocks every change until the feed recovers); show the reason in the banner. — DONE in plan 2B (wrong-group feeds still rejected)
- `update_line` should only flip the checkbox / due suffix instead of re-rendering the whole line (long lines lose their tail). — DONE in plan 2B
- Rule/occurrence editing UI, plus handling of edited (detached) or deleted occurrences when a rule is edited. — rule editing DONE in polish pass (Settings Edit + Edit series)
- Restored local draft can be stale vs. a note changed elsewhere: add "Discard draft" or compare with the note's updated_at. — PARTLY DONE in plan 2B ("Discard changes" button; no updated_at comparison)
- Parametrised 401 tests for every new route; a formatter for array-shaped 422 details. — 422 formatter DONE in plan 2B; parametrised 401 tests still open
- Board: per-task aria-label on Delete, reset two-click confirms, disable status select while pending, keep the board visible on background refetch errors. — DONE in plan 2B

## Raw deferred minors (from the execution ledger)
- Task 1: minor (deferred): mid-file timedelta import; no boundary tests (exactly 10 / ratio 0.3) or past/cancelled-exclusion test; legit large schedule change blocks every sync with no user override (banner does not show reason) — consider "apply anyway" in Plan 2B
- Task 2: minor (deferred): unparseable last_success_at hides stale banner (NaN); stale branch applies to any non-failed status (incl. a hypothetical "running"); no precedence/boundary tests; now evaluated only on render
- Task 3: minor (deferred): test_models mid-file imports (plan-mandated); migration 0002 not run on live PG until Task 13 (offline SQL test covers RLS)
- Task 4: minor (deferred): LINE_RE lazy-match backtracking O(n^2) on huge whitespace runs (bounded by 20k body); test gaps ([X]/tabs, reorder, due/important updates, doing->done)
- Task 4: minor (deferred): ticking a task whose line title was >300 chars rewrites the line with the truncated title (rest of that line lost) — mitigation: update_line could only flip the checkbox char; re-reviewer claim that rewritten CRLF line drops  looks wrong (code restores carriage; test covers) — final review to confirm
- Task 5: minor (deferred): DST gap/overlap times resolve with fold=0 (02:30 on spring-forward -> 03:30; fall-back -> first 02:30) untested/undocumented; MAX_SPAN_DAYS cap silent; N+1 note lookups; missing tests (double regenerate, whitespace note, kept_starts collision, task cascade)
- Task 6: minor (deferred): whitespace-only note counts as note; next_event ignores semester/chosen section edge cases; test gaps (cancelled next, recurring next, 20k limit 422, PUT unauth/unknown, empty-body count, subjectless describe)
- Task 7: minor (deferred): rules/custom events editable by id across semesters (list is active-only); editing a detached occurrence then editing its rule regenerates the original slot (duplicate that week); naive datetimes treated as UTC silently; validation test does not assert which field
- Task 8: minor (deferred): no None-guard on session.get(Note) in write-back; no duplicate-title write-back test; write-back does not bump note.updated_at (Note has updated_at); redundant .strip() after TaskTitle; truncated-title line rewrite (see Task 4 minor)
- Task 9: minor (deferred): full-cover button blocks text selection/badge pointer events; dashed-outline test checks data-kind only; no DST gap/overlap or non-Paris TZ tests for parisLocalToUtc; no input validation in parisLocalToUtc
- Task 10: minor (deferred): no unsaved-changes guard when leaving the page; 404 shows generic error with Try again; error <p> lack role=alert; incomplete tab ARIA (aria-controls/tabpanel/arrow keys); delete confirm never resets; toggle not disabled while pending
- Task 10: minor (deferred): no regression test for typing-during-pending-save
- Task 11: minor (deferred): changing Date overwrites chosen weekdays; apiFetch ignores array-shaped 422 detail (generic message); test gaps (overnight rollover, start=end, until<date, API error display)
- Task 11: minor (deferred): no tests for cleared Until/Date
- Task 12: minor (deferred): board Delete button lacks per-task aria-label; stale mutation errors linger; two-click confirm never resets (board + recurring); status select not optimistic/disabled while pending; refetch failure hides populated board; test gaps (board delete, loading/error, nav link)

## Plan 2B follow-ups (open)
- Subjects/Review pages: tasks of hidden subjects still appear on Board/Review/open_tasks counts (spec only hides events). — DONE in polish pass
- Semester switcher lives in the desktop sidebar only; phones use Settings → "Make active". — DONE in polish pass (Settings select on phones)
- Clearing a semester's Zeus group (empty Save) has no confirmation; daily sync then fails until set again.
- `GET /subjects/{id}` computes visible events twice (fine at ~400 events).
- A legitimate Zeus group change mid-semester is now rejected as "looks like a different group"; needs a one-off "accept new group" path if it ever happens. — DONE in polish pass (group_changed_at marker)
- Review marks (`week_review`) are global, not per semester.
