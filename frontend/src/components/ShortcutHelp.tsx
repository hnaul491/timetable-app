import { useLocation } from "react-router";
import { useT, type MessageKey } from "../i18n";
import { formatKeys, useShortcutList } from "../lib/shortcuts";
import { Dialog } from "./ui/Dialog";

type Group = "global" | "calendar" | "settings" | "freeTime" | "assistant";
const GROUP_TITLE: Record<Group, MessageKey> = {
  global: "shortcuts.groupGlobal",
  calendar: "shortcuts.groupCalendar",
  settings: "shortcuts.groupSettings",
  freeTime: "shortcuts.groupFreeTime",
  assistant: "shortcuts.groupAssistant",
};
const PREFIX_GROUP: [string, Group][] = [["cal-", "calendar"], ["settings-", "settings"], ["free-", "freeTime"], ["assistant-", "assistant"]];
const groupOf = (id: string): Group => PREFIX_GROUP.find(([prefix]) => id.startsWith(prefix))?.[1] ?? "global";

function pageGroup(pathname: string): Group | null {
  if (pathname === "/") return "calendar";
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "settings";
  if (pathname === "/free-time") return "freeTime";
  if (pathname === "/assistant") return "assistant";
  return null;
}

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const list = useShortcutList();
  const page = pageGroup(useLocation().pathname);
  const groups = (["global", "calendar", "settings", "freeTime", "assistant"] as Group[])
    .filter((g) => g === "global" || g === page)
    .map((g) => ({ group: g, items: list.filter((s) => groupOf(s.id) === g) }))
    .filter((g) => g.items.length > 0);
  return (
    <Dialog open={open} onClose={onClose} title={t("shortcuts.title")} size="sm">
      <div className="flex flex-col gap-4">
        {groups.map(({ group, items }) => (
          <section key={group} aria-labelledby={`shortcut-group-${group}`}>
            <h3 id={`shortcut-group-${group}`} className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">{t(GROUP_TITLE[group])}</h3>
            <ul className="flex flex-col gap-2.5">
            {items.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 text-sm">
                <span>{t(s.label)}</span>
                <span className="flex items-center gap-1">
                  {formatKeys(s.keys).map((k, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && !s.keys.startsWith("Mod+") && <span className="text-xs text-muted">{t("shortcuts.then")}</span>}
                      <kbd className="min-w-6 rounded-md border border-line bg-subtle px-1.5 py-0.5 text-center text-xs font-semibold text-ink-2">{k}</kbd>
                    </span>
                  ))}
                </span>
              </li>
            ))}
            </ul>
          </section>
        ))}
      </div>
      {page === null && <p className="mt-4 border-t border-line pt-3 text-xs text-muted">{t("shortcuts.contextHint")}</p>}
    </Dialog>
  );
}
