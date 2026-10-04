import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDetail } from "../types";
import { ConfirmProvider } from "../components/ui/Confirm";
import { ToastProvider } from "../components/ui/Toast";
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
      <ToastProvider>
        <ConfirmProvider>
          <MemoryRouter initialEntries={["/events/7"]}>
            <Routes>
              <Route path="/events/:id" element={<EventPage />} />
              <Route path="/" element={<p>Calendar home</p>} />
            </Routes>
          </MemoryRouter>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("EventPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    localStorage.clear();
  });

  it("shows the class, its notes per tab and the next class", async () => {
    apiFetch.mockResolvedValue(detail());
    renderPage();
    expect(await screen.findByRole("heading", { name: "Relational Databases" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "After class note" })).toHaveValue("[ ] Redo ex 3");
    expect(screen.getByRole("link", { name: /Next class/ })).toHaveAttribute("href", "/events/8");
    await userEvent.click(screen.getByRole("tab", { name: "Before next class" }));
    expect(screen.getByRole("textbox", { name: "Before next class note" })).toHaveValue("Bring laptop");
  });

  it("saves the edited note text", async () => {
    apiFetch.mockResolvedValue(detail());
    renderPage();
    const box = await screen.findByRole("textbox", { name: "After class note" });
    const save = screen.getByRole("button", { name: "Save note" });
    expect(save).toBeDisabled();
    fireEvent.change(box, { target: { value: "[ ] Redo ex 3\n[ ] Read ch. 4" } });
    await userEvent.click(save);
    expect(apiFetch).toHaveBeenCalledWith("/api/events/7/notes/after", {
      method: "PUT",
      body: JSON.stringify({ body: "[ ] Redo ex 3\n[ ] Read ch. 4" }),
    });
  });

  it("stars the class as important right away", async () => {
    let starred = false; // the server remembers the star, so the refetch after saving sees it too
    apiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "PUT") starred = true;
      return detail({ important: starred });
    });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Mark important" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/events/7/important", { method: "PUT", body: JSON.stringify({ important: true }) });
    expect(await screen.findByRole("button", { name: "Important" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Marked important");
  });

  it("ticks a task", async () => {
    apiFetch.mockResolvedValue(detail());
    renderPage();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Redo ex 3" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/tasks/3", { method: "PATCH", body: JSON.stringify({ status: "done" }) });
  });

  it("deletes a custom event only after confirming", async () => {
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) =>
      init?.method === "DELETE" ? { deleted: true } : detail({ source: "custom", kind: "work", subject_name: null, subject_id: null, title: "Work shift" }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Delete event and its notes" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/api/events/7", { method: "DELETE" });
    await userEvent.click(screen.getByRole("button", { name: "Delete event and its notes" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete event" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/events/7", { method: "DELETE" });
    expect(await screen.findByText("Calendar home")).toBeInTheDocument();
  });

  it("does not leak drafts or delete confirmation into the next class", async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path === "/api/events/8"
        ? { ...detail({ id: 8, source: "custom", kind: "work" }), notes: { after: { tab: "after", body: "Event 8 note", important: false, updated_at: null }, before: { tab: "before", body: "", important: false, updated_at: null } }, next_event_id: null, next_event_start: null }
        : detail(),
    );
    renderPage();
    const box = await screen.findByRole("textbox", { name: "After class note" });
    fireEvent.change(box, { target: { value: "draft for 7" } });
    await userEvent.click(screen.getByRole("tab", { name: "Before next class" }));
    await userEvent.click(screen.getByRole("link", { name: /Next class/ }));
    const box8 = await screen.findByDisplayValue("Event 8 note");
    expect(box8).toHaveAccessibleName("After class note");
    expect(screen.getByRole("tab", { name: "After class" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete event and its notes" })).toBeInTheDocument();
  });

  it("blocks ticking tasks while a note has unsaved changes", async () => {
    apiFetch.mockResolvedValue(detail());
    renderPage();
    const box = await screen.findByRole("textbox", { name: "After class note" });
    const task = screen.getByRole("checkbox", { name: "Redo ex 3" });
    expect(task).toBeEnabled();
    fireEvent.change(box, { target: { value: "edited" } });
    expect(task).toBeDisabled();
    expect(screen.getByText("Save your note first to tick tasks.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Redo ex 3" })).toBeEnabled());
    expect(screen.queryByText("Save your note first to tick tasks.")).not.toBeInTheDocument();
  });

  it("drops a reverted draft so a tick is allowed and the refetched body shows", async () => {
    let body = "[ ] Redo ex 3";
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        body = "[x] Redo ex 3";
        return {};
      }
      const d = detail();
      d.notes.after.body = body;
      return d;
    });
    renderPage();
    const box = await screen.findByRole("textbox", { name: "After class note" });
    fireEvent.change(box, { target: { value: "[ ] Redo ex 3x" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "[ ] Redo ex 3" } });
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    const task = screen.getByRole("checkbox", { name: "Redo ex 3" });
    expect(task).toBeEnabled();
    await userEvent.click(task);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "After class note" })).toHaveValue("[x] Redo ex 3"));
  });

  it("keeps text typed while a save is pending", async () => {
    let resolvePut: (v: EventDetail) => void = () => {};
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      init?.method === "PUT" ? new Promise<EventDetail>((r) => { resolvePut = r; }) : Promise.resolve(detail()),
    );
    renderPage();
    const box = await screen.findByRole("textbox", { name: "After class note" });
    fireEvent.change(box, { target: { value: "first" } });
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));
    fireEvent.change(box, { target: { value: "first and more" } });
    const saved = detail();
    saved.notes.after.body = "first";
    resolvePut(saved);
    await waitFor(() => expect(localStorage.getItem("timetable:draft:7:after")).toContain("first and more"));
    expect(screen.getByRole("textbox", { name: "After class note" })).toHaveValue("first and more");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("restores an unsaved draft after unmount and remount", async () => {
    apiFetch.mockResolvedValue(detail());
    const first = renderPage();
    fireEvent.change(await screen.findByRole("textbox", { name: "After class note" }), { target: { value: "half-written" } });
    first.unmount();
    renderPage();
    expect(await screen.findByDisplayValue("half-written")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("removes the stored draft after a successful save", async () => {
    apiFetch.mockResolvedValue(detail());
    renderPage();
    fireEvent.change(await screen.findByRole("textbox", { name: "After class note" }), { target: { value: "to save" } });
    expect(localStorage.getItem("timetable:draft:7:after")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(localStorage.getItem("timetable:draft:7:after")).toBeNull());
  });

  it("limits the note length", async () => {
    apiFetch.mockResolvedValue(detail());
    renderPage();
    expect(await screen.findByRole("textbox", { name: "After class note" })).toHaveAttribute("maxlength", "20000");
  });

  it("discards unsaved changes", async () => {
    apiFetch.mockResolvedValue(detail());
    renderPage();
    const box = await screen.findByRole("textbox", { name: "After class note" });
    fireEvent.change(box, { target: { value: "scratch" } });
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(box).toHaveValue("[ ] Redo ex 3");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(localStorage.getItem("timetable:draft:7:after")).toBeNull();
  });
});
