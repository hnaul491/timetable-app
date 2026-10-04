import type { QueryClient } from "@tanstack/react-query";

const TASK_VIEW_KEYS = ["tasks", "event", "events", "review", "subjects", "subject", "free-time"] as const;

/** Refresh every view that shows tasks or the notes they are derived from. */
export function invalidateTaskViews(queryClient: QueryClient): void {
  for (const key of TASK_VIEW_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
}
