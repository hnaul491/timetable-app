import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { FreeTimeResult } from "../lib/freeTime";
import { addDays, todayParis } from "../lib/time";
import { FreeTimePage } from "./FreeTimePage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const result = (over: Partial<FreeTimeResult> = {}): FreeTimeResult => ({
  window: { from: "06:00", to: "08:00" }, start: "2026-10-01", end: "2026-10-07", buffer: 0, min_free: null,
  counted_days: 3, free_days: 1,
  by_weekday: [
    { weekday: 0, free: 0, total: 1 }, { weekday: 1, free: 0, total: 0 }, { weekday: 2, free: 1, total: 1 },
    { weekday: 3, free: 0, total: 1 }, { weekday: 4, free: 0, total: 0 }, { weekday: 5, free: 0, total: 0 }, { weekday: 6, free: 0, total: 0 },
  ],
  days: [
    { date: "2026-10-01", weekday: 3, status: "busy", counts: false, free_minutes: 0, longest_free: 0,
      blockers: [{ event_id: 1, title: "Databases TP", start: "2026-10-01T05:30:00Z", end: "2026-10-01T07:00:00Z", kind: "class" }] },
    { date: "2026-10-02", weekday: 4, status: "off", counts: false, free_minutes: 0, longest_free: 0, blockers: [] },
    { date: "2026-10-05", weekday: 0, status: "partial", counts: false, free_minutes: 45, longest_free: 45,
      blockers: [{ event_id: 2, title: "Gym", start: "2026-10-05T05:15:00Z", end: "2026-10-05T05:30:00Z", kind: "custom" }] },
    { date: "2026-10-07", weekday: 2, status: "free", counts: true, free_minutes: 120, longest_free: 120, blockers: [] },
  ],
  ...over,
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function renderPage(locale: "en" | "vi" = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>
        <MemoryRouter initialEntries={["/free-time"]}>
          <Where />
          <Routes>
            <Route path="/free-time" element={<FreeTimePage />} />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const freeCalls = () => apiFetch.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith("/api/free-time"));
const lastParams = () => new URLSearchParams(freeCalls().at(-1)!.split("?")[1]);

beforeEach(() => {
  localStorage.clear();
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/semesters")) return [{ id: 1, code: "S1", name: "S1", zeus_group_id: null, start_date: "2026-09-01", end_date: addDays(todayParis(), 60), is_active: true }];
    return result();
  });
});
afterEach(() => vi.restoreAllMocks());

