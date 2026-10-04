import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardPage } from "../pages/BoardPage";
import { ReviewPage } from "../pages/ReviewPage";
import { SubjectsPage } from "../pages/SubjectsPage";
import type { Review, SubjectSummary, Task } from "../types";
import { I18nProvider, translate } from "./index";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const tr = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("vi", key, vars);

function renderVi(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="vi">
        <MemoryRouter>{ui}</MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const task: Task = {
  id: 1, title: "Buy notebook", status: "todo", due_date: "2026-10-22", important: true, source: "manual", note_id: null,
  event_id: null, subject_id: null, subject_name: null, event_start: null, position: 0,
};
const subject: SubjectSummary = {
  id: 1, display_name: "Relational Databases", color: "#2E55E6", hidden: true, aliases: [], sessions: 10,
  sessions_done: 1, next_start: "2026-11-09T12:00:00Z", exam_start: "2027-01-26T08:00:00Z", exam_room: null, open_tasks: 2, note_count: 3,
};
const review: Review = {
  week_start: "2026-10-19", week_end: "2026-10-25", reviewed_at: null, overdue: [], due_this_week: [], important: [],
  without_notes: [], changes: [], week: [], hours: { school: 2, work: 4, french_ext: 0, other: 0 },
};

describe("study screens in Vietnamese", () => {
  beforeEach(() => apiFetch.mockReset());

  it("translates the board", async () => {
    apiFetch.mockResolvedValue([task]);
    renderVi(<BoardPage />);
    expect(await screen.findByRole("heading", { name: tr("board.title") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tr("board.addTask") })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: tr("board.todo") })).toBeInTheDocument();
    expect(screen.getByText(tr("board.card.important"))).toBeInTheDocument();
    expect(screen.getByText(tr("board.card.due", { date: "2026-10-22" }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tr("board.card.deleteAria", { title: "Buy notebook" }) })).toBeInTheDocument();
  });

  it("translates the subjects list", async () => {
    apiFetch.mockResolvedValue([subject]);
    renderVi(<SubjectsPage />);
    expect(await screen.findByRole("heading", { name: tr("subjects.title") })).toBeInTheDocument();
    expect(screen.getByText(tr("subjects.hidden"))).toBeInTheDocument();
    expect(screen.getByText(/tháng 11/)).toBeInTheDocument();
  });

  it("translates the weekend review with a Vietnamese week title", async () => {
    apiFetch.mockResolvedValue(review);
    renderVi(<ReviewPage />);
    expect(await screen.findByRole("heading", { name: /19 – 25 tháng 10/ })).toBeInTheDocument();
    expect(screen.getByText(tr("review.weekendReview"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tr("review.markReviewed") })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: tr("review.overdue") })).toBeInTheDocument();
    expect(screen.getByText(tr("review.nothingOverdue"))).toBeInTheDocument();
  });
});
