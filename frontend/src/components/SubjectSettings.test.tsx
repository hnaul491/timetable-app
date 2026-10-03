import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubjectSummary } from "../types";
import { SubjectSettings } from "./SubjectSettings";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const base = { hidden: false, aliases: [], sessions: 0, sessions_done: 0, next_start: null, exam_start: null, exam_room: null, open_tasks: 0, note_count: 0 };
const SUBJECTS: SubjectSummary[] = [
  { ...base, id: 1, display_name: "French for Fall 26 T1", color: "#0E7F72" },
  { ...base, id: 2, display_name: "French for Spring F26 T1", color: "#6A45D8" },
];

function renderIt() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SubjectSettings />
    </QueryClientProvider>,
  );
}

describe("SubjectSettings", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (_p: string, init?: RequestInit) => (init?.method ? {} : SUBJECTS));
  });

  it("renames, recolours and hides a subject", async () => {
    renderIt();
    const name = await screen.findByLabelText("Name of French for Spring F26 T1");
    fireEvent.change(name, { target: { value: "French (spring)" } });
    await userEvent.click(screen.getByRole("button", { name: "Save name of French for Spring F26 T1" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/subjects/2", { method: "PATCH", body: JSON.stringify({ display_name: "French (spring)" }) });
    fireEvent.change(screen.getByLabelText("Colour of French for Spring F26 T1"), { target: { value: "#aa00ff" } });
    expect(apiFetch).not.toHaveBeenCalledWith("/api/subjects/2", { method: "PATCH", body: JSON.stringify({ color: "#aa00ff" }) });
    fireEvent.blur(screen.getByLabelText("Colour of French for Spring F26 T1"));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/subjects/2", { method: "PATCH", body: JSON.stringify({ color: "#aa00ff" }) }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Hide French for Spring F26 T1" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/subjects/2", { method: "PATCH", body: JSON.stringify({ hidden: true }) });
  });

  it("merges only after a second click", async () => {
    renderIt();
    await userEvent.selectOptions(await screen.findByLabelText("Merge French for Spring F26 T1 into"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Merge French for Spring F26 T1" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/api/subjects/2/merge", expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Click again to merge French for Spring F26 T1" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/subjects/2/merge", { method: "POST", body: JSON.stringify({ into_id: 1 }) });
  });
});
