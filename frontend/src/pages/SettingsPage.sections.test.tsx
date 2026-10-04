import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { ConfirmProvider } from "../components/ui/Confirm";
import { ToastProvider } from "../components/ui/Toast";
import { apiFetch } from "../lib/api";
import { SettingsAt } from "../test/settingsRoute";

const recent = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

vi.mock("../lib/google", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/google")>()),
  takeProviderRefreshToken: vi.fn(async () => "refresh-token"),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(async (path: string) => {
      switch (path) {
        case "/api/settings/zeus-key":
          return { configured: true };
        case "/api/sync/status":
          return { last_run: { status: "ok", finished_at: recent }, last_success_at: recent };
        case "/api/subjects":
          return [{ id: 1, display_name: "Algo", color: "#112233", hidden: false, aliases: [] }, { id: 2, display_name: "DB", color: "#112233", hidden: true, aliases: [] }];
        case "/api/google":
          return { configured: true, connected: true, email: "me@example.com", needs_reconnect: true, kinds: [], pending: 0, drive_enabled: true, last_push_at: null, last_push_error: null };
        case "/api/ai/status":
          return { enabled: false, model: null };
        case "/api/backup/status":
          return { drive_available: true, last_at: null };
        default:
          return [];
      }
    }),
  };
});

function mount(url?: string, locale: "en" | "vi" = "en", before?: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>
        <ToastProvider>
          <ConfirmProvider>
            <SettingsAt url={url} before={before} />
          </ConfirmProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}
const path = () => screen.getByTestId("path").textContent;
const list = () => screen.getByRole("navigation", { name: "Settings sections" });

beforeEach(() => localStorage.setItem("timetable:theme", "dark"));
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("Settings sections (desktop)", () => {
  it("shows only the section of the route", async () => {
    const markers: [string, () => void][] = [
      ["general", () => expect(screen.getByRole("heading", { level: 3, name: "Appearance" })).toBeInTheDocument()],
      ["school", () => expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument()],
      ["subjects", () => expect(screen.getByRole("heading", { level: 3, name: "Subjects" })).toBeInTheDocument()],
      ["google", () => expect(screen.getByRole("heading", { level: 3, name: "Google Calendar" })).toBeInTheDocument()],
      ["ai", () => expect(screen.getByRole("heading", { level: 3, name: "AI assistant" })).toBeInTheDocument()],
      ["backup", () => expect(screen.getByRole("heading", { level: 3, name: "Backup" })).toBeInTheDocument()],
    ];
    for (const [id, check] of markers) {
      const view = mount(`/settings/${id}`);
      expect(await screen.findByRole("link", { current: "page" })).toHaveAttribute("href", `/settings/${id}`);
      check();
      expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
      if (id !== "general") expect(screen.queryByRole("heading", { level: 3, name: "Appearance" })).toBeNull();
      if (id !== "backup") expect(screen.queryByRole("heading", { level: 3, name: "Backup" })).toBeNull();
      view.unmount();
    }
  });

  it("opens General at /settings and redirects unknown sections", async () => {
    mount("/settings");
    await waitFor(() => expect(path()).toBe("/settings/general"));
    expect(screen.getByRole("heading", { level: 3, name: "Appearance" })).toBeInTheDocument();
  });

  it("sends an unknown section back to /settings (which then shows General)", async () => {
    mount("/settings/nope");
    await waitFor(() => expect(path()).toBe("/settings/general"));
  });

  it("lists the six sections with their status lines", async () => {
    mount("/settings/general");
    const nav = within(list());
    expect(nav.getAllByRole("link")).toHaveLength(6);
    expect(await nav.findByText("Dark · English")).toBeInTheDocument();
    expect(await nav.findByText("Synced 2 h ago")).toBeInTheDocument();
    expect(await nav.findByText("2 subjects · 1 hidden")).toBeInTheDocument();
    expect(await nav.findByText("Reconnect needed")).toBeInTheDocument();
    expect(await nav.findByText("Off")).toBeInTheDocument();
    expect(await nav.findByText("Never")).toBeInTheDocument();
    const dots = list().querySelectorAll("[data-dot]");
    expect([...dots].map((d) => d.getAttribute("data-dot"))).toEqual(["none", "ok", "none", "warn", "none", "none"]);
  });

  it("navigates between sections from the list", async () => {
    mount("/settings/general");
    await userEvent.click(within(list()).getByRole("link", { name: /Google/ }));
    expect(path()).toBe("/settings/google");
    expect(await screen.findByRole("heading", { level: 3, name: "Google Calendar" })).toBeInTheDocument();
  });

  it("plays the enter animation, re-keyed per section", async () => {
    mount("/settings/general");
    const first = document.querySelector("[data-section]")!;
    expect(first).toHaveAttribute("data-section", "general");
    expect(first.className).toContain("motion-safe:*:animate-[settings-in_180ms_ease-out]");
    await userEvent.click(within(list()).getByRole("link", { name: /Backup/ }));
    const second = document.querySelector("[data-section]")!;
    expect(second).toHaveAttribute("data-section", "backup");
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
  });

  it("goes to Google after a connect redirect lands on /settings", async () => {
    sessionStorage.setItem("timetable:google-connect", "1");
    mount("/settings");
    await waitFor(() => expect(path()).toBe("/settings/google"));
    await waitFor(() =>
      expect(vi.mocked(apiFetch).mock.calls.filter(([p, init]) => p === "/api/google/connect" && init?.method === "POST")).toHaveLength(1),
    );
  });
});

