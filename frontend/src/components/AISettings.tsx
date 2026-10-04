import { useQuery } from "@tanstack/react-query";
import { useT } from "../i18n";
import { apiFetch } from "../lib/api";
import type { AiStatus } from "../types";
import { Skeleton } from "./ui/Skeleton";

const card = "flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5";

export function AISettings() {
  const t = useT();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => apiFetch<AiStatus>("/api/ai/status") });
  return (
    <section className={card}>
      <h2 className="text-base font-bold">{t("ai.settingsTitle")}</h2>
      {status.error && <p className="text-sm text-danger">{t("ai.statusFailed", { message: status.error.message })}</p>}
      {!status.data && !status.error && <Skeleton className="h-5 w-48" />}
      {status.data && <p className="text-sm font-semibold">{status.data.enabled ? t("ai.statusOn", { model: status.data.model ?? "" }) : t("ai.statusOff")}</p>}
      {status.data && !status.data.enabled && (
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
