import type { ReactNode } from "react";
import { useLocale, useT, type Locale, type MessageKey } from "../i18n";
import { formatLongDate } from "../lib/time";
import type { PendingAction } from "../types";

const KIND_LABEL: Record<string, MessageKey> = {
  task: "ai.kindTask",
  event: "ai.kindEvent",
  note: "ai.kindNote",
  study_blocks: "ai.kindStudyBlocks",
};
const KIND_ICON: Record<string, ReactNode> = {
  task: <path d="M5 12l4 4 10-10" />,
  event: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  note: <path d="M6 3h9l4 4v14H6zM9 12h7M9 16h7" />,
  study_blocks: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};
const GENERIC_ICON = <circle cx="12" cy="12" r="8" />;
const EVENT_KIND: Record<string, MessageKey> = { work: "event.kindWork", french_ext: "event.kindFrench", other: "event.kindOther" };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const day = (v: unknown, locale: Locale): string => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? formatLongDate(str(v), locale) : str(v));
const range = (start: unknown, end: unknown): string => [str(start), str(end)].filter(Boolean).join("–");

interface Block {
  date: string;
  start: string;
  end: string;
}
function blocksOf(payload: Record<string, unknown>): Block[] {
  if (!Array.isArray(payload.blocks)) return [];
  return payload.blocks
    .filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null)
    .map((b) => ({ date: str(b.date), start: str(b.start), end: str(b.end) }));
}

interface Props {
  action: PendingAction;
  busy: boolean;
  onAdd: () => void;
  onDismiss: () => void;
}

/** A change the assistant proposes, showing what will be written; nothing is saved until the user presses Add. */
export function ActionCard({ action, busy, onAdd, onDismiss }: Props) {
  const t = useT();
  const locale = useLocale();
  const p = action.payload ?? {};
  const known = action.kind in KIND_LABEL;
  const label = t(known ? KIND_LABEL[action.kind] : "ai.kindUnknown");

  // Summary and details come from the payload so they follow the interface language; the server summary is the fallback.
  let summary = str(action.summary);
  const rows: [string, ReactNode][] = [];
  if (action.kind === "task" && str(p.title)) {
    summary = t("ai.sumTask", { title: str(p.title) });
    if (str(p.due_date)) rows.push([t("ai.fieldDue"), day(p.due_date, locale)]);
    if (str(p.subject_name)) rows.push([t("ai.fieldSubject"), str(p.subject_name)]);
  } else if (action.kind === "event" && str(p.title)) {
    summary = t("ai.sumEvent", { title: str(p.title) });
    if (str(p.date)) rows.push([t("ai.fieldDate"), day(p.date, locale)]);
    if (str(p.start) || str(p.end)) rows.push([t("ai.fieldTime"), range(p.start, p.end)]);
    if (str(p.kind) in EVENT_KIND) rows.push([t("ai.fieldKind"), t(EVENT_KIND[str(p.kind)])]);
    if (str(p.room)) rows.push([t("ai.fieldRoom"), str(p.room)]);
  } else if (action.kind === "note" && str(p.text)) {
    const tab = t(p.tab === "before" ? "ai.tabBefore" : "ai.tabAfter");
    if (str(p.event_title)) {
      summary = t("ai.sumNote", { tab, title: str(p.event_title) });
      rows.push([t("ai.fieldClass"), [str(p.event_title), day(p.event_date, locale)].filter(Boolean).join(" · ")]);
    }
    rows.push([t("ai.fieldTab"), tab]);
    rows.push([
      t("ai.fieldText"),
      <span key="text" className="block whitespace-pre-wrap break-words">
        {str(p.text)}
      </span>,
    ]);
  } else if (action.kind === "study_blocks") {
    const blocks = blocksOf(p);
    if (str(p.subject_name)) {
      summary = t("ai.sumStudy", { count: blocks.length, subject: str(p.subject_name) });
      rows.push([t("ai.fieldSubject"), str(p.subject_name)]);
    }
    blocks.forEach((b, i) => rows.push([i === 0 ? t("ai.fieldBlocks") : "", `${day(b.date, locale)} · ${range(b.start, b.end)}`]));
  }

  const expired = action.status === "expired" || (action.status === "pending" && action.expires_at !== null && Date.parse(action.expires_at) < Date.now());
  const done: MessageKey | null = action.status === "confirmed" ? "ai.added" : action.status === "dismissed" ? "ai.dismissed" : expired ? "ai.expired" : null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {known ? KIND_ICON[action.kind] : GENERIC_ICON}
        </svg>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-semibold text-muted">{label}</span>
        <span className="text-sm font-semibold break-words">{summary}</span>
        {rows.length > 0 && (
          <dl className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
            {rows.map(([name, value], i) => (
              <div key={i} className="flex gap-2">
                <dt className="w-16 shrink-0 font-semibold">{name}</dt>
                <dd className="min-w-0 flex-1 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {done ? (
        <span className="self-center text-xs font-semibold text-muted">{t(done)}</span>
      ) : (
        <div className="flex shrink-0 gap-2 self-center">
          <button type="button" disabled={busy} onClick={onAdd} className="h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-60">
            {t("ai.add")}
          </button>
          <button type="button" disabled={busy} onClick={onDismiss} className="h-9 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink-2 disabled:opacity-60">
            {t("ai.dismiss")}
          </button>
        </div>
      )}
    </div>
  );
}
