import { useT } from "../i18n";
import { hintChips, useHintKeys } from "../lib/shortcutHints";
import { isSequence } from "../lib/shortcutKeys";

/** Small key chips for a shortcut's effective keys. Hidden below md unless `always`; screen readers use aria-keyshortcuts instead. */
export function ShortcutHint({ id, always = false, className = "" }: { id: string; always?: boolean; className?: string }) {
  const t = useT();
  const keys = useHintKeys()(id);
  if (!keys) return null;
  const sequence = isSequence(keys);
  return (
    <span aria-hidden="true" data-shortcut-hint={id} className={`${always ? "inline-flex" : "hidden md:inline-flex"} shrink-0 items-center gap-1 ${className}`}>
      {hintChips(keys).map((chip, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && sequence && <span className="text-[10px] text-muted">{t("shortcuts.then")}</span>}
          <kbd className="rounded border border-line px-1 text-[11px] leading-4 font-medium text-muted tabular-nums">{chip}</kbd>
        </span>
      ))}
    </span>
  );
}
