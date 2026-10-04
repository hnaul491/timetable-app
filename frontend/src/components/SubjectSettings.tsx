import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useT } from "../i18n";
import { apiFetch } from "../lib/api";
import type { SubjectSummary } from "../types";

type Patch = Partial<Pick<SubjectSummary, "display_name" | "color" | "hidden">>;

export function SubjectSettings() {
  const t = useT();
  const queryClient = useQueryClient();
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: () => apiFetch<SubjectSummary[]>("/api/subjects") });
  const refresh = () => queryClient.invalidateQueries();
  const patch = useMutation({
    mutationFn: (v: { id: number; body: Patch }) => apiFetch(`/api/subjects/${v.id}`, { method: "PATCH", body: JSON.stringify(v.body) }),
    onSuccess: refresh,
  });
  const merge = useMutation({
    mutationFn: (v: { id: number; into: number }) => apiFetch(`/api/subjects/${v.id}/merge`, { method: "POST", body: JSON.stringify({ into_id: v.into }) }),
    onSuccess: refresh,
  });
  const error = (patch.error ?? merge.error) as Error | null;
  const all = subjects.data ?? [];
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-base font-bold">{t("settings.subjects.title")}</h2>
      <p className="text-sm text-muted">{t("settings.subjects.help")}</p>
      {all.map((s) => (
        <SubjectRow key={s.id} subject={s} others={all.filter((o) => o.id !== s.id)} onPatch={(body) => patch.mutate({ id: s.id, body })} onMerge={(into) => merge.mutate({ id: s.id, into })} />
      ))}
      {error && <p className="text-sm text-danger">{error.message}</p>}
    </section>
  );
}

function SubjectRow({ subject, others, onPatch, onMerge }: { subject: SubjectSummary; others: SubjectSummary[]; onPatch: (b: Patch) => void; onMerge: (into: number) => void }) {
  const t = useT();
  const [name, setName] = useState(subject.display_name);
  const [into, setInto] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [color, setColor] = useState(subject.color.toLowerCase());
  const [syncedColor, setSyncedColor] = useState(subject.color);
  if (syncedColor !== subject.color) {
    setSyncedColor(subject.color);
    setColor(subject.color.toLowerCase());
  }
  const target = others.some((o) => String(o.id) === into) ? into : "";
  const label = subject.display_name;
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5">
      <input type="color" aria-label={t("settings.subjects.colourOf", { name: label })} value={color} onChange={(e) => setColor(e.target.value)} onBlur={() => color.toLowerCase() !== subject.color.toLowerCase() && onPatch({ color })} className="size-8 rounded" />
      <input aria-label={t("settings.subjects.nameOf", { name: label })} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className="h-9 min-w-[200px] flex-1 rounded-lg border border-line-strong bg-surface px-2 text-sm" />
      <button type="button" aria-label={t("settings.subjects.saveNameOf", { name: label })} disabled={!name.trim() || name.trim() === subject.display_name} onClick={() => onPatch({ display_name: name.trim() })} className="h-9 rounded-lg border border-line bg-surface px-3 text-sm font-semibold disabled:opacity-50">
        {t("common.save")}
      </button>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" aria-label={t("settings.subjects.hideAria", { name: label })} checked={subject.hidden} onChange={(e) => onPatch({ hidden: e.target.checked })} />
        {t("settings.subjects.hide")}
      </label>
      <select aria-label={t("settings.subjects.mergeIntoAria", { name: label })} value={target} onChange={(e) => { setInto(e.target.value); setConfirm(false); }} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm">
        <option value="">{t("settings.subjects.mergeInto")}</option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            {o.display_name}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={confirm ? t("settings.subjects.mergeConfirmAria", { name: label }) : t("settings.subjects.mergeAria", { name: label })}
        disabled={!target}
        onClick={() => (confirm ? onMerge(Number(target)) : setConfirm(true))}
        onBlur={() => setConfirm(false)}
        className="h-9 rounded-lg px-3 text-sm font-semibold text-danger disabled:opacity-40"
      >
        {confirm ? t("settings.subjects.mergeConfirm") : t("settings.subjects.merge")}
      </button>
    </div>
  );
}
