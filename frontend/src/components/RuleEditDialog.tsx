import { useQuery } from "@tanstack/react-query";
import { useT } from "../i18n";
import { apiFetch } from "../lib/api";
import type { RecurringRule } from "../types";
import { EventForm } from "./EventForm";
import { Dialog } from "./ui/Dialog";
import { useToast } from "./ui/Toast";

/** Edits a weekly repeating rule, prefilled from GET /api/recurring. */
export function RuleEditDialog({ ruleId, onClose }: { ruleId: number; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const rules = useQuery({ queryKey: ["recurring"], queryFn: () => apiFetch<RecurringRule[]>("/api/recurring") });
  const rule = rules.data?.find((r) => r.id === ruleId);
  return (
    <Dialog open onClose={onClose} size="md" title={t("event.editSeriesTitle")}>
      {rule ? (
        <EventForm
          ruleId={rule.id}
          initial={{
            title: rule.title,
            kind: rule.kind,
            date: rule.from_date,
            start: rule.start_time,
            end: rule.end_time,
            room: rule.location,
            weekdays: rule.weekdays,
            until: rule.until_date,
          }}
          onCancel={onClose}
          onDone={() => {
            toast.success(t("event.ruleUpdated"));
            onClose();
          }}
        />
      ) : (
        <p className="text-muted">{rules.error ? rules.error.message : t("common.loading")}</p>
      )}
    </Dialog>
  );
}
