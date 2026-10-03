import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDetail } from "../types";
import { EventPage } from "./EventPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const detail = (over: Partial<EventDetail["event"]> = {}): EventDetail => ({
  event: {
    id: 7, title: "Relational Databases", subject_id: 1, subject_name: "Relational Databases", color: "#2E55E6",
    section: null, start: "2026-10-19T11:00:00Z", end: "2026-10-19T13:00:00Z", room: "KB602", kind: "class",
    status: "normal", source: "zeus", note_count: 1, open_tasks: 1, important: false, ...over,
  },
  notes: {
    after: { tab: "after", body: "[ ] Redo ex 3", important: false, updated_at: "2026-10-19T15:00:00Z" },
    before: { tab: "before", body: "Bring laptop", important: false, updated_at: "2026-10-19T15:00:00Z" },
  },
  tasks: [{ id: 3, title: "Redo ex 3", status: "todo", due_date: null, important: false, source: "note", note_id: 1,
            event_id: 7, subject_id: 1, subject_name: "Relational Databases", event_start: "2026-10-19T11:00:00Z", position: 0 }],
  next_event_id: 8,
  next_event_start: "2026-11-09T12:00:00Z",
  recurring_rule_id: null,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/events/7"]}>
        <Routes>
          <Route path="/events/:id" element={<EventPage />} />
          <Route path="/" element={<p>Calendar home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EventPage", () => {
  beforeEach(() => apiFetch.mockReset());

  it("shows the class, its notes per tab and the next class", async () => {
    apiFetch.mockResolvedValue(detail());
    renderPage();
    expect(await screen.findByRole("heading", { name: "Relational Databases" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "After class note" })).toHaveValue("[ ] Redo ex 3");
    expect(screen.getByRole("link", { name: /Next class/ })).toHaveAttribute("href", "/events/8");
    await userEvent.click(screen.getByRole("tab", { name: "Before next class" }));
    expect(screen.getByRole("textbox", { name: "Before next class note" })).toHaveValue("Bring laptop");
  });

  it("saves the edited note with the Important flag", async () => {
    apiFetch.mockResolvedValue(detail());
    renderPage();
    const box = await screen.findByRole("textbox", { name: "After class note" });
    const save = screen.getByRole("button", { name: "Save note" });
    expect(save).toBeDisabled();
    fireEvent.change(box, { target: { value: "[ ] Redo ex 3\n[ ] Read ch. 4" } });
    await userEvent.click(screen.getByRole("checkbox", { name: "Important" }));
    await userEvent.click(save);
    expect(apiFetch).toHaveBeenCalledWith("/api/events/7/notes/after", {
      method: "PUT",
      body: JSON.stringify({ body: "[ ] Redo ex 3\n[ ] Read ch. 4", important: true }),
    });
  });

  it("ticks a task", async () => {
    apiFetch.mockResolvedValue(detail());
    renderPage();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Redo ex 3" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/tasks/3", { method: "PATCH", body: JSON.stringify({ status: "done" }) });
  });

  it("deletes a custom event only after a second click", async () => {
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) =>
      init?.method === "DELETE" ? { deleted: true } : detail({ source: "custom", kind: "work", subject_name: null, subject_id: null, title: "Work shift" }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Delete event" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/api/events/7", { method: "DELETE" });
    await userEvent.click(screen.getByRole("button", { name: "Click again to delete" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/events/7", { method: "DELETE" });
    expect(await screen.findByText("Calendar home")).toBeInTheDocument();
  });
});
