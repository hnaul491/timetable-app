import { NavLink } from "react-router";
import { useT } from "../../i18n";
import type { SectionDef, SectionId } from "./sections";
import type { SectionStatus } from "./useSettingsStatus";

const dotClass = { ok: "bg-success", warn: "bg-warn", none: "bg-transparent" } as const;

function Dot({ status }: { status: SectionStatus }) {
  return <span aria-hidden="true" data-dot={status.dot} className={`size-2 shrink-0 self-center rounded-full ${dotClass[status.dot]}`} />;
}

/** The section list: a sticky rail on desktop, a grouped list with chevrons on phones. */
export function SectionList({
  items,
  status,
  variant,
}: {
  items: SectionDef[];
  status: Record<SectionId, SectionStatus>;
  variant: "rail" | "grouped";
}) {
  const t = useT();
  const grouped = variant === "grouped";
  return (
    <nav
      aria-label={t("settings.sectionsLabel")}
      className={grouped ? "flex flex-col overflow-hidden rounded-2xl border border-line bg-surface" : "flex flex-col gap-0.5"}
    >
      {items.map((s) => (
        <NavLink
          key={s.id}
          to={`/settings/${s.id}`}
          state={{ fromList: true }}
          className={({ isActive }) =>
            grouped
              ? "flex items-center gap-2.5 border-t border-line px-3.5 py-3 first:border-t-0"
              : `flex items-center gap-2 rounded-xl px-3 py-2.5 hover:bg-surface ${isActive ? "bg-accent-soft" : ""}`
          }
        >
          {({ isActive }) => (
            <>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={`text-sm font-bold ${isActive && !grouped ? "text-accent-strong" : "text-ink"}`}>{t(s.title)}</span>
                <span className="truncate text-xs text-muted">{status[s.id].text || " "}</span>
              </span>
              <Dot status={status[s.id]} />
              {grouped && (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0 fill-none stroke-muted stroke-2">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
