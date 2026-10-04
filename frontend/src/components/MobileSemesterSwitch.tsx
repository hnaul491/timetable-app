import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useT } from "../i18n";
import { apiFetch } from "../lib/api";
import type { Semester } from "../types";

/** Compact semester select for phones, where the sidebar (and its select) is hidden. */
export function MobileSemesterSwitch() {
  const t = useT();
  const queryClient = useQueryClient();
  const semesters = useQuery({ queryKey: ["semesters"], queryFn: () => apiFetch<Semester[]>("/api/semesters") });
  const switchSemester = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/semesters/${id}/activate`, { method: "PUT" }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  if (!semesters.data || semesters.data.length === 0) return null;
  const active = semesters.data.find((s) => s.is_active);
  return (
    <div data-mobile-only className="md:hidden">
      <select
        aria-label={t("nav.semester")}
        value={active?.id ?? ""}
        onChange={(e) => switchSemester.mutate(Number(e.target.value))}
        className="h-10 w-full rounded-xl border border-line bg-surface-2 px-2.5 text-sm font-semibold text-ink"
      >
        {!active && (
          <option value="" disabled>
            {t("nav.selectSemester")}
          </option>
        )}
        {semesters.data.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {switchSemester.error && <p role="alert" className="mt-1 text-xs text-danger">{(switchSemester.error as Error).message}</p>}
    </div>
  );
}
