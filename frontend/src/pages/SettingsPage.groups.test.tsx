import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/Toast";
import { SettingsAt } from "../test/settingsRoute";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const puts = () => apiFetch.mock.calls.filter((c) => c[0] === "/api/settings/sections" && c[1]?.method === "PUT");

function setup() {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (path === "/api/settings/zeus-key") return { configured: true };
    if (path === "/api/sync/status") return { last_run: null, last_success_at: null };
    if (path === "/api/settings/sections")
      return [
        { subject_id: 1, subject_name: "Chosen subject", sections: ["G1", "G2"], chosen: "G1" },
        { subject_id: 2, subject_name: "Open subject", sections: ["G1", "G2"], chosen: null },
      ];
    return [];
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SettingsAt />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("SettingsPage My groups", () => {
  beforeEach(() => vi.clearAllMocks());

  it("drops the Choose option once a group is chosen and never saves an empty group", async () => {
    setup();
    const chosen = (await screen.findByLabelText("Chosen subject")) as HTMLSelectElement;
    expect(Array.from(chosen.options).some((o) => o.value === "")).toBe(false);
    fireEvent.change(chosen, { target: { value: "" } });
    expect(puts()).toHaveLength(0);
  });

  it("keeps Choose disabled while nothing is chosen yet", async () => {
    setup();
    const open = (await screen.findByLabelText("Open subject")) as HTMLSelectElement;
    const choose = Array.from(open.options).find((o) => o.value === "")!;
    expect(choose.disabled).toBe(true);
    fireEvent.change(open, { target: { value: "" } });
    expect(puts()).toHaveLength(0);
  });
});
