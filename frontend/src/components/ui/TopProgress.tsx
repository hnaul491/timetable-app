import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useT } from "../../i18n";

export function TopProgress() {
  const t = useT();
  const busy = useIsFetching() + useIsMutating() > 0;
  return (
    <div
      data-testid="top-progress"
      data-busy={busy ? "true" : "false"}
      role="progressbar"
      aria-label={t("ui.loading")}
      aria-hidden={!busy}
      className={`pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5 transition-opacity ${busy ? "opacity-100" : "opacity-0"}`}
    >
      <div className="h-full w-full animate-pulse bg-accent" />
    </div>
  );
}
