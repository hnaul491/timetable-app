import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecurringList } from "./RecurringList";

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

  it("lists rules and deletes after a second click", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RecurringList />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("French (external)")).toBeInTheDocument();
    expect(screen.getByText(/Mon, Thu · 19:30–21:00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete French (external)" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/api/recurring/5", { method: "DELETE" });
    await userEvent.click(screen.getByRole("button", { name: "Click again to delete French (external)" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/recurring/5", { method: "DELETE" });
  });
});
