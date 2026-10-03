import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiEvent, Review, Task } from "../types";
import { ReviewPage } from "./ReviewPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const event = (over: Partial<ApiEvent>): ApiEvent => ({
  id: 1, title: "Relational Databases", subject_id: 1, subject_name: "Relational Databases", color: "#2E55E6", section: null,
  start: "2026-10-19T11:00:00Z", end: "2026-10-19T13:00:00Z", room: "KB602", kind: "class", status: "normal", source: "zeus",
  note_count: 0, open_tasks: 0, important: false, ...over,
});
const task = (over: Partial<Task>): Task => ({
  id: 1, title: "Old homework", status: "todo", due_date: "2026-10-14", important: false, source: "manual", note_id: null,
  event_id: null, subject_id: null, subject_name: null, event_start: null, position: 0, ...over,
});
const review = (over: Partial<Review> = {}): Review => ({
  week_start: "2026-10-19", week_end: "2026-10-25", reviewed_at: null,
  overdue: [task({})],
  due_this_week: [task({ id: 2, title: "Read ch. 4", due_date: "2026-10-22" })],
  important: [{ event_id: 5, title: "French for Fall 26 T1", start: "2026-10-15T12:30:00Z", tab: "after", body: "Oral presentation Thursday" }],
  without_notes: [event({ id: 6, title: "Harmonization", start: "2026-10-16T12:00:00Z", end: "2026-10-16T15:00:00Z" })],
  changes: [event({ id: 7, title: "Introduction to Python", status: "changed", start: "2026-10-21T15:00:00Z", end: "2026-10-21T18:00:00Z" })],
  week: [event({ id: 8 }), event({ id: 9, title: "Work shift", kind: "work", source: "custom", subject_id: null, subject_name: null, color: null,
                                    start: "2026-10-21T10:00:00Z", end: "2026-10-21T14:00:00Z" })],
  hours: { school: 2, work: 4, french_ext: 0, other: 0 },
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ReviewPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/review/2026-10-19/done") return { week_start: "2026-10-19", reviewed_at: "2026-10-18T17:00:00Z" };
      if (init?.method === "PATCH") return {};
      return path.includes("week_start=2026-10-26") ? review({ week_start: "2026-10-26", week_end: "2026-11-01", overdue: [] }) : review();
    });
  });

  it("shows every section for the week", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: /19 – 25 October 2026/ })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Overdue" })).getByText("Old homework")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Important notes" })).getByRole("link", { name: /Oral presentation Thursday/ })).toHaveAttribute("href", "/events/5");
    expect(within(screen.getByRole("region", { name: "Last week's classes without notes" })).getByRole("link", { name: /Add note/ })).toHaveAttribute("href", "/events/6");
    expect(within(screen.getByRole("region", { name: "School timetable changes" })).getByText(/Introduction to Python/)).toBeInTheDocument();
    expect(screen.getByText(/2 h school · 4 h work/)).toBeInTheDocument();
  });

  it("ticks a task done", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Read ch. 4" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/tasks/2", { method: "PATCH", body: JSON.stringify({ status: "done" }) });
  });

  it("marks the week reviewed and moves between weeks", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Mark week as reviewed" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/review/2026-10-19/done", { method: "POST" });
    await userEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(await screen.findByRole("heading", { name: /26 October – 1 November 2026/ })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/api/review?week_start=2026-10-26");
  });
});
