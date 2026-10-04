import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation, useSearchParams } from "react-router";
import { ErrorPanel, GoogleBanner, MissingSectionsBanner, SyncBanner } from "../components/Banners";
import { EventForm, type FormValues } from "../components/EventForm";
import { EventPanel } from "../components/EventPanel";
import { Dialog } from "../components/ui/Dialog";
import { useToast } from "../components/ui/Toast";
import { WeekGrid } from "../components/WeekGrid";
import { useLocale, useT } from "../i18n";
import { apiFetch } from "../lib/api";
import { rememberCalendarSearch } from "../lib/calendarLocation";
import { useChrome } from "../lib/chrome";
import { useShortcut } from "../lib/shortcuts";
import { addDays, dayLabel, formatLongDate, formatTime, parisParts, rangeUtc, startOfWeek, todayParis, weekdayIndex } from "../lib/time";
import { useMediaQuery } from "../lib/useMediaQuery";
import type { CustomKind, EventDetail, EventsResponse, GoogleStatus, SyncStatus } from "../types";

type View = "week" | "day";

function parseView(value: string | null): View | null {
  return value === "week" || value === "day" ? value : null;
}

function parseDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return addDays(value, 0) === value ? value : null; // rejects 2026-13-45 and other impossible dates
}

const POPUP_PARAMS = ["event", "new", "edit"] as const;
type Popup = (typeof POPUP_PARAMS)[number];

/** "2026-10-21T10:30" from the ?new= parameter, or null when it is not one. */
function parseSlot(value: string | null): { date: string; start: string } | null {
  const match = value ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value) : null;
  return match && parseDate(match[1]) ? { date: match[1], start: match[2] } : null;
}

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const buttonClass = "h-10 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold hover:bg-surface-2";

export function CalendarPage() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { setFullScreen } = useChrome();
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

  // Popups live in the address: opening pushes an entry (Back closes it), closing or swapping replaces.
  const openPopup = (key: Popup, value: string, replace = false) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const name of POPUP_PARAMS) next.delete(name);
        next.set(key, value);
        return next;
      },
      { replace },
    );
  const closePopup = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const name of POPUP_PARAMS) next.delete(name);
        return next;
      },
      { replace: true },
    );
  const eventParam = params.get("event");
  const editParam = params.get("edit");
  const eventId = eventParam && /^\d+$/.test(eventParam) ? Number(eventParam) : null;
  const editId = editParam && /^\d+$/.test(editParam) ? Number(editParam) : null;
  const slot = parseSlot(params.get("new"));
  const openNew = (date: string, start: string) => openPopup("new", `${date}T${start}`);

  useShortcut("cal-previous", "ArrowLeft", () => setAnchor(addDays(anchor, -step)), { label: "shortcuts.previous" });
  useShortcut("cal-next", "ArrowRight", () => setAnchor(addDays(anchor, step)), { label: "shortcuts.next" });
  useShortcut("cal-today", "t", () => setAnchor(todayParis()), { label: "shortcuts.today" });
  useShortcut("cal-week", "w", () => setView("week"), { label: "shortcuts.weekView" });
  useShortcut("cal-day", "d", () => setView("day"), { label: "shortcuts.dayView" });
  useShortcut("cal-new", "n", () => openNew(anchor, "09:00"), { label: "shortcuts.newEvent" });
  useShortcut("cal-full-screen", "f", () => setFullScreen(true), { label: "shortcuts.fullScreen" });

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
      ? `${dayLabel(days[0], locale).day} – ${formatLongDate(days[6], locale)}`
      : `${dayLabel(anchor, locale).weekday} ${formatLongDate(anchor, locale)}`;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold tracking-tight">{title}</h1>
        <div className="flex gap-1.5">
          <button type="button" aria-label={t(view === "week" ? "calendar.header.previousWeek" : "calendar.header.previousDay")} className={buttonClass} onClick={() => setAnchor(addDays(anchor, -step))}>
            ‹
          </button>
          <button type="button" className={buttonClass} onClick={() => setAnchor(todayParis())}>
            {t("common.today")}
          </button>
          <button type="button" aria-label={t(view === "week" ? "calendar.header.nextWeek" : "calendar.header.nextDay")} className={buttonClass} onClick={() => setAnchor(addDays(anchor, step))}>
            ›
          </button>
        </div>
        <div role="group" aria-label={t("calendar.header.view")} className="flex rounded-xl bg-subtle p-[3px]">
          {(["week", "day"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`h-[34px] rounded-lg px-4 text-sm capitalize ${view === v ? "bg-surface font-semibold shadow-sm" : "font-medium text-ink-2"}`}
            >
              {t(v === "week" ? "calendar.header.viewWeek" : "calendar.header.viewDay")}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => openNew(anchor, "09:00")} className="flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong">
          {t("calendar.header.addEvent")}
        </button>
      </header>
      <SyncBanner status={sync.data} />
      <GoogleBanner status={google.data} />
      <MissingSectionsBanner names={events.data?.missing_sections ?? []} />
      {events.error ? <ErrorPanel error={events.error} onRetry={() => events.refetch()} /> : <WeekGrid days={days} events={events.data?.events ?? []} onSelect={(id) => openPopup("event", String(id))} onCreateAt={(date, minutes) => openNew(date, clock(minutes))} />}
      {editId !== null ? (
        <EditDialog
          id={editId}
          onClose={closePopup}
          onDone={(id) => {
            toast.success(t("event.updated"));
            queryClient.invalidateQueries({ queryKey: ["event", String(id)] });
            openPopup("event", String(id ?? editId), true);
          }}
        />
      ) : slot ? (
        <Dialog open onClose={closePopup} size="md" title={t("event.newTitle")}>
          <EventForm
            initial={{ date: slot.date, start: slot.start, end: clock(Math.min(Number(slot.start.slice(0, 2)) * 60 + Number(slot.start.slice(3)) + 60, 24 * 60 - 1)) }}
            onCancel={closePopup}
            onDone={(id) => {
              toast.success(t("event.created"));
              if (id === null) closePopup();
              else openPopup("event", String(id), true);
            }}
          />
        </Dialog>
      ) : eventId !== null ? (
        <EventPanel eventId={eventId} onClose={closePopup} onEdit={(id) => openPopup("edit", String(id))} onOpen={(id) => openPopup("event", String(id), true)} />
      ) : null}
    </div>
  );
}

function EditDialog({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: (id: number | null) => void }) {
  const t = useT();
  const detail = useQuery({ queryKey: ["event", String(id)], queryFn: () => apiFetch<EventDetail>(`/api/events/${id}`) });
  const event = detail.data?.event;
  let initial: Partial<FormValues> | undefined;
  if (event) {
    const start = parisParts(event.start);
    const end = parisParts(event.end);
    initial = { title: event.title, kind: event.kind as CustomKind, date: start.date, start: clock(start.minutes), end: clock(end.minutes), room: event.room, weekdays: [weekdayIndex(start.date)] };
  }
  return (
    <Dialog open onClose={onClose} size="md" title={t("event.editTitle")}>
      {detail.error ? <ErrorPanel error={detail.error} onRetry={() => detail.refetch()} /> : initial ? <EventForm initial={initial} eventId={id} onCancel={onClose} onDone={onDone} /> : <p className="text-muted">{t("common.loading")}</p>}
    </Dialog>
  );
}
