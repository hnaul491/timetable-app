# Plan 3 follow-ups (Google Calendar push)

Open, not blocking:
- `GET /api/google` computes `pending` with the full reconcile plan (incl. note/task counts) on every load; fine at ~400 events, add a count-free variant if it grows.
- Copies of events from other semesters stay in Google (by design); switching semesters does not clean them.
- Disconnect then Connect creates a second "My Timetable" calendar (the UI now says to delete the old one); could reuse an existing app-created calendar instead.
- A DB failure between a successful Google insert and its commit (or a function killed mid-op) can leave an orphan copy; events carry `extendedProperties.private.timetableEventId`, so a future cleanup can find and delete orphans.
- Whether Google answers 404 or 403 when a stored calendar id belongs to another Google account (self-heal assumes 404).
- The calendar page uses `replace: true` for week steps, so browser Back skips week-by-week history (intended: Back returns to where you came from).

## Done in the polish pass (2026-10-04)
- First push is faster: Google calls run in parallel (4 workers, batches of 4), DB writes stay on the main thread.
