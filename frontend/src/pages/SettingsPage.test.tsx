import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { SettingsPage } from "./SettingsPage";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/sync" && init?.method === "POST") throw new ApiError(500, "boom");
      if (path === "/api/settings/zeus-key") return { configured: true };
      if (path === "/api/sync/status") return { last_run: null, last_success_at: null };
      return [];
    }),
  };
});

describe("SettingsPage", () => {
  it("shows the error when Sync now fails", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SettingsPage />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});
