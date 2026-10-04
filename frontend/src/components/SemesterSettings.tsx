import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "../lib/api";
import type { Semester } from "../types";

export function SemesterSettings() {
  const queryClient = useQueryClient();
  const semesters = useQuery({ queryKey: ["semesters"], queryFn: () => apiFetch<Semester[]>("/api/semesters") });
  const refresh = () => queryClient.invalidateQueries();
  const save = useMutation({
    mutationFn: (v: { id: number; zeus_group_id: number | null }) =>
      apiFetch(`/api/semesters/${v.id}`, { method: "PATCH", body: JSON.stringify({ zeus_group_id: v.zeus_group_id }) }),
    onSuccess: refresh,
  });
  const activate = useMutation({ mutationFn: (id: number) => apiFetch(`/api/semesters/${id}/activate`, { method: "PUT" }), onSuccess: refresh });
  const error = (save.error ?? activate.error) as Error | null;
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-base font-bold">Semesters</h2>
      <p className="text-sm text-muted">Set each semester's Zeus group when you know it, then make it active to switch the whole app.</p>
      {semesters.data?.map((s) => <SemesterRow key={s.id} semester={s} onSave={(g) => save.mutate({ id: s.id, zeus_group_id: g })} onActivate={() => activate.mutate(s.id)} />)}
      {error && <p className="text-sm text-danger">{error.message}</p>}
    </section>
  );
}

function SemesterRow({ semester, onSave, onActivate }: { semester: Semester; onSave: (group: number | null) => void; onActivate: () => void }) {
  const [group, setGroup] = useState(semester.zeus_group_id?.toString() ?? "");
  return (
    <div className={`flex flex-wrap items-end gap-3 rounded-xl px-3 py-2.5 ${semester.is_active ? "bg-success-soft" : "bg-surface-2"}`}>
      <span className="flex min-w-[180px] flex-1 flex-col">
        <span className="text-sm font-semibold">{semester.name}</span>
        <span className="text-xs text-muted">{semester.is_active ? "Active" : "Not active"}</span>
      </span>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
        Zeus group
        <input
          aria-label={`Zeus group for ${semester.name}`}
          inputMode="numeric"
          value={group}
          onChange={(e) => setGroup(e.target.value.replace(/\D/g, ""))}
          className="h-9 w-24 rounded-lg border border-line-strong bg-surface px-2 text-sm text-ink"
        />
      </label>
      <button type="button" aria-label={`Save ${semester.name}`} onClick={() => onSave(group ? Number(group) : null)} className="h-9 rounded-lg border border-line bg-surface px-3 text-sm font-semibold">
        Save
      </button>
      {!semester.is_active && (
        <button type="button" aria-label={`Make ${semester.name} active`} onClick={onActivate} className="h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent">
          Make active
        </button>
      )}
    </div>
  );
}
