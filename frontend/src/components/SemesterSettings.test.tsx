import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Semester } from "../types";
import { SemesterSettings } from "./SemesterSettings";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const SEMS: Semester[] = [
  { id: 1, code: "S1", name: "SE S1 (Fundamental)", zeus_group_id: 802, start_date: "2026-10-12", end_date: "2027-01-30", is_active: true },
  { id: 2, code: "S2", name: "SE S2 (Common Core)", zeus_group_id: null, start_date: null, end_date: null, is_active: false },
];

describe("SemesterSettings", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (_p: string, init?: RequestInit) => (init?.method ? {} : SEMS));
  });

  it("saves a Zeus group and activates a semester", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SemesterSettings />
      </QueryClientProvider>,
    );
    fireEvent.change(await screen.findByLabelText("Zeus group for SE S2 (Common Core)"), { target: { value: "905" } });
    await userEvent.click(screen.getByRole("button", { name: "Save SE S2 (Common Core)" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/semesters/2", { method: "PATCH", body: JSON.stringify({ zeus_group_id: 905 }) });
    expect(screen.queryByRole("button", { name: "Make SE S1 (Fundamental) active" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Make SE S2 (Common Core) active" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/semesters/2/activate", { method: "PUT" });
  });
});
