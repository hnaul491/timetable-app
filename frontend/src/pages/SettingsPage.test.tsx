import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/Toast";
import { ApiError } from "../lib/api";
import { SettingsPage } from "./SettingsPage";

const syncRun = { status: "ok", fetched: 12, inserted: 1, updated: 2, cancelled: 0, finished_at: "2026-10-19T10:00:00Z", error: null };
let syncOk = false;

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/sync" && init?.method === "POST") {
        if (syncOk) return syncRun;
        throw new ApiError(500, "boom");
      }
      if (path === "/api/settings/zeus-key" && init?.method === "PUT") return {};
      if (path === "/api/settings/zeus-key") return { configured: true };
      if (path === "/api/sync/status") return { last_run: null, last_success_at: null };
      if (path === "/api/settings/sections")
        return [{ subject_id: 1, subject_name: "Adapting to a New Culture", sections: ["G1", "G2"], chosen: "ALL" }];
      return [];
    }),
  };
});

describe("SettingsPage", () => {
  it("shows the error when Sync now fails", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SettingsPage />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("offers an All groups choice for grouped subjects", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SettingsPage />
        </ToastProvider>
      </QueryClientProvider>,
    );
    const select = await screen.findByRole("combobox", { name: /Adapting to a New Culture/ });
    expect(select).toHaveValue("ALL");
    expect(screen.getByRole("option", { name: "All groups" })).toBeInTheDocument();
  });

  it("toasts the sync result and a saved link", async () => {
    syncOk = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SettingsPage />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(await screen.findByText("12 classes checked")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Zeus ICS subscription link"), "https://zeus.example/ics");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Zeus link saved")).toBeInTheDocument();
    syncOk = false;
  });
});
