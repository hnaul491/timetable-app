import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubjectDetail, SubjectSummary } from "../types";
import { SubjectPage } from "./SubjectPage";
import { SubjectsPage } from "./SubjectsPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const db: SubjectSummary = {
  id: 1, display_name: "Relational Databases", color: "#2E55E6", hidden: false, aliases: [], sessions: 10,
  sessions_done: 1, next_start: "2026-11-09T12:00:00Z", exam_start: "2027-01-26T08:00:00Z", exam_room: "KB003 (amphi 3)",
  open_tasks: 2, note_count: 3,
};
const hidden: SubjectSummary = { ...db, id: 2, display_name: "GenAI 101", hidden: true, sessions: 0, sessions_done: 0, next_start: null, exam_start: null, exam_room: null, open_tasks: 0, note_count: 0 };
const detail: SubjectDetail = {
  subject: db,
  sessions: [
    { id: 11, start: "2026-10-19T11:00:00Z", end: "2026-10-19T13:00:00Z", room: "KB602", kind: "class", status: "normal", section: null,
      note_snippet: "Covered ER diagrams", note_count: 1, open_tasks: 1, important: true },
    { id: 12, start: "2026-11-09T12:00:00Z", end: "2026-11-09T14:00:00Z", room: "KB602", kind: "class", status: "cancelled", section: null,
      note_snippet: null, note_count: 0, open_tasks: 0, important: false },
  ],
  tasks: [],
};

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/subjects" element={<SubjectsPage />} />
          <Route path="/subjects/:id" element={<SubjectPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Subjects", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string) => (path === "/api/subjects" ? [db, hidden] : detail));
  });

  it("lists subjects with progress and links", async () => {
    renderAt("/subjects");
    const link = await screen.findByRole("link", { name: /Relational Databases/ });
    expect(link).toHaveAttribute("href", "/subjects/1");
    expect(screen.getByText(/1 of 10 sessions · 2 open tasks/)).toBeInTheDocument();
    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("links to all documents (shown on phones)", async () => {
    renderAt("/subjects");
    const link = await screen.findByRole("link", { name: "All documents" });
    expect(link).toHaveAttribute("href", "/documents");
    expect(link.className).toContain("md:hidden");
  });

  it("shows a subject's exam, sessions and note snippets", async () => {
    renderAt("/subjects/1");
    expect(await screen.findByRole("heading", { name: "Relational Databases" })).toBeInTheDocument();
    expect(screen.getByText(/Exam/)).toBeInTheDocument();
    expect(screen.getByText("KB003 (amphi 3)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Covered ER diagrams" })).toHaveAttribute("href", "/events/11");
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "1 of 10 sessions done" })).toBeInTheDocument();
  });

  it("shows list skeletons with an accessible status while loading", () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    renderAt("/subjects");
    expect(screen.getByRole("status")).toHaveTextContent("Loading subjects…");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("shows a subject page skeleton with an accessible status while loading", () => {
    apiFetch.mockImplementation(() => new Promise(() => {}));
    renderAt("/subjects/1");
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
