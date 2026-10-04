import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { DocumentsSection } from "../components/DocumentsSection";
import { SuggestTasks } from "../components/SuggestTasks";
import { useConfirm } from "../components/ui/Confirm";
import { useToast } from "../components/ui/Toast";
import { useLocale, useT, type MessageKey } from "../i18n";
import { apiFetch } from "../lib/api";
import { calendarHref } from "../lib/calendarLocation";
import { invalidateTaskViews } from "../lib/invalidate";
import { useShortcut } from "../lib/shortcuts";
import { dayLabel, formatLongDate, formatTime, parisParts } from "../lib/time";
import type { EventDetail, NoteTab, Task } from "../types";

const TABS: { id: NoteTab; label: MessageKey; noteLabel: MessageKey }[] = [
  { id: "after", label: "event.tabAfter", noteLabel: "event.noteAfter" },
  { id: "before", label: "event.tabBefore", noteLabel: "event.noteBefore" },
];
const KIND_LABEL: Record<string, MessageKey> = { work: "event.kindWork", french_ext: "event.kindFrench", other: "event.kindOther" };
const chip = "rounded-full bg-subtle px-2.5 py-1 text-xs font-semibold text-ink-2";

interface Draft {
  body: string;
  important: boolean;
}

const draftKey = (eventId: string | undefined, tab: NoteTab) => `timetable:draft:${eventId}:${tab}`;

function loadDrafts(eventId: string | undefined): Partial<Record<NoteTab, Draft>> {
  const out: Partial<Record<NoteTab, Draft>> = {};
  for (const t of TABS) {
    try {
      const raw = localStorage.getItem(draftKey(eventId, t.id));
      if (!raw) continue;
      const v = JSON.parse(raw) as Partial<Draft>;
      if (typeof v.body === "string" && typeof v.important === "boolean") out[t.id] = { body: v.body, important: v.important };
    } catch {
      /* storage unavailable or corrupt: ignore */
    }
  }
  return out;
}

function storeDrafts(eventId: string | undefined, drafts: Partial<Record<NoteTab, Draft>>) {
  for (const t of TABS) {
    try {
      const d = drafts[t.id];
      if (d) localStorage.setItem(draftKey(eventId, t.id), JSON.stringify(d));
      else localStorage.removeItem(draftKey(eventId, t.id));
    } catch {
      /* storage unavailable: drafts stay in memory only */
    }
  }
}

export function EventPage() {
  const { id } = useParams();
  return <EventPageInner key={id} />;
}

