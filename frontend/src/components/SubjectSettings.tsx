import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "../lib/api";
import type { SubjectSummary } from "../types";

type Patch = Partial<Pick<SubjectSummary, "display_name" | "color" | "hidden">>;

export function SubjectSettings() {
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
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-5">
      <h2 className="text-base font-bold">Subjects</h2>
      <p className="text-sm text-muted">Rename, recolour or hide subjects. "Merge into" combines duplicates (e.g. two names for the same French class); future syncs use the merged subject.</p>
      {all.map((s) => (
        <SubjectRow key={s.id} subject={s} others={all.filter((o) => o.id !== s.id)} onPatch={(body) => patch.mutate({ id: s.id, body })} onMerge={(into) => merge.mutate({ id: s.id, into })} />
      ))}
      {error && <p className="text-sm text-[#8B1A1A]">{error.message}</p>}
    </section>
  );
}

function SubjectRow({ subject, others, onPatch, onMerge }: { subject: SubjectSummary; others: SubjectSummary[]; onPatch: (b: Patch) => void; onMerge: (into: number) => void }) {
  const [name, setName] = useState(subject.display_name);
  const [into, setInto] = useState("");
  const [confirm, setConfirm] = useState(false);
  const label = subject.display_name;
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-xl bg-[#F8F9FB] px-3 py-2.5">
      <input type="color" aria-label={`Colour of ${label}`} value={subject.color.toLowerCase()} onChange={(e) => onPatch({ color: e.target.value })} className="size-8 rounded" />
      <input aria-label={`Name of ${label}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className="h-9 min-w-[200px] flex-1 rounded-lg border border-[#D5D9E0] bg-white px-2 text-sm" />
      <button type="button" aria-label={`Save name of ${label}`} disabled={!name.trim() || name.trim() === subject.display_name} onClick={() => onPatch({ display_name: name.trim() })} className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-semibold disabled:opacity-50">
        Save
      </button>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" aria-label={`Hide ${label}`} checked={subject.hidden} onChange={(e) => onPatch({ hidden: e.target.checked })} />
        Hide
      </label>
      <select aria-label={`Merge ${label} into`} value={into} onChange={(e) => { setInto(e.target.value); setConfirm(false); }} className="h-9 rounded-lg border border-[#D5D9E0] bg-white px-2 text-sm">
        <option value="">Merge into…</option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            {o.display_name}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={confirm ? `Click again to merge ${label}` : `Merge ${label}`}
        disabled={!into}
        onClick={() => (confirm ? onMerge(Number(into)) : setConfirm(true))}
        onBlur={() => setConfirm(false)}
        className="h-9 rounded-lg px-3 text-sm font-semibold text-[#8B1A1A] disabled:opacity-40"
      >
        {confirm ? "Click again to merge" : "Merge"}
      </button>
    </div>
  );
}
