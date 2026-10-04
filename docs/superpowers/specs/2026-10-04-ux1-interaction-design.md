# UX-1 — Interaction (popups, confirm, feedback, shortcuts, full screen) — Design

**Status:** requested by the user (UX backlog items 1–5, event details popup asked twice); shortcut set accepted; user asked to proceed without further approvals (2026-10-04).
**Builds on:** UX-2 tokens (`bg-surface`, `text-ink`, …) and translations (`useT`, en/vi area files). Everything new is themed and translated from the start.

## 1. Shared UI primitives (`src/components/ui/`)
- **Dialog** — accessible modal: portal to `document.body`, dimmed backdrop, `role="dialog"` + `aria-modal` + `aria-labelledby`, focus moves to the first focusable element (or the dialog), Tab/Shift+Tab trapped inside, Esc and backdrop click close, focus returns to the opener. Sizes: `sm` (confirm), `md` (forms), `side` (right-hand panel on desktop, bottom sheet on phones).
- **Confirm** — `ConfirmProvider` + `useConfirm()` returning `confirm({ title, body?, confirmLabel, tone: "danger" | "default" }) => Promise<boolean>`; Enter confirms, Esc cancels. Replaces every two-click confirm: delete event, delete repeating event, delete task, merge subjects, disconnect Google, clear a semester's Zeus group (new), discard unsaved note changes when closing a panel.
- **Toasts** — `ToastProvider` + `useToast()` with `toast.success(text)`, `toast.error(text, { retry? })`. Bottom-right (bottom-centre on phones), max 3 stacked, success auto-hides after 4 s, errors stay until closed or retried; `aria-live="polite"` region (errors `assertive`).
- **Loading** — `Skeleton` blocks for the calendar grid, board columns, subject list/detail and review sections instead of "Loading…" text; a thin **top progress bar** while any query refetches or mutation runs (`useIsFetching` + `useIsMutating`); buttons keep their disabled/“…ing” states.

## 2. Calendar without page jumps
- **Event details popup** — clicking an event opens a side panel (`Dialog size="side"`) over the calendar: subject colour, title + group, date/time/room, status badges, ★ important toggle, notes preview (both tabs, first lines), open tasks with checkboxes, "Next class" link, and actions **Open full page**, **Edit** (own events), **Delete** (own events, via confirm). The calendar stays where it was.
- **Create / edit popup** — "Add event", **N**, or clicking an empty slot in the grid (rounded to 30 min, prefilled date/time, 1 h long) opens the event form in a `Dialog size="md"`; editing an own event uses the same form prefilled. The form is extracted from `NewEventPage` into `EventForm` (the page keeps working at `/events/new`).
- **URL keeps the popup:** `?event=<id>` opens the details panel, `?new=<YYYY-MM-DD>T<HH:MM>` the create form, `?edit=<id>` the edit form (together with the existing `date`/`view` params). Browser Back closes the popup; links can be shared.
- After create/update/delete: toast, calendar refresh, popup closes (create/edit → details of the new event).

## 3. Keyboard shortcuts
- One small engine (`lib/shortcuts.tsx`): `ShortcutProvider` + `useShortcut(id, keys, handler, { enabled? })`; key strings like `"n"`, `"ArrowLeft"`, `"g c"` (sequence, 1 s window), `"Mod+s"` (Ctrl on Windows/Linux, ⌘ on Mac), `"Shift+?"`. Single-key shortcuts are ignored while typing in an input/textarea/select/contenteditable; `Mod+s` works inside forms. Never binds browser-reserved combos.
- Set: **N** new event · **← / →** previous/next week or day · **T** today · **W / D** week/day view · **F** full-screen calendar (Esc exits) · **[** collapse/expand sidebar · **G then C / B / S / R / ,** go to Calendar/Board/Subjects/Review/Settings · **Ctrl/⌘+S** save the open form or note · **Ctrl/⌘+D** delete in the event panel (opens confirm) · **Delete** on the open event panel (confirm) · **?** shortcut help overlay (Dialog listing all shortcuts, translated).

## 4. Full-screen calendar and collapsible sidebar
- **Collapsed sidebar** shows icons only (Calendar, Board, Subjects, Review, Settings with simple inline SVG icons + tooltips via `aria-label`/`title`); remembered in localStorage `timetable:sidebar` (`expanded|collapsed`, safe fallback). Toggle button at the bottom of the sidebar and **[**.
- **Full-screen calendar** hides the sidebar, the mobile bottom bar and the page header extras; a small floating "Exit full screen" button and Esc/F leave it. State lives in a `ChromeProvider` (`useChrome()` → `{ sidebarCollapsed, toggleSidebar, fullScreen, setFullScreen }`). Not remembered across reloads.

## Non-goals
Drag-and-drop of events, multi-select, undo history, offline mode.

## Testing
- Primitives: Dialog focus trap/Esc/backdrop/focus return; confirm resolves true/false; toasts auto-hide (fake timers) and retry; progress bar visible while a query is fetching.
- Shortcuts: sequences, typing guard, Mod+s inside an input, disabled when a dialog that owns its own keys is open (only Esc/Mod+s pass through).
- Calendar: clicking an event opens the panel (URL `?event=`), Back closes it; empty-slot click opens prefilled create form; create → toast + panel; delete via confirm; N / arrows / T / W / D / F work.
- Each replaced two-click confirm now asks through the dialog; Vietnamese rendering of new texts (key parity test keeps passing).
