import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router";
import { apiFetch } from "../lib/api";

interface Semester {
  code: string;
  name: string;
  is_active: boolean;
}

const links = [
  { to: "/", label: "Calendar" },
  { to: "/settings", label: "Settings" },
];

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex h-11 items-center rounded-lg px-3 text-sm ${isActive ? "bg-accent-soft font-semibold text-accent-strong" : "font-medium text-[#3A3F4B] hover:bg-[#F0F1F4]"}`;

export function Layout() {
  const semesters = useQuery({ queryKey: ["semesters"], queryFn: () => apiFetch<Semester[]>("/api/semesters") });
  const active = semesters.data?.find((s) => s.is_active);
  return (
    <div className="min-h-screen md:flex">
      <nav aria-label="Main" className="hidden w-60 shrink-0 flex-col gap-5 border-r border-line bg-white px-4 py-5 md:flex">
        <div className="flex items-center gap-2.5 px-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">T</div>
          <span className="text-[17px] font-bold">Timetable</span>
        </div>
        {active && (
          <div className="rounded-xl border border-line bg-[#F8F9FB] px-3 py-2.5 text-sm font-semibold">{active.name}</div>
        )}
        <div className="flex flex-col gap-0.5">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end className={navClass}>
              {l.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="min-w-0 flex-1 px-4 pt-5 pb-24 md:px-7 md:pb-8">
        <Outlet />
      </main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 grid grid-cols-2 border-t border-line bg-white px-2 pt-1.5 pb-3 md:hidden">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end className={({ isActive }) => `flex h-12 items-center justify-center text-sm ${isActive ? "font-semibold text-accent-strong" : "text-[#3A3F4B]"}`}>
            {l.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
