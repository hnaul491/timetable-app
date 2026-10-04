import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../components/ui/Confirm";
import { ToastProvider } from "../components/ui/Toast";
import { translate } from "../i18n";
import { todayParis } from "../lib/time";
import { calendarHref } from "../lib/calendarLocation";
import { ChromeProvider, useChrome } from "../lib/chrome";
import { ShortcutProvider } from "../lib/shortcuts";
import { CalendarPage } from "./CalendarPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const event = (over = {}) => ({
  id: 5, title: "Work shift", subject_id: null, subject_name: null, color: null, section: null,
  start: "2026-10-19T11:00:00Z", end: "2026-10-19T13:00:00Z", room: "Back office", kind: "work",
  status: "normal", source: "custom", note_count: 0, open_tasks: 0, important: false, ...over,
});
const detail = (over = {}) => ({
  event: event(over),
  notes: {
    after: { tab: "after", body: "", important: false, updated_at: null },
    before: { tab: "before", body: "", important: false, updated_at: null },
  },
  tasks: [],
  next_event_id: null,
  next_event_start: null,
  recurring_rule_id: null,
});

function Where() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="where">{location.pathname + location.search}</p>
      <button type="button" onClick={() => navigate(-1)}>
        test-back
      </button>
    </>
  );
}

function FullScreenProbe() {
  const { fullScreen } = useChrome();
  return <p data-testid="fs">{String(fullScreen)}</p>;
}

