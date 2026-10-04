import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { apiFetch } from "../lib/api";
import { dayLabel, formatLongDate, formatTime, parisParts } from "../lib/time";
import type { SubjectDetail } from "../types";

export function SubjectPage() {
  const { id } = useParams();
  const detail = useQuery({ queryKey: ["subject", id], queryFn: () => apiFetch<SubjectDetail>(`/api/subjects/${id}`), refetchOnMount: "always" });
  if (detail.error) return <ErrorPanel error={detail.error} onRetry={() => detail.refetch()} />;
  if (!detail.data) return <p className="text-sm text-muted">Loading…</p>;
  const { subject, sessions, tasks } = detail.data;
  const pct = subject.sessions ? Math.round((subject.sessions_done / subject.sessions) * 100) : 0;
  return (
    <div className="flex flex-col gap-4">
      <Link to="/subjects" className="text-sm font-semibold text-accent">
        ‹ All subjects
      </Link>
      <article className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 md:p-7">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="flex items-center gap-2 text-xs font-semibold text-muted">
              <span className="size-2 rounded-full" style={{ background: subject.color }} />
              {subject.aliases.length > 0 ? `Also called: ${subject.aliases.join(", ")}` : "Subject"}
            </span>
            <h1 className="text-2xl font-bold tracking-tight">{subject.display_name}</h1>
            <span className="text-sm text-ink-2">
              {subject.sessions} sessions · {subject.sessions_done} done · {subject.note_count} notes · {subject.open_tasks} open tasks
            </span>
          </div>
          {subject.exam_start && (
            <div className="flex flex-col gap-0.5 rounded-xl bg-danger-soft px-4 py-2.5 text-danger">
              <span className="text-xs font-bold uppercase tracking-wide">Exam</span>
              <span className="text-sm font-semibold">
                {dayLabel(parisParts(subject.exam_start).date).weekday} {formatLongDate(parisParts(subject.exam_start).date)} · {formatTime(subject.exam_start)}
              </span>
              {subject.exam_room && <span className="text-xs">{subject.exam_room}</span>}
            </div>
          )}
        </header>
        <div
          role="progressbar"
          aria-label={`${subject.sessions_done} of ${subject.sessions} sessions done`}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 overflow-hidden rounded-full bg-subtle"
        >
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <section className="flex flex-col">
          <h2 className="mb-2 text-sm font-bold">Sessions</h2>
          {sessions.length === 0 && <p className="text-sm text-muted">No sessions (hidden subject, or pick your group in Settings).</p>}
          <ol className="flex flex-col">
            {sessions.map((s) => {
              const day = parisParts(s.start).date;
              return (
                <li key={s.id} className="flex flex-wrap gap-4 border-b border-subtle py-3">
                  <Link to={`/events/${s.id}`} className="flex w-32 shrink-0 flex-col gap-0.5">
                    <span className={`text-sm font-semibold ${s.status === "cancelled" ? "text-muted line-through" : "text-ink"}`}>
                      {dayLabel(day).weekday} {formatLongDate(day)}
                    </span>
                    <span className="font-mono text-[11.5px] text-muted">
                      {formatTime(s.start)} · {s.room}
                    </span>
                  </Link>
                  <span className="flex min-w-[200px] flex-1 flex-col gap-1.5">
                    {s.note_snippet ? (
                      <Link to={`/events/${s.id}`} className="text-sm text-ink">
                        {s.note_snippet}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted">No notes yet</span>
                    )}
                    <span className="flex flex-wrap gap-1.5">
                      {s.kind === "exam" && <span className="rounded-full bg-danger px-2 text-[11px] font-bold text-on-danger">Exam</span>}
                      {s.status === "cancelled" && <span className="rounded-full bg-subtle px-2 text-[11px] font-semibold text-muted">Cancelled</span>}
                      {s.status === "changed" && <span className="rounded-full bg-changed px-2 text-[11px] font-bold text-on-changed">Changed</span>}
                      {s.important && <span className="rounded-full bg-warn-soft px-2 text-[11px] font-bold text-warn">Important</span>}
                      {s.open_tasks > 0 && <span className="rounded-full bg-accent-soft px-2 text-[11px] font-semibold text-accent-strong">{s.open_tasks} open</span>}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
        {tasks.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-bold">Tasks</h2>
            {tasks.map((t) => (
              <p key={t.id} className={`text-sm ${t.status === "done" ? "text-muted line-through" : ""}`}>
                {t.title}
                {t.due_date ? <span className="ml-2 font-mono text-xs text-muted">due {t.due_date}</span> : null}
              </p>
            ))}
            <Link to="/board" className="text-sm font-semibold text-accent">
              Open the board
            </Link>
          </section>
        )}
      </article>
    </div>
  );
}
