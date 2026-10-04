import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/Toast";
import { ConfirmProvider } from "../components/ui/Confirm";
import { SettingsAt } from "../test/settingsRoute";

const SEMESTERS = [
  { id: 1, code: "S3", name: "Fall 2026", zeus_group_id: 10, start_date: null, end_date: null, is_active: true },
  { id: 2, code: "S4", name: "Spring 2027", zeus_group_id: null, start_date: null, end_date: null, is_active: false },
];
const apiFetch = vi.fn(async (path: string, init?: RequestInit) => {
  if (path === "/api/semesters") return SEMESTERS;
  if (path === "/api/semesters/2/activate" && init?.method === "PUT") return {};
  if (path === "/api/settings/zeus-key") return { configured: true };
  if (path === "/api/sync/status") return { last_run: null, last_success_at: null };
  return [];
});
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: [string, RequestInit?]) => apiFetch(...args),
}));

describe("SettingsPage semester switcher (phones)", () => {
  it("has a compact semester select at the top that activates the chosen semester", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ConfirmProvider>
            <SettingsAt url="/settings/general" />
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    const select = await screen.findByRole("combobox", { name: "Semester" });
    expect(select).toHaveValue("1");
    expect(select.closest("[data-mobile-only]")).not.toBeNull();
    // It comes before the other settings cards.
    expect(select.compareDocumentPosition(screen.getByText("Appearance")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.selectOptions(select, "2");
    expect(apiFetch).toHaveBeenCalledWith("/api/semesters/2/activate", { method: "PUT" });
  });

  afterEach(() => vi.unstubAllGlobals());
});
