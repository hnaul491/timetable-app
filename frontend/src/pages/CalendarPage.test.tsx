import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../components/ui/Confirm";
import { ToastProvider } from "../components/ui/Toast";
import { ChromeProvider } from "../lib/chrome";
import { ShortcutProvider } from "../lib/shortcuts";
import { calendarHref } from "../lib/calendarLocation";
import { CalendarPage } from "./CalendarPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>
          <ShortcutProvider>
            <ChromeProvider>
              <MemoryRouter initialEntries={[path]}>
                <Routes>
                  <Route path="/" element={<CalendarPage />} />
                </Routes>
                <Where />
              </MemoryRouter>
            </ChromeProvider>
          </ShortcutProvider>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("CalendarPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/events")) return { events: [], missing_sections: [] };
      if (path === "/api/sync/status") return { last_run: null, last_success_at: null };
      return undefined;
    });
  });

  it("opens the week and view given in the address", async () => {
    renderAt("/?date=2026-11-11&view=week");
    expect(await screen.findByRole("heading", { name: "9 – 15 November 2026" })).toBeInTheDocument();
  });

  it("keeps the shown week in the address so going back returns to it", async () => {
    renderAt("/?date=2026-11-11&view=week");
    await userEvent.click(await screen.findByRole("button", { name: "Next week" }));
    expect(screen.getByRole("heading", { name: "16 – 22 November 2026" })).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/?date=2026-11-18&view=week");
    await userEvent.click(screen.getByRole("button", { name: "day" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/?date=2026-11-18&view=day");
    expect(calendarHref()).toBe("/?date=2026-11-18&view=day"); // "Back to calendar" returns here
  });

  it("ignores a broken date in the address", async () => {
    renderAt("/?date=2026-13-45&view=week");
    expect(await screen.findByRole("heading", { level: 1 })).not.toHaveTextContent("NaN");
  });
});
