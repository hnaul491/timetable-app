import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { useT, type MessageKey } from "../i18n";
import { formatKeys, useShortcutList } from "../lib/shortcuts";
import { useOpenSearch } from "../lib/searchContext";

type Item = { key: string; label: MessageKey; shortcutId: string; run: () => void };

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

/** Floating "+" button with a small menu of the most common actions. */
export function QuickActions() {
  const t = useT();
  const navigate = useNavigate();
  const openSearch = useOpenSearch();
  const shortcuts = useShortcutList();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAssistant = useLocation().pathname.startsWith("/assistant");
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  const list: Item[] = [
    { key: "event", label: "nav.quickNewEvent", shortcutId: "cal-new", run: () => navigate("/?new=today") },
    { key: "task", label: "nav.quickNewTask", shortcutId: "quick-new-task", run: () => navigate("/board?new=1") },
    { key: "ai", label: "nav.quickAskAi", shortcutId: "go-assistant", run: () => navigate("/assistant?compose=1") },
    { key: "free", label: "nav.quickFreeTime", shortcutId: "go-free-time", run: () => navigate("/free-time") },
    { key: "search", label: "search.open", shortcutId: "search", run: openSearch },
  ];

  useEffect(() => {
    if (!open) return;
    items.current[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) dismiss();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Fade out over 120 ms before unmounting; reduced motion (or no matchMedia) closes instantly.
  const dismiss = () => {
    const calm = typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (calm) {
      setOpen(false);
      return;
    }
    setClosing(true);
    timer.current = setTimeout(() => {
      setClosing(false);
      setOpen(false);
    }, 120);
  };

  const close = (refocus: boolean) => {
    dismiss();
    if (refocus) button.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const nodes = items.current.filter((n): n is HTMLButtonElement => n !== null);
    const at = nodes.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const next = e.key === "Home" ? 0 : e.key === "End" ? nodes.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + nodes.length) % nodes.length;
      nodes[next]?.focus();
    } else if (e.key === "Tab") {
      setClosing(false);
      setOpen(false);
    }
  };

  return (
    <div ref={root} className={`fixed right-4 bottom-[5.5rem] z-40 flex flex-col items-end gap-2 md:right-6 md:bottom-6 ${onAssistant ? "max-md:hidden" : ""}`}>
      {open && (
        <div
          role="menu"
          aria-label={t("nav.quickActions")}
          onKeyDown={onMenuKey}
          className={`flex min-w-52 origin-bottom-right flex-col rounded-2xl border border-line bg-surface p-1.5 shadow-lg ${closing ? "motion-safe:animate-[quick-out_120ms_ease-in_forwards]" : "motion-safe:animate-[quick-in_150ms_ease-out]"}`}
        >
          {list.map((item, i) => {
            const keys = shortcuts.find((s) => s.id === item.shortcutId)?.keys;
            return (
              <button
                key={item.key}
                ref={(n) => {
                  items.current[i] = n;
                }}
                type="button"
                role="menuitem"
                aria-keyshortcuts={keys ? formatKeys(keys).join(" ") : undefined}
                onClick={() => {
                  setClosing(false);
                  setOpen(false);
                  item.run();
                }}
                className="flex h-11 items-center justify-between gap-4 rounded-xl px-3 text-left text-sm font-medium text-ink hover:bg-subtle focus-visible:bg-subtle"
              >
                {t(item.label)}
                {keys && <kbd aria-hidden="true" className="hidden text-xs font-semibold text-muted md:inline">{formatKeys(keys).join(" ")}</kbd>}
              </button>
            );
          })}
        </div>
      )}
      <button
        ref={button}
        type="button"
        aria-label={t("nav.quickActions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open && !closing ? dismiss() : closing ? undefined : setOpen(true))}
        className="flex size-12 items-center justify-center rounded-full bg-accent text-on-accent shadow-lg hover:bg-accent-strong"
      >
        <Icon>
          <path d="M12 5v14M5 12h14" />
        </Icon>
      </button>
    </div>
  );
}
