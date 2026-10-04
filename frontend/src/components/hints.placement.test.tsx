import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { Preferences } from "../i18n/LanguageRoot";
import { ChromeProvider } from "../lib/chrome";
import { ShortcutProvider } from "../lib/shortcuts";
import { CalendarPage } from "../pages/CalendarPage";
import { SettingsAt } from "../test/settingsRoute";
import { ConfirmProvider } from "./ui/Confirm";
import { ToastProvider } from "./ui/Toast";
import { Layout } from "./Layout";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/events")) return { events: [], missing_sections: [] };
    if (path === "/api/sync/status") return { last_run: null, last_success_at: null };
    return [];
  });
});

function renderTree(ui: React.ReactNode, prefs: Partial<Preferences> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["preferences"], { language: "en", ...prefs });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <ShortcutProvider overrides={prefs.shortcuts}>
          <ToastProvider>
            <ConfirmProvider>
              <ChromeProvider>{ui}</ChromeProvider>
            </ConfirmProvider>
          </ToastProvider>
        </ShortcutProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const chips = (root: ParentNode, id: string) => [...root.querySelectorAll(`[data-shortcut-hint="${id}"] kbd`)].map((k) => k.textContent);

describe("hints in the sidebar", () => {
  const layout = (prefs: Partial<Preferences> = {}) =>
    renderTree(
      <MemoryRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="*" element={<p>page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      prefs,
    );

  it("shows the go-to sequences and the search keys on the expanded sidebar", () => {
    layout();
    const nav = screen.getAllByRole("navigation", { name: "Main" }).find((n) => n.className.includes("md:flex"))!;
    expect(chips(nav, "go-calendar")).toEqual(["G", "C"]);
    expect(chips(nav, "go-board")).toEqual(["G", "B"]);
    expect(chips(nav, "go-settings")).toEqual(["G", ","]);
    expect(chips(nav, "search")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute("title", "Collapse sidebar ([)");
  });

  it("follows a customised key and drops all hints when switched off", () => {
    const { unmount } = layout({ shortcuts: { "go-board": "g x" } });
    expect(chips(document.body, "go-board")).toEqual(["G", "X"]);
    unmount();
    layout({ shortcut_hints: false });
    expect(document.querySelector("kbd")).toBeNull();
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute("title", "Collapse sidebar");
  });
});

describe("hints on the calendar toolbar", () => {
  it("labels Today, the views, Add event and the icon buttons", async () => {
    renderTree(
      <MemoryRouter initialEntries={["/?date=2026-11-11&view=week"]}>
        <Routes>
          <Route path="/" element={<CalendarPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const header = (await screen.findByRole("heading", { name: /November 2026/ })).closest("header")!;
    expect(chips(header, "cal-today")).toEqual(["T"]);
    expect(chips(header, "cal-week")).toEqual(["W"]);
    expect(chips(header, "cal-day")).toEqual(["D"]);
    expect(chips(header, "cal-new")).toEqual(["N"]);
    expect(chips(header, "go-free-time")).toEqual(["G", "F"]);
    expect(within(header).getByRole("button", { name: "Previous week" })).toHaveAttribute("title", "Previous week (←)");
    expect(within(header).getByRole("button", { name: "Next week" })).toHaveAttribute("aria-keyshortcuts", "ArrowRight");
    expect(within(header).getByRole("button", { name: "Full-screen calendar" })).toHaveAttribute("title", "Full-screen calendar (F)");
    expect(within(header).getByRole("button", { name: /Today/ })).toHaveAttribute("aria-keyshortcuts", "T");
  });
});

describe("hints in the settings list", () => {
  it("numbers the sections on the desktop rail and labels the finder", async () => {
    renderTree(<SettingsAt url="/settings/general" />);
    const rail = await screen.findByRole("navigation", { name: "Settings sections" });
    expect(chips(rail, "settings-section-1")).toEqual(["1"]);
    expect(chips(rail, "settings-section-7")).toEqual(["7"]);
    expect(chips(document.body, "settings-find")).toEqual(["F"]);
  });
});
