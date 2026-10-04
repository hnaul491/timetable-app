import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { UploadDialog } from "../components/UploadDialog";
import { Skeleton } from "../components/ui/Skeleton";
import { useLocale, useT, type MessageKey } from "../i18n";
import { apiFetch } from "../lib/api";
import { docBadge, formatSize } from "../lib/documents";
import { dayLabel, formatLongDate, parisParts } from "../lib/time";
import { useDeleteDocument } from "../lib/useDeleteDocument";
import { stripAccents } from "./settings/sections";
import type { AllDocuments, DocListItem, DocumentTag, GoogleStatus } from "../types";

type Filter = "all" | DocumentTag;
type Sort = "newest" | "name";
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
const COLLAPSED_KEY = "documents.collapsed";

const chipClass = (on: boolean) =>
  `h-9 rounded-[9px] border px-2.5 text-xs font-bold ${on ? "border-accent bg-accent text-on-accent" : "border-line bg-surface text-ink-2 hover:bg-surface-2"}`;
const field = "h-10 rounded-xl border border-line bg-surface px-3 text-sm text-ink";
const linkBtn = "inline-flex h-10 items-center rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2";

function readCollapsed(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((n): n is number => typeof n === "number") : [];
  } catch {
    return [];
  }
}
function writeCollapsed(ids: number[]) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids));
  } catch {
    // private mode or blocked storage: the sections just open again next time
  }
}

