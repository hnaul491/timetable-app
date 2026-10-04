import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useT } from "../i18n";
import { translateServerMessage } from "../i18n/serverMessages";
import { apiFetch, authHeaders, toApiError } from "../lib/api";
import { formatLongDate, parisParts } from "../lib/time";
import { useToast } from "./ui/Toast";

const card = "flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5";
const primary = "h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-60";
const secondary = "h-10 rounded-xl border border-line bg-surface px-4 text-sm font-semibold disabled:opacity-60";

interface BackupStatus {
  drive_available: boolean;
  last_at: string | null;
}

function fileName(response: Response): string {
  const match = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "");
  return match ? match[1] : "timetable-backup.json";
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function BackupSettings() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["backup"], queryFn: () => apiFetch<BackupStatus>("/api/backup/status") });

  const download = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/backup", { headers: await authHeaders() });
      if (!response.ok) throw await toApiError(response);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName(response);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onSuccess: () => toast.success(t("backup.downloaded")),
    onError: (error) => toast.error(t("backup.downloadFailed", { error: translateServerMessage(message(error), locale) })),
  });
  const drive = useMutation({
    mutationFn: () => apiFetch<{ file_name: string }>("/api/backup/drive", { method: "POST" }),
    onSuccess: (result) => {
      toast.success(t("backup.driveDone", { name: result.file_name }));
      void queryClient.invalidateQueries({ queryKey: ["backup"] });
    },
    onError: (error) => toast.error(t("backup.driveFailed", { error: translateServerMessage(message(error), locale) })),
  });

  const available = status.data?.drive_available === true;
  const last = status.data?.last_at;
  return (
    <section className={card}>
      <h3 className="text-base font-bold">{t("backup.title")}</h3>
      <p className="text-sm text-muted">{t("backup.help")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={download.isPending} onClick={() => download.mutate()}>
          {download.isPending ? t("backup.downloading") : t("backup.download")}
        </button>
        <button type="button" className={secondary} disabled={!available || drive.isPending} onClick={() => drive.mutate()}>
          {drive.isPending ? t("backup.driving") : t("backup.drive")}
        </button>
      </div>
      {status.isError && <p className="text-sm text-danger">{t("backup.statusFailed", { error: message(status.error) })}</p>}
      {status.data && !available && <p className="text-sm text-muted">{t("backup.needDrive")}</p>}
      {status.data && (
        <p className="text-sm text-muted">
          {last ? t("backup.lastAt", { date: formatLongDate(parisParts(last).date, locale) }) : t("backup.never")}
        </p>
      )}
    </section>
  );
}