describe("FreeTimePage", () => {
  it("queries the default 06:00-08:00 Mon-Fri window for this month", async () => {
    renderPage();
    await screen.findByTestId("free-big");
    const p = lastParams();
    const today = todayParis();
    expect(p.get("from")).toBe("06:00");
    expect(p.get("to")).toBe("08:00");
    expect(p.get("weekdays")).toBe("0,1,2,3,4");
    expect(p.get("buffer")).toBe("0");
    expect(p.get("start")).toBe(`${today.slice(0, 8)}01`);
    expect(p.has("min_free")).toBe(false);
  });

  it("sends a manually typed buffer only once, after the debounce", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("free-big");
    const before = freeCalls().length;
    const input = screen.getByRole("spinbutton", { name: "Travel buffer" });
    await user.clear(input);
    await user.type(input, "25");
    await waitFor(() => expect(lastParams().get("buffer")).toBe("25"));
    expect(freeCalls().length).toBe(before + 1);
  });

  it("shows an inline error and sends nothing for a buffer over 240", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("free-big");
    const before = freeCalls().length;
    const input = screen.getByRole("spinbutton", { name: "Travel buffer" });
    await user.clear(input);
    await user.type(input, "300");
    expect(screen.getByRole("alert")).toHaveTextContent("0 to 240");
    await new Promise((r) => setTimeout(r, 450));
    expect(freeCalls().length).toBe(before);
    expect(screen.queryByTestId("free-big")).not.toBeInTheDocument();
  });

  it("presets fill the input and request that buffer", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("free-big");
    await user.click(screen.getByRole("button", { name: "30" }));
    expect(screen.getByRole("spinbutton", { name: "Travel buffer" })).toHaveValue(30);
    await waitFor(() => expect(lastParams().get("buffer")).toBe("30"));
    await user.click(screen.getByRole("button", { name: "None" }));
    expect(screen.getByRole("spinbutton", { name: "Travel buffer" })).toHaveValue(0);
  });

  it("validates from < to and does not query", async () => {
    renderPage();
    await screen.findByTestId("free-big");
    const before = freeCalls().length;
    const user = userEvent.setup();
    const from = screen.getByLabelText("From");
    await user.clear(from);
    await user.type(from, "09:00");
    expect(screen.getByRole("alert")).toHaveTextContent("before the end time");
    await new Promise((r) => setTimeout(r, 400));
    expect(freeCalls().length).toBe(before);
  });

  it("toggles weekdays with aria-pressed", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("free-big");
    const sat = screen.getByRole("button", { name: "Saturday" });
    expect(sat).toHaveAttribute("aria-pressed", "false");
    await user.click(sat);
    expect(sat).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(lastParams().get("weekdays")).toBe("0,1,2,3,4,5"));
    await user.click(screen.getByRole("button", { name: "Monday" }));
    await waitFor(() => expect(lastParams().get("weekdays")).toBe("1,2,3,4,5"));
  });

  it("computes this week, custom and rest of semester periods", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("free-big");
    await user.selectOptions(screen.getByLabelText("Period"), "week");
    await waitFor(() => {
      const p = lastParams();
      expect(new Date(`${p.get("end")}T00:00:00Z`).getTime() - new Date(`${p.get("start")}T00:00:00Z`).getTime()).toBe(6 * 86_400_000);
    });
    await user.selectOptions(screen.getByLabelText("Period"), "semester");
    await waitFor(() => {
      expect(lastParams().get("end")).toBe(addDays(todayParis(), 60));
      expect(lastParams().get("start")).toBe(todayParis());
    });
    await user.selectOptions(screen.getByLabelText("Period"), "custom");
    const first = screen.getByLabelText("First day");
    await user.clear(first);
    await user.type(first, "2026-11-02");
    const last = screen.getByLabelText("Last day");
    await user.clear(last);
    await user.type(last, "2026-11-06");
    await waitFor(() => expect(lastParams().get("start")).toBe("2026-11-02"));
    expect(lastParams().get("end")).toBe("2026-11-06");
  });

  it("rejects a custom range over 200 days and an end before the start", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("free-big");
    await user.selectOptions(screen.getByLabelText("Period"), "custom");
    const first = screen.getByLabelText("First day");
    await user.clear(first);
    await user.type(first, "2026-01-01");
    const last = screen.getByLabelText("Last day");
    await user.clear(last);
    await user.type(last, "2026-12-31");
    expect(screen.getByRole("alert")).toHaveTextContent("at most 200 days");
    await user.clear(last);
    await user.type(last, "2025-12-31");
    expect(screen.getByRole("alert")).toHaveTextContent("must not be before");
  });

  it("sends min_free when the checkbox is on", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("free-big");
    await user.click(screen.getByRole("checkbox", { name: /at least/ }));
    await waitFor(() => expect(lastParams().get("min_free")).toBe("60"));
  });

  it("renders the answer, the weekday bars and coloured day cells", async () => {
    apiFetch.mockImplementation(async (path: string) => (path.startsWith("/api/semesters") ? [] : result({ buffer: 30 })));
    renderPage();
    const big = await screen.findByTestId("free-big");
    expect(big).toHaveTextContent("1 of 3 days");
    expect(screen.getByText(/free from 06:00 to 08:00/)).toHaveTextContent("keeping 30 min to get to class");
    expect(within(screen.getByTestId("wd-2")).getByText("1/1")).toBeInTheDocument();
    expect(screen.queryByTestId("wd-1")).not.toBeInTheDocument();
    const cells = screen.getAllByRole("button", { name: /, (free|busy|45m|not counted)/i });
    expect(cells.map((c) => c.getAttribute("data-status"))).toEqual(["busy", "off", "partial", "free"]);
    expect(within(cells[2]).getByText("45m")).toBeInTheDocument();
  });

  it("shows blocker detail on focus and opens the calendar on click", async () => {
    const user = userEvent.setup();
    apiFetch.mockImplementation(async (path: string) => (path.startsWith("/api/semesters") ? [] : result({ buffer: 30 })));
    renderPage();
    await screen.findByTestId("free-big");
    const busy = screen.getAllByRole("button", { name: /busy/ })[0];
    act(() => busy.focus());
    expect(screen.getByTestId("free-detail")).toHaveTextContent(/Databases TP 0[67]:30–0[89]:00 \(\+30 min travel\)/);
    await user.click(busy);
    expect(screen.getByTestId("where")).toHaveTextContent("/?date=2026-10-01");
  });

  it("restores the last query from localStorage and remembers changes", async () => {
    localStorage.setItem("timetable:free-time", JSON.stringify({ from: "07:00", to: "09:30", period: "month", customStart: "2026-10-01", customEnd: "2026-10-31", weekdays: [1], buffer: "45", useMinFree: true, minFree: "30" }));
    renderPage();
    await screen.findByTestId("free-big");
    const p = lastParams();
    expect(p.get("from")).toBe("07:00");
    expect(p.get("weekdays")).toBe("1");
    expect(p.get("buffer")).toBe("45");
    expect(p.get("min_free")).toBe("30");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "15" }));
    expect(JSON.parse(localStorage.getItem("timetable:free-time")!).buffer).toBe("15");
  });

  it("works when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    renderPage();
    expect(await screen.findByTestId("free-big")).toBeInTheDocument();
  });

  it("shows a translated error with Retry", async () => {
    const user = userEvent.setup();
    let fail = true;
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/semesters")) return [];
      if (fail) throw new Error("boom");
      return result();
    });
    renderPage();
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("free-big")).toBeInTheDocument();
  });

  it("shows a loading state first", async () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(await screen.findByRole("status", { name: "Calculating free days" })).toBeInTheDocument();
  });

  it("speaks Vietnamese", async () => {
    renderPage("vi");
    expect(await screen.findByRole("heading", { name: "Thời gian rảnh" })).toBeInTheDocument();
    await screen.findByTestId("free-big");
    expect(screen.getByTestId("free-big")).toHaveTextContent("1 trên 3 ngày");
    expect(screen.getByText(/rảnh từ 06:00 đến 08:00/)).toBeInTheDocument();
    expect(screen.getByText("Theo thứ trong tuần")).toBeInTheDocument();
  });
});
