import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { useLocale, useT, type MessageKey } from "../i18n";
import { apiFetch } from "../lib/api";
import { docBadge, formatSize } from "../lib/documents";
import { dayLabel, formatLongDate, parisParts } from "../lib/time";
import type { DocumentItem, DocumentTag, GoogleStatus } from "../types";
import { ErrorPanel } from "./Banners";
import { UploadDialog } from "./UploadDialog";
import { useConfirm } from "./ui/Confirm";
import { SkeletonRows } from "./ui/Skeleton";
import { useToast } from "./ui/Toast";

type Filter = "all" | DocumentTag;
const FILTERS: { value: Filter; label: MessageKey }[] = [
  { value: "all", label: "documents.filterAll" },
  { value: "slides", label: "documents.filterSlides" },
  { value: "exercises", label: "documents.filterExercises" },
  { value: "other", label: "documents.filterOther" },
];
const TAG_LABEL: Record<DocumentTag, MessageKey> = {
  slides: "documents.filterSlides",
  exercises: "documents.filterExercises",
  other: "documents.filterOther",
};

export function DocumentsSection({ subjectId, eventId }: { subjectId: number; eventId?: number }) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [uploading, setUploading] = useState(false);
  const compact = eventId !== undefined;
  const headingId = `documents-heading-${subjectId}-${eventId ?? "all"}`;

  const google = useQuery({ queryKey: ["google"], queryFn: () => apiFetch<GoogleStatus>("/api/google") });
  const docs = useQuery({
    queryKey: compact ? ["documents", "event", eventId] : ["documents", "subject", subjectId],
    queryFn: () => apiFetch<DocumentItem[]>(compact ? `/api/events/${eventId}/documents` : `/api/subjects/${subjectId}/documents`),
  });
  const remove = useMutation({
    mutationFn: (doc: DocumentItem) => apiFetch(`/api/documents/${doc.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success(t("documents.deleted"));
    },
    onError: (error, doc) => toast.error(t("documents.deleteFailed", { message: error.message }), { retry: () => remove.mutate(doc) }),
  });
  const askDelete = async (doc: DocumentItem) => {
    const ok = await confirm({ title: t("documents.deleteTitle"), body: t("documents.deleteBody", { name: doc.name }), confirmLabel: t("documents.delete"), tone: "danger" });
    if (ok) remove.mutate(doc);
  };

  const all = docs.data ?? [];
  const shown = all.filter((d) => filter === "all" || d.tag === filter);
  const driveOn = google.data ? google.data.connected && google.data.drive_enabled : null;

  const groups = new Map<number | null, DocumentItem[]>();
  for (const doc of shown) groups.set(doc.event_id, [...(groups.get(doc.event_id) ?? []), doc]);
  // Classes with the latest on top, files not linked to a class last.
  const ordered = [...groups.entries()].sort(([a, da], [b, db]) => {
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    return (db[0].event_start ?? "").localeCompare(da[0].event_start ?? "");
  });

  const row = (doc: DocumentItem) => (
    <li key={doc.id} className="flex items-center gap-3 border-b border-subtle py-2.5">
      <span className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[11px] font-bold text-accent-strong">{docBadge(doc)}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold">{doc.name}</span>
        <span className="text-xs text-muted">
          {t(TAG_LABEL[doc.tag])} · {formatSize(doc.size, locale)}
        </span>
      </span>
      <a
        href={doc.web_view_link}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("documents.openNamed", { name: doc.name })}
        className="flex h-9 items-center rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2"
      >
        {t("documents.open")}
      </a>
      <button
        type="button"
        aria-label={t("documents.deleteNamed", { name: doc.name })}
        onClick={() => askDelete(doc)}
        disabled={remove.isPending}
        className="h-9 rounded-lg border border-danger-line px-3 text-sm font-semibold text-danger disabled:opacity-60"
      >
        {t("documents.delete")}
      </button>
    </li>
  );

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className={`mr-auto font-bold ${compact ? "text-xs tracking-wide text-muted uppercase" : "text-sm"}`}>
          {t("documents.title")}
          {docs.data && <span className="ml-2 font-normal text-muted">{t("documents.count", { count: all.length })}</span>}
        </h2>
        {driveOn && (
          <button type="button" onClick={() => setUploading(true)} className="h-9 rounded-xl bg-accent px-3.5 text-sm font-semibold text-on-accent hover:bg-accent-strong">
            {t("documents.upload")}
          </button>
        )}
      </div>
      {google.error && <ErrorPanel error={google.error} onRetry={() => google.refetch()} />}
      {driveOn === false && (
        <p className="rounded-xl bg-subtle px-4 py-3 text-sm text-ink-2">
          {t("documents.driveOff")}{" "}
          <Link to="/settings" className="font-semibold text-accent">
            {t("documents.driveOffLink")}
          </Link>
        </p>
      )}
      {!compact && all.length > 0 && (
        <div role="group" aria-label={t("documents.filterLabel")} className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={`h-8 rounded-full border px-3 text-xs font-semibold ${filter === f.value ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-ink-2"}`}
            >
              {t(f.label)}
            </button>
          ))}
        </div>
      )}
      {docs.error ? (
        <ErrorPanel error={docs.error} onRetry={() => docs.refetch()} />
      ) : !docs.data ? (
        <SkeletonRows rows={2} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">{t(all.length === 0 ? "documents.empty" : "documents.emptyFiltered")}</p>
      ) : compact ? (
        <ul className="flex flex-col">{shown.map(row)}</ul>
      ) : (
        ordered.map(([groupEvent, list]) => (
          <div key={groupEvent ?? "none"} className="flex flex-col">
            <h3 className="text-xs font-bold tracking-wide text-muted uppercase">
              {groupEvent !== null && list[0].event_start
                ? `${dayLabel(parisParts(list[0].event_start).date, locale).weekday} ${formatLongDate(parisParts(list[0].event_start).date, locale)}`
                : t("documents.noClass")}
            </h3>
            <ul className="flex flex-col">{list.map(row)}</ul>
          </div>
        ))
      )}
      {driveOn && uploading && <UploadDialog open onClose={() => setUploading(false)} subjectId={subjectId} eventId={eventId ?? null} />}
    </section>
  );
}
