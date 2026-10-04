import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../components/ui/Confirm";
import { ShortcutHelp } from "../components/ShortcutHelp";
import { ToastProvider } from "../components/ui/Toast";
import { I18nProvider } from "../i18n";
import { ShortcutProvider } from "../lib/shortcuts";
import { SettingsAt } from "../test/settingsRoute";
import { SettingsPage } from "./SettingsPage";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: vi.fn(async (path: string) => {
    if (path === "/api/settings/zeus-key") return { configured: true };
    if (path === "/api/sync/status") return { last_run: null, last_success_at: null };
    if (path === "/api/google") return { configured: false, connected: false, email: null, needs_reconnect: false, kinds: [], pending: 0, drive_enabled: false, last_push_at: null, last_push_error: null };
    if (path === "/api/ai/status") return { enabled: false, model: null };
    if (path === "/api/backup/status") return { drive_available: false, last_at: null };
    return [];
  }),
}));

function renderHelp(locale: "en" | "vi") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>
        <ShortcutProvider>
          <ToastProvider>
            <ConfirmProvider>
              <MemoryRouter initialEntries={["/settings/general"]}>
                <Routes>
                  <Route path="/settings/:section?" element={<SettingsPage />} />
                </Routes>
                <ShortcutHelp open onClose={() => {}} />
              </MemoryRouter>
            </ConfirmProvider>
          </ToastProvider>
        </ShortcutProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

function renderAt(url = "/settings/general") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <ShortcutProvider>
          <ToastProvider>
            <ConfirmProvider>
              <SettingsAt url={url} />
            </ConfirmProvider>
          </ToastProvider>
        </ShortcutProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Settings shortcuts", () => {
  it.each([
    ["1", "general"], ["2", "school"], ["3", "subjects"], ["4", "google"], ["5", "ai"], ["6", "backup"],
  ])("%s opens the %s section", async (key, id) => {
    const user = userEvent.setup();
    renderAt(id === "general" ? "/settings/backup" : "/settings/general");
    await user.keyboard(key);
    expect(screen.getByTestId("path")).toHaveTextContent(`/settings/${id}`);
  });

  it("f focuses the finder without typing the letter", async () => {
    const user = userEvent.setup();
    renderAt();
    const finder = screen.getByRole("searchbox", { name: "Find a setting" });
    await user.keyboard("f");
    expect(finder).toHaveFocus();
    expect(finder).toHaveValue("");
  });

  it("digits and f are plain text while typing in the finder", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.type(screen.getByRole("searchbox", { name: "Find a setting" }), "f3");
    expect(screen.getByRole("searchbox", { name: "Find a setting" })).toHaveValue("f3");
    expect(screen.getByTestId("path")).toHaveTextContent("/settings/general");
  });

  it("on a phone a digit opens the section the way a tap does, and f is not offered", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    const user = userEvent.setup();
    renderAt("/settings");
    await user.keyboard("3");
    expect(screen.getByTestId("path")).toHaveTextContent("/settings/subjects");
    await user.click(screen.getByRole("link", { name: "Back to Settings" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/settings");
  });

  it("does not fire on other pages", async () => {
    const user = userEvent.setup();
    renderAt("/start");
    await user.keyboard("2");
    expect(screen.getByTestId("path")).toHaveTextContent("/start");
  });

  it("the help lists them under a Settings group, in English and Vietnamese", async () => {
    renderHelp("en");
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(dialog).getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(within(dialog).getByText("Open School timetable")).toBeInTheDocument();
    expect(within(dialog).getByText("Find a setting")).toBeInTheDocument();
  });

  it("the help is in Vietnamese too", async () => {
    renderHelp("vi");
    const dialog = await screen.findByRole("dialog", { name: "Phím tắt" });
    expect(within(dialog).getByRole("heading", { name: "Cài đặt" })).toBeInTheDocument();
    expect(within(dialog).getByText("Mở Sao lưu")).toBeInTheDocument();
    expect(within(dialog).getByText("Tìm một cài đặt")).toBeInTheDocument();
  });
});
