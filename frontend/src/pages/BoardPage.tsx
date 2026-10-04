import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { ErrorPanel } from "../components/Banners";
import { useConfirm } from "../components/ui/Confirm";
import { Skeleton } from "../components/ui/Skeleton";
import { useToast } from "../components/ui/Toast";
import { apiFetch } from "../lib/api";
import { useT, type MessageKey } from "../i18n";
import { invalidateTaskViews } from "../lib/invalidate";
import type { Task, TaskStatus } from "../types";

const COLUMNS: { status: TaskStatus; label: MessageKey; dot: string }[] = [
  { status: "todo", label: "board.todo", dot: "#8A90A0" },
  { status: "doing", label: "board.doing", dot: "#2E55E6" },
  { status: "done", label: "board.done", dot: "#1F8A4C" },
];
const field = "h-10 rounded-xl border border-line-strong bg-surface px-3 text-sm";

export function BoardPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => apiFetch<Task[]>("/api/tasks") });
  const [subject, setSubject] = useState("all");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  // "/board?new=1" (quick-action menu) focuses the new-task input once, then drops the param.
  const [params, setParams] = useSearchParams();
  const titleInput = useRef<HTMLInputElement>(null);
  const wantsNew = params.get("new") === "1";
  const ready = Boolean(tasks.data);
  useEffect(() => {
    if (!wantsNew || !ready) return;
    titleInput.current?.focus();
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("new");
      return next;
    }, { replace: true });
  }, [wantsNew, ready, setParams]);

  const refresh = () => invalidateTaskViews(queryClient);
  const move = useMutation({
    mutationFn: (v: { id: number; status: TaskStatus }) =>
      apiFetch(`/api/tasks/${v.id}`, { method: "PATCH", body: JSON.stringify({ status: v.status }) }),
    onSuccess: (_data, v) => {
      refresh();
      toast.success(t("board.toast.moved", { column: t(COLUMNS.find((c) => c.status === v.status)?.label ?? "board.todo") }));
    },
    onError: (error, v) => toast.error(error.message, { retry: () => move.mutate(v) }),
  });
  const add = useMutation({
    mutationFn: (v: { title: string; due: string }) => apiFetch("/api/tasks", { method: "POST", body: JSON.stringify({ title: v.title, due_date: v.due || null }) }),
    onSuccess: () => {
      setTitle("");
      setDue("");
      refresh();
      toast.success(t("board.toast.added"));
    },
    onError: (error, v) => toast.error(error.message, { retry: () => add.mutate(v) }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      toast.success(t("board.toast.deleted"));
    },
    onError: (error, id) => toast.error(error.message, { retry: () => remove.mutate(id) }),
  });
  const askDelete = async (task: Task) => {
    if (await confirm({ title: t("board.deleteTitle", { title: task.title }), confirmLabel: t("common.delete"), tone: "danger" })) remove.mutate(task.id);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) add.mutate({ title: title.trim(), due });
  };

  if (tasks.error && !tasks.data) return <ErrorPanel error={tasks.error} onRetry={() => tasks.refetch()} />;
  if (!tasks.data)
    return (
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">{t("board.loading")}</span>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-16 w-full" />
        <div aria-hidden="true" className="grid items-start gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => (
            <div key={col.status} className="flex flex-col gap-2.5 rounded-2xl bg-subtle p-3">
              <Skeleton className="h-5 w-24 bg-surface" />
              <Skeleton className="h-28 w-full bg-surface" />
              <Skeleton className="h-28 w-full bg-surface" />
            </div>
          ))}
        </div>
      </div>
    );
  const all = tasks.data;
  const subjects = [...new Set(all.map((t) => t.subject_name).filter((s): s is string => Boolean(s)))].sort();
  const visible = all.filter((t) => subject === "all" || t.subject_name === subject);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold tracking-tight">{t("board.title")}</h1>
          <p className="text-sm text-muted">{t("board.openSummary", { count: all.filter((x) => x.status !== "done").length })}</p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          {t("board.subject")}
          <select aria-label={t("board.subject")} className={field} value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="all">{t("board.allSubjects")}</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </header>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs font-semibold text-muted">
          {t("board.newTask")}
          <input ref={titleInput} className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder={t("board.newTaskPlaceholder")} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          {t("board.due")}
          <input type="date" className={field} value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <button type="submit" disabled={add.isPending} className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-50">
          {t("board.addTask")}
        </button>
      </form>
      {tasks.error && tasks.data && <ErrorPanel error={tasks.error} onRetry={() => tasks.refetch()} />}

      <div className="grid items-start gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const cards = visible.filter((t) => t.status === col.status);
          return (
            <section key={col.status} aria-label={t(col.label)} className="flex flex-col gap-2.5 rounded-2xl bg-subtle p-3">
              <h2 className="flex items-center gap-2 px-1 text-sm font-bold">
                <span className="size-2.5 rounded-full" style={{ background: col.dot }} />
                {t(col.label)}
                <span className="rounded-full bg-surface px-2 text-xs font-semibold text-ink-2">{cards.length}</span>
              </h2>
              {cards.map((t) => (
                <TaskCard key={t.id} task={t} pending={move.isPending && move.variables?.id === t.id} onMove={(status) => move.mutate({ id: t.id, status })} onDelete={() => void askDelete(t)} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard({ task, pending, onMove, onDelete }: { task: Task; pending: boolean; onMove: (s: TaskStatus) => void; onDelete: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap gap-1.5">
        {task.subject_name && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-semibold text-accent-strong">{task.subject_name}</span>}
        {task.important && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11.5px] font-bold text-warn">{t("board.card.important")}</span>}
      </div>
      <p className={`text-[14.5px] font-semibold ${task.status === "done" ? "text-muted line-through" : ""}`}>{task.title}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="font-mono">{task.due_date ? t("board.card.due", { date: task.due_date }) : t("board.card.noDueDate")}</span>
        {task.event_id !== null && (
          <Link to={`/events/${task.event_id}`} className="font-semibold text-accent">
            {t("board.card.fromClass")}
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t("board.card.statusFor", { title: task.title })}
          value={task.status}
          disabled={pending}
          onChange={(e) => onMove(e.target.value as TaskStatus)}
          className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm"
        >
          {COLUMNS.map((c) => (
            <option key={c.status} value={c.status}>
              {t(c.label)}
            </option>
          ))}
        </select>
        {task.source === "manual" && (
          <button
            type="button"
            aria-label={t("board.card.deleteAria", { title: task.title })}
            onClick={onDelete}
            className="h-9 rounded-lg px-2 text-sm font-semibold text-danger"
          >
            {t("common.delete")}
          </button>
        )}
      </div>
    </div>
  );
}
