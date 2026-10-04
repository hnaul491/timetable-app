import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { apiFetch } from "../lib/api";
import { SHORTCUT_CATALOG } from "../lib/shortcutCatalog";
import { useShortcut } from "../lib/shortcuts";
import { ShortcutHelp } from "./ShortcutHelp";
import { ShortcutRoot } from "./ShortcutRoot";
import { ShortcutSettings } from "./ShortcutSettings";
import { ConfirmProvider } from "./ui/Confirm";
import { ToastProvider } from "./ui/Toast";
import { MemoryRouter } from "react-router";

type Server = { language: null; shortcuts: Record<string, string | null>; single_key_shortcuts: boolean; fail: boolean };
let server: Server;

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(async (path: string, init?: RequestInit) => {
      if (path !== "/api/preferences") return [];
      if (init?.method === "PUT") {
        if (server.fail) throw new Error("boom");
        Object.assign(server, JSON.parse(String(init.body)));
      }
      const { fail: _fail, ...prefs } = server;
      return structuredClone(prefs);
    }),
  };
});

const calls = {
  today: vi.fn(),
  newEvent: vi.fn(),
  board: vi.fn(),
  week: vi.fn(),
};

function Probe() {
  useShortcut("cal-today", "t", calls.today, { label: "shortcuts.today" });
  useShortcut("cal-new", "n", calls.newEvent, { label: "shortcuts.newEvent" });
  useShortcut("go-board", "g b", calls.board, { label: "shortcuts.goBoard" });
  useShortcut("cal-week", "w", calls.week, { label: "shortcuts.weekView" });
  return null;
}

