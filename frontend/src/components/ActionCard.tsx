import type { ReactNode } from "react";
import { useT, type MessageKey } from "../i18n";
import type { PendingAction } from "../types";

const KIND_LABEL: Record<PendingAction["kind"], MessageKey> = {
  task: "ai.kindTask",
  event: "ai.kindEvent",
  note: "ai.kindNote",
  study_block: "ai.kindStudyBlock",
};
const KIND_ICON: Record<PendingAction["kind"], ReactNode> = {
  task: <path d="M5 12l4 4 10-10" />,
  event: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  note: <path d="M6 3h9l4 4v14H6zM9 12h7M9 16h7" />,
  study_block: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};
const DETAIL_KEYS = ["due_date", "date", "start", "end", "start_time", "end_time", "location", "subject"];

function details(payload: Record<string, unknown>): string {
  return DETAIL_KEYS.map((k) => payload[k])
    .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
    .map(String)
    .join(" · ");
}

interface Props {
  action: PendingAction;
  busy: boolean;
  onAdd: () => void;
  onDismiss: () => void;
}

/** A change the assistant proposes; nothing is saved until the user presses Add. */
export function ActionCard({ action, busy, onAdd, onDismiss }: Props) {
  const t = useT();
  const expired = action.status === "pending" && action.expires_at !== null && Date.parse(action.expires_at) < Date.now();
  const detail = details(action.payload);
  const done: MessageKey | null = action.status === "confirmed" ? "ai.added" : action.status === "dismissed" ? "ai.dismissed" : expired ? "ai.expired" : null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {KIND_ICON[action.kind]}
        </svg>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-semibold text-muted">{t(KIND_LABEL[action.kind])}</span>
        <span className="text-sm font-semibold break-words">{action.summary}</span>
        {detail && <span className="font-mono text-xs text-muted">{detail}</span>}
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
