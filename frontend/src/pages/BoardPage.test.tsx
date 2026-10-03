import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { BoardPage } from "./BoardPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const task = (over: Partial<Task>): Task => ({
  id: 1, title: "Redo ex 3", status: "todo", due_date: null, important: false, source: "note", note_id: 1, event_id: 7,
  subject_id: 1, subject_name: "Relational Databases", event_start: "2026-10-19T11:00:00Z", position: 0, ...over,
});
const TASKS = [
  task({}),
  task({ id: 2, title: "Set up venv", status: "doing", subject_id: 2, subject_name: "Introduction to Python", due_date: "2026-10-21" }),
  task({ id: 3, title: "Buy notebook", status: "done", source: "manual", note_id: null, event_id: null, subject_id: null, subject_name: null }),
];

function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BoardPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => (init?.method ? {} : TASKS));
  });

  it("groups tasks into the three columns", async () => {
    renderBoard();
    const todo = await screen.findByRole("region", { name: "To do" });
    expect(within(todo).getByText("Redo ex 3")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Doing" })).getByText("Set up venv")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Done" })).getByText("Buy notebook")).toBeInTheDocument();
    expect(within(todo).getByRole("link", { name: "From class" })).toHaveAttribute("href", "/events/7");
  });

  it("moves a task with the status select", async () => {
    renderBoard();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Status for Redo ex 3" }), "doing");
    expect(apiFetch).toHaveBeenCalledWith("/api/tasks/1", { method: "PATCH", body: JSON.stringify({ status: "doing" }) });
  });

  it("filters by subject", async () => {
    renderBoard();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Subject" }), "Introduction to Python");
    expect(screen.queryByText("Redo ex 3")).not.toBeInTheDocument();
    expect(screen.getByText("Set up venv")).toBeInTheDocument();
  });

  it("adds a manual task", async () => {
    renderBoard();
    await userEvent.type(await screen.findByLabelText("New task"), "Print slides");
    await userEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Print slides", due_date: null }) });
  });

  it("names delete buttons per task and resets the confirmation on blur", async () => {
    renderBoard();
    const del = await screen.findByRole("button", { name: "Delete Buy notebook" });
    await userEvent.click(del);
    expect(screen.getByRole("button", { name: "Click again to delete Buy notebook" })).toBeInTheDocument();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Delete Buy notebook" })).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith("/api/tasks/3", { method: "DELETE" });
  });
});
