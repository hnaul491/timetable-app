import type { MessageKey } from "../i18n";

export type ShortcutGroup = "everywhere" | "calendar" | "event" | "panel" | "other";
export const SHORTCUT_GROUPS: ShortcutGroup[] = ["everywhere", "calendar", "event", "panel", "other"];

export interface CatalogEntry {
  id: string;
  /** Default keys; must match the useShortcut call (a test checks this). */
  keys: string;
  label: MessageKey;
  group: ShortcutGroup;
}

/**
 * Shortcuts the Settings page can list even when their page is not open. Shortcuts that are registered but not
 * listed here still appear (under "other") while their page is mounted, so a missing entry only costs discoverability.
 */
export const SHORTCUT_CATALOG: CatalogEntry[] = [
  { id: "search-slash", keys: "/", label: "shortcuts.search", group: "everywhere" },
  { id: "sidebar", keys: "[", label: "shortcuts.toggleSidebar", group: "everywhere" },
  { id: "help", keys: "?", label: "shortcuts.help", group: "everywhere" },
  { id: "go-calendar", keys: "g c", label: "shortcuts.goCalendar", group: "everywhere" },
  { id: "go-board", keys: "g b", label: "shortcuts.goBoard", group: "everywhere" },
  { id: "go-subjects", keys: "g s", label: "shortcuts.goSubjects", group: "everywhere" },
  { id: "go-review", keys: "g r", label: "shortcuts.goReview", group: "everywhere" },
  { id: "go-assistant", keys: "g a", label: "shortcuts.goAssistant", group: "everywhere" },
  { id: "go-settings", keys: "g ,", label: "shortcuts.goSettings", group: "everywhere" },
  { id: "go-free-time", keys: "g f", label: "shortcuts.goFreeTime", group: "everywhere" },
  { id: "cal-previous", keys: "ArrowLeft", label: "shortcuts.previous", group: "calendar" },
  { id: "cal-next", keys: "ArrowRight", label: "shortcuts.next", group: "calendar" },
  { id: "cal-today", keys: "t", label: "shortcuts.today", group: "calendar" },
  { id: "cal-week", keys: "w", label: "shortcuts.weekView", group: "calendar" },
  { id: "cal-day", keys: "d", label: "shortcuts.dayView", group: "calendar" },
  { id: "cal-new", keys: "n", label: "shortcuts.newEvent", group: "calendar" },
  { id: "cal-full-screen", keys: "f", label: "shortcuts.fullScreen", group: "calendar" },
  { id: "exit-full-screen", keys: "Escape", label: "shortcuts.exitFullScreen", group: "calendar" },
  { id: "note-save", keys: "Mod+s", label: "shortcuts.save", group: "event" },
  { id: "form-save", keys: "Mod+s", label: "shortcuts.save", group: "panel" },
  { id: "panel-delete", keys: "Mod+d", label: "shortcuts.delete", group: "panel" },
  { id: "panel-delete-key", keys: "Delete", label: "shortcuts.delete", group: "panel" },
];
