import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { ErrorPanel, GoogleBanner, MissingSectionsBanner, SyncBanner } from "../components/Banners";
import { WeekGrid } from "../components/WeekGrid";
import { apiFetch } from "../lib/api";
import { rememberCalendarSearch } from "../lib/calendarLocation";
import { addDays, dayLabel, formatLongDate, rangeUtc, startOfWeek, todayParis } from "../lib/time";
import { useMediaQuery } from "../lib/useMediaQuery";
import type { EventsResponse, GoogleStatus, SyncStatus } from "../types";

type View = "week" | "day";

function parseView(value: string | null): View | null {
  return value === "week" || value === "day" ? value : null;
}

function parseDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return addDays(value, 0) === value ? value : null; // rejects 2026-13-45 and other impossible dates
}

const buttonClass = "h-10 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold hover:bg-surface-2";

export function CalendarPage() {
  const navigate = useNavigate();
  const isPhone = useMediaQuery("(max-width: 767px)");
  // The shown date and view live in the address, so coming back from an event keeps the same week.
  const [params, setParams] = useSearchParams();
  const { search } = useLocation();
  useEffect(() => rememberCalendarSearch(search), [search]);
  const view = parseView(params.get("view")) ?? (isPhone ? "day" : "week");
  const anchor = parseDate(params.get("date")) ?? todayParis();
  const show = (next: { date?: string; view?: View }) =>
    setParams({ date: next.date ?? anchor, view: next.view ?? view }, { replace: true });
  const setAnchor = (date: string) => show({ date });
  const setView = (next: View) => show({ view: next });

  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)) : [anchor];
  const range = rangeUtc(days[0], days.length);
  const step = view === "week" ? 7 : 1;

  const events = useQuery({
    queryKey: ["events", range.start, range.end],
    queryFn: () => apiFetch<EventsResponse>(`/api/events?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`),
  });
  const sync = useQuery({ queryKey: ["sync-status"], queryFn: () => apiFetch<SyncStatus>("/api/sync/status") });
  const google = useQuery({ queryKey: ["google"], queryFn: () => apiFetch<GoogleStatus>("/api/google") });

  const title =
    view === "week"
      ? `${dayLabel(days[0]).day} – ${formatLongDate(days[6])}`
      : `${dayLabel(anchor).weekday} ${formatLongDate(anchor)}`;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold tracking-tight">{title}</h1>
        <div className="flex gap-1.5">
          <button type="button" aria-label={`Previous ${view}`} className={buttonClass} onClick={() => setAnchor(addDays(anchor, -step))}>
            ‹
          </button>
          <button type="button" className={buttonClass} onClick={() => setAnchor(todayParis())}>
            Today
          </button>
          <button type="button" aria-label={`Next ${view}`} className={buttonClass} onClick={() => setAnchor(addDays(anchor, step))}>
            ›
          </button>
        </div>
        <div role="group" aria-label="View" className="flex rounded-xl bg-subtle p-[3px]">
          {(["week", "day"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`h-[34px] rounded-lg px-4 text-sm capitalize ${view === v ? "bg-surface font-semibold shadow-sm" : "font-medium text-ink-2"}`}
            >
              {v}
            </button>
          ))}
        </div>
        <Link to="/events/new" className="flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong">
          Add event
        </Link>
      </header>
      <SyncBanner status={sync.data} />
      <GoogleBanner status={google.data} />
      <MissingSectionsBanner names={events.data?.missing_sections ?? []} />
      {events.error ? <ErrorPanel error={events.error} onRetry={() => events.refetch()} /> : <WeekGrid days={days} events={events.data?.events ?? []} onSelect={(id) => navigate(`/events/${id}`)} />}
    </div>
  );
}
