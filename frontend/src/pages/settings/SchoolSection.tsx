import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ErrorPanel } from "../../components/Banners";
import { useConfirm } from "../../components/ui/Confirm";
import { useToast } from "../../components/ui/Toast";
import { RecurringList } from "../../components/RecurringList";
import { SemesterSettings } from "../../components/SemesterSettings";
import { useLocale, useT } from "../../i18n";
import { translateServerMessage } from "../../i18n/serverMessages";
import { apiFetch } from "../../lib/api";
import { formatTime, parisParts } from "../../lib/time";
import type { SectionChoice, Semester, SyncRun, SyncStatus } from "../../types";

interface GroupMismatch {
  link_group: number;
  semester_group: number;
}

const card = "flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5";
const primary = "h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-60";

export function SchoolSection() {
  const t = useT();
  const locale = useLocale();
  const statusLabel = (status: SyncRun["status"]) => t(`settings.syncStatus.${status}`);
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const keyStatus = useQuery({ queryKey: ["zeus-key"], queryFn: () => apiFetch<{ configured: boolean }>("/api/settings/zeus-key") });
  const sync = useQuery({ queryKey: ["sync-status"], queryFn: () => apiFetch<SyncStatus>("/api/sync/status") });
  const sections = useQuery({ queryKey: ["sections"], queryFn: () => apiFetch<SectionChoice[]>("/api/settings/sections") });
  const semesters = useQuery({ queryKey: ["semesters"], queryFn: () => apiFetch<Semester[]>("/api/semesters") });
  const [link, setLink] = useState("");
  const [mismatch, setMismatch] = useState<GroupMismatch | null>(null);

  const saveKey = useMutation({
    mutationFn: (value: string) =>
      apiFetch<{ configured: boolean; group_mismatch?: GroupMismatch | null }>("/api/settings/zeus-key", { method: "PUT", body: JSON.stringify({ value }) }),
    onSuccess: (data) => {
      setLink("");
      setMismatch(data?.group_mismatch ?? null);
      queryClient.invalidateQueries({ queryKey: ["zeus-key"] });
      toast.success(t("settings.zeus.keySaved"));
    },
    onError: (error, value) => toast.error(error.message, { retry: () => saveKey.mutate(value) }),
  });
  const activeSemester = semesters.data?.find((s) => s.is_active);
  const applyLinkGroup = useMutation({
    mutationFn: (v: { id: number; group: number }) =>
      apiFetch(`/api/semesters/${v.id}`, { method: "PATCH", body: JSON.stringify({ zeus_group_id: v.group }) }),
    onSuccess: () => {
      setMismatch(null);
      queryClient.invalidateQueries();
    },
    onError: (error, v) => toast.error(error.message, { retry: () => applyLinkGroup.mutate(v) }),
  });
  const syncNow = useMutation({
    mutationFn: () => apiFetch<SyncRun>("/api/sync", { method: "POST" }),
    onSuccess: (run) => {
      if (run.status === "ok" || run.status === "partial") toast.success(t("settings.zeus.syncDone", { count: run.fetched }));
      else toast.error(run.error ? translateServerMessage(run.error, locale) : t("settings.zeus.syncFailed"), { retry: () => syncNow.mutate() });
    },
    onError: (error) => toast.error(error.message, { retry: () => syncNow.mutate() }),
    onSettled: () => queryClient.invalidateQueries(),
  });
  const pick = useMutation({
    mutationFn: (body: { subject_id: number; section: string }) =>
      apiFetch("/api/settings/sections", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success(t("settings.groups.saved"));
    },
    onError: (error, body) => toast.error(error.message, { retry: () => pick.mutate(body) }),
  });
  const removeGroup = useMutation({
    mutationFn: (subjectId: number) => apiFetch(`/api/settings/sections/${subjectId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success(t("settings.groups.removed"));
    },
    onError: (error, subjectId) => toast.error(error.message, { retry: () => removeGroup.mutate(subjectId) }),
  });
  const askRemove = async (choice: SectionChoice) => {
    const ok = await confirm({
      title: t("settings.groups.removeTitle", { subject: choice.subject_name }),
      body: t("settings.groups.removeBody"),
      confirmLabel: t("settings.groups.removeConfirm"),
      tone: "danger",
    });
    if (ok) removeGroup.mutate(choice.subject_id);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (link.trim()) saveKey.mutate(link.trim());
  };

  const lastRun = sync.data?.last_run;
  const when = (iso: string | null | undefined) => (iso ? `${parisParts(iso).date} ${formatTime(iso)}` : t("common.never"));

  return (
    <div className="flex flex-col gap-4">
      {keyStatus.error && <ErrorPanel error={keyStatus.error} />}
      <section className={card}>
        <h3 className="text-base font-bold">{t("settings.zeus.title")}</h3>
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
          <p className="text-sm">{keyStatus.data?.configured ? t("settings.zeus.saved") : t("settings.zeus.notSaved")}</p>
        </form>
        {mismatch && (
          <div role="alert" className="flex flex-col gap-2 rounded-xl border border-warn-line bg-warn-soft px-3 py-2.5 text-sm text-warn">
            <p>{t("settings.zeus.groupMismatch", { link_group: mismatch.link_group, semester_group: mismatch.semester_group })}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!activeSemester || applyLinkGroup.isPending}
                onClick={() => activeSemester && applyLinkGroup.mutate({ id: activeSemester.id, group: mismatch.link_group })}
                className={primary}
              >
                {t("settings.zeus.useGroup", { group: mismatch.link_group })}
              </button>
              <button type="button" onClick={() => setMismatch(null)} className="h-10 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink">
                {t("settings.zeus.keepGroup", { group: mismatch.semester_group })}
              </button>
            </div>
          </div>
        )}
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
      </section>
      <SemesterSettings />
      <section className={card}>
        <h3 className="text-base font-bold">{t("settings.groups.title")}</h3>
        <p className="text-sm text-muted">{t("settings.groups.help")}</p>
        {sections.data?.length === 0 && <p className="text-sm">{t("settings.groups.none")}</p>}
        {sections.data?.map((choice) => (
          <div key={choice.subject_id} className="flex flex-wrap items-center justify-between gap-3 text-sm font-medium">
          <label htmlFor={`group-${choice.subject_id}`}>{choice.subject_name}</label>
          <div className="flex items-center gap-2">
            <select
              id={`group-${choice.subject_id}`}
              value={choice.chosen ?? ""}
              onChange={(e) => e.target.value && pick.mutate({ subject_id: choice.subject_id, section: e.target.value })}
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
            {choice.chosen !== null && (
              <button
                type="button"
                onClick={() => askRemove(choice)}
                disabled={removeGroup.isPending}
                aria-label={t("settings.groups.removeAria", { subject: choice.subject_name })}
                title={t("settings.groups.removeAria", { subject: choice.subject_name })}
                className="h-10 rounded-xl border border-line px-3 font-semibold text-danger hover:bg-subtle disabled:opacity-50"
              >
                {t("settings.groups.remove")}
              </button>
            )}
          </div>
          </div>
        ))}
      </section>
      <RecurringList />
    </div>
  );
}
