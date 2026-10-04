import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecurringList } from "./RecurringList";
import { ConfirmProvider } from "./ui/Confirm";
import { ToastProvider } from "./ui/Toast";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const RULE = { id: 5, title: "French (external)", kind: "french_ext", weekdays: [0, 3], start_time: "19:30", end_time: "21:00",
               from_date: "2026-10-19", until_date: "2026-12-17", location: "Alliance", occurrences: 18 };

describe("RecurringList", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (_p: string, init?: RequestInit) => (init?.method === "DELETE" ? { deleted: true } : [RULE]));
  });

  it("lists rules and deletes after the dialog is confirmed", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ConfirmProvider>
            <RecurringList />
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("French (external)")).toBeInTheDocument();
    expect(screen.getByText(/Mon, Thu · 19:30–21:00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete French (external)" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/api/recurring/5", { method: "DELETE" });
    await userEvent.click(screen.getByRole("button", { name: "Delete French (external)" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/recurring/5", { method: "DELETE" });
    expect(await screen.findByText("Repeating event deleted")).toBeInTheDocument();
  });
});
