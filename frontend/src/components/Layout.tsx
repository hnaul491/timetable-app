import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router";
import { apiFetch } from "../lib/api";
import type { Semester } from "../types";

const links = [
  { to: "/", label: "Calendar" },
  { to: "/board", label: "Board" },
  { to: "/subjects", label: "Subjects" },
  { to: "/review", label: "Review" },
  { to: "/settings", label: "Settings" },
];

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex h-11 items-center rounded-lg px-3 text-sm ${isActive ? "bg-accent-soft font-semibold text-accent-strong" : "font-medium text-[#3A3F4B] hover:bg-[#F0F1F4]"}`;

export function Layout() {
  const queryClient = useQueryClient();
  const switchSemester = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/semesters/${id}/activate`, { method: "PUT" }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const semesters = useQuery({ queryKey: ["semesters"], queryFn: () => apiFetch<Semester[]>("/api/semesters") });
  const active = semesters.data?.find((s) => s.is_active);
  return (
    <div className="min-h-screen md:flex">
      <nav aria-label="Main" className="hidden w-60 shrink-0 flex-col gap-5 border-r border-line bg-white px-4 py-5 md:flex">
        <div className="flex items-center gap-2.5 px-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">T</div>
          <span className="text-[17px] font-bold">Timetable</span>
        </div>
        {semesters.data && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Semester
            <select
              aria-label="Semester"
              value={active?.id ?? ""}
              onChange={(e) => switchSemester.mutate(Number(e.target.value))}
              className="h-10 rounded-xl border border-line bg-[#F8F9FB] px-2.5 text-sm font-semibold text-ink"
            >
              {semesters.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-col gap-0.5">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.to === "/"} className={navClass}>
              {l.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="min-w-0 flex-1 px-4 pt-5 pb-24 md:px-7 md:pb-8">
        <Outlet />
      </main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 grid grid-cols-5 border-t border-line bg-white px-2 pt-1.5 pb-3 md:hidden">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === "/"} className={({ isActive }) => `flex h-12 items-center justify-center text-xs ${isActive ? "font-semibold text-accent-strong" : "text-[#3A3F4B]"}`}>
            {l.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
