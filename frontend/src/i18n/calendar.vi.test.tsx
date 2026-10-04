import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../components/ui/Confirm";
import { ToastProvider } from "../components/ui/Toast";
import { ChromeProvider } from "../lib/chrome";
import { ShortcutProvider } from "../lib/shortcuts";
import { SyncBanner } from "../components/Banners";
import { CalendarPage } from "../pages/CalendarPage";
import { EventPage } from "../pages/EventPage";
import { NewEventPage } from "../pages/NewEventPage";
import type { EventDetail } from "../types";
import { I18nProvider, translate } from "./index";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const tv = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) => translate("vi", key, vars);

const detail: EventDetail = {
  event: {
    id: 7, title: "Relational Databases", subject_id: 1, subject_name: "Relational Databases", color: "#2E55E6",
    section: null, start: "2026-10-19T11:00:00Z", end: "2026-10-19T13:00:00Z", room: "KB602", kind: "class",
    status: "changed", source: "zeus", note_count: 1, open_tasks: 1, important: false,
  },
  notes: {
    after: { tab: "after", body: "", important: false, updated_at: null },
    before: { tab: "before", body: "", important: false, updated_at: null },
  },
  tasks: [],
  next_event_id: 8,
  next_event_start: "2026-11-09T12:00:00Z",
  recurring_rule_id: null,
};

function renderAt(path: string, ui: React.ReactNode, route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="vi">
        <ToastProvider>
          <ConfirmProvider>
            <ShortcutProvider>
              <ChromeProvider>
                <MemoryRouter initialEntries={[path]}>
                  <Routes>
                    <Route path={route} element={ui} />
                  </Routes>
                </MemoryRouter>
              </ChromeProvider>
            </ShortcutProvider>
          </ConfirmProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("calendar, event and nav in Vietnamese", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/events/7")) return detail;
      if (path.startsWith("/api/events")) return { events: [], missing_sections: [] };
      if (path === "/api/sync/status") return { last_run: null, last_success_at: null };
      return undefined;
    });
  });

  it("translates the calendar header and banner, with Vietnamese dates", async () => {
    renderAt("/?date=2026-11-11&view=week", <CalendarPage />, "/");
    expect(await screen.findByRole("heading", { name: /tháng 11/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tv("calendar.header.nextWeek") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tv("common.today") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tv("calendar.header.viewDay") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tv("calendar.header.addEvent") })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: tv("calendar.banner.noDataLink") })).toBeInTheDocument();
  });

  it("translates the event page", async () => {
    renderAt("/events/7", <EventPage />, "/events/:id");
    expect(await screen.findByRole("button", { name: new RegExp(tv("event.markImportant")) })).toBeInTheDocument();
    expect(screen.getByText(tv("event.schoolTimetable"))).toBeInTheDocument();
    expect(screen.getByText(tv("event.changed"))).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: tv("event.tabAfter") })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: tv("event.noteAfter") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tv("event.saveNote") })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: tv("event.backToCalendar") })).toBeInTheDocument();
  });

  it("translates the new event form", () => {
    renderAt("/events/new", <NewEventPage />, "/events/new");
    expect(screen.getByRole("heading", { name: tv("event.newTitle") })).toBeInTheDocument();
    expect(screen.getByLabelText(tv("event.fieldTitle"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tv("event.saveEvent") })).toBeInTheDocument();
  });

  it("translates the stale banner pieces", () => {
    render(
      <I18nProvider locale="vi">
        <MemoryRouter>
          <SyncBanner
            status={{ last_run: { status: "ok", started_at: "", finished_at: "", fetched: 0, inserted: 0, updated: 0, cancelled: 0, skipped: 0, error: null }, last_success_at: "2026-10-01T04:00:00Z" }}
            now={new Date("2026-10-15T10:00:00Z")}
          />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.getByRole("link", { name: tv("calendar.banner.staleLink") })).toBeInTheDocument();
  });
});