function Tree({ client, locale = "en" }: { client: QueryClient; locale?: "en" | "vi" }) {
  return (
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>
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
    </QueryClientProvider>
  );
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

function setup(locale: "en" | "vi" = "en") {
  const client = newClient();
  const view = render(<Tree client={client} locale={locale} />);
  return { client, view };
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-shortcut="${id}"]`)!;
const kbds = (id: string) => [...row(id).querySelectorAll("kbd")].map((k) => k.textContent);
const puts = () => vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => JSON.parse(String(init!.body)));

beforeEach(() => {
  server = { language: null, shortcuts: {}, single_key_shortcuts: true, fail: false };
  Object.values(calls).forEach((f) => f.mockClear());
  vi.mocked(apiFetch).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A plain key is recorded once no second key follows within a second, so callers wait for the result. */
function pressAlone(key: string) {
  act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
  expect(screen.getByRole("status")).toHaveTextContent(`${key.toUpperCase()} then…`);
}
const LATE = { timeout: 3000 };

async function change(user: ReturnType<typeof userEvent.setup>, label: string, keys: string) {
  await user.click(screen.getByRole("button", { name: `Change keys for ${label}` }));
  await user.keyboard(keys);
}

describe("Shortcuts settings", () => {
  it("lists actions by page with their keys", async () => {
    setup();
    await screen.findByRole("heading", { level: 4, name: "Everywhere" });
    expect(screen.getByRole("heading", { level: 4, name: "Calendar" })).toBeInTheDocument();
    expect(kbds("cal-today")).toEqual(["T"]);
    expect(kbds("go-board")).toEqual(["G", "B"]);
    expect(within(row("cal-today")).queryByRole("button", { name: /Reset/ })).toBeNull();
  });

  it("rebinds a key: the old key stops, the new key works, and it saves", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Go to today");
    await user.keyboard("t");
    expect(calls.today).toHaveBeenCalledTimes(1);

    await change(user, "Go to today", "{Control>}j{/Control}");
    await waitFor(() => expect(kbds("cal-today")).toEqual(["Ctrl", "J"]));
    expect(puts()).toEqual([{ shortcuts: { "cal-today": "Mod+j" } }]);
    expect(row("cal-today")).toHaveTextContent("Customised");

    await user.keyboard("t");
    expect(calls.today).toHaveBeenCalledTimes(1);
    await user.keyboard("{Control>}j{/Control}");
    expect(calls.today).toHaveBeenCalledTimes(2);
  });

  it("records a two-key sequence and a plain key (after a short wait)", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Go to today");
    await change(user, "Go to today", "gx");
    await waitFor(() => expect(kbds("cal-today")).toEqual(["G", "X"]));
    await user.keyboard("gx");
    expect(calls.today).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Change keys for New event" }));
    pressAlone("q");
    await waitFor(() => expect(kbds("cal-new")).toEqual(["Q"]), LATE);
  });

  it("Escape cancels without saving, and the keys are not treated as shortcuts while recording", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Go to today");
    await user.click(screen.getByRole("button", { name: "Change keys for Go to today" }));
    expect(screen.getByText("Press the new keys…")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Press the new keys…")).toBeNull();
    expect(puts()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Change keys for Go to today" }));
    await user.keyboard("{Control>}n{/Control}");
    expect(calls.newEvent).not.toHaveBeenCalled();
  });

  it("refuses keys the browser owns", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Go to today");
    await change(user, "Go to today", "{Control>}w{/Control}");
    expect(await within(row("cal-today")).findByRole("alert")).toHaveTextContent("Ctrl+W is used by your browser");
    expect(kbds("cal-today")).toEqual(["T"]);
    expect(puts()).toEqual([]);
    await change(user, "Go to today", "{F5}");
    expect(await within(row("cal-today")).findByRole("alert")).toHaveTextContent("F5 is used by your browser");
  });

  it("turns an action off and on", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Go to today");
    await user.click(screen.getByRole("button", { name: "Turn off Go to today" }));
    await waitFor(() => expect(within(row("cal-today")).getByText("Off")).toBeInTheDocument());
    expect(puts()).toEqual([{ shortcuts: { "cal-today": null } }]);
    await user.keyboard("t");
    expect(calls.today).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Turn on Go to today" }));
    await waitFor(() => expect(kbds("cal-today")).toEqual(["T"]));
    expect(puts()[1]).toEqual({ shortcuts: {} });
    await user.keyboard("t");
    expect(calls.today).toHaveBeenCalledTimes(1);
  });

  it("resets one action", async () => {
    const user = userEvent.setup();
    server.shortcuts = { "cal-today": "m", "cal-new": "k" };
    setup();
    await waitFor(() => expect(kbds("cal-today")).toEqual(["M"]));
    await user.click(screen.getByRole("button", { name: "Reset keys for Go to today" }));
    await waitFor(() => expect(kbds("cal-today")).toEqual(["T"]));
    expect(puts()).toEqual([{ shortcuts: { "cal-new": "k" } }]);
    expect(kbds("cal-new")).toEqual(["K"]);
  });

  it("resets everything after confirming", async () => {
    const user = userEvent.setup();
    server.shortcuts = { "cal-today": "m", "cal-new": null };
    setup();
    await waitFor(() => expect(kbds("cal-today")).toEqual(["M"]));
    await user.click(screen.getByRole("button", { name: "Reset all to defaults" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset all shortcuts?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(puts()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Reset all to defaults" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Reset all to defaults" }));
    await waitFor(() => expect(kbds("cal-today")).toEqual(["T"]));
    expect(puts()).toEqual([{ shortcuts: {} }]);
    expect(kbds("cal-new")).toEqual(["N"]);
    expect(screen.queryByRole("button", { name: "Reset all to defaults" })).toBeNull();
  });

  it("offers Swap or Cancel when the keys are taken, and swaps both", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Go to today");
    await user.click(screen.getByRole("button", { name: "Change keys for Go to today" }));
    pressAlone("n");
    const alert = await within(row("cal-today")).findByRole("alert", {}, LATE);
    expect(alert).toHaveTextContent("N is already used for “New event”");
    expect(puts()).toEqual([]);

    await user.click(within(alert).getByRole("button", { name: "Cancel" }));
    expect(within(row("cal-today")).queryByRole("alert")).toBeNull();
    expect(kbds("cal-today")).toEqual(["T"]);

    await user.click(screen.getByRole("button", { name: "Change keys for Go to today" }));
    pressAlone("n");
    await user.click(within(await within(row("cal-today")).findByRole("alert", {}, LATE)).getByRole("button", { name: "Swap" }));
    await waitFor(() => expect(kbds("cal-today")).toEqual(["N"]));
    expect(kbds("cal-new")).toEqual(["T"]);
    expect(puts()).toEqual([{ shortcuts: { "cal-today": "n", "cal-new": "t" } }]);
    await user.keyboard("n");
    expect(calls.today).toHaveBeenCalledTimes(1);
    await user.keyboard("t");
    expect(calls.newEvent).toHaveBeenCalledTimes(1);
  });

  it("page groups may reuse keys, but a clash inside one page or with Everywhere is a conflict", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Go to today");
    // Settings section 1 and Free time day 1 both default to "1": no conflict between pages.
    await user.click(screen.getByRole("button", { name: "Change keys for Open Subjects" }));
    pressAlone("1");
    expect(await within(row("settings-section-3")).findByRole("alert", {}, LATE)).toHaveTextContent("already used for “Open General”");
    await user.click(within(row("settings-section-3")).getByRole("button", { name: "Cancel" }));
    // Free time day 3 to "1" clashes only with Free time day 1, not Settings.
    await user.click(screen.getByRole("button", { name: "Change keys for Toggle Wednesday" }));
    pressAlone("1");
    expect(await within(row("free-day-3")).findByRole("alert", {}, LATE)).toHaveTextContent("already used for “Toggle Monday”");
  });

  it("toggles the key hints setting, default on, in English and Vietnamese", async () => {
    const user = userEvent.setup();
    setup();
    const toggle = await screen.findByRole("checkbox", { name: /Show key hints on buttons/ });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(puts()).toEqual([{ shortcut_hints: false }]));
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(puts()[1]).toEqual({ shortcut_hints: true }));
  });

  it("labels the key hints setting in Vietnamese", async () => {
    setup("vi");
    expect(await screen.findByRole("checkbox", { name: /Hiện phím tắt trên nút/ })).toBeChecked();
  });

  it("toggles single-key shortcuts", async () => {
    const user = userEvent.setup();
    setup();
    const toggle = await screen.findByRole("checkbox", { name: /Single-key shortcuts/ });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(/voice control/);
    await user.click(toggle);
    await waitFor(() => expect(puts()).toEqual([{ single_key_shortcuts: false }]));
    expect(toggle).not.toBeChecked();
    document.body.focus();
    await user.keyboard("t");
    expect(calls.today).not.toHaveBeenCalled();
    await user.click(toggle);
    await waitFor(() => expect(puts()[1]).toEqual({ single_key_shortcuts: true }));
    document.body.focus();
    await user.keyboard("t");
    expect(calls.today).toHaveBeenCalledTimes(1);
  });

  it("survives a reload: a fresh client reads the saved keys and applies them", async () => {
    const user = userEvent.setup();
    const first = setup();
    await screen.findByText("Go to today");
    await change(user, "Go to today", "{Alt>}t{/Alt}");
    await waitFor(() => expect(server.shortcuts).toEqual({ "cal-today": "Alt+t" }));
    first.view.unmount();

    setup();
    await waitFor(() => expect(kbds("cal-today")).toEqual(["Alt", "T"]));
    await user.keyboard("t");
    expect(calls.today).not.toHaveBeenCalled();
    await user.keyboard("{Alt>}t{/Alt}");
    expect(calls.today).toHaveBeenCalledTimes(1);
  });

  it("rolls back and offers Retry when saving fails", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText("Go to today");
    server.fail = true;
    await user.click(screen.getByRole("button", { name: "Turn off Go to today" }));
    expect(await screen.findByText("Couldn't save your shortcuts.")).toBeInTheDocument();
    expect(kbds("cal-today")).toEqual(["T"]);
    server.fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(row("cal-today")).getByText("Off")).toBeInTheDocument());
    expect(server.shortcuts).toEqual({ "cal-today": null });
  });

  it("shows other registered shortcuts under Other pages with no per-id code", async () => {
    function Extra() {
      useShortcut("misc-new-thing", "i", () => {}, { label: "shortcuts.search" });
      return null;
    }
    const client = newClient();
    render(
      <QueryClientProvider client={client}>
        <I18nProvider locale="en">
          <ToastProvider>
            <ConfirmProvider>
              <MemoryRouter>
                <ShortcutRoot>
                  <Extra />
                  <ShortcutSettings />
                </ShortcutRoot>
              </MemoryRouter>
            </ConfirmProvider>
          </ToastProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { level: 4, name: "Other pages" });
    expect(kbds("misc-new-thing")).toEqual(["I"]);
  });

  it("the ? help shows the effective keys and hides turned-off actions", async () => {
    server.shortcuts = { "cal-today": "m", "cal-new": null };
    const client = newClient();
    render(
      <QueryClientProvider client={client}>
        <I18nProvider locale="en">
          <MemoryRouter>
            <ShortcutRoot>
              <Probe />
              <ShortcutHelp open onClose={() => {}} />
            </ShortcutRoot>
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    );
    const help = await screen.findByRole("dialog");
    await waitFor(() => expect(within(help).queryByText("New event")).toBeNull());
    const item = within(help).getByText("Go to today").closest("li")!;
    expect([...item.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["M"]);
  });

  it("speaks Vietnamese", async () => {
    const user = userEvent.setup();
    server.shortcuts = { "cal-today": "m" };
    setup("vi");
    expect(await screen.findByRole("heading", { level: 4, name: "Mọi nơi" })).toBeInTheDocument();
    expect(screen.getByText("Phím tắt một phím")).toBeInTheDocument();
    expect(screen.getByText(/Hãy tắt nếu bạn dùng điều khiển bằng giọng nói/)).toBeInTheDocument();
    await waitFor(() => expect(row("cal-today")).toHaveTextContent("Đã đổi"));
    await user.click(screen.getByRole("button", { name: "Đổi phím cho Về hôm nay" }));
    expect(screen.getByText("Nhấn phím mới…")).toBeInTheDocument();
    await user.keyboard("{Control>}w{/Control}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Trình duyệt đang dùng Ctrl+W");
    expect(screen.getByRole("button", { name: "Đặt lại tất cả về mặc định" })).toBeInTheDocument();
  });
});

describe("shortcut catalog", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) files.push(path);
    }
  };
  walk(join(__dirname, ".."));
  const source = files.map((f) => readFileSync(f, "utf8")).join("\n");

  it("matches the defaults registered in the code", () => {
    for (const entry of SHORTCUT_CATALOG) {
      const call = new RegExp(`useShortcut\\(\\s*"${entry.id}",\\s*"${entry.keys.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
      expect(source, entry.id).toMatch(call);
    }
  });

  it("lists every labelled useShortcut id found in the source", () => {
    const missing: string[] = [];
    for (const chunk of source.split("useShortcut(").slice(1)) {
      const id = /^\s*"([^"]+)"/.exec(chunk)?.[1];
      if (id && /label:\s*"shortcuts\./.test(chunk.slice(0, 700)) && !SHORTCUT_CATALOG.some((c) => c.id === id)) missing.push(id);
    }
    expect(missing, "add these ids to SHORTCUT_CATALOG").toEqual([]);
  });

  it("has unique ids", () => {
    const ids = SHORTCUT_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
