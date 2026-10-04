import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { ConfirmProvider } from "../components/ui/Confirm";
import { ToastProvider } from "../components/ui/Toast";
import { SHORTCUT_CATALOG } from "../lib/shortcutCatalog";
import { ShortcutProvider } from "../lib/shortcuts";
import { SettingsAt } from "../test/settingsRoute";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: vi.fn(async () => []),
}));

describe("Settings key 7", () => {
  it("is catalogued with a label and opens the Shortcuts section", async () => {
    expect(SHORTCUT_CATALOG.find((c) => c.id === "settings-section-7")).toMatchObject({ keys: "7", label: "shortcuts.settingsSection7", group: "settings" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <I18nProvider locale="en">
          <ToastProvider>
            <ConfirmProvider>
              <ShortcutProvider>
                <SettingsAt url="/settings/general" />
              </ShortcutProvider>
            </ConfirmProvider>
          </ToastProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { level: 3, name: "Appearance" });
    await userEvent.keyboard("7");
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/settings/shortcuts"));
  });
});
