import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocale, useT } from "../i18n";
import { apiFetch } from "../lib/api";
import { formatSize } from "../lib/documents";
import { dayLabel, formatLongDate, formatTime, parisParts } from "../lib/time";
import { MAX_FILE_BYTES, uploadFile } from "../lib/upload";
import type { DocumentTag, SubjectDetail } from "../types";
import { Dialog } from "./ui/Dialog";
import { useToast } from "./ui/Toast";

interface Item {
  key: number;
  file: File;
  status: "ready" | "uploading" | "done" | "error" | "cancelled";
  sent: number;
  error?: string;
}

const field = "h-10 rounded-xl border border-line bg-surface px-3 text-sm text-ink";

export function UploadDialog({ open, onClose, subjectId, eventId }: { open: boolean; onClose: () => void; subjectId: number; eventId: number | null }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ["subject", String(subjectId)], queryFn: () => apiFetch<SubjectDetail>(`/api/subjects/${subjectId}`), enabled: open });
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [classId, setClassId] = useState<string>(eventId === null ? "" : String(eventId));
  const [tag, setTag] = useState<DocumentTag>("slides");
  const [busy, setBusy] = useState(false);
  const nextKey = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const abort = () => controller.current?.abort();
  const patch = (key: number, change: Partial<Item>) => setItems((all) => all.map((item) => (item.key === key ? { ...item, ...change } : item)));

  const add = (list: FileList | null) => {
    if (!list) return;
    const files = [...list];
    setRejected(files.filter((f) => f.size > MAX_FILE_BYTES).map((f) => t("documents.tooLarge", { name: f.name })));
    setItems((all) => [
      ...all,
      ...files.filter((f) => f.size <= MAX_FILE_BYTES).map((file) => ({ key: nextKey.current++, file, status: "ready" as const, sent: 0 })),
    ]);
  };

  const start = async () => {
    setBusy(true);
    const run = new AbortController();
    controller.current = run;
    let ok = 0;
    let failed = 0;
    const todo = items.filter((i) => i.status !== "done");
    for (const [index, item] of todo.entries()) {
      patch(item.key, { status: "uploading", sent: 0, error: undefined });
      try {
        await uploadFile(item.file, { subjectId, eventId: classId === "" ? null : Number(classId), tag }, (sent) => patch(item.key, { sent }), run.signal);
        patch(item.key, { status: "done", sent: item.file.size });
        ok += 1;
      } catch (error) {
        if (run.signal.aborted) {
          for (const rest of todo.slice(index)) patch(rest.key, { status: "cancelled" });
          break;
        }
        const message = error instanceof Error ? error.message : String(error);
        patch(item.key, { status: "error", error: message });
        toast.error(t("documents.uploadFailed", { name: item.file.name, message }));
        failed += 1;
      }
    }
    setBusy(false);
    if (controller.current === run) controller.current = null;
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    if (ok > 0) toast.success(t("documents.uploaded", { count: ok }));
    if (failed === 0 && ok > 0 && !run.signal.aborted) {
      setItems([]);
      onClose();
    }
  };

  const pending = items.some((i) => i.status !== "done");
  return (
    <Dialog
      open={open}
      onClose={() => {
        abort();
        onClose();
      }}
      title={t("documents.uploadTitle")}
      footer={
        <>
          <button type="button" onClick={() => (busy ? abort() : onClose())} className="h-10 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink">
            {t("documents.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !pending}
            onClick={start}
            className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-50"
          >
            {busy ? t("documents.uploading") : t("documents.start")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            {t("documents.classLabel")}
            <select value={classId} disabled={busy} onChange={(e) => setClassId(e.target.value)} className={field}>
              <option value="">{t("documents.wholeSubject")}</option>
              {detail.data?.sessions.map((s) => {
                const day = parisParts(s.start).date;
                return (
                  <option key={s.id} value={String(s.id)}>
                    {dayLabel(day, locale).weekday} {formatLongDate(day, locale)} · {formatTime(s.start)}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            {t("documents.tagLabel")}
            <select value={tag} disabled={busy} onChange={(e) => setTag(e.target.value as DocumentTag)} className={field}>
              <option value="slides">{t("documents.filterSlides")}</option>
              <option value="exercises">{t("documents.filterExercises")}</option>
              <option value="other">{t("documents.filterOther")}</option>
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          {t("documents.files")}
          <input
            type="file"
            multiple
            disabled={busy}
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
            className="text-sm text-ink"
          />
        </label>
        {rejected.map((message) => (
          <p key={message} role="alert" className="text-sm text-danger">
            {message}
          </p>
        ))}
        {items.length === 0 && <p className="text-sm text-muted">{t("documents.noneChosen")}</p>}
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const pct = item.file.size ? Math.round((item.sent / item.file.size) * 100) : item.status === "done" ? 100 : 0;
            return (
              <li key={item.key} className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-sm">
                  <span className="mr-auto truncate font-semibold">{item.file.name}</span>
                  <span className="shrink-0 font-mono text-xs text-muted">{formatSize(item.file.size, locale)}</span>
                  {item.status === "done" && <span className="text-xs font-semibold text-success">{t("documents.done")}</span>}
                  {item.status === "error" && <span className="text-xs font-semibold text-danger">{t("documents.failed")}</span>}
                  {item.status === "cancelled" && <span className="text-xs font-semibold text-muted">{t("documents.cancelled")}</span>}
                </span>
                {(item.status === "uploading" || item.status === "done") && (
                  <div role="progressbar" aria-label={item.file.name} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-subtle">
                    <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                )}
                {item.error && <span className="text-xs text-danger">{item.error}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}
