import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { apiFetch } from "../lib/api";
import { formatLongDate, parisParts } from "../lib/time";
import type { SubjectSummary } from "../types";

export function SubjectsPage() {
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: () => apiFetch<SubjectSummary[]>("/api/subjects"), refetchOnMount: "always" });
  if (subjects.error) return <ErrorPanel error={subjects.error} onRetry={() => subjects.refetch()} />;
  if (!subjects.data) return <p className="text-sm text-muted">Loading subjects…</p>;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Subjects</h1>
      {subjects.data.length === 0 && <p className="text-sm text-muted">No subjects yet — sync your school timetable first.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {subjects.data.map((s) => (
          <Link key={s.id} to={`/subjects/${s.id}`} className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-accent-line">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
                {s.display_name}
                {s.hidden && <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-muted">Hidden</span>}
              </span>
              <span className="text-xs text-muted">
                {s.sessions_done} of {s.sessions} sessions · {s.open_tasks} open {s.open_tasks === 1 ? "task" : "tasks"}
                {s.next_start ? ` · next ${formatLongDate(parisParts(s.next_start).date)}` : ""}
              </span>
              {s.exam_start && (
                <span className="text-xs font-semibold text-danger">Exam {formatLongDate(parisParts(s.exam_start).date)}</span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
