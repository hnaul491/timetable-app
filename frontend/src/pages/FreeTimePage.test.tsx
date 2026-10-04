import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShortcutHelp } from "../components/ShortcutHelp";
import { I18nProvider } from "../i18n";
import { ShortcutProvider } from "../lib/shortcuts";
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
  counted_days: 3, uncovered_days: 0, free_days: 1,
  semester: { id: 1, name: "SE S1 2026", start: "2026-09-01", end: "2027-01-30" }, missing_sections: [],
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

function renderPage(locale: "en" | "vi" = "en", help = false, path = "/free-time") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>
        <ShortcutProvider>
          <MemoryRouter initialEntries={[path]}>
            <Where />
            <Routes>
              <Route path="/free-time" element={<FreeTimePage />} />
              <Route path="*" element={null} />
            </Routes>
            {help && <ShortcutHelp open onClose={() => {}} />}
          </MemoryRouter>
        </ShortcutProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

/** The period chip (it has aria-pressed); the step buttons can share a name such as "Next week". */
const chip = (name: string) => screen.getAllByRole("button", { name }).find((b) => b.hasAttribute("aria-pressed"))!;
const stepButton = (name: string) => screen.getByRole("button", { name: `Go to ${name.toLowerCase()}` });
const pressedChips = () => within(screen.getByRole("group", { name: "Period" })).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);

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
    await user.click(chip("This week"));
    await waitFor(() => {
      const p = lastParams();
      expect(new Date(`${p.get("end")}T00:00:00Z`).getTime() - new Date(`${p.get("start")}T00:00:00Z`).getTime()).toBe(6 * 86_400_000);
    });
    await user.click(chip("Rest of semester"));
    await waitFor(() => {
      expect(lastParams().get("end")).toBe(addDays(todayParis(), 60));
      expect(lastParams().get("start")).toBe(todayParis());
    });
    await user.click(chip("Custom"));
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
    await user.click(chip("Custom"));
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
    const cells = screen.getAllByRole("button", { name: /, (free|busy|45 min free|not counted)/i });
    expect(cells.map((c) => c.getAttribute("data-status"))).toEqual(["busy", "off", "partial", "free"]);
    expect(within(cells[2]).getByText("45m")).toBeInTheDocument();
  });

  it("keeps the big number to checked days and shows the outside-semester notice and ? cells", async () => {
    const days = result().days.map((d) => ({ ...d }));
    days[3] = { ...days[3], status: "unknown", counts: false };
    apiFetch.mockImplementation(async (path: string) => (path.startsWith("/api/semesters") ? [] : result({ days, uncovered_days: 1, free_days: 0 })));
    renderPage();
    expect(await screen.findByTestId("free-big")).toHaveTextContent("0 of 2 days");
    expect(screen.getByText("1 days are outside SE S1 2026 and are not counted.")).toBeInTheDocument();
    const cell = screen.getByRole("button", { name: /outside the semester/ });
    expect(cell).toHaveAttribute("data-status", "unknown");
    expect(within(cell).getByText("?")).toBeInTheDocument();
    expect(cell.className).toContain("border-dashed");
  });

  it("links to Settings when there is no active semester", async () => {
    const days = result().days.map((d) => ({ ...d, status: "unknown" as const, counts: false }));
    apiFetch.mockImplementation(async (path: string) => (path.startsWith("/api/semesters") ? [] : result({ days, uncovered_days: 3, free_days: 0, semester: null })));
    renderPage();
    expect(await screen.findByTestId("free-big")).toHaveTextContent("0 of 0 days");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings/school");
  });

  it("shows the missing sections notice with a link to Settings", async () => {
    apiFetch.mockImplementation(async (path: string) => (path.startsWith("/api/semesters") ? [] : result({ missing_sections: [{ subject_id: 4, name: "French" }, { subject_id: null, name: "Tutorat" }] })));
    renderPage();
    await screen.findByTestId("free-big");
    expect(screen.getByText(/French, Tutorat/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose your groups" })).toHaveAttribute("href", "/settings/school");
  });

  it("describes the response period, not the form, in the summary", async () => {
    const user = userEvent.setup();
    let pending = false;
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/semesters")) return [];
      if (pending) return new Promise(() => {});
      return result({ start: "2026-10-01", end: "2026-10-31" });
    });
    renderPage();
    await screen.findByTestId("free-big");
    expect(screen.getByText(/free from 06:00 to 08:00 in October 2026/)).toBeInTheDocument();
    pending = true;
    await user.click(chip("This week"));
    // the form moved on, the old response is still on screen: the sentence keeps its own dates
    expect(screen.getByText(/free from 06:00 to 08:00 from 1 October 2026 to 31 October 2026/)).toBeInTheDocument();
  });

  it("recomputes today when the tab becomes visible after midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-30T12:00:00Z") });
    try {
      renderPage();
      await screen.findByTestId("free-big");
      expect(lastParams().get("start")).toBe("2026-10-01");
      vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => expect(lastParams().get("start")).toBe("2026-11-01"), { timeout: 3000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows blocker detail on focus and opens the calendar on click", async () => {
    const user = userEvent.setup();
    apiFetch.mockImplementation(async (path: string) => (path.startsWith("/api/semesters") ? [] : result({ buffer: 30 })));
    renderPage();
    await screen.findByTestId("free-big");
    const busy = screen.getAllByRole("button", { name: /busy/ })[0];
    act(() => busy.focus());
    expect(screen.getByTestId("free-detail")).toHaveTextContent(/Databases TP 0[67]:30–0[89]:00 \(\+30 min travel\)/);
    act(() => screen.getByRole("button", { name: /45 min free/ }).focus());
    expect(screen.getByTestId("free-detail")).toHaveTextContent("longest free stretch 45 min");
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

  describe("shortcuts", () => {
    it("w, m and s pick the period", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("free-big");
      await user.keyboard("w");
      expect(pressedChips()).toEqual(["This week"]);
      await user.keyboard("s");
      expect(pressedChips()).toEqual(["Rest of semester"]);
      await user.keyboard("m");
      expect(pressedChips()).toEqual(["This month"]);
    });

    it("Shift+W and Shift+M pick next week and next month", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("free-big");
      await user.keyboard("{Shift>}W{/Shift}");
      expect(pressedChips()).toEqual(["Next week"]);
      await user.keyboard("{Shift>}M{/Shift}");
      expect(pressedChips()).toEqual(["Next month"]);
      await user.keyboard("w");
      expect(pressedChips()).toEqual(["This week"]);
    });

    it("c switches to custom dates and focuses the first day, even from another period", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("free-big");
      await user.keyboard("c");
      expect(pressedChips()).toEqual(["Custom"]);
      const start = await screen.findByLabelText("First day");
      expect(start).toHaveFocus();
      (document.activeElement as HTMLElement).blur();
      await user.keyboard("c");
      expect(start).toHaveFocus();
    });

    it("b focuses the travel buffer without typing into it", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("free-big");
      const buffer = screen.getByRole("spinbutton", { name: "Travel buffer" });
      await user.keyboard("b");
      expect(buffer).toHaveFocus();
      expect(buffer).toHaveValue(0);
    });

    it("1 to 7 toggle Monday to Sunday", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("free-big");
      await user.keyboard("16");
      expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "Saturday" })).toHaveAttribute("aria-pressed", "true");
      await user.keyboard("7");
      expect(screen.getByRole("button", { name: "Sunday" })).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => expect(lastParams().get("weekdays")).toBe("1,2,3,4,5,6"));
      await user.keyboard("1");
      expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "true");
    });

    it("do nothing while typing in a field", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("free-big");
      const buffer = screen.getByRole("spinbutton", { name: "Travel buffer" });
      await user.clear(buffer);
      await user.type(buffer, "15");
      expect(buffer).toHaveValue(15);
      expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "true");
      expect(pressedChips()).toEqual(["This month"]);
    });

    it("do nothing on other pages", async () => {
      const user = userEvent.setup();
      renderPage("en", false, "/board");
      await user.keyboard("1wmsbc");
      expect(screen.getByTestId("where")).toHaveTextContent("/board");
      expect(document.body).toHaveFocus();
    });

    it("Enter and Space on a focused day open the calendar at that date", async () => {
      const user = userEvent.setup();
      renderPage();
      const cell = await screen.findByRole("button", { name: /busy/ });
      cell.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByTestId("where")).toHaveTextContent("/?date=2026-10-01");
    });

    it("Space on a focused day opens it too", async () => {
      const user = userEvent.setup();
      renderPage();
      const cell = await screen.findByRole("button", { name: /45 min free/ });
      cell.focus();
      await user.keyboard(" ");
      expect(screen.getByTestId("where")).toHaveTextContent("/?date=2026-10-05");
    });

    it("the help groups them under Free time", async () => {
      renderPage("en", true);
      const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
      expect(within(dialog).getByRole("heading", { name: "Free time" })).toBeInTheDocument();
      for (const label of ["Today", "Tomorrow", "Go to previous period", "Go to next period", "This week", "This month", "Rest of semester", "Custom dates", "Travel buffer", "Toggle Monday", "Toggle Sunday"]) {
        expect(within(dialog).getByText(label)).toBeInTheDocument();
      }
    });

    it("the help is in Vietnamese", async () => {
      renderPage("vi", true);
      const dialog = await screen.findByRole("dialog", { name: "Phím tắt" });
      expect(within(dialog).getByRole("heading", { name: "Thời gian rảnh" })).toBeInTheDocument();
      expect(within(dialog).getByText("Bật/tắt thứ Hai")).toBeInTheDocument();
      expect(within(dialog).getByText("Chọn ngày")).toBeInTheDocument();
      expect(within(dialog).getByText("Hôm nay")).toBeInTheDocument();
    });
  });

  describe("period chips and stepping", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-14T12:00:00Z") }); // a Wednesday
      apiFetch.mockImplementation(async (path: string) => {
        if (path.startsWith("/api/semesters")) return [{ id: 1, code: "S1", name: "S1", zeus_group_id: null, start_date: "2026-09-01", end_date: "2027-01-30", is_active: true }];
        const q = new URLSearchParams(path.split("?")[1]);
        return result({ start: q.get("start")!, end: q.get("end")!, days: [] });
      });
    });
    afterEach(() => vi.useRealTimers());

    it("shows all chips, with exactly the matching one pressed", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("free-big");
      const group = screen.getByRole("group", { name: "Period" });
      expect(within(group).getAllByRole("button", { pressed: false }).concat(within(group).getAllByRole("button", { pressed: true })).map((b) => b.textContent))
        .toEqual(expect.arrayContaining(["Today", "Tomorrow", "This week", "Next week", "This month", "Next month", "Rest of semester", "Custom"]));
      expect(pressedChips()).toEqual(["This month"]);
      await user.click(chip("Tomorrow"));
      expect(pressedChips()).toEqual(["Tomorrow"]);
      await waitFor(() => expect(lastParams().get("start")).toBe("2026-10-15"));
      expect(lastParams().get("end")).toBe("2026-10-15");
      await user.click(chip("Today"));
      expect(pressedChips()).toEqual(["Today"]);
      await user.click(chip("Next month"));
      await waitFor(() => expect(lastParams().get("start")).toBe("2026-11-01"));
      expect(lastParams().get("end")).toBe("2026-11-30");
    });

    it("steps with the arrow buttons and shows the range between them", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("free-big");
      expect(screen.getByTestId("period-label")).toHaveTextContent("October 2026");
      await user.click(stepButton("Next month"));
      expect(screen.getByTestId("period-label")).toHaveTextContent("November 2026");
      expect(pressedChips()).toEqual(["Next month"]);
      await user.click(stepButton("Next month"));
      expect(screen.getByTestId("period-label")).toHaveTextContent("December 2026");
      expect(pressedChips()).toEqual([]);
      await user.click(stepButton("Previous month"));
      await user.click(stepButton("Previous month"));
      expect(pressedChips()).toEqual(["This month"]);

      await user.click(chip("This week"));
      expect(screen.getByTestId("period-label")).toHaveTextContent("12–18 Oct 2026");
      await user.click(stepButton("Next week"));
      expect(screen.getByTestId("period-label")).toHaveTextContent("19–25 Oct 2026");
      expect(pressedChips()).toEqual(["Next week"]);
      await user.click(stepButton("Next week"));
      expect(screen.getByTestId("period-label")).toHaveTextContent("26 Oct – 1 Nov 2026");
      expect(pressedChips()).toEqual([]);
      await waitFor(() => expect(lastParams().get("start")).toBe("2026-10-26"));
      expect(lastParams().get("end")).toBe("2026-11-01");

      await user.click(chip("Today"));
      expect(screen.getByTestId("period-label")).toHaveTextContent("Wed 14 Oct");
      await user.click(screen.getByRole("button", { name: "Go to previous day" }));
      expect(screen.getByTestId("period-label")).toHaveTextContent("Tue 13 Oct");
      expect(pressedChips()).toEqual([]);
      await waitFor(() => expect(lastParams().get("start")).toBe("2026-10-13"));
    });

    it("disables the arrows for rest of semester and custom", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("free-big");
      await user.click(chip("Rest of semester"));
      expect(screen.getByRole("button", { name: /^Go to previous/ })).toBeDisabled();
      expect(stepButton("Next day")).toBeDisabled();
      expect(screen.getByTestId("period-label")).toBeEmptyDOMElement();
      await user.click(chip("Custom"));
      expect(screen.getByRole("button", { name: /^Go to previous/ })).toBeDisabled();
      expect(stepButton("Next day")).toBeDisabled();
      await user.click(chip("This week"));
      expect(screen.getByRole("button", { name: "Go to previous week" })).toBeEnabled();
    });

    it("t, Shift+T, left and right arrows", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("free-big");
      await user.keyboard("{ArrowRight}");
      expect(screen.getByTestId("period-label")).toHaveTextContent("November 2026");
      await user.keyboard("{ArrowLeft}{ArrowLeft}");
      expect(screen.getByTestId("period-label")).toHaveTextContent("September 2026");
      await user.keyboard("t");
      expect(pressedChips()).toEqual(["Today"]);
      await user.keyboard("{Shift>}T{/Shift}");
      expect(pressedChips()).toEqual(["Tomorrow"]);
      await user.keyboard("{ArrowRight}");
      expect(screen.getByTestId("period-label")).toHaveTextContent("Fri 16 Oct");
      await user.keyboard("s{ArrowRight}");
      expect(pressedChips()).toEqual(["Rest of semester"]);
      await user.keyboard("c{ArrowRight}");
      expect(pressedChips()).toEqual(["Custom"]);
    });

    it("describes a single day and a stepped week in the summary", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByTestId("free-big");
      await user.click(chip("Tomorrow"));
      expect(await screen.findByText(/free from 06:00 to 08:00 on Thursday 15 October 2026/)).toBeInTheDocument();
      await user.click(chip("This week"));
      await user.click(stepButton("Next week"));
      await user.click(stepButton("Next week"));
      expect(await screen.findByText(/free from 06:00 to 08:00 from 26 October 2026 to 1 November 2026/)).toBeInTheDocument();
      await user.click(chip("Next week"));
      expect(await screen.findByText(/free from 06:00 to 08:00 next week/)).toBeInTheDocument();
    });

    it("is translated to Vietnamese", async () => {
      const user = userEvent.setup();
      renderPage("vi");
      await screen.findByTestId("free-big");
      expect(screen.getByRole("group", { name: "Khoảng thời gian" })).toBeInTheDocument();
      for (const label of ["Hôm nay", "Ngày mai", "Tuần này", "Tuần sau", "Tháng này", "Tháng sau", "Phần còn lại của học kỳ", "Tùy chọn"]) {
        expect(chip(label)).toBeInTheDocument();
      }
      await user.click(chip("Hôm nay"));
      await user.click(screen.getByRole("button", { name: "Sang ngày sau" }));
      expect(screen.getByTestId("period-label")).toHaveTextContent("15");
      expect(await screen.findByText(/rảnh từ 06:00 đến 08:00 vào Thứ Năm, 15 tháng 10, 2026/)).toBeInTheDocument();
      await user.click(chip("Tuần này"));
      expect(screen.getByRole("button", { name: "Về tuần trước" })).toBeInTheDocument();
      await user.click(chip("Tháng này"));
      expect(screen.getByRole("button", { name: "Về tháng trước" })).toBeInTheDocument();
    });
  });

  it("speaks Vietnamese", async () => {
    renderPage("vi");
    expect(await screen.findByRole("heading", { name: "Thời gian rảnh" })).toBeInTheDocument();
    await screen.findByTestId("free-big");
    expect(screen.getByTestId("free-big")).toHaveTextContent("1 trên 3 ngày");
    expect(screen.getByText(/rảnh từ 06:00 đến 08:00/)).toBeInTheDocument();
    expect(screen.getByText("Theo thứ trong tuần")).toBeInTheDocument();
    const partial = screen.getByRole("button", { name: /rảnh 45 phút/ });
    expect(within(partial).getByText("45 ph")).toBeInTheDocument();
  });
});
