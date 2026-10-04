import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useT } from "../i18n";
import { apiFetch } from "../lib/api";
import type { AiStatus } from "../types";
import { Skeleton } from "./ui/Skeleton";
import { useToast } from "./ui/Toast";

const card = "flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5";

export function AISettings() {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => apiFetch<AiStatus>("/api/ai/status") });
  const save = useMutation({
    mutationFn: (body: { model?: string; auto_fallback?: boolean }) =>
      apiFetch<AiStatus>("/api/ai/settings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: (saved) => {
      toast.success(t("ai.settingsSaved"));
      queryClient.setQueryData(["ai-status"], saved); // the PUT answers with the new status: no snap-back while refetching
    },
    onError: (error) => toast.error(t("ai.settingsFailed", { message: error.message })),
  });
  const notes = { best: t("ai.noteBest"), fastest: t("ai.noteFastest") };
  const optionText = (m: NonNullable<AiStatus["models"]>[number]) => {
    const parts = [m.label];
    if (m.note_key) parts.push(` — ${notes[m.note_key]}`);
    if (m.available === false) parts.push(` (${t("ai.modelUnavailable")})`);
    return parts.join("");
  };
  const data = status.data;
  return (
    <section className={card}>
      <h2 className="text-base font-bold">{t("ai.settingsTitle")}</h2>
      {status.error && <p className="text-sm text-danger">{t("ai.statusFailed", { message: status.error.message })}</p>}
      {!data && !status.error && <Skeleton className="h-5 w-48" />}
      {data && <p className="text-sm font-semibold">{data.enabled ? t("ai.statusOn", { model: data.model ?? "" }) : t("ai.statusOff")}</p>}
      {data && data.enabled && data.models && (
        <>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {t("ai.modelLabel")}
            <select
              value={data.model ?? ""}
              disabled={save.isPending}
              onChange={(e) => save.mutate({ model: e.target.value })}
              className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-normal"
            >
              {data.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {optionText(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={data.auto_fallback ?? true}
              disabled={save.isPending}
              onChange={(e) => save.mutate({ auto_fallback: e.target.checked })}
            />
            {t("ai.autoFallback")}
          </label>
          <p className="text-xs text-muted">{t("ai.modelHelp")}</p>
        </>
      )}
      {data && !data.enabled && (
        <>
          <p className="text-sm text-ink-2">{t("ai.enableHelp")}</p>
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-sm font-semibold text-accent">
            {t("ai.getKey")}
          </a>
        </>
      )}
      <p className="text-xs text-muted">{t("ai.privacy")}</p>
    </section>
  );
}
