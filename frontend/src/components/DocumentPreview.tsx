import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { useLocale, useT, type MessageKey } from "../i18n";
import { apiFetch } from "../lib/api";
import { docBadge, type PreviewDoc } from "../lib/documents";
import { useShortcut } from "../lib/shortcuts";
import { dayLabel, formatLongDate, parisParts } from "../lib/time";
import type { DocumentTag, GoogleStatus } from "../types";
import { ShortcutHint } from "./ShortcutHint";
import { Dialog } from "./ui/Dialog";
import { Skeleton } from "./ui/Skeleton";

const TAG_LABEL: Record<DocumentTag, MessageKey> = {
  slides: "documents.filterSlides",
  exercises: "documents.filterExercises",
  other: "documents.filterOther",
};

const btn = "inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-50 disabled:hover:bg-surface";

/** Small "open in a new tab" icon link to the file in Drive, for list rows. */
export function OpenInDriveIcon({ doc }: { doc: Pick<PreviewDoc, "name" | "web_view_link"> }) {
  const t = useT();
  return (
    <a
      href={doc.web_view_link}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("documents.openInDriveNamed", { name: doc.name })}
      title={t("documents.preview.open")}
      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-2 hover:bg-surface-2"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </svg>
    </a>
  );
}

function Frame({ doc }: { doc: PreviewDoc & { preview_url: string } }) {
  const t = useT();
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-subtle">
      {!loaded && (
        <div role="status" className="absolute inset-0 p-4">
          <span className="sr-only">{t("documents.preview.loading")}</span>
          <Skeleton className="h-full w-full" />
        </div>
      )}
      <iframe src={doc.preview_url} title={doc.name} allow="autoplay" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} className="absolute inset-0 size-full border-0" />
    </div>
  );
}

export function DocumentPreview({ docs, index, onIndex, onClose }: {
  docs: PreviewDoc[];
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const google = useQuery({ queryKey: ["google"], queryFn: () => apiFetch<GoogleStatus>("/api/google") });
  const open = index !== null && docs[index] !== undefined;
  const at = index ?? 0;
  const hasPrev = open && at > 0;
  const hasNext = open && at < docs.length - 1;
  const go = onIndex;
  useShortcut("doc-prev", "ArrowLeft", () => hasPrev && go(at - 1), { inDialog: true, label: "shortcuts.docPrev", enabled: open });
  useShortcut("doc-next", "ArrowRight", () => hasNext && go(at + 1), { inDialog: true, label: "shortcuts.docNext", enabled: open });
  if (!open) return null;

  const doc = docs[at];
  const email = google.data?.email;
  const start = doc.event ? parisParts(doc.event.start).date : null;
  const classLabel = start ? `${dayLabel(start, locale).weekday} ${formatLongDate(start, locale).replace(/\s+\d{4}$/, "")}` : null;
  return (
    <Dialog
      open
      size="xl"
      onClose={onClose}
      title={doc.name}
      footer={<p className="mr-auto text-xs text-muted">{email ? t("documents.preview.hintAs", { email }) : t("documents.preview.hint")}</p>}
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span data-kind={docBadge(doc)} className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[11px] font-bold text-accent-strong">
            {docBadge(doc)}
          </span>
          <span className="rounded-full bg-subtle px-2 py-0.5 text-xs font-semibold text-ink-2">{t(TAG_LABEL[doc.tag])}</span>
          {doc.event && start && classLabel && (
            <Link to={`/?date=${start}&event=${doc.event.id}`} onClick={onClose} className="text-xs font-semibold text-accent">
              {classLabel}
            </Link>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" disabled={!hasPrev} onClick={() => go(at - 1)} className={btn}>
              {t("documents.preview.previous")}
              <ShortcutHint id="doc-prev" />
            </button>
            <button type="button" disabled={!hasNext} onClick={() => go(at + 1)} className={btn}>
              {t("documents.preview.next")}
              <ShortcutHint id="doc-next" />
            </button>
            <a href={doc.web_view_link} target="_blank" rel="noopener noreferrer" className={btn}>
              {t("documents.preview.open")}
            </a>
          </span>
        </div>
        {doc.preview_url && <Frame key={doc.id} doc={{ ...doc, preview_url: doc.preview_url }} />}
      </div>
    </Dialog>
  );
}