export function DocumentsPage() {
  const t = useT();
  const locale = useLocale();
  const { askDelete, pending: deleting } = useDeleteDocument();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [showEmpty, setShowEmpty] = useState(false);
  const [collapsed, setCollapsed] = useState<number[]>(readCollapsed);
  const [uploadFor, setUploadFor] = useState<number | null>(null);

  const google = useQuery({ queryKey: ["google"], queryFn: () => apiFetch<GoogleStatus>("/api/google") });
  const data = useQuery({ queryKey: ["documents", "all"], queryFn: () => apiFetch<AllDocuments>("/api/documents"), refetchOnMount: "always" });
  const driveOn = google.data ? google.data.connected && google.data.drive_enabled : null;

  const toggle = (id: number) =>
    setCollapsed((current) => {
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      writeCollapsed(next);
      return next;
    });

  const sections = useMemo(() => {
    if (!data.data) return [];
    const needle = stripAccents(query.trim());
    const filtered = data.data.documents
      .filter((d) => (tag === "all" || d.tag === tag) && (needle === "" || stripAccents(d.name).includes(needle)))
      .sort(
        sort === "name"
          ? (a, b) => a.name.localeCompare(b.name, locale, { sensitivity: "base" })
          : (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id,
      );
    const total = new Map<number, number>();
    for (const d of data.data.documents) total.set(d.subject.id, (total.get(d.subject.id) ?? 0) + 1);
    return data.data.subjects
      .map((s) => ({ subject: s, docs: filtered.filter((d) => d.subject.id === s.id), hasAny: (total.get(s.id) ?? 0) > 0 }))
      .filter((s) => (s.hasAny ? s.docs.length > 0 : showEmpty));
  }, [data.data, query, tag, sort, showEmpty, locale]);

  const row = (doc: DocListItem) => {
    const start = doc.event ? parisParts(doc.event.start).date : null;
    return (
      <li key={doc.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-subtle py-2.5">
        <span
          data-kind={docBadge(doc)}
          aria-hidden="true"
          className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[11px] font-bold text-accent-strong"
        >
          {docBadge(doc)}
        </span>
        <span className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
          <a href={doc.web_view_link} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-semibold text-ink hover:text-accent">
            {doc.name}
          </a>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <span className="rounded-full bg-subtle px-2 py-0.5 font-semibold text-ink-2">{t(TAG_LABEL[doc.tag])}</span>
            {doc.event && start && (
              <Link to={`/?date=${start}&event=${doc.event.id}`} className="font-semibold text-accent">
                {dayLabel(start, locale).weekday} {formatLongDate(start, locale).replace(/\s+\d{4}$/, "")} · {doc.event.title}
              </Link>
            )}
            <span>{formatSize(doc.size, locale)}</span>
            <span>{t("documents.page.uploadedOn", { date: formatLongDate(parisParts(doc.created_at).date, locale) })}</span>
          </span>
        </span>
        <button
          type="button"
          aria-label={t("documents.deleteNamed", { name: doc.name })}
          onClick={() => askDelete(doc)}
          disabled={deleting}
          className="h-9 rounded-lg border border-danger-line px-3 text-sm font-semibold text-danger disabled:opacity-60"
        >
          {t("documents.delete")}
        </button>
      </li>
    );
  };

  const subjectsList = data.data?.subjects.map((s) => ({ id: s.id, name: s.name })) ?? [];
  const hasDocs = (data.data?.documents.length ?? 0) > 0;

  const body = () => {
    if (data.error) return <ErrorPanel error={data.error} onRetry={() => data.refetch()} />;
    if (!data.data)
      return (
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">{t("documents.page.loading")}</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      );
    if (!hasDocs && !showEmpty)
      return (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-base font-bold">{t("documents.page.emptyTitle")}</h2>
          <p className="text-sm text-ink-2">{t("documents.page.emptyBody")}</p>
          {driveOn && subjectsList.length > 0 && (
            <button type="button" onClick={() => setUploadFor(subjectsList[0].id)} className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong">
              {t("documents.page.uploadShort")}
            </button>
          )}
        </div>
      );
    if (sections.length === 0) return <p className="text-sm text-muted">{t("documents.page.noMatch")}</p>;
    return sections.map(({ subject, docs }) => {
      const open = !collapsed.includes(subject.id);
      const panelId = `documents-subject-${subject.id}`;
      return (
        <section key={subject.id} aria-label={subject.name} className="flex flex-col rounded-2xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => toggle(subject.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: subject.color }} />
              <span className="truncate text-[15px] font-bold">{subject.name}</span>
              {subject.hidden && <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-muted">{t("documents.page.hidden")}</span>}
              <span className="shrink-0 text-xs font-normal text-muted">{t("documents.count", { count: docs.length })}</span>
            </button>
            {subject.folder_url && (
              <a
                href={subject.folder_url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("documents.page.openFolderNamed", { name: subject.name })}
                className="text-sm font-semibold text-accent"
              >
                {t("documents.page.openFolder")}
              </a>
            )}
            {driveOn && (
              <button
                type="button"
                aria-label={t("documents.page.uploadTo", { name: subject.name })}
                onClick={() => setUploadFor(subject.id)}
                className="h-9 rounded-lg border border-accent-line px-3 text-sm font-semibold text-accent hover:bg-accent-soft"
              >
                {t("documents.page.uploadToShort")}
              </button>
            )}
          </div>
          {open && (
            <div id={panelId}>
              {docs.length === 0 ? <p className="pt-2 text-sm text-muted">{t("documents.page.subjectEmpty")}</p> : <ul className="flex flex-col pt-1">{docs.map(row)}</ul>}
            </div>
          )}
        </section>
      );
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold tracking-tight">{t("documents.title")}</h1>
        {data.data?.semester_url && (
          <a href={data.data.semester_url} target="_blank" rel="noopener noreferrer" className={linkBtn}>
            {t("documents.page.openDrive")}
          </a>
        )}
        {driveOn && subjectsList.length > 0 && (
          <button type="button" onClick={() => setUploadFor(subjectsList[0].id)} className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong">
            {t("documents.page.uploadShort")}
          </button>
        )}
      </header>
      {google.error && <ErrorPanel error={google.error} onRetry={() => google.refetch()} />}
      {driveOn === false && (
        <p className="rounded-xl bg-subtle px-4 py-3 text-sm text-ink-2">
          {t("documents.driveOff")}{" "}
          <Link to="/settings/google" className="font-semibold text-accent">
            {t("documents.driveOffLink")}
          </Link>
        </p>
      )}
      {(hasDocs || query !== "" || tag !== "all") && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("documents.page.searchLabel")}
            placeholder={t("documents.page.searchPlaceholder")}
            className={`${field} min-w-0 flex-1 basis-56`}
          />
          <label className="flex items-center gap-2 text-xs font-semibold text-muted">
            {t("documents.page.sortLabel")}
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={field}>
              <option value="newest">{t("documents.page.sortNewest")}</option>
              <option value="name">{t("documents.page.sortName")}</option>
            </select>
          </label>
          <div role="group" aria-label={t("documents.filterLabel")} className="flex w-full flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" aria-pressed={tag === f.value} onClick={() => setTag(f.value)} className={chipClass(tag === f.value)}>
                {t(f.label)}
              </button>
            ))}
          </div>
        </div>
      )}
      {data.data && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
          {t("documents.page.showEmpty")}
        </label>
      )}
      {body()}
      {driveOn && uploadFor !== null && subjectsList.length > 0 && (
        <UploadDialog open onClose={() => setUploadFor(null)} subjectId={uploadFor} eventId={null} subjects={subjectsList} />
      )}
    </div>
  );
}
