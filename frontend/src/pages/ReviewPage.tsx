import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { apiFetch } from "../lib/api";
import { useLocale, useT, type Locale } from "../i18n";
import { INTL_LOCALE } from "../i18n/locale";
import { invalidateTaskViews } from "../lib/invalidate";
import { addDays, dayLabel, formatLongDate, formatTime, parisParts } from "../lib/time";
import type { ApiEvent, Review, Task } from "../types";

const card = "flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-4";

function weekTitle(start: string, end: string, locale: Locale): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [, em] = end.split("-").map(Number);
  if (sm === em) return `${sd} – ${formatLongDate(end, locale)}`;
  const startText = new Date(Date.UTC(sy, sm - 1, sd, 12)).toLocaleDateString(INTL_LOCALE[locale], { day: "numeric", month: "long", timeZone: "UTC" });
  return `${startText} – ${formatLongDate(end, locale)}`;
}

function Section({ title, tone, children }: { title: string; tone?: "warn" | "error"; children: ReactNode }) {
  const border = tone === "error" ? "border-danger-line" : tone === "warn" ? "border-warn-line bg-warn-soft" : "";
  return (
    <section aria-label={title} className={`${card} ${border}`}>
      <h2 className="text-[15px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

function when(e: ApiEvent, locale: Locale): string {
  const day = parisParts(e.start).date;
  return `${dayLabel(day, locale).weekday} ${formatLongDate(day, locale)} · ${formatTime(e.start)}`;
}

export function ReviewPage() {
  const t = useT();
  const locale = useLocale();
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
    mutationFn: (task: Task) => apiFetch(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) }),
    onSuccess: () => {
      invalidateTaskViews(queryClient);
    },
  });
  const mark = useMutation({
    mutationFn: (start: string) => apiFetch(`/api/review/${start}/done`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["review"] }),
  });

  const r = review.data ?? lastShown.current;
  if (!r) {
    return review.error ? <ErrorPanel error={review.error} onRetry={() => review.refetch()} /> : <p className="text-sm text-muted">{t("review.loading")}</p>;
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(r.week_start, i));
  // Step from the week asked for, so arrows still work after a failed week.
  const shownWeek = weekStart ?? r.week_start;
  const error = (tick.error ?? mark.error) as Error | null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="text-sm text-muted">{t("review.weekendReview")}</p>
          <h1 className="text-2xl font-bold tracking-tight">{weekTitle(r.week_start, r.week_end, locale)}</h1>
        </div>
        <button type="button" aria-label={t("review.previousWeek")} onClick={() => setWeekStart(addDays(shownWeek, -7))} className="h-10 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold">
          ‹
        </button>
        <button type="button" aria-label={t("review.nextWeek")} onClick={() => setWeekStart(addDays(shownWeek, 7))} className="h-10 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold">
          ›
        </button>
        {r.reviewed_at ? (
          <span className="rounded-xl bg-success-soft px-4 py-2.5 text-sm font-semibold text-success">
            {t("review.reviewedOn", { date: formatLongDate(parisParts(r.reviewed_at).date, locale) })}
          </span>
        ) : (
          <button type="button" onClick={() => mark.mutate(r.week_start)} disabled={mark.isPending} className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-50">
            {t("review.markReviewed")}
          </button>
        )}
      </header>
      {error && <p className="text-sm text-danger">{error.message}</p>}

      {review.error && !review.data ? (
        <ErrorPanel error={review.error} onRetry={() => review.refetch()} />
      ) : (
      <>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title={t("review.overdue")} tone="error">
          {r.overdue.length === 0 ? <p className="text-sm text-muted">{t("review.nothingOverdue")}</p> : r.overdue.map((x) => <TaskLine key={x.id} task={x} onTick={() => tick.mutate(x)} />)}
        </Section>
        <Section title={t("review.dueThisWeek")}>
          {r.due_this_week.length === 0 ? <p className="text-sm text-muted">{t("review.noDeadlines")}</p> : r.due_this_week.map((x) => <TaskLine key={x.id} task={x} onTick={() => tick.mutate(x)} />)}
        </Section>
        <Section title={t("review.importantNotes")} tone="warn">
          {r.important.length === 0 ? (
            <p className="text-sm text-muted">{t("review.noImportantNotes")}</p>
          ) : (
            r.important.map((n) => (
              <Link key={`${n.event_id}-${n.tab}`} to={`/events/${n.event_id}`} className="flex flex-col gap-0.5 text-sm">
                <span className="font-semibold text-ink">{n.body ? n.body.split("\n")[0] : t("review.markedImportant")}</span>
                <span className="text-xs text-muted">
                  {n.title} · {formatLongDate(parisParts(n.start).date, locale)}
                </span>
              </Link>
            ))
          )}
        </Section>
        <Section title={t("review.withoutNotes")}>
          {r.without_notes.length === 0 ? (
            <p className="text-sm text-muted">{t("review.everyClassHasNote")}</p>
          ) : (
            r.without_notes.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex flex-col">
                  <span className="font-medium">{e.title}{e.section ? ` · ${e.section}` : ""}</span>
                  <span className="text-xs text-muted">{when(e, locale)}</span>
                </span>
                <Link to={`/events/${e.id}`} className="rounded-lg border border-accent-line bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent-strong">
                  {t("review.addNote")}
                </Link>
              </div>
            ))
          )}
        </Section>
        <Section title={t("review.changes")}>
          {r.changes.length === 0 ? (
            <p className="text-sm text-muted">{t("review.noChanges")}</p>
          ) : (
            r.changes.map((e) => (
              <Link key={e.id} to={`/events/${e.id}`} className="text-sm">
                <span className="mr-2 rounded-full bg-changed px-2 text-[11px] font-bold text-on-changed">{e.status === "cancelled" ? t("review.cancelled") : t("review.changed")}</span>
                {e.title} · {when(e, locale)}
              </Link>
            ))
          )}
        </Section>
      </div>

      <section aria-label={t("review.glance")} className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-bold">{t("review.glance")}</h2>
          <span className="text-sm text-muted">
            {t("review.hours", { school: r.hours.school, work: r.hours.work, french: r.hours.french_ext })}
          </span>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {days.map((day) => {
            const items = r.week.filter((e) => parisParts(e.start).date === day);
            return (
              <div key={day} className="flex flex-col gap-1.5 rounded-xl bg-surface-2 p-3">
                <span className="text-xs font-bold uppercase tracking-wide text-muted">
                  {dayLabel(day, locale).weekday} {dayLabel(day, locale).day}
                </span>
                {items.length === 0 && <span className="text-xs text-muted">{t("review.free")}</span>}
                {items.map((e) => (
                  <span key={e.id} className={`flex items-baseline gap-1.5 text-[12.5px] ${e.status === "cancelled" ? "text-muted line-through" : ""}`}>
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: e.color ?? (e.kind === "french_ext" ? "#0E7F72" : "var(--tt-kind-work)") }} />
                    <span className="font-mono text-[11px] text-ink-2">{e.kind === "holiday" ? t("review.allDay") : formatTime(e.start)}</span>
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
  const t = useT();
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" aria-label={task.title} checked={task.status === "done"} onChange={onTick} className="mt-0.5" />
      <span className="flex flex-col">
        <span className="font-medium">{task.title}</span>
        <span className="text-xs text-muted">
          {task.subject_name ? `${task.subject_name} · ` : ""}
          {task.due_date ? t("review.taskDue", { date: task.due_date }) : ""}
        </span>
      </span>
    </label>
  );
}
