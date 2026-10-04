import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useT, type MessageKey } from "../i18n";
import { apiFetch } from "../lib/api";
import type { RecurringRule } from "../types";
import { RuleEditDialog } from "./RuleEditDialog";
import { useConfirm } from "./ui/Confirm";
import { useToast } from "./ui/Toast";

const DAYS: MessageKey[] = ["settings.days.mon", "settings.days.tue", "settings.days.wed", "settings.days.thu", "settings.days.fri", "settings.days.sat", "settings.days.sun"];

export function RecurringList() {
  const t = useT();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<number | null>(null);
  const rules = useQuery({ queryKey: ["recurring"], queryFn: () => apiFetch<RecurringRule[]>("/api/recurring") });
  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/recurring/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["event"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(t("settings.recurring.deleted"));
    },
    onError: (error, id) => toast.error(error.message, { retry: () => remove.mutate(id) }),
  });
  const askDelete = async (rule: RecurringRule) => {
    const ok = await confirm({
      title: t("settings.recurring.deleteTitle", { title: rule.title }),
      body: t("settings.recurring.deleteBody"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (ok) remove.mutate(rule.id);
  };

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <h3 className="text-base font-bold">{t("settings.recurring.title")}</h3>
      <p className="text-sm text-muted">{t("settings.recurring.help")}</p>
      {rules.data?.length === 0 && <p className="text-sm">{t("settings.recurring.none")}</p>}
      {rules.data?.map((rule) => (
        <RuleRow key={rule.id} rule={rule} onEdit={() => setEditing(rule.id)} onDelete={() => void askDelete(rule)} />
      ))}
      {editing !== null && <RuleEditDialog ruleId={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function RuleRow({ rule, onEdit, onDelete }: { rule: RecurringRule; onEdit: () => void; onDelete: () => void }) {
  const t = useT();
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
        aria-label={t("settings.recurring.editAria", { title: rule.title })}
        onClick={onEdit}
        className="h-9 rounded-lg px-3 text-sm font-semibold text-accent"
      >
        {t("common.edit")}
      </button>
      <button
        type="button"
        aria-label={t("settings.recurring.deleteAria", { title: rule.title })}
        onClick={onDelete}
        className="h-9 rounded-lg px-3 text-sm font-semibold text-danger"
      >
        {t("common.delete")}
      </button>
    </div>
  );
}