describe("Settings finder", () => {
  it("only filters while typing: the open section stays, with a hint to open the first match", async () => {
    mount("/settings/general");
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a setting" }), "model");
    expect(within(list()).getAllByRole("link")).toHaveLength(1);
    expect(path()).toBe("/settings/general");
    expect(screen.getByRole("heading", { level: 3, name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByText("Press Enter to open AI assistant")).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(path()).toBe("/settings/ai");
    expect(screen.getByRole("heading", { level: 3, name: "AI assistant" })).toBeInTheDocument();
    expect(screen.queryByText(/Press Enter/)).toBeNull();
  });

  it("keeps the current section without a hint when it still matches", async () => {
    mount("/settings/backup");
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a setting" }), "drive");
    expect(within(list()).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/settings/google", "/settings/backup"]);
    expect(path()).toBe("/settings/backup");
    expect(screen.queryByText(/Press Enter/)).toBeNull();
  });

  it("matches Vietnamese keywords without accents", async () => {
    mount("/settings/google", "vi");
    const box = screen.getByRole("searchbox", { name: "Tìm cài đặt" });
    await userEvent.type(box, "thoi khoa");
    expect(screen.getByText("Nhấn Enter để mở Thời khoá biểu trường")).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(path()).toBe("/settings/school");
    await userEvent.clear(box);
    await userEvent.type(box, "sao luu{Enter}");
    expect(path()).toBe("/settings/backup");
    await userEvent.clear(box);
    await userEvent.type(box, "TIẾNG VIỆT{Enter}");
    expect(path()).toBe("/settings/general");
  });

  it("says when nothing matches, Enter does nothing, and Escape clears the search", async () => {
    mount("/settings/general");
    const box = screen.getByRole("searchbox", { name: "Find a setting" });
    await userEvent.type(box, "zzz{Enter}");
    expect(path()).toBe("/settings/general");
    expect(screen.getByText("No setting matches “zzz”.")).toBeInTheDocument();
    expect(within(list()).queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 3, name: "Appearance" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(box).toHaveValue("");
    expect(within(list()).getAllByRole("link")).toHaveLength(6);
    expect(screen.queryByText(/No setting matches/)).toBeNull();
  });
});

describe("Settings on a phone", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  });

  it("shows the list, opens a section with a back button, and returns", async () => {
    mount("/settings", "en", ["/start"]);
    expect(path()).toBe("/settings");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(within(list()).getAllByRole("link")).toHaveLength(6);
    expect(await within(list()).findByText("Synced 2 h ago")).toBeInTheDocument();

    await userEvent.click(within(list()).getByRole("link", { name: /Backup/ }));
    expect(path()).toBe("/settings/backup");
    const heading = screen.getByRole("heading", { level: 2, name: "Backup" });
    expect(heading).toHaveFocus();
    expect(document.querySelector("[data-section]")?.className).toContain("settings-in");
    expect(screen.queryByRole("navigation", { name: "Settings sections" })).toBeNull();

    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Back to Settings" }));
    expect(path()).toBe("/settings");
    expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeInTheDocument();
    // the back button popped the history entry: browser Back leaves Settings instead of reopening Backup
    await userEvent.click(screen.getByRole("button", { name: "history-back" }));
    expect(path()).toBe("/start");
  });

  it("replaces the entry when the section was opened directly", async () => {
    mount("/settings/backup", "en", ["/start"]);
    await userEvent.click(screen.getByRole("link", { name: "Back to Settings" }));
    expect(path()).toBe("/settings");
    await userEvent.click(screen.getByRole("button", { name: "history-back" }));
    expect(path()).toBe("/start");
  });
});
