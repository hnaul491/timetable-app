import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useT, type MessageKey } from "../i18n";
import { apiFetch } from "../lib/api";
import type { RecurringRule } from "../types";

const DAYS: MessageKey[] = ["settings.days.mon", "settings.days.tue", "settings.days.wed", "settings.days.thu", "settings.days.fri", "settings.days.sat", "settings.days.sun"];

export function RecurringList() {
  const t = useT();
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: ["recurring"], queryFn: () => apiFetch<RecurringRule[]>("/api/recurring") });
  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/recurring/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["event"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-base font-bold">{t("settings.recurring.title")}</h2>
      <p className="text-sm text-muted">{t("settings.recurring.help")}</p>
      {rules.data?.length === 0 && <p className="text-sm">{t("settings.recurring.none")}</p>}
      {rules.data?.map((rule) => (
        <RuleRow key={rule.id} rule={rule} onDelete={() => remove.mutate(rule.id)} />
      ))}
      {remove.error && <p className="text-sm text-danger">{(remove.error as Error).message}</p>}
    </section>
  );
}

function RuleRow({ rule, onDelete }: { rule: RecurringRule; onDelete: () => void }) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">{rule.title}</span>
        <span className="text-xs text-muted">
          {rule.weekdays.map((d) => t(DAYS[d])).join(", ")} · {rule.start_time}–{rule.end_time} · {rule.from_date} → {rule.until_date}
          {rule.location ? ` · ${rule.location}` : ""} · {t("settings.recurring.occurrences", { count: rule.occurrences })}
        </span>
      </span>
      <button
        type="button"
        aria-label={confirm ? t("settings.recurring.deleteConfirmAria", { title: rule.title }) : t("settings.recurring.deleteAria", { title: rule.title })}
        onClick={() => (confirm ? onDelete() : setConfirm(true))}
        className="h-9 rounded-lg px-3 text-sm font-semibold text-danger"
      >
        {confirm ? t("settings.recurring.deleteConfirm") : t("common.delete")}
      </button>
    </div>
  );
}
