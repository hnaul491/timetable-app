import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Semester } from "../types";
import { SemesterSettings } from "./SemesterSettings";
import { ConfirmProvider } from "./ui/Confirm";
import { ToastProvider } from "./ui/Toast";

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

  function renderSems() {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ConfirmProvider>
            <SemesterSettings />
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  it("saves a Zeus group and activates a semester", async () => {
    renderSems();
    fireEvent.change(await screen.findByLabelText("Zeus group for SE S2 (Common Core)"), { target: { value: "905" } });
    await userEvent.click(screen.getByRole("button", { name: "Save SE S2 (Common Core)" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/semesters/2", { method: "PATCH", body: JSON.stringify({ zeus_group_id: 905 }) });
    expect(screen.queryByRole("button", { name: "Make SE S1 (Fundamental) active" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Make SE S2 (Common Core) active" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/semesters/2/activate", { method: "PUT" });
  });

  it("toasts after saving and activating", async () => {
    renderSems();
    fireEvent.change(await screen.findByLabelText("Zeus group for SE S2 (Common Core)"), { target: { value: "905" } });
    await userEvent.click(screen.getByRole("button", { name: "Save SE S2 (Common Core)" }));
    expect(await screen.findByText("Semester saved")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Make SE S2 (Common Core) active" }));
    expect(await screen.findByText("SE S2 (Common Core) is now active")).toBeInTheDocument();
  });

  it("asks before clearing the group of the active semester", async () => {
    renderSems();
    fireEvent.change(await screen.findByLabelText("Zeus group for SE S1 (Fundamental)"), { target: { value: "" } });
    await userEvent.click(screen.getByRole("button", { name: "Save SE S1 (Fundamental)" }));
    const dialog = screen.getByRole("dialog", { name: "Clear the Zeus group of SE S1 (Fundamental)?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/api/semesters/1", expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Save SE S1 (Fundamental)" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear group" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/semesters/1", { method: "PATCH", body: JSON.stringify({ zeus_group_id: null }) });
  });
});
