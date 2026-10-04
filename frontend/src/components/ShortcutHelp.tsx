import { useLocation } from "react-router";
import { useT } from "../i18n";
import { formatKeys, isSequence, useShortcutList } from "../lib/shortcuts";
import { Dialog } from "./ui/Dialog";

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const list = useShortcutList().filter((s) => !s.disabled);
  const onCalendar = useLocation().pathname === "/";
  return (
    <Dialog open={open} onClose={onClose} title={t("shortcuts.title")} size="sm">
      <ul className="flex flex-col gap-2.5">
        {list.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 text-sm">
            <span>{t(s.label)}</span>
            <span className="flex items-center gap-1">
              {formatKeys(s.keys).map((k, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && isSequence(s.keys) && <span className="text-xs text-muted">{t("shortcuts.then")}</span>}
                  <kbd className="min-w-6 rounded-md border border-line bg-subtle px-1.5 py-0.5 text-center text-xs font-semibold text-ink-2">{k}</kbd>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {!onCalendar && <p className="mt-4 border-t border-line pt-3 text-xs text-muted">{t("shortcuts.contextHint")}</p>}
    </Dialog>
  );
}
