import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ErrorPanel } from "../components/Banners";
import { GoogleSettings } from "../components/GoogleSettings";
import { AppearanceSettings } from "../components/AppearanceSettings";
import { RecurringList } from "../components/RecurringList";
import { SemesterSettings } from "../components/SemesterSettings";
import { SubjectSettings } from "../components/SubjectSettings";
import { useLocale, useT } from "../i18n";
import { translateServerMessage } from "../i18n/serverMessages";
import { apiFetch } from "../lib/api";
import { formatTime, parisParts } from "../lib/time";
import type { SectionChoice, SyncRun, SyncStatus } from "../types";

const card = "flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5";
const primary = "h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-60";

export function SettingsPage() {
  const t = useT();
  const locale = useLocale();
  const statusLabel = (status: SyncRun["status"]) => t(`settings.syncStatus.${status}`);
  const queryClient = useQueryClient();
  const keyStatus = useQuery({ queryKey: ["zeus-key"], queryFn: () => apiFetch<{ configured: boolean }>("/api/settings/zeus-key") });
  const sync = useQuery({ queryKey: ["sync-status"], queryFn: () => apiFetch<SyncStatus>("/api/sync/status") });
  const sections = useQuery({ queryKey: ["sections"], queryFn: () => apiFetch<SectionChoice[]>("/api/settings/sections") });
  const [link, setLink] = useState("");

  const saveKey = useMutation({
    mutationFn: (value: string) => apiFetch("/api/settings/zeus-key", { method: "PUT", body: JSON.stringify({ value }) }),
    onSuccess: () => {
      setLink("");
      queryClient.invalidateQueries({ queryKey: ["zeus-key"] });
    },
  });
  const syncNow = useMutation({
    mutationFn: () => apiFetch<SyncRun>("/api/sync", { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries(),
  });
  const pick = useMutation({
    mutationFn: (body: { subject_id: number; section: string }) =>
      apiFetch("/api/settings/sections", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (link.trim()) saveKey.mutate(link.trim());
  };

  const lastRun = sync.data?.last_run;
  const when = (iso: string | null | undefined) => (iso ? `${parisParts(iso).date} ${formatTime(iso)}` : t("common.never"));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
      {keyStatus.error && <ErrorPanel error={keyStatus.error} />}
      <AppearanceSettings />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="text-base font-bold">{t("settings.zeus.title")}</h2>
          <form onSubmit={submit} className="flex flex-col gap-2">
            <label htmlFor="zeus-link" className="text-sm font-semibold text-ink-2">
              {t("settings.zeus.linkLabel")}
            </label>
            <div className="flex gap-2">
              <input
                id="zeus-link"
                type="password"
                autoComplete="off"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder={keyStatus.data?.configured ? t("settings.zeus.placeholderSaved") : "https://zeus.ionis-it.com/api/group/…/ics/…"}
                className="h-10 min-w-0 flex-1 rounded-xl border border-line-strong px-3 text-sm"
              />
              <button type="submit" className={primary} disabled={saveKey.isPending}>
                {t("common.save")}
              </button>
            </div>
            <p className="text-xs text-muted">
              {t("settings.zeus.help")}
            </p>
            {saveKey.error && <p className="text-sm text-danger">{(saveKey.error as Error).message}</p>}
            <p className="text-sm">{keyStatus.data?.configured ? t("settings.zeus.saved") : t("settings.zeus.notSaved")}</p>
          </form>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
            <span>
              {t("settings.zeus.lastSync", { value: lastRun ? `${statusLabel(lastRun.status)} · ${when(lastRun.finished_at)}` : t("common.never") })}
              {lastRun?.status === "ok" &&
                ` · ${t("settings.zeus.syncCounts", { fetched: lastRun.fetched, inserted: lastRun.inserted, updated: lastRun.updated, cancelled: lastRun.cancelled })}`}
              {lastRun?.error && ` · ${translateServerMessage(lastRun.error, locale)}`}
            </span>
            <button type="button" className={primary} onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
              {syncNow.isPending ? t("settings.zeus.syncing") : t("settings.zeus.syncNow")}
            </button>
          </div>
          {syncNow.error && <p className="text-sm text-danger">{(syncNow.error as Error).message}</p>}
        </section>
        <section className={card}>
          <h2 className="text-base font-bold">{t("settings.groups.title")}</h2>
          <p className="text-sm text-muted">{t("settings.groups.help")}</p>
          {pick.error && <p className="text-sm text-danger">{(pick.error as Error).message}</p>}
          {sections.data?.length === 0 && <p className="text-sm">{t("settings.groups.none")}</p>}
          {sections.data?.map((choice) => (
            <label key={choice.subject_id} className="flex flex-wrap items-center justify-between gap-3 text-sm font-medium">
              {choice.subject_name}
              <select
                value={choice.chosen ?? ""}
                onChange={(e) => pick.mutate({ subject_id: choice.subject_id, section: e.target.value })}
                className="h-10 min-w-[120px] rounded-xl border border-line-strong bg-surface px-2.5 font-semibold"
              >
                {choice.chosen === null && (
                  <option value="" disabled>
                    {t("settings.groups.choose")}
                  </option>
                )}
                <option value="ALL">{t("settings.groups.all")}</option>
                {choice.sections.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </section>
      </div>
      <RecurringList />
      <SemesterSettings />
      <SubjectSettings />
      <GoogleSettings />
    </div>
  );
}