function EventPageInner() {
  const t = useT();
  const locale = useLocale();
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<NoteTab>("after");
  const [drafts, setDrafts] = useState<Partial<Record<NoteTab, Draft>>>(() => loadDrafts(id));
  useEffect(() => storeDrafts(id, drafts), [id, drafts]);
  const leavingRef = useRef(false);
  const confirm = useConfirm();
  const toast = useToast();

  const detail = useQuery({ queryKey: ["event", id], queryFn: () => apiFetch<EventDetail>(`/api/events/${id}`) });

  const invalidateLists = () => {
    invalidateTaskViews(queryClient);
  };
  const save = useMutation({
    mutationFn: (v: { tab: NoteTab; draft: Draft }) =>
      apiFetch<EventDetail>(`/api/events/${id}/notes/${v.tab}`, { method: "PUT", body: JSON.stringify({ body: v.draft.body }) }),
    onSuccess: (data, v) => {
      queryClient.setQueryData(["event", id], data);
      setDrafts((d) => {
        const cur = d[v.tab];
        if (cur && (cur.body !== v.draft.body || cur.important !== v.draft.important)) return d;
        const next = { ...d };
        delete next[v.tab];
        return next;
      });
      invalidateLists();
      toast.success(t("event.noteSaved"));
    },
    onError: (error, v) => toast.error(t("event.noteFailed", { message: error.message }), { retry: () => save.mutate(v) }),
  });
  const star = useMutation({
    mutationFn: (important: boolean) =>
      apiFetch<EventDetail>(`/api/events/${id}/important`, { method: "PUT", body: JSON.stringify({ important }) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["event", id], data);
      toast.success(t(data.event.important ? "event.markedImportant" : "event.noLongerImportant"));
      invalidateLists();
    },
    onError: (error, important) => toast.error(t("event.starFailed", { message: error.message }), { retry: () => star.mutate(important) }),
  });
  const toggleTask = useMutation({
    mutationFn: (task: Task) =>
      apiFetch<Task>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: task.status === "done" ? "todo" : "done" }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event", id] });
      invalidateLists();
    },
    onError: (error, task) => toast.error(t("event.taskFailed", { message: error.message }), { retry: () => toggleTask.mutate(task) }),
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/events/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      // the event is gone: its drafts go with it, and leaving must not ask about them
      leavingRef.current = true;
      setDrafts({});
      storeDrafts(id, {});
      invalidateLists();
      toast.success(t("event.deleted"));
      navigate(calendarHref());
      queryClient.removeQueries({ queryKey: ["event", id] });
    },
    onError: (error) => toast.error(t("event.deleteFailed", { message: error.message }), { retry: () => remove.mutate() }),
  });
  const askDelete = async () => {
    if (!detail.data || remove.isPending) return;
    const ok = await confirm({
      title: t("event.deleteTitle"),
      body: t(detail.data.event.note_count > 0 ? "event.deleteBodyWithNotes" : "event.deleteBody"),
      confirmLabel: t("event.deleteEvent"),
      tone: "danger",
    });
    if (ok) remove.mutate();
  };

  useShortcut(
    "note-save",
    "Mod+s",
    () => {
      const data = detail.data;
      if (!data || save.isPending) return;
      const saved = data.notes[tab];
      const current: Draft = drafts[tab] ?? { body: saved.body, important: saved.important };
      if (current.body !== saved.body || current.important !== saved.important) save.mutate({ tab, draft: current });
    },
    { label: "shortcuts.save" },
  );

  const hasUnsaved =
    detail.data !== undefined &&
    TABS.some((x) => {
      const d = drafts[x.id];
      const n = detail.data!.notes[x.id];
      return d !== undefined && (d.body !== n.body || d.important !== n.important);
    });
  useEffect(() => {
    if (!hasUnsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsaved]);
  const hasUnsavedRef = useRef(hasUnsaved);
  hasUnsavedRef.current = hasUnsaved;
  const blocker = useBlocker(() => hasUnsavedRef.current && !leavingRef.current);
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  const asking = useRef(false);
  useEffect(() => {
    if (blocker.state !== "blocked" || asking.current) return;
    asking.current = true;
    void confirm({ title: t("event.leaveTitle"), body: t("event.leaveBody"), confirmLabel: t("event.leave"), tone: "danger" }).then((ok) => {
      asking.current = false;
      if (blockerRef.current.state !== "blocked") return;
      if (ok) blockerRef.current.proceed();
      else blockerRef.current.reset();
    });
  }, [blocker.state, confirm, t]);

  if (detail.error) return <ErrorPanel error={detail.error} onRetry={() => detail.refetch()} />;
  if (!detail.data) return <p className="text-muted">{t("common.loading")}</p>;

  const { event, tasks, notes } = detail.data;
  const saved = notes[tab];
  const current: Draft = drafts[tab] ?? { body: saved.body, important: saved.important };
  const setCurrent = (patch: Partial<Draft>) => {
    const next = { ...current, ...patch };
    const reverted = next.body === saved.body && next.important === saved.important;
    setDrafts((d) => {
      const out = { ...d };
      if (reverted) delete out[tab];
      else out[tab] = next;
      return out;
    });
  };
  const discard = () =>
    setDrafts((d) => {
      const out = { ...d };
      delete out[tab];
      return out;
    });
  const dirty = current.body !== saved.body || current.important !== saved.important;
  const anyDirty = TABS.some((t) => {
    const d = drafts[t.id];
    return d !== undefined && (d.body !== notes[t.id].body || d.important !== notes[t.id].important);
  });
  const start = parisParts(event.start);
  const nextStart = detail.data.next_event_start;
  const noteLabel = TABS.find((x) => x.id === tab)!.noteLabel;

  return (
    <div className="flex flex-col gap-4">
      <Link to={calendarHref()} className="text-sm font-semibold text-accent">
        {t("event.backToCalendar")}
      </Link>
      <article className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 md:p-7">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {event.subject_name && <span className={chip}>{event.subject_name}</span>}
            <span className={chip}>{event.source === "zeus" ? t("event.schoolTimetable") : t(KIND_LABEL[event.kind])}</span>
            {event.status !== "normal" && <span className={chip}>{t(event.status === "changed" ? "event.changed" : "event.cancelled")}</span>}
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
          <h1 className="text-2xl font-bold tracking-tight">
            {event.title}
            {event.section ? ` · ${event.section}` : ""}
          </h1>
          <p className="text-sm text-ink-2">
            {dayLabel(start.date, locale).weekday} {formatLongDate(start.date, locale)} ·{" "}
            <span className="font-mono">
              {formatTime(event.start)}–{formatTime(event.end)}
            </span>
            {event.room ? ` · ${event.room}` : ""}
          </p>
          {detail.data.next_event_id && nextStart && (
            <Link to={`/events/${detail.data.next_event_id}`} className="text-sm font-semibold text-accent">
              {t("event.nextClass", { date: formatLongDate(parisParts(nextStart).date, locale), time: formatTime(nextStart) })}
            </Link>
          )}
        </header>

        <div role="tablist" aria-label={t("event.notes")} className="flex gap-1 border-b border-line">
          {TABS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              className={`-mb-px px-3.5 py-2.5 text-sm ${tab === x.id ? "border-b-2 border-accent font-semibold text-accent-strong" : "font-medium text-muted"}`}
            >
              {t(x.label)}
            </button>
          ))}
        </div>

        <textarea
          aria-label={t(noteLabel)}
          value={current.body}
          onChange={(e) => setCurrent({ body: e.target.value })}
          rows={10}
          maxLength={20000}
          className="w-full rounded-xl border border-line p-4 font-sans text-[15px] leading-relaxed"
          placeholder={t("event.placeholder")}
        />
        <p className="text-xs text-muted">
          {t("event.helpStart")} <code>[ ]</code> {t("event.helpTasks")} <code>[x]</code> {t("event.helpDone")}{" "}
          <code>@2026-10-22</code> {t("event.helpDue")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ tab, draft: current })}
            className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-50"
          >
            {t("event.saveNote")}
          </button>
          {dirty && (
            <button type="button" onClick={discard} className="h-10 rounded-xl border border-line px-4 text-sm font-semibold text-ink-2">
              {t("event.discard")}
            </button>
          )}
          {dirty ? <span className="text-sm text-muted">{t("event.unsaved")}</span> : saved.updated_at ? <span className="text-sm text-muted">{t("event.saved")}</span> : null}
          {save.error && <p className="text-sm text-danger">{(save.error as Error).message}</p>}
        </div>

        <SuggestTasks key={tab} eventId={event.id} subjectId={event.subject_id} tab={tab} />

        {tasks.length > 0 && (
          <section aria-label={t("event.tasksFromClass")} className="flex flex-col gap-2 border-t border-line pt-4">
            <h2 className="text-sm font-bold">{t("event.tasksFromClass")}</h2>
            {anyDirty && <p className="text-xs text-muted">{t("event.saveFirst")}</p>}
            {tasks.map((task) => (
              <label key={task.id} className="flex items-center gap-2.5 text-sm">
                <input type="checkbox" disabled={anyDirty} checked={task.status === "done"} onChange={() => toggleTask.mutate(task)} />
                <span className={task.status === "done" ? "text-muted line-through" : ""}>{task.title}</span>
                {task.status === "doing" && <span className={chip}>{t("event.doing")}</span>}
                {task.due_date && <span className="font-mono text-xs text-muted">{t("event.due", { date: task.due_date })}</span>}
              </label>
            ))}
            {toggleTask.error && <p className="text-sm text-danger">{(toggleTask.error as Error).message}</p>}
          </section>
        )}

        {event.subject_id !== null && (
          <div className="border-t border-line pt-4">
            <DocumentsSection subjectId={event.subject_id} eventId={event.id} />
          </div>
        )}

        {event.source === "custom" && (
          <div className="border-t border-line pt-4">
            <button
              type="button"
              onClick={askDelete}
              className="h-10 rounded-xl border border-danger-line px-4 text-sm font-semibold text-danger"
            >
              {event.note_count > 0 ? t("event.deleteWithNotes") : t("event.deleteEvent")}
            </button>
          </div>
        )}
      </article>
    </div>
  );
}
