import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { apiFetch } from "../lib/api";
import { invalidateTaskViews } from "../lib/invalidate";
import { dayLabel, formatLongDate, formatTime, parisParts } from "../lib/time";
import type { EventDetail, NoteTab, Task } from "../types";

const TABS: { id: NoteTab; label: string }[] = [
  { id: "after", label: "After class" },
  { id: "before", label: "Before next class" },
];
const KIND_LABEL: Record<string, string> = { work: "Work", french_ext: "French (external)", other: "My event" };
const chip = "rounded-full bg-[#F0F1F4] px-2.5 py-1 text-xs font-semibold text-[#3A3F4B]";

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
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<NoteTab>("after");
  const [drafts, setDrafts] = useState<Partial<Record<NoteTab, Draft>>>(() => loadDrafts(id));
  useEffect(() => storeDrafts(id, drafts), [id, drafts]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const detail = useQuery({ queryKey: ["event", id], queryFn: () => apiFetch<EventDetail>(`/api/events/${id}`) });

  const invalidateLists = () => {
    queryClient.invalidateQueries({ queryKey: ["events"] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    invalidateTaskViews(queryClient);
  };
  const save = useMutation({
    mutationFn: (v: { tab: NoteTab; draft: Draft }) =>
      apiFetch<EventDetail>(`/api/events/${id}/notes/${v.tab}`, { method: "PUT", body: JSON.stringify(v.draft) }),
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
    },
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
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/events/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateLists();
      navigate("/");
    },
  });

  if (detail.error) return <ErrorPanel error={detail.error} onRetry={() => detail.refetch()} />;
  if (!detail.data) return <p className="text-muted">Loading…</p>;

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
  const tabLabel = TABS.find((t) => t.id === tab)!.label;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/" className="text-sm font-semibold text-accent">
        ‹ Back to calendar
      </Link>
      <article className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-5 md:p-7">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {event.subject_name && <span className={chip}>{event.subject_name}</span>}
            <span className={chip}>{event.source === "zeus" ? "School timetable" : KIND_LABEL[event.kind]}</span>
            {event.status !== "normal" && <span className={chip}>{event.status === "changed" ? "Changed" : "Cancelled"}</span>}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {event.title}
            {event.section ? ` · ${event.section}` : ""}
          </h1>
          <p className="text-sm text-[#3A3F4B]">
            {dayLabel(start.date).weekday} {formatLongDate(start.date)} ·{" "}
            <span className="font-mono">
              {formatTime(event.start)}–{formatTime(event.end)}
            </span>
            {event.room ? ` · ${event.room}` : ""}
          </p>
          {detail.data.next_event_id && nextStart && (
            <Link to={`/events/${detail.data.next_event_id}`} className="text-sm font-semibold text-accent">
              Next class: {formatLongDate(parisParts(nextStart).date)} {formatTime(nextStart)}
            </Link>
          )}
        </header>

        <div role="tablist" aria-label="Notes" className="flex gap-1 border-b border-line">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px px-3.5 py-2.5 text-sm ${tab === t.id ? "border-b-2 border-accent font-semibold text-accent-strong" : "font-medium text-muted"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <textarea
          aria-label={`${tabLabel} note`}
          value={current.body}
          onChange={(e) => setCurrent({ body: e.target.value })}
          rows={10}
          maxLength={20000}
          className="w-full rounded-xl border border-line p-4 font-sans text-[15px] leading-relaxed"
          placeholder="What was covered? Homework? Write [ ] at the start of a line to make it a task."
        />
        <p className="text-xs text-muted">
          Lines starting with <code>[ ]</code> become tasks on your board; <code>[x]</code> marks one done. Add{" "}
          <code>@2026-10-22</code> at the end of a task line for a due date.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={current.important} onChange={(e) => setCurrent({ important: e.target.checked })} />
            Important
          </label>
          <button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ tab, draft: current })}
            className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
          >
            Save note
          </button>
          {dirty && (
            <button type="button" onClick={discard} className="h-10 rounded-xl border border-line px-4 text-sm font-semibold text-[#3A3F4B]">
              Discard changes
            </button>
          )}
          {dirty ? <span className="text-sm text-muted">Unsaved changes</span> : saved.updated_at ? <span className="text-sm text-muted">Saved</span> : null}
          {save.error && <p className="text-sm text-[#8B1A1A]">{(save.error as Error).message}</p>}
        </div>

        {tasks.length > 0 && (
          <section aria-label="Tasks from this class" className="flex flex-col gap-2 border-t border-line pt-4">
            <h2 className="text-sm font-bold">Tasks from this class</h2>
            {anyDirty && <p className="text-xs text-muted">Save your note first to tick tasks.</p>}
            {tasks.map((task) => (
              <label key={task.id} className="flex items-center gap-2.5 text-sm">
                <input type="checkbox" disabled={anyDirty} checked={task.status === "done"} onChange={() => toggleTask.mutate(task)} />
                <span className={task.status === "done" ? "text-muted line-through" : ""}>{task.title}</span>
                {task.status === "doing" && <span className={chip}>Doing</span>}
                {task.due_date && <span className="font-mono text-xs text-muted">due {task.due_date}</span>}
              </label>
            ))}
            {toggleTask.error && <p className="text-sm text-[#8B1A1A]">{(toggleTask.error as Error).message}</p>}
          </section>
        )}

        {event.source === "custom" && (
          <div className="border-t border-line pt-4">
            <button
              type="button"
              onClick={() => (confirmDelete ? remove.mutate() : setConfirmDelete(true))}
              className="h-10 rounded-xl border border-[#F3C4C4] px-4 text-sm font-semibold text-[#8B1A1A]"
            >
              {event.note_count > 0
                ? confirmDelete
                  ? "Click again to delete event and notes"
                  : "Delete event and its notes"
                : confirmDelete
                  ? "Click again to delete"
                  : "Delete event"}
            </button>
            {remove.error && <p className="text-sm text-[#8B1A1A]">{(remove.error as Error).message}</p>}
          </div>
        )}
      </article>
    </div>
  );
}
