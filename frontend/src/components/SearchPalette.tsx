import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useLocale, useT, type MessageKey } from "../i18n";
import { INTL_LOCALE } from "../i18n/locale";
import { apiFetch } from "../lib/api";
import { useHintsVisible } from "../lib/shortcutHints";
import { setTheme } from "../lib/theme";
import { parisParts, formatLongDate, TZ } from "../lib/time";
import type { SearchResults } from "../types";
import { Dialog } from "./ui/Dialog";
import { SkeletonRows } from "./ui/Skeleton";

const DEBOUNCE_MS = 200;
const LIMIT = 8;

type Item = { key: string; group: MessageKey; run: () => void; content: ReactNode; text: string };

const ACTIONS: { key: string; label: MessageKey; to?: string }[] = [
  { key: "calendar", label: "shortcuts.goCalendar", to: "/" },
  { key: "board", label: "shortcuts.goBoard", to: "/board" },
  { key: "subjects", label: "shortcuts.goSubjects", to: "/subjects" },
  { key: "documents", label: "shortcuts.goDocuments", to: "/documents" },
  { key: "review", label: "shortcuts.goReview", to: "/review" },
  { key: "assistant", label: "shortcuts.goAssistant", to: "/assistant" },
  { key: "settings", label: "shortcuts.goSettings", to: "/settings" },
  { key: "free-time", label: "shortcuts.goFreeTime", to: "/free-time" },
  { key: "new", label: "shortcuts.newEvent", to: "/events/new" },
  { key: "theme", label: "search.toggleTheme" },
];

