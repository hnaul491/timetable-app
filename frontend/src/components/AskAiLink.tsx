import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useT } from "../i18n";
import { apiFetch } from "../lib/api";
import type { AiStatus } from "../types";

/** "Ask AI" shortcut to the assistant about one class or subject; hidden unless AI is enabled. */
export function AskAiLink({ event, subject, className }: { event?: number; subject?: number; className: string }) {
  const t = useT();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => apiFetch<AiStatus>("/api/ai/status") });
  if (status.data?.enabled !== true) return null;
  const to = event !== undefined ? `/assistant?event=${event}` : `/assistant?subject=${subject}`;
  return (
    <Link to={to} className={className}>
      {t("ai.ask")}
    </Link>
  );
}
