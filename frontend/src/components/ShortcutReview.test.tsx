import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { apiFetch } from "../lib/api";
import { ShortcutProvider, useShortcut } from "../lib/shortcuts";
import { ShortcutHelp } from "./ShortcutHelp";
import { ShortcutRoot } from "./ShortcutRoot";
import { ShortcutSettings } from "./ShortcutSettings";
import { ConfirmProvider } from "./ui/Confirm";
import { ToastProvider } from "./ui/Toast";

const server = { language: null, shortcuts: {} as Record<string, string | null>, single_key_shortcuts: true };

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(async (path: string, init?: RequestInit) => {
      if (path !== "/api/preferences") return [];
      if (init?.method === "PUT") Object.assign(server, JSON.parse(String(init.body)));
      return structuredClone(server);
    }),
  };
});

function Probe() {
  useShortcut("cal-today", "t", () => {}, { label: "shortcuts.today" });
  useShortcut("cal-new", "n", () => {}, { label: "shortcuts.newEvent" });
  useShortcut("cal-week", "w", () => {}, { label: "shortcuts.weekView" });
  useShortcut("go-board", "g b", () => {}, { label: "shortcuts.goBoard" });
  useShortcut("go-calendar", "g c", () => {}, { label: "shortcuts.goCalendar" });
  return null;
}

beforeEach(() => {
  server.shortcuts = {};
  server.single_key_shortcuts = true;
  vi.mocked(apiFetch).mockClear();
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <ToastProvider>
          <ConfirmProvider>
            <MemoryRouter>
              <ShortcutRoot>
                <Probe />
                <ShortcutSettings />
              </ShortcutRoot>
            </MemoryRouter>
          </ConfirmProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-shortcut="${id}"]`)!;
const puts = () => vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => JSON.parse(String(init!.body)));
const change = (label: string) => screen.getByRole("button", { name: `Change keys for ${label}` });

describe("capture review fixes", () => {
  it("never records Tab, Enter or Space (alone or in a sequence) and focuses Cancel", { timeout: 20000 }, async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Go to today");
    await user.click(change("Go to today"));
    expect(within(row("cal-today")).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(await within(row("cal-today")).findByRole("alert")).toHaveTextContent("used by your browser");
    for (const keys of ["{Enter}", " ", "{Shift>}{Tab}{/Shift}"]) {
      await user.click(change("Go to today"));
      await user.keyboard(keys);
      expect(await within(row("cal-today")).findByRole("alert")).toBeInTheDocument();
    }
    await user.click(change("Go to today"));
    await user.keyboard("g");
    await user.keyboard("{Enter}");
    expect(await within(row("cal-today")).findByRole("alert")).toBeInTheDocument();
    expect(puts()).toEqual([]);
  });

  it("flags a plain key that starts another sequence in the same group, and swaps", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Go to today");
    await user.click(change("Go to Board"));
    await user.keyboard("t");
    const alert = await within(row("go-board")).findByRole("alert", {}, { timeout: 3000 });
    expect(alert).toHaveTextContent("already used for “Go to today”");
    await user.click(within(alert).getByRole("button", { name: "Cancel" }));
    expect(puts()).toEqual([]);
  });

  it("flags a sequence whose first key is another action's single key", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Go to today");
    await user.click(change("Go to today"));
    await user.keyboard("gb");
    expect(await within(row("cal-today")).findByRole("alert")).toHaveTextContent("already used for “Go to Board”");
    await user.click(change("Go to today"));
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true })));
    expect(await within(row("cal-today")).findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent("already used for");
    expect(puts()).toEqual([]);
  });

  it("swapping a prefix clash gives the other action the old keys", async () => {
    const user = userEvent.setup();
    server.shortcuts = { "cal-week": "g" };
    setup();
    await waitFor(() => expect(row("cal-week").querySelector("kbd")).toHaveTextContent("G"));
    await user.click(change("Go to today"));
    await user.keyboard("gc");
    const alert = await within(row("cal-today")).findByRole("alert");
    expect(alert).toHaveTextContent("already used for");
    await user.click(within(alert).getByRole("button", { name: "Swap" }));
    await waitFor(() => expect(puts().length).toBe(1));
    expect(puts()[0].shortcuts["cal-today"]).toBe("g c");
  });
});

describe("help and single-key toggle", () => {
  it("hides shortcuts the single-key toggle switches off", async () => {
    render(
      <I18nProvider locale="en">
        <ShortcutProvider singleKey={false} overrides={{ "go-board": "Mod+b" }}>
          <MemoryRouter initialEntries={["/"]}>
            <Probe />
            <ShortcutHelp open onClose={() => {}} />
          </MemoryRouter>
        </ShortcutProvider>
      </I18nProvider>,
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Go to Board")).toBeInTheDocument();
    expect(within(dialog).queryByText("Go to today")).toBeNull();
    expect(within(dialog).queryByText("Go to Calendar")).toBeNull();
  });
});
