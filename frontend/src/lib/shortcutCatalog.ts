import type { MessageKey } from "../i18n";

export type ShortcutGroup = "everywhere" | "calendar" | "settings" | "freeTime" | "assistant" | "event" | "panel" | "other";
export const SHORTCUT_GROUPS: ShortcutGroup[] = ["everywhere", "calendar", "settings", "freeTime", "assistant", "event", "panel", "other"];

export const GROUP_TITLE: Record<ShortcutGroup, MessageKey> = {
  everywhere: "shortcuts.groupGlobal",
  calendar: "shortcuts.groupCalendar",
  settings: "shortcuts.groupSettings",
  freeTime: "shortcuts.groupFreeTime",
  assistant: "shortcuts.groupAssistant",
  event: "shortcuts.settings.groups.event",
  panel: "shortcuts.settings.groups.panel",
  other: "shortcuts.settings.groups.other",
};

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
  { id: "search", keys: "Mod+k", label: "shortcuts.search", group: "everywhere" },
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
  { id: "settings-section-1", keys: "1", label: "shortcuts.settingsSection1", group: "settings" },
  { id: "settings-section-2", keys: "2", label: "shortcuts.settingsSection2", group: "settings" },
  { id: "settings-section-3", keys: "3", label: "shortcuts.settingsSection3", group: "settings" },
  { id: "settings-section-4", keys: "4", label: "shortcuts.settingsSection4", group: "settings" },
  { id: "settings-section-5", keys: "5", label: "shortcuts.settingsSection5", group: "settings" },
  { id: "settings-section-6", keys: "6", label: "shortcuts.settingsSection6", group: "settings" },
  { id: "settings-section-7", keys: "7", label: "shortcuts.settingsSection7", group: "settings" },
  { id: "settings-find", keys: "f", label: "shortcuts.settingsFind", group: "settings" },
  { id: "free-today", keys: "t", label: "shortcuts.freeToday", group: "freeTime" },
  { id: "free-tomorrow", keys: "Shift+t", label: "shortcuts.freeTomorrow", group: "freeTime" },
  { id: "free-prev", keys: "ArrowLeft", label: "shortcuts.freePrev", group: "freeTime" },
  { id: "free-next", keys: "ArrowRight", label: "shortcuts.freeNext", group: "freeTime" },
  { id: "free-week", keys: "w", label: "shortcuts.freeWeek", group: "freeTime" },
  { id: "free-month", keys: "m", label: "shortcuts.freeMonth", group: "freeTime" },
  { id: "free-next-week", keys: "Shift+w", label: "shortcuts.freeNextWeek", group: "freeTime" },
  { id: "free-next-month", keys: "Shift+m", label: "shortcuts.freeNextMonth", group: "freeTime" },
  { id: "free-semester", keys: "s", label: "shortcuts.freeSemester", group: "freeTime" },
  { id: "free-custom", keys: "c", label: "shortcuts.freeCustom", group: "freeTime" },
  { id: "free-buffer", keys: "b", label: "shortcuts.freeBuffer", group: "freeTime" },
  { id: "free-day-1", keys: "1", label: "shortcuts.freeDay1", group: "freeTime" },
  { id: "free-day-2", keys: "2", label: "shortcuts.freeDay2", group: "freeTime" },
  { id: "free-day-3", keys: "3", label: "shortcuts.freeDay3", group: "freeTime" },
  { id: "free-day-4", keys: "4", label: "shortcuts.freeDay4", group: "freeTime" },
  { id: "free-day-5", keys: "5", label: "shortcuts.freeDay5", group: "freeTime" },
  { id: "free-day-6", keys: "6", label: "shortcuts.freeDay6", group: "freeTime" },
  { id: "free-day-7", keys: "7", label: "shortcuts.freeDay7", group: "freeTime" },
  { id: "assistant-focus", keys: "i", label: "shortcuts.assistantFocus", group: "assistant" },
  { id: "assistant-stop", keys: "Escape", label: "shortcuts.assistantStop", group: "assistant" },
  { id: "note-save", keys: "Mod+s", label: "shortcuts.save", group: "event" },
  { id: "form-save", keys: "Mod+s", label: "shortcuts.save", group: "panel" },
  { id: "panel-delete", keys: "Mod+d", label: "shortcuts.delete", group: "panel" },
  { id: "panel-delete-key", keys: "Delete", label: "shortcuts.delete", group: "panel" },
];

const PREFIX_GROUP: [string, ShortcutGroup][] = [["cal-", "calendar"], ["settings-", "settings"], ["free-", "freeTime"], ["assistant-", "assistant"]];

/** Group of a shortcut: from the catalogue, else by id prefix, else "other" (Settings) / Everywhere (help). */
export function groupOfId(id: string): ShortcutGroup {
  return SHORTCUT_CATALOG.find((c) => c.id === id)?.group ?? PREFIX_GROUP.find(([prefix]) => id.startsWith(prefix))?.[1] ?? "other";
}
