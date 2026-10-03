import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { apiFetch } from "../lib/api";
import { addDays, dayLabel, formatLongDate, formatTime, parisParts } from "../lib/time";
import type { ApiEvent, Review, Task } from "../types";

const card = "flex flex-col gap-2.5 rounded-2xl border border-line bg-white p-4";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function weekTitle(start: string, end: string): string {
  const [, sm] = start.split("-").map(Number);
  const [, em] = end.split("-").map(Number);
  const startDay = Number(start.slice(8));
  return sm === em ? `${startDay} – ${formatLongDate(end)}` : `${startDay} ${MONTHS[sm - 1]} – ${formatLongDate(end)}`;
}

function Section({ title, tone, children }: { title: string; tone?: "warn" | "error"; children: ReactNode }) {
  const border = tone === "error" ? "border-[#F3C4C4]" : tone === "warn" ? "border-[#F5D9B8] bg-[#FFF7ED]" : "";
  return (
    <section aria-label={title} className={`${card} ${border}`}>
      <h2 className="text-[15px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

function when(e: ApiEvent): string {
  const day = parisParts(e.start).date;
  return `${dayLabel(day).weekday} ${formatLongDate(day)} · ${formatTime(e.start)}`;
}

export function ReviewPage() {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const review = useQuery({
    queryKey: ["review", weekStart],
    queryFn: () => apiFetch<Review>(weekStart ? `/api/review?week_start=${weekStart}` : "/api/review"),
    placeholderData: keepPreviousData,
    refetchOnMount: "always",
  });
  const lastShown = useRef<Review | undefined>(undefined);
  if (review.data) lastShown.current = review.data;
  const tick = useMutation({
    mutationFn: (t: Task) => apiFetch(`/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const mark = useMutation({
    mutationFn: (start: string) => apiFetch(`/api/review/${start}/done`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["review"] }),
  });

  const r = review.data ?? lastShown.current;
  if (!r) {
    return review.error ? <ErrorPanel error={review.error} onRetry={() => review.refetch()} /> : <p className="text-sm text-muted">Loading review…</p>;
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(r.week_start, i));
  // Step from the week asked for, so arrows still work after a failed week.
  const shownWeek = weekStart ?? r.week_start;
  const error = (tick.error ?? mark.error) as Error | null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="text-sm text-muted">Weekend review</p>
          <h1 className="text-2xl font-bold tracking-tight">{weekTitle(r.week_start, r.week_end)}</h1>
        </div>
        <button type="button" aria-label="Previous week" onClick={() => setWeekStart(addDays(shownWeek, -7))} className="h-10 rounded-xl border border-line bg-white px-3.5 text-sm font-semibold">
          ‹
        </button>
        <button type="button" aria-label="Next week" onClick={() => setWeekStart(addDays(shownWeek, 7))} className="h-10 rounded-xl border border-line bg-white px-3.5 text-sm font-semibold">
          ›
        </button>
        {r.reviewed_at ? (
          <span className="rounded-xl bg-[#E7F5EC] px-4 py-2.5 text-sm font-semibold text-[#145C33]">
            Reviewed on {formatLongDate(parisParts(r.reviewed_at).date)}
          </span>
        ) : (
          <button type="button" onClick={() => mark.mutate(r.week_start)} disabled={mark.isPending} className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">
            Mark week as reviewed
          </button>
        )}
      </header>
      {error && <p className="text-sm text-[#8B1A1A]">{error.message}</p>}

      {review.error && !review.data ? (
        <ErrorPanel error={review.error} onRetry={() => review.refetch()} />
      ) : (
      <>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="Overdue" tone="error">
          {r.overdue.length === 0 ? <p className="text-sm text-muted">Nothing overdue.</p> : r.overdue.map((t) => <TaskLine key={t.id} task={t} onTick={() => tick.mutate(t)} />)}
        </Section>
        <Section title="Due this week">
          {r.due_this_week.length === 0 ? <p className="text-sm text-muted">No deadlines this week.</p> : r.due_this_week.map((t) => <TaskLine key={t.id} task={t} onTick={() => tick.mutate(t)} />)}
        </Section>
        <Section title="Important notes" tone="warn">
          {r.important.length === 0 ? (
            <p className="text-sm text-muted">No important notes.</p>
          ) : (
            r.important.map((n) => (
              <Link key={`${n.event_id}-${n.tab}`} to={`/events/${n.event_id}`} className="flex flex-col gap-0.5 text-sm">
                <span className="font-semibold text-ink">{n.body.split("\n")[0]}</span>
                <span className="text-xs text-muted">
                  {n.title} · {formatLongDate(parisParts(n.start).date)}
                </span>
              </Link>
            ))
          )}
        </Section>
        <Section title="Last week's classes without notes">
          {r.without_notes.length === 0 ? (
            <p className="text-sm text-muted">Every class has a note.</p>
          ) : (
            r.without_notes.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex flex-col">
                  <span className="font-medium">{e.title}{e.section ? ` · ${e.section}` : ""}</span>
                  <span className="text-xs text-muted">{when(e)}</span>
                </span>
                <Link to={`/events/${e.id}`} className="rounded-lg border border-[#C9D3F7] bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent-strong">
                  Add note
                </Link>
              </div>
            ))
          )}
        </Section>
        <Section title="School timetable changes">
          {r.changes.length === 0 ? (
            <p className="text-sm text-muted">No changes from school this week.</p>
          ) : (
            r.changes.map((e) => (
              <Link key={e.id} to={`/events/${e.id}`} className="text-sm">
                <span className="mr-2 rounded-full bg-[#9A3412] px-2 text-[11px] font-bold text-white">{e.status === "cancelled" ? "Cancelled" : "Changed"}</span>
                {e.title} · {when(e)}
              </Link>
            ))
          )}
        </Section>
      </div>

      <section aria-label="Week at a glance" className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-bold">Week at a glance</h2>
          <span className="text-sm text-muted">
            {r.hours.school} h school · {r.hours.work} h work · {r.hours.french_ext} h French (external)
          </span>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {days.map((day) => {
            const items = r.week.filter((e) => parisParts(e.start).date === day);
            return (
              <div key={day} className="flex flex-col gap-1.5 rounded-xl bg-[#F8F9FB] p-3">
                <span className="text-xs font-bold uppercase tracking-wide text-muted">
                  {dayLabel(day).weekday} {dayLabel(day).day}
                </span>
                {items.length === 0 && <span className="text-xs text-muted">Free</span>}
                {items.map((e) => (
                  <span key={e.id} className={`flex items-baseline gap-1.5 text-[12.5px] ${e.status === "cancelled" ? "text-muted line-through" : ""}`}>
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: e.color ?? (e.kind === "french_ext" ? "#0E7F72" : "#3B4252") }} />
                    <span className="font-mono text-[11px] text-[#3A3F4B]">{e.kind === "holiday" ? "all day" : formatTime(e.start)}</span>
                    {e.title}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </section>
      </>
      )}
    </div>
  );
}

function TaskLine({ task, onTick }: { task: Task; onTick: () => void }) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" aria-label={task.title} checked={task.status === "done"} onChange={onTick} className="mt-0.5" />
      <span className="flex flex-col">
        <span className="font-medium">{task.title}</span>
        <span className="text-xs text-muted">
          {task.subject_name ? `${task.subject_name} · ` : ""}
          {task.due_date ? `due ${task.due_date}` : ""}
        </span>
      </span>
    </label>
  );
}
