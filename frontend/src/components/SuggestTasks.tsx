import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocale, useT } from "../i18n";
import { aiErrorText } from "../lib/aiError";
import { apiFetch } from "../lib/api";
import { invalidateTaskViews } from "../lib/invalidate";
import type { AiStatus, AiSuggestion, NoteTab } from "../types";
import { useToast } from "./ui/Toast";

/** "Suggest tasks" under the class note editor: the assistant proposes, the user adds. */
export function SuggestTasks({ eventId, subjectId, tab }: { eventId: number; subjectId: number | null; tab: NoteTab }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => apiFetch<AiStatus>("/api/ai/status") });
  const [items, setItems] = useState<AiSuggestion[] | null>(null);
  const enabled = status.data?.enabled === true;

  const suggest = useMutation({
    mutationFn: () => apiFetch<{ suggestions: AiSuggestion[] }>("/api/ai/suggest", { method: "POST", body: JSON.stringify({ event_id: eventId, tab, locale }) }),
    onSuccess: (data) => setItems(data.suggestions),
    onError: (error) => toast.error(t("ai.suggestFailed", { message: aiErrorText(error, t) }), { retry: () => suggest.mutate() }),
  });
  const add = useMutation({
    mutationFn: (s: AiSuggestion) =>
      apiFetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title: s.title, due_date: s.due_date ?? null, subject_id: subjectId, event_id: eventId }),
      }),
    onSuccess: (_data, s) => {
      setItems((all) => all && all.filter((x) => x !== s));
      invalidateTaskViews(queryClient);
      toast.success(t("ai.suggestAdded"));
    },
    onError: (error, s) => toast.error(t("ai.suggestAddFailed", { message: error.message }), { retry: () => add.mutate(s) }),
  });

  return (
    <section aria-label={t("ai.suggestTitle")} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!enabled || suggest.isPending}
          onClick={() => suggest.mutate()}
          className="h-10 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink-2 disabled:opacity-60"
        >
          {suggest.isPending ? t("ai.suggesting") : t("ai.suggest")}
        </button>
        {status.data && !enabled && <span className="text-xs text-muted">{t("ai.suggestOff")}</span>}
      </div>
      {items && items.length === 0 && <p className="text-sm text-muted">{t("ai.suggestNone")}</p>}
      {items && items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((s, i) => (
            <li key={`${i}-${s.title}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 break-words">{s.title}</span>
              {s.due_date && <span className="font-mono text-xs text-muted">{t("event.due", { date: s.due_date })}</span>}
              <button type="button" disabled={add.isPending} onClick={() => add.mutate(s)} className="h-9 rounded-lg bg-accent px-3 font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-60">
                {t("ai.add")}
              </button>
              <button type="button" onClick={() => setItems((all) => all && all.filter((x) => x !== s))} className="h-9 rounded-lg border border-line bg-surface px-3 font-semibold text-ink-2">
                {t("ai.dismiss")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
