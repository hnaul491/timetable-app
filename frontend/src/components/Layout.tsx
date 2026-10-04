import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useT, type MessageKey } from "../i18n";
import { apiFetch } from "../lib/api";
import { useChrome } from "../lib/chrome";
import { useShortcut } from "../lib/shortcuts";
import { SearchPalette } from "./SearchPalette";
import { ShortcutHelp } from "./ShortcutHelp";
import type { Semester } from "../types";

const Icon = ({ children }: { children: ReactNode }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const links: { to: string; label: MessageKey; keys: string; goLabel: MessageKey; icon: ReactNode }[] = [
  { to: "/", label: "nav.calendar", keys: "g c", goLabel: "shortcuts.goCalendar", icon: <Icon><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Icon> },
  { to: "/board", label: "nav.board", keys: "g b", goLabel: "shortcuts.goBoard", icon: <Icon><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="10" rx="1" /><rect x="17" y="4" width="4" height="13" rx="1" /></Icon> },
  { to: "/subjects", label: "nav.subjects", keys: "g s", goLabel: "shortcuts.goSubjects", icon: <Icon><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z" /><path d="M4 19a2 2 0 0 1 2-2h13" /></Icon> },
  { to: "/review", label: "nav.review", keys: "g r", goLabel: "shortcuts.goReview", icon: <Icon><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></Icon> },
  { to: "/assistant", label: "nav.assistant", keys: "g a", goLabel: "shortcuts.goAssistant", icon: <Icon><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" /></Icon> },
  { to: "/settings", label: "nav.settings", keys: "g ,", goLabel: "shortcuts.goSettings", icon: <Icon><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></Icon> },
];

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex h-11 items-center rounded-lg px-3 text-sm ${isActive ? "bg-accent-soft font-semibold text-accent-strong" : "font-medium text-ink-2 hover:bg-subtle"}`;

export function Layout() {
  const t = useT();
  const navigate = useNavigate();
  const { sidebarCollapsed, toggleSidebar, fullScreen, setFullScreen } = useChrome();
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Ctrl/Cmd+K toggles the palette, but never opens it on top of another dialog.
  useShortcut("search", "Mod+k", () => {
    if (searchOpen) setSearchOpen(false);
    else if (document.querySelector('[aria-modal="true"]') === null) setSearchOpen(true);
  }, { label: "shortcuts.search", inDialog: true });
  useShortcut("search-slash", "/", () => setSearchOpen(true), { label: "shortcuts.search" });
  useShortcut("sidebar", "[", toggleSidebar, { label: "shortcuts.toggleSidebar" });
  useShortcut("help", "?", () => setHelpOpen(true), { label: "shortcuts.help" });
  useShortcut("exit-full-screen", "Escape", () => setFullScreen(false), { label: "shortcuts.exitFullScreen", enabled: fullScreen });
  useShortcut("go-calendar", "g c", () => navigate("/"), { label: "shortcuts.goCalendar" });
  useShortcut("go-board", "g b", () => navigate("/board"), { label: "shortcuts.goBoard" });
  useShortcut("go-subjects", "g s", () => navigate("/subjects"), { label: "shortcuts.goSubjects" });
  useShortcut("go-review", "g r", () => navigate("/review"), { label: "shortcuts.goReview" });
  useShortcut("go-assistant", "g a", () => navigate("/assistant"), { label: "shortcuts.goAssistant" });
  useShortcut("go-settings", "g ,", () => navigate("/settings"), { label: "shortcuts.goSettings" });
  const collapsed = sidebarCollapsed;
  const queryClient = useQueryClient();
  const switchSemester = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/semesters/${id}/activate`, { method: "PUT" }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const semesters = useQuery({ queryKey: ["semesters"], queryFn: () => apiFetch<Semester[]>("/api/semesters") });
  const active = semesters.data?.find((s) => s.is_active);
  return (
    <div className="min-h-screen md:flex">
      {!fullScreen && (
      <nav aria-label={t("nav.main")} className={`sticky top-0 hidden h-screen self-start shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-surface py-5 md:flex ${collapsed ? "w-16 px-2" : "w-60 px-4"}`}>
        <div className={`flex items-center gap-2.5 ${collapsed ? "flex-col" : "pl-2"}`}>
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold text-on-accent">T</div>
          {!collapsed && <span className="text-[17px] font-bold">Timetable</span>}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            title={`${collapsed ? t("nav.expand") : t("nav.collapse")} ([)`}
            className={`flex size-8 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-ink ${collapsed ? "" : "ml-auto"}`}
          >
            <Icon>
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
              {collapsed ? <path d="M13 10l2 2-2 2" /> : <path d="M15 10l-2 2 2 2" />}
            </Icon>
          </button>
        </div>
        {!collapsed && semesters.data && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            {t("nav.semester")}
            <select
              aria-label={t("nav.semester")}
              value={active?.id ?? ""}
              onChange={(e) => switchSemester.mutate(Number(e.target.value))}
              className="h-10 rounded-xl border border-line bg-surface-2 px-2.5 text-sm font-semibold text-ink"
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
            {switchSemester.error && <p className="text-xs text-danger">{(switchSemester.error as Error).message}</p>}
          </label>
        )}
        <div className="flex flex-col gap-0.5">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              aria-label={collapsed ? t(l.label) : undefined}
              title={collapsed ? t(l.label) : undefined}
              className={(s) => `${navClass(s)} gap-3 ${collapsed ? "justify-center px-0!" : ""}`}
            >
              {l.icon}
              {!collapsed && t(l.label)}
            </NavLink>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label={t("search.open")}
          title={t("search.open")}
          className={`flex h-10 items-center gap-3 rounded-lg text-sm font-medium text-ink-2 hover:bg-subtle ${collapsed ? "justify-center" : "px-3"}`}
        >
          <Icon><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></Icon>
          {!collapsed && t("search.open")}
        </button>
      </nav>
      )}
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      {!fullScreen && (
        <button type="button" onClick={() => setSearchOpen(true)} aria-label={t("search.open")} className="fixed top-3 right-3 z-40 flex size-10 items-center justify-center rounded-full border border-line bg-surface text-ink-2 shadow-sm md:hidden">
          <Icon><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></Icon>
        </button>
      )}
      <main className="min-w-0 flex-1 px-4 pt-5 pb-24 md:px-7 md:pb-8">
        <Outlet />
      </main>
      {!fullScreen && (
      <nav aria-label={t("nav.main")} className="fixed inset-x-0 bottom-0 grid grid-cols-6 border-t border-line bg-surface px-2 pt-1.5 pb-3 md:hidden">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === "/"} className={({ isActive }) => `flex h-12 items-center justify-center text-xs ${isActive ? "font-semibold text-accent-strong" : "text-ink-2"}`}>
            {t(l.label)}
          </NavLink>
        ))}
      </nav>
      )}
    </div>
  );
}
