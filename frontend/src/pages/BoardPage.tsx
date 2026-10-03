import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { apiFetch } from "../lib/api";
import { invalidateTaskViews } from "../lib/invalidate";
import type { Task, TaskStatus } from "../types";

const COLUMNS: { status: TaskStatus; label: string; dot: string }[] = [
  { status: "todo", label: "To do", dot: "#8A90A0" },
  { status: "doing", label: "Doing", dot: "#2E55E6" },
  { status: "done", label: "Done", dot: "#1F8A4C" },
];
const field = "h-10 rounded-xl border border-[#D5D9E0] bg-white px-3 text-sm";

export function BoardPage() {
  const queryClient = useQueryClient();
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => apiFetch<Task[]>("/api/tasks") });
  const [subject, setSubject] = useState("all");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");

  const refresh = () => invalidateTaskViews(queryClient);
  const move = useMutation({
    mutationFn: (v: { id: number; status: TaskStatus }) =>
      apiFetch(`/api/tasks/${v.id}`, { method: "PATCH", body: JSON.stringify({ status: v.status }) }),
    onSuccess: refresh,
  });
  const add = useMutation({
    mutationFn: () => apiFetch("/api/tasks", { method: "POST", body: JSON.stringify({ title: title.trim(), due_date: due || null }) }),
    onSuccess: () => {
      setTitle("");
      setDue("");
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: number) => apiFetch(`/api/tasks/${id}`, { method: "DELETE" }), onSuccess: refresh });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) add.mutate();
  };

  if (tasks.error && !tasks.data) return <ErrorPanel error={tasks.error} onRetry={() => tasks.refetch()} />;
  if (!tasks.data) return <p className="text-sm text-muted">Loading tasks…</p>;
  const all = tasks.data;
  const subjects = [...new Set(all.map((t) => t.subject_name).filter((s): s is string => Boolean(s)))].sort();
  const visible = all.filter((t) => subject === "all" || t.subject_name === subject);
  const mutationError = (move.error ?? add.error ?? remove.error) as Error | null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold tracking-tight">Task board</h1>
          <p className="text-sm text-muted">{all.filter((t) => t.status !== "done").length} open · tasks come from [ ] lines in your class notes</p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Subject
          <select aria-label="Subject" className={field} value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="all">All subjects</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </header>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-white p-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs font-semibold text-muted">
          New task
          <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder="e.g. Print the lab sheet" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Due
          <input type="date" className={field} value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <button type="submit" disabled={add.isPending} className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50">
          Add task
        </button>
      </form>
      {mutationError && <p className="text-sm text-[#8B1A1A]">{mutationError.message}</p>}
      {tasks.error && tasks.data && <ErrorPanel error={tasks.error} onRetry={() => tasks.refetch()} />}

      <div className="grid items-start gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const cards = visible.filter((t) => t.status === col.status);
          return (
            <section key={col.status} aria-label={col.label} className="flex flex-col gap-2.5 rounded-2xl bg-[#EBEDF1] p-3">
              <h2 className="flex items-center gap-2 px-1 text-sm font-bold">
                <span className="size-2.5 rounded-full" style={{ background: col.dot }} />
                {col.label}
                <span className="rounded-full bg-white px-2 text-xs font-semibold text-[#3A3F4B]">{cards.length}</span>
              </h2>
              {cards.map((t) => (
                <TaskCard key={t.id} task={t} pending={move.isPending && move.variables?.id === t.id} onMove={(status) => move.mutate({ id: t.id, status })} onDelete={() => remove.mutate(t.id)} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard({ task, pending, onMove, onDelete }: { task: Task; pending: boolean; onMove: (s: TaskStatus) => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#E1E4EA] bg-white p-3">
      <div className="flex flex-wrap gap-1.5">
        {task.subject_name && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-semibold text-accent-strong">{task.subject_name}</span>}
        {task.important && <span className="rounded-full bg-[#FFF1E0] px-2 py-0.5 text-[11.5px] font-bold text-[#7C2D12]">Important</span>}
      </div>
      <p className={`text-[14.5px] font-semibold ${task.status === "done" ? "text-muted line-through" : ""}`}>{task.title}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="font-mono">{task.due_date ? `Due ${task.due_date}` : "No due date"}</span>
        {task.event_id !== null && (
          <Link to={`/events/${task.event_id}`} className="font-semibold text-accent">
            From class
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`Status for ${task.title}`}
          value={task.status}
          disabled={pending}
          onChange={(e) => onMove(e.target.value as TaskStatus)}
          className="h-9 rounded-lg border border-[#D5D9E0] bg-white px-2 text-sm"
        >
          {COLUMNS.map((c) => (
            <option key={c.status} value={c.status}>
              {c.label}
            </option>
          ))}
        </select>
        {task.source === "manual" && (
          <button
            type="button"
            aria-label={confirm ? `Click again to delete ${task.title}` : `Delete ${task.title}`}
            onClick={() => (confirm ? onDelete() : setConfirm(true))}
            onBlur={() => setConfirm(false)}
            className="h-9 rounded-lg px-2 text-sm font-semibold text-[#8B1A1A]"
          >
            {confirm ? "Click again to delete" : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
}