/** Splits text around the query; the match is rendered as text inside <mark>, never as HTML. */
function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim();
  if (!needle) return <>{text}</>;
  const parts = text.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-accent-soft text-accent-strong">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-xs text-muted">{children}</span>;

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  useEffect(() => {
    if (!open) {
      setText("");
      setDebounced("");
    }
  }, [open]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const q = text.trim();
  const enabled = open && debounced.length >= 2;
  const query = useQuery({
    queryKey: ["search", debounced],
    queryFn: async () => ({ q: debounced, results: await apiFetch<SearchResults>(`/api/search?q=${encodeURIComponent(debounced)}&limit=${LIMIT}`) }),
    enabled,
    placeholderData: keepPreviousData,
  });

  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  const toggleTheme = () => {
    onClose();
    const dark = document.documentElement.dataset.theme === "dark";
    setTheme(dark ? "light" : "dark");
  };

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const data = enabled ? query.data?.results : undefined;
    const hq = query.data?.q ?? q; // highlight with the query these results answer
    if (data) {
      for (const e of data.events) {
        const when = new Date(e.start).toLocaleString(INTL_LOCALE[locale], {
          timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        });
        out.push({
          key: `e${e.id}`, group: "search.classes", text: e.title,
          run: () => go(`/?event=${e.id}&date=${parisParts(e.start).date}`),
          content: (
            <>
              <span className={`block truncate text-sm font-semibold ${e.cancelled ? "line-through" : ""}`}><Highlight text={e.title} q={hq} /></span>
              {e.title_raw && <span className="block truncate text-xs text-ink-2"><Highlight text={e.title_raw} q={hq} /></span>}
              <Muted>
                {when}
                {e.room ? <> · <Highlight text={e.room} q={hq} /></> : null}
                {e.cancelled ? ` · ${t("search.cancelled")}` : ""}
              </Muted>
            </>
          ),
        });
      }
      for (const s of data.subjects)
        out.push({ key: `s${s.id}`, group: "search.subjects", text: s.name, run: () => go(`/subjects/${s.id}`),
          content: <span className="block truncate text-sm font-semibold"><Highlight text={s.name} q={hq} /></span> });
      for (const n of data.notes)
        out.push({ key: `n${n.id}`, group: "search.notes", text: n.snippet, run: () => go(`/events/${n.event_id}`),
          content: (
            <>
              <span className="block truncate text-sm font-semibold">{n.event_title}</span>
              <span className="block text-xs text-ink-2"><Highlight text={n.snippet} q={hq} /></span>
            </>
          ) });
      for (const k of data.tasks)
        out.push({ key: `t${k.id}`, group: "search.tasks", text: k.title,
          run: () => go(k.event_id !== null ? `/events/${k.event_id}` : "/board"),
          content: (
            <>
              <span className={`block truncate text-sm font-semibold ${k.done ? "line-through" : ""}`}><Highlight text={k.title} q={hq} /></span>
              <Muted>
                {k.done ? t("search.done") : ""}
                {k.done && k.due ? " · " : ""}
                {k.due ? t("search.due", { date: formatLongDate(k.due, locale) }) : ""}
              </Muted>
            </>
          ) });
      for (const d of data.documents)
        out.push({ key: `d${d.id}`, group: "search.documents", text: d.name,
          run: () => {
            if (d.web_view_link) {
              onClose();
              window.open(d.web_view_link, "_blank", "noopener,noreferrer");
            } else go(`/subjects/${d.subject_id}`);
          },
          content: <span className="block truncate text-sm font-semibold"><Highlight text={d.name} q={hq} /></span> });
    }
    const needle = q.toLowerCase();
    for (const a of ACTIONS) {
      const label = t(a.label);
      if (needle && !label.toLowerCase().includes(needle)) continue;
      out.push({ key: `a${a.key}`, group: "search.actions", text: label,
        run: a.to ? () => go(a.to!) : toggleTheme,
        content: <span className="block truncate text-sm font-medium">{label}</span> });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, enabled, q, locale, t]);
  const groups = items.reduce<{ group: MessageKey; entries: { item: Item; index: number }[] }[]>((acc, item, index) => {
    const last = acc[acc.length - 1];
    if (last && last.group === item.group) last.entries.push({ item, index });
    else acc.push({ group: item.group, entries: [{ item, index }] });
    return acc;
  }, []);

  useEffect(() => setActive(0), [items.length, q]);
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-o${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, listId, items.length]);
  const current = items[Math.min(active, items.length - 1)];
  const optionId = (i: number) => `${listId}-o${i}`;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (items.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    } else if (e.key === "Enter" && current) {
      e.preventDefault();
      current.run();
    }
  };

  const hintsVisible = useHintsVisible();
  const loading = enabled && (query.isPending || debounced !== q);
  const noResults = !loading && items.length === 0;

  return (
    <Dialog open={open} onClose={onClose} title={t("search.title")}>
      <input
        data-autofocus
        role="combobox"
        aria-label={t("search.inputLabel")}
        aria-expanded={items.length > 0}
        aria-controls={listId}
        aria-activedescendant={current ? optionId(items.indexOf(current)) : undefined}
        aria-autocomplete="list"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t("search.placeholder")}
        maxLength={100}
        className="mb-3 h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink"
      />
      <div role="listbox" id={listId} aria-label={t("search.results")} className="flex flex-col">
        {groups.map(({ group, entries }) => (
          <div key={group} role="group" aria-labelledby={`${listId}-${group}`}>
            <div id={`${listId}-${group}`} className="px-3 pt-3 pb-1 text-xs font-bold text-muted">{t(group)}</div>
            {entries.map(({ item, index }) => (
              <div
                key={item.key}
                id={optionId(index)}
                role="option"
                aria-selected={item === current}
                onMouseMove={() => setActive(index)}
                onClick={item.run}
                className={`cursor-pointer rounded-lg px-3 py-2 ${item === current ? "bg-accent-soft" : ""}`}
              >
                {item.content}
              </div>
            ))}
          </div>
        ))}
      </div>
      {loading && (
        <div className="mt-2" role="status" aria-label={t("search.loading")}>
          <SkeletonRows rows={2} />
        </div>
      )}
      {hintsVisible && (
        <p aria-hidden="true" className="mt-3 hidden border-t border-line pt-2 text-xs text-muted md:block">
          {t("search.footer")}
        </p>
      )}
      {query.isError && enabled && <p role="alert" className="mt-2 text-sm text-danger">{t("search.error")}</p>}
      {noResults && !query.isError && (
        <p className="px-3 py-4 text-sm text-muted">{q.length >= 2 ? t("search.empty", { q }) : t("search.hint")}</p>
      )}
    </Dialog>
  );
}
