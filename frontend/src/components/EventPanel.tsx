import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { Link } from "react-router";
import { useLocale, useT } from "../i18n";
import { apiFetch } from "../lib/api";
import { invalidateTaskViews } from "../lib/invalidate";
import { useShortcut } from "../lib/shortcuts";
import { dayLabel, formatLongDate, formatTime, parisParts } from "../lib/time";
import type { EventDetail, NoteTab, Task } from "../types";
import { ErrorPanel } from "./Banners";
import { Dialog } from "./ui/Dialog";
import { useConfirm } from "./ui/Confirm";
import { SkeletonRows } from "./ui/Skeleton";
import { useToast } from "./ui/Toast";

const chip = "rounded-full bg-subtle px-2.5 py-1 text-xs font-semibold text-ink-2";
const action = "flex h-10 items-center justify-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2";

function firstLines(body: string, count = 3): string {
  return body.split("\n").filter((line) => line.trim() !== "").slice(0, count).join("\n");
}

export function EventPanel({ eventId, onClose, onEdit, onOpen }: { eventId: number; onClose: () => void; onEdit: (id: number) => void; onOpen?: (id: number) => void }) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const asking = useRef(false);

  const detail = useQuery({ queryKey: ["event", String(eventId)], queryFn: () => apiFetch<EventDetail>(`/api/events/${eventId}`) });

  const star = useMutation({
    mutationFn: (important: boolean) => apiFetch<EventDetail>(`/api/events/${eventId}/important`, { method: "PUT", body: JSON.stringify({ important }) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["event", String(eventId)], data);
      toast.success(t(data.event.important ? "event.markedImportant" : "event.noLongerImportant"));
      invalidateTaskViews(queryClient);
    },
    onError: (error, important) => toast.error(t("event.starFailed", { message: error.message }), { retry: () => star.mutate(important) }),
  });
  const toggleTask = useMutation({
    mutationFn: (task: Task) => apiFetch<Task>(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: task.status === "done" ? "todo" : "done" }) }),
    onSuccess: () => invalidateTaskViews(queryClient),
    onError: (error, task) => toast.error(t("event.taskFailed", { message: error.message }), { retry: () => toggleTask.mutate(task) }),
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/events/${eventId}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateTaskViews(queryClient);
      toast.success(t("event.deleted"));
      onClose();
      queryClient.removeQueries({ queryKey: ["event", String(eventId)] });
    },
    onError: (error) => toast.error(t("event.deleteFailed", { message: error.message }), { retry: () => remove.mutate() }),
  });

  const own = detail.data?.event.source === "custom";
  const askDelete = async () => {
    if (!detail.data || asking.current || remove.isPending) return;
    asking.current = true;
    try {
      const hasNotes = detail.data.event.note_count > 0;
      const ok = await confirm({
        title: t("event.deleteTitle"),
        body: t(hasNotes ? "event.deleteBodyWithNotes" : "event.deleteBody"),
        confirmLabel: t("event.deleteEvent"),
        tone: "danger",
      });
      if (ok) remove.mutate();
    } finally {
      asking.current = false;
    }
  };
  useShortcut("panel-delete", "Mod+d", askDelete, { inDialog: true, label: "shortcuts.delete", enabled: own });
  useShortcut("panel-delete-key", "Delete", askDelete, { inDialog: true, label: "shortcuts.delete", enabled: own });

  const data = detail.data;
  const event = data?.event;
  const start = event ? parisParts(event.start) : null;
  const nextStart = data?.next_event_start;
  const color = event?.color ?? "var(--tt-kind-work)";
  const notes = data ? (["after", "before"] as NoteTab[]).filter((tab) => data.notes[tab].body.trim() !== "") : [];

  return (
    <Dialog open onClose={onClose} size="side" title={detail.error ? t("event.notFound") : event ? `${event.title}${event.section ? ` · ${event.section}` : ""}` : t("common.loading")}>
      {detail.error ? (
        <ErrorPanel error={detail.error} onRetry={() => detail.refetch()} />
      ) : !data || !event || !start ? (
        <SkeletonRows rows={4} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="size-3 shrink-0 rounded-full" style={{ background: color }} />
            {event.subject_name && <span className={chip}>{event.subject_name}</span>}
            {event.status !== "normal" && <span className={chip}>{t(event.status === "changed" ? "event.changed" : "event.cancelled")}</span>}
            {event.kind === "exam" && <span className="rounded-full bg-danger px-2.5 py-1 text-xs font-bold text-on-danger">{t("calendar.grid.exam")}</span>}
            <button
              type="button"
              aria-pressed={event.important}
              onClick={() => star.mutate(!event.important)}
              disabled={star.isPending}
              className={`ml-auto flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold disabled:opacity-60 ${
                event.important ? "border-warn-line bg-warn-soft text-changed" : "border-line bg-surface text-ink-2"
              }`}
            >
              <span aria-hidden="true" className="text-base leading-none">{event.important ? "★" : "☆"}</span>
              {t(event.important ? "event.important" : "event.markImportant")}
            </button>
          </div>
          <p className="text-sm text-ink-2">
            {dayLabel(start.date, locale).weekday} {formatLongDate(start.date, locale)} ·{" "}
            <span className="font-mono">
              {formatTime(event.start)}–{formatTime(event.end)}
            </span>
            {event.room ? ` · ${event.room}` : ""}
          </p>

          {notes.length > 0 && (
            <section aria-label={t("event.notes")} className="flex flex-col gap-2">
              {notes.map((tab) => (
                <div key={tab}>
                  <h3 className="text-xs font-bold tracking-wide text-muted uppercase">{t(tab === "after" ? "event.tabAfter" : "event.tabBefore")}</h3>
                  <p className="text-sm whitespace-pre-line text-ink-2">{firstLines(data.notes[tab].body)}</p>
                </div>
              ))}
            </section>
          )}

          {data.tasks.some((task) => task.status !== "done") && (
            <section aria-label={t("event.tasksFromClass")} className="flex flex-col gap-2">
              <h3 className="text-sm font-bold">{t("event.tasksFromClass")}</h3>
              {data.tasks
                .filter((task) => task.status !== "done")
                .map((task) => (
                  <label key={task.id} className="flex items-center gap-2.5 text-sm">
                    <input type="checkbox" checked={false} onChange={() => toggleTask.mutate(task)} />
                    <span>{task.title}</span>
                    {task.due_date && <span className="font-mono text-xs text-muted">{t("event.due", { date: task.due_date })}</span>}
                  </label>
                ))}
            </section>
          )}

          {data.next_event_id !== null && nextStart && onOpen && (
            <button type="button" onClick={() => onOpen(data.next_event_id!)} className="self-start text-sm font-semibold text-accent">
              {t("event.nextClass", { date: formatLongDate(parisParts(nextStart).date, locale), time: formatTime(nextStart) })}
            </button>
          )}

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Link to={`/events/${event.id}`} className={action}>
              {t("event.openFullPage")}
            </Link>
            {own && (
              <>
                <button type="button" onClick={() => onEdit(event.id)} className={action}>
                  {t("common.edit")}
                </button>
                <button type="button" onClick={askDelete} disabled={remove.isPending} className="h-10 rounded-xl border border-danger-line px-4 text-sm font-semibold text-danger disabled:opacity-60">
                  {t("common.delete")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