function renderAt(path: string | string[] = "/?date=2026-10-19&view=week") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>
          <ShortcutProvider>
            <ChromeProvider>
              <MemoryRouter initialEntries={Array.isArray(path) ? path : [path]}>
                <Routes>
                  <Route path="/" element={<CalendarPage />} />
                  <Route path="/other" element={<p>Other page</p>} />
                </Routes>
                <FullScreenProbe />
                <Where />
              </MemoryRouter>
            </ChromeProvider>
          </ShortcutProvider>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("CalendarPage popups", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    sessionStorage.clear();
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/events?")) return { events: [event()], missing_sections: [] };
      if (path === "/api/events" && init?.method === "POST") return event({ id: 99, title: "Gym" });
      if (path === "/api/events/5" && init?.method === "DELETE") return { deleted: true };
      if (path === "/api/events/5") return detail();
      if (path === "/api/events/99") return detail({ id: 99, title: "Gym" });
      if (path === "/api/sync/status") return { last_run: null, last_success_at: null };
      return undefined;
    });
  });

  it("clicking an event opens the panel", async () => {
    renderAt();
    await userEvent.click(await screen.findByRole("button", { name: /Open Work shift/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("event=5");
    expect(screen.getByTestId("where")).toHaveTextContent("date=2026-10-19");
    const dialog = await screen.findByRole("dialog", { name: "Work shift" });
    expect(dialog).toHaveTextContent("Back office");
    expect(dialog).toHaveTextContent("19 October 2026");
    expect(screen.getByRole("link", { name: "Open full page" })).toHaveAttribute("href", "/events/5");
  });

  it("Back closes the event panel", async () => {
    renderAt();
    await userEvent.click(await screen.findByRole("button", { name: /Open Work shift/ }));
    await screen.findByRole("dialog", { name: "Work shift" });
    await userEvent.click(screen.getByRole("button", { name: "test-back" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("where")).not.toHaveTextContent("event=");
  });

  it("empty slot opens a prefilled create form", async () => {
    renderAt();
    await screen.findByRole("button", { name: /Open Work shift/ });
    const column = document.querySelector<HTMLElement>('[data-date="2026-10-21"]')!;
    column.getBoundingClientRect = () => ({ top: 100, left: 0, right: 100, bottom: 800, width: 100, height: 700, x: 0, y: 100, toJSON() {} });
    // grid starts at 08:00, 52px per hour: 10:40 is 2h40 = 138.67px below the top, rounded down to 10:30
    fireEvent.click(column, { clientY: 100 + 139 });
    const dialog = await screen.findByRole("dialog", { name: "Add event" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveValue("2026-10-21");
    expect(screen.getByLabelText("Start")).toHaveValue("10:30");
    expect(screen.getByTestId("where")).toHaveTextContent("new=2026-10-21T10%3A30");
  });

  it("creating shows a toast and the new event", async () => {
    renderAt();
    await userEvent.click(await screen.findByRole("button", { name: "Add event" }));
    await userEvent.type(await screen.findByLabelText("Title"), "Gym");
    await userEvent.click(screen.getByRole("button", { name: "Save event" }));
    expect(await screen.findByText(translate("en", "event.created"))).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("event=99"));
    expect(await screen.findByRole("dialog", { name: "Gym" })).toBeInTheDocument();
    expect(screen.getByTestId("where")).not.toHaveTextContent("new=");
  });

  it("cancelled delete keeps the event", async () => {
    renderAt("/?date=2026-10-19&view=week&event=5");
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/api/events/5", { method: "DELETE" });
    expect(screen.getByRole("dialog", { name: "Work shift" })).toBeInTheDocument();
  });

  it("confirmed delete removes the event", async () => {
    renderAt("/?date=2026-10-19&view=week&event=5");
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete event" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/events/5", { method: "DELETE" }));
    expect(await screen.findByText(translate("en", "event.deleted"))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("where")).not.toHaveTextContent("event=");
  });

  it("school classes have no edit or delete", async () => {
    apiFetch.mockImplementation(async (path: string) => (path === "/api/events/5" ? detail({ source: "zeus", kind: "class" }) : path.startsWith("/api/events?") ? { events: [], missing_sections: [] } : undefined));
    renderAt("/?date=2026-10-19&view=week&event=5");
    await screen.findByRole("dialog", { name: "Work shift" });
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("Edit opens the form filled from the event and saves with PUT", async () => {
    renderAt("/?date=2026-10-19&view=week&event=5");
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(await screen.findByLabelText("Title")).toHaveValue("Work shift");
    expect(screen.getByLabelText("Start")).toHaveValue("13:00");
    await userEvent.click(screen.getByRole("button", { name: "Save event" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/events/5", expect.objectContaining({ method: "PUT" })));
  });

  it("n opens the create form; arrows move the week; t/w/d switch", async () => {
    renderAt();
    await screen.findByRole("heading", { level: 1 });
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByTestId("where")).toHaveTextContent("date=2026-10-26");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByTestId("where")).toHaveTextContent("date=2026-10-12");
    await userEvent.keyboard("d");
    expect(screen.getByTestId("where")).toHaveTextContent("view=day");
    await userEvent.keyboard("w");
    expect(screen.getByTestId("where")).toHaveTextContent("view=week");
    await userEvent.keyboard("n");
    expect(await screen.findByRole("dialog", { name: "Add event" })).toBeInTheDocument();
    expect(screen.getByLabelText("Start")).toHaveValue("09:00");
  });

  it("does not remember the open popup in the calendar address", async () => {
    renderAt("/?date=2026-10-19&view=week&event=5");
    await screen.findByRole("dialog", { name: "Work shift" });
    expect(calendarHref()).toBe("/?date=2026-10-19&view=week");
  });

  it("f toggles full screen and leaving the calendar resets it", async () => {
    renderAt(["/other", "/?date=2026-10-19&view=week"]);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.keyboard("f");
    expect(screen.getByTestId("fs")).toHaveTextContent("true");
    await userEvent.keyboard("f");
    expect(screen.getByTestId("fs")).toHaveTextContent("false");
    await userEvent.click(screen.getByRole("button", { name: "Full-screen calendar" }));
    expect(screen.getByRole("button", { name: "Exit full screen" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "test-back" }));
    expect(await screen.findByText("Other page")).toBeInTheDocument();
    expect(screen.getByTestId("fs")).toHaveTextContent("false");
  });

  it("shows a grid skeleton while events load", async () => {
    apiFetch.mockImplementation((path: string) => (path.startsWith("/api/events?") ? new Promise(() => {}) : Promise.resolve(undefined)));
    renderAt();
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Loading…");
    expect(screen.queryByRole("button", { name: /Open Work shift/ })).not.toBeInTheDocument();
  });

  it("closing a popup opened in the app goes back instead of leaving dead Back entries", async () => {
    renderAt(["/other", "/?date=2026-10-19&view=week"]);
    await userEvent.click(await screen.findByRole("button", { name: /Open Work shift/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "test-back" }));
    expect(await screen.findByText("Other page")).toBeInTheDocument();
  });

  it("closing a popup from a deep link replaces the address", async () => {
    renderAt(["/other", "/?date=2026-10-19&view=week&event=5"]);
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("where")).toHaveTextContent("/?date=2026-10-19&view=week");
    await userEvent.click(screen.getByRole("button", { name: "test-back" }));
    expect(await screen.findByText("Other page")).toBeInTheDocument();
  });

  it("saving an edit swaps edit= for event= without a new entry", async () => {
    renderAt("/?date=2026-10-19&view=week&event=5");
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save event" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("event=5"));
    expect(screen.getByTestId("where")).not.toHaveTextContent("edit=");
  });

  it("?new=today opens the new-event popup for today at 09:00", async () => {
    renderAt("/?new=today");
    expect(await screen.findByLabelText("Start")).toHaveValue("09:00");
    expect(screen.getByLabelText("Date")).toHaveValue(todayParis());
  });

  it("ignores an invalid ?new= time", async () => {
    renderAt("/?date=2026-10-19&view=week&new=2026-10-21T25:99");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("?edit= on a school class shows the details instead", async () => {
    apiFetch.mockImplementation(async (path: string) => (path === "/api/events/5" ? detail({ source: "zeus", kind: "class" }) : path.startsWith("/api/events?") ? { events: [], missing_sections: [] } : undefined));
    renderAt("/?date=2026-10-19&view=week&edit=5");
    expect(await screen.findByRole("dialog", { name: "Work shift" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("a missing event titles the panel as not found", async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === "/api/events/5") throw new Error("nope");
      return path.startsWith("/api/events?") ? { events: [], missing_sections: [] } : undefined;
    });
    renderAt("/?date=2026-10-19&view=week&event=5");
    expect(await screen.findByRole("dialog", { name: "Event not found" })).toBeInTheDocument();
  });
});
