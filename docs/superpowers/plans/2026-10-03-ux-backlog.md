# UX backlog (requested 2026-10-03, to plan after Plan 3)

User feedback: too many screen changes for one action, no confirmation dialogs, no keyboard shortcuts, no full-screen calendar / collapsible sidebar, no loading/success/fail feedback.

## 1. Create and edit events without leaving the calendar
- "Add event" (and clicking an empty slot in the week/day grid) opens a **modal** with the new-event form, prefilled with the clicked day/time.
- Clicking an event opens a **side panel / modal** with details, quick note view, Edit and Delete; "Open full page" keeps the current event page for long notes.
- Deleting from the panel asks for confirmation (see 2) and stays on the calendar.

## 2. Confirmation dialog
- One accessible dialog component (focus trap, Esc to cancel, Enter to confirm, destructive button styling) replacing the two-click buttons: delete event, delete repeating event, delete task, merge subjects, disconnect Google, clear a semester's Zeus group.

## 3. Keyboard shortcuts (+ "?" help overlay)
The user asked for Ctrl-based shortcuts but without fighting strong browser defaults. Proposal, to confirm when this plan starts:

| Action | Requested | Proposed | Why |
|---|---|---|---|
| Save / create (form or modal open) | Ctrl+S | **Ctrl/⌘+S** | Browser "save page" can be safely overridden; common in web apps |
| Delete (event panel open) | Ctrl+D | **Ctrl/⌘+D** in the panel, and **Delete** key on a selected event — both open the confirm dialog | Ctrl+D (bookmark) can be overridden, but only inside the panel |
| New event | Ctrl+A | **N** (or C like Google Calendar) | Ctrl+A is select-all — breaks text selection |
| Previous / next week or day | Ctrl+←/→ | **← / →** (and **T** = today) when not typing | Ctrl+←/→ jumps words in text fields; on macOS Ctrl+arrows switch desktops |
| Week ⇄ day | Ctrl+M | **W / D** | ⌘+M minimises the window on macOS |
| Go to Calendar / Board / Subjects / Review / Settings | Ctrl+Shift+C / B … | **G then C / B / S / R / ,** (GitHub/Gmail style) | Ctrl+Shift+C opens Chrome DevTools inspector; Ctrl+Shift+B toggles the bookmarks bar |
| Full-screen calendar | — | **F** (Esc exits) | |
| Collapse / expand sidebar | — | **[** | Same as Linear/Notion |
| Show shortcuts | — | **?** | |

Single-key shortcuts never fire while typing in an input, textarea or editor. Never use browser-reserved combos (Ctrl+N/T/W, Ctrl+Shift+N/T/W, Ctrl+Tab).

## 4. Full-screen calendar and collapsible sidebar
- Full-screen mode for the calendar (hides sidebar and header; optional browser Fullscreen API).
- Collapse/expand the sidebar to icons; remembered per browser (localStorage, safe fallback).

## 5. Loading / success / failure feedback
- Toasts for every change: "Saved", "Deleted", "Couldn't save — Retry".
- Buttons show a spinner/disabled state while their request runs (some already do).
- Skeleton placeholders instead of "Loading…" text for the calendar, board, subjects, review.
- A thin top progress bar while background refreshes run.
