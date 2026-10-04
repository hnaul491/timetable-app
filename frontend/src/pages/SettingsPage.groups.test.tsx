import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../components/ui/Confirm";
import { ToastProvider } from "../components/ui/Toast";
import { SettingsAt } from "../test/settingsRoute";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const deletes = () => apiFetch.mock.calls.filter((c) => String(c[0]).startsWith("/api/settings/sections/") && c[1]?.method === "DELETE");
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
        <ConfirmProvider>
          <SettingsAt />
        </ConfirmProvider>
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

  it("removes a chosen group after confirming", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Remove my group for Chosen subject" }));
    expect(await screen.findByText("Remove your group for “Chosen subject”?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0][0]).toBe("/api/settings/sections/1");
    expect(await screen.findByText("Group removed")).toBeInTheDocument();
  });

  it("keeps the group when the dialog is cancelled, and offers no Remove before a group is chosen", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Remove my group for Chosen subject" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(deletes()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Remove my group for Open subject" })).toBeNull();
  });
});
