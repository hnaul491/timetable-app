import { useQuery } from "@tanstack/react-query";
import { useLocale, useT } from "../../i18n";
import { apiFetch } from "../../lib/api";
import { useTheme } from "../../lib/theme";
import { formatLongDate, parisParts } from "../../lib/time";
import type { AiStatus, GoogleStatus, SubjectSummary, SyncStatus } from "../../types";
import { STALE_AFTER_MS } from "../../components/Banners";
import type { SectionId } from "./sections";

export type Dot = "ok" | "warn" | "none";
export type SectionStatus = { text: string; dot: Dot };

interface BackupStatus {
  drive_available: boolean;
  last_at: string | null;
}

/** One-line status per section, built from queries the section cards already use (same keys, so nothing is fetched twice). */
export function useSettingsStatus(now: Date = new Date()): Record<SectionId, SectionStatus> {
  const t = useT();
  const locale = useLocale();
  const [theme] = useTheme();
  const key = useQuery({ queryKey: ["zeus-key"], queryFn: () => apiFetch<{ configured: boolean }>("/api/settings/zeus-key") });
  const sync = useQuery({ queryKey: ["sync-status"], queryFn: () => apiFetch<SyncStatus>("/api/sync/status") });
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: () => apiFetch<SubjectSummary[]>("/api/subjects") });
  const google = useQuery({ queryKey: ["google"], queryFn: () => apiFetch<GoogleStatus>("/api/google") });
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => apiFetch<AiStatus>("/api/ai/status") });
  const backup = useQuery({ queryKey: ["backup"], queryFn: () => apiFetch<BackupStatus>("/api/backup/status") });

  const ago = (iso: string) => {
    const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
    if (minutes < 1) return t("settings.status.justNow");
    if (minutes < 60) return t("settings.status.minutesAgo", { count: minutes });
    if (minutes < 48 * 60) return t("settings.status.hoursAgo", { count: Math.floor(minutes / 60) });
    return t("settings.status.daysAgo", { count: Math.floor(minutes / 1440) });
  };

  const general: SectionStatus = {
    text: `${t(`settings.appearance.themes.${theme}`)} · ${locale === "vi" ? "Tiếng Việt" : "English"}`,
    dot: "none",
  };

  let school: SectionStatus = { text: "", dot: "none" };
  const run = sync.data?.last_run;
  if (key.isError) school = { text: t("settings.status.needsAttention"), dot: "warn" };
  else if (key.data && key.data.configured === false) school = { text: t("settings.status.addLink"), dot: "warn" };
  else if (sync.data) {
    const last = sync.data.last_success_at ?? (run?.status === "ok" ? run.finished_at : null);
    if (run && (run.status === "failed" || run.status === "auth_failed")) school = { text: t("settings.status.syncFailed"), dot: "warn" };
    else if (run?.status === "partial") school = { text: t("settings.status.needsAttention"), dot: "warn" };
    else if (last && now.getTime() - new Date(last).getTime() > STALE_AFTER_MS) school = { text: t("settings.status.needsAttention"), dot: "warn" };
    else if (last) school = { text: t("settings.status.synced", { when: ago(last) }), dot: "ok" };
    else school = { text: t("settings.status.neverSynced"), dot: "none" };
  }

  const list = Array.isArray(subjects.data) ? subjects.data : null;
  const subjectsStatus: SectionStatus = list
    ? { text: t("settings.status.subjects", { count: list.length, hidden: list.filter((s) => s.hidden).length }), dot: "none" }
    : { text: "", dot: "none" };

  const g = google.data;
  const googleStatus: SectionStatus = !g
    ? { text: "", dot: "none" }
    : g.connected && g.needs_reconnect
      ? { text: t("settings.status.googleReconnect"), dot: "warn" }
      : g.connected
        ? { text: t("settings.status.googleConnected"), dot: "ok" }
        : { text: t("settings.status.googleNone"), dot: "none" };

  const a = ai.data;
  const aiStatus: SectionStatus = !a
    ? { text: "", dot: "none" }
    : a.enabled
      ? { text: a.models?.find((m) => m.id === a.model)?.label ?? a.model ?? "", dot: "none" }
      : { text: t("settings.status.aiOff"), dot: "none" };

  const b = backup.data;
  const backupStatus: SectionStatus = !b
    ? { text: "", dot: "none" }
    : b.drive_available !== true
      ? { text: t("settings.status.backupDownloadOnly"), dot: "none" }
      : b.last_at
        ? { text: t("backup.lastAt", { date: formatLongDate(parisParts(b.last_at).date, locale) }), dot: "ok" }
        : { text: t("settings.status.backupNever"), dot: "none" };

  return { general, school, subjects: subjectsStatus, google: googleStatus, ai: aiStatus, backup: backupStatus };
}
