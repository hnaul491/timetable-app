import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { Skeleton } from "../components/ui/Skeleton";
import { useLocale, useT } from "../i18n";
import { apiFetch } from "../lib/api";
import { formatLongDate, parisParts } from "../lib/time";
import type { SubjectSummary } from "../types";

export function SubjectsPage() {
  const t = useT();
  const locale = useLocale();
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: () => apiFetch<SubjectSummary[]>("/api/subjects"), refetchOnMount: "always" });
  if (subjects.error) return <ErrorPanel error={subjects.error} onRetry={() => subjects.refetch()} />;
  if (!subjects.data)
    return (
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">{t("subjects.loading")}</span>
        <Skeleton className="h-8 w-40" />
        <div aria-hidden="true" className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold tracking-tight">{t("subjects.title")}</h1>
        <Link to="/documents" className="text-sm font-semibold text-accent md:hidden">
          {t("documents.page.allDocuments")}
        </Link>
      </div>
      {subjects.data.length === 0 && <p className="text-sm text-muted">{t("subjects.empty")}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {subjects.data.map((s) => (
          <Link key={s.id} to={`/subjects/${s.id}`} className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-accent-line">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
                {s.display_name}
                {s.hidden && <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-muted">{t("subjects.hidden")}</span>}
              </span>
              <span className="text-xs text-muted">
                {s.next_start
                  ? t("subjects.summaryNext", { done: s.sessions_done, total: s.sessions, count: s.open_tasks, date: formatLongDate(parisParts(s.next_start).date, locale) })
                  : t("subjects.summary", { done: s.sessions_done, total: s.sessions, count: s.open_tasks })}
              </span>
              {s.exam_start && (
                <span className="text-xs font-semibold text-danger">{t("subjects.exam", { date: formatLongDate(parisParts(s.exam_start).date, locale) })}</span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
