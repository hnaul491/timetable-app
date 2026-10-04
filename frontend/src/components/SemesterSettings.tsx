import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useT } from "../i18n";
import { apiFetch } from "../lib/api";
import type { Semester } from "../types";
import { useConfirm } from "./ui/Confirm";
import { useToast } from "./ui/Toast";

export function SemesterSettings() {
  const t = useT();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const semesters = useQuery({ queryKey: ["semesters"], queryFn: () => apiFetch<Semester[]>("/api/semesters") });
  const refresh = () => queryClient.invalidateQueries();
  const save = useMutation({
    mutationFn: (v: { id: number; zeus_group_id: number | null }) =>
      apiFetch(`/api/semesters/${v.id}`, { method: "PATCH", body: JSON.stringify({ zeus_group_id: v.zeus_group_id }) }),
    onSuccess: () => {
      refresh();
      toast.success(t("settings.semesters.saved"));
    },
    onError: (error, v) => toast.error(error.message, { retry: () => save.mutate(v) }),
  });
  const activate = useMutation({
    mutationFn: (s: Semester) => apiFetch(`/api/semesters/${s.id}/activate`, { method: "PUT" }),
    onSuccess: (_data, s) => {
      refresh();
      toast.success(t("settings.semesters.activated", { name: s.name }));
    },
    onError: (error, s) => toast.error(error.message, { retry: () => activate.mutate(s) }),
  });
  const askSave = async (s: Semester, group: number | null) => {
    if (group === null && s.is_active && s.zeus_group_id !== null) {
      const ok = await confirm({
        title: t("settings.semesters.clearTitle", { name: s.name }),
        body: t("settings.semesters.clearBody"),
        confirmLabel: t("settings.semesters.clearConfirm"),
        tone: "danger",
      });
      if (!ok) return;
    }
    save.mutate({ id: s.id, zeus_group_id: group });
  };
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-base font-bold">{t("settings.semesters.title")}</h2>
      <p className="text-sm text-muted">{t("settings.semesters.help")}</p>
      {semesters.data?.map((s) => <SemesterRow key={s.id} semester={s} onSave={(g) => void askSave(s, g)} onActivate={() => activate.mutate(s)} />)}
    </section>
  );
}

function SemesterRow({ semester, onSave, onActivate }: { semester: Semester; onSave: (group: number | null) => void; onActivate: () => void }) {
  const t = useT();
  const [group, setGroup] = useState(semester.zeus_group_id?.toString() ?? "");
  return (
    <div className={`flex flex-wrap items-end gap-3 rounded-xl px-3 py-2.5 ${semester.is_active ? "bg-success-soft" : "bg-surface-2"}`}>
      <span className="flex min-w-[180px] flex-1 flex-col">
        <span className="text-sm font-semibold">{semester.name}</span>
        <span className="text-xs text-muted">{semester.is_active ? t("settings.semesters.active") : t("settings.semesters.notActive")}</span>
      </span>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
        {t("settings.semesters.zeusGroup")}
        <input
          aria-label={t("settings.semesters.zeusGroupFor", { name: semester.name })}
          inputMode="numeric"
          value={group}
          onChange={(e) => setGroup(e.target.value.replace(/\D/g, ""))}
          className="h-9 w-24 rounded-lg border border-line-strong bg-surface px-2 text-sm text-ink"
        />
      </label>
      <button type="button" aria-label={t("settings.semesters.saveAria", { name: semester.name })} onClick={() => onSave(group ? Number(group) : null)} className="h-9 rounded-lg border border-line bg-surface px-3 text-sm font-semibold">
        {t("common.save")}
      </button>
      {!semester.is_active && (
        <button type="button" aria-label={t("settings.semesters.makeActiveAria", { name: semester.name })} onClick={onActivate} className="h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent">
          {t("settings.semesters.makeActive")}
        </button>
      )}
    </div>
  );
}
