import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { Preferences } from "../i18n/LanguageRoot";
import { hintChips, hintText, useAriaKeyshortcuts, useHintTitle } from "../lib/shortcutHints";
import { ShortcutProvider, useShortcut } from "../lib/shortcuts";
import { ShortcutHint } from "./ShortcutHint";

function Registered({ id, keys }: { id: string; keys: string }) {
  useShortcut(id, keys, () => {}, { label: "shortcuts.today" });
  return null;
}

function Probe({ id, label }: { id: string; label: string }) {
  const title = useHintTitle();
  const aria = useAriaKeyshortcuts(id);
  return <button title={title(label, id)} aria-keyshortcuts={aria}>probe</button>;
}

function setup(ui: React.ReactNode, prefs: Partial<Preferences> = {}, overrides?: Record<string, string | null>, singleKey = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["preferences"], { language: "en", ...prefs, ...(overrides ? { shortcuts: overrides } : {}) });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <ShortcutProvider overrides={overrides ?? prefs.shortcuts} singleKey={singleKey && prefs.single_key_shortcuts !== false}>
          {ui}
        </ShortcutProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const platform = (value: string) => vi.spyOn(navigator, "platform", "get").mockReturnValue(value);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hintChips", () => {
  it("formats Mod per platform", () => {
    expect(hintChips("Mod+k", false)).toEqual(["Ctrl K"]);
    expect(hintChips("Mod+k", true)).toEqual(["⌘K"]);
    expect(hintChips("Mod+s", false)).toEqual(["Ctrl S"]);
  });
  it("formats sequences, Shift, arrows and named keys", () => {
    expect(hintChips("g c", false)).toEqual(["G", "C"]);
    expect(hintChips("g ,", false)).toEqual(["G", ","]);
    expect(hintChips("Shift+w", false)).toEqual(["⇧W"]);
    expect(hintChips("ArrowLeft", false)).toEqual(["←"]);
    expect(hintChips("ArrowRight", false)).toEqual(["→"]);
    expect(hintChips("Escape", false)).toEqual(["Esc"]);
  });
  it("joins a sequence for tooltips", () => {
    expect(hintText("g c", "then", false)).toBe("G then C");
    expect(hintText("t", "then", false)).toBe("T");
  });
});

describe("ShortcutHint", () => {
  it("shows catalogue defaults when the id is not registered, aria-hidden", () => {
    platform("Win32");
    setup(<ShortcutHint id="search" />);
    const hint = document.querySelector('[data-shortcut-hint="search"]')!;
    expect(hint).toHaveAttribute("aria-hidden", "true");
    expect(hint.textContent).toBe("Ctrl K");
  });

  it("uses the command key on a Mac", () => {
    platform("MacIntel");
    setup(<ShortcutHint id="search" />);
    expect(document.querySelector("kbd")!.textContent).toBe("⌘K");
  });

  it("renders a sequence as separate chips with a separator", () => {
    setup(<ShortcutHint id="go-calendar" />);
    const chips = [...document.querySelectorAll("kbd")].map((k) => k.textContent);
    expect(chips).toEqual(["G", "C"]);
    expect(document.body.textContent).toContain("then");
  });

  it("follows a customised key, registered or not", () => {
    setup(<><Registered id="cal-today" keys="t" /><ShortcutHint id="cal-today" /><ShortcutHint id="go-board" /></>, {}, { "cal-today": "Alt+t", "go-board": "g x" });
    expect(document.querySelector('[data-shortcut-hint="cal-today"]')!.textContent).toBe("Alt T");
    expect([...document.querySelectorAll('[data-shortcut-hint="go-board"] kbd')].map((k) => k.textContent)).toEqual(["G", "X"]);
  });

  it("renders nothing for a shortcut the user turned off", () => {
    setup(<ShortcutHint id="cal-today" />, {}, { "cal-today": null });
    expect(document.querySelector("kbd")).toBeNull();
  });

  it("renders nothing when single-key shortcuts are blocked, but keeps Mod and Escape ones", () => {
    setup(<><ShortcutHint id="cal-today" /><ShortcutHint id="search" /></>, { single_key_shortcuts: false });
    expect(document.querySelector('[data-shortcut-hint="cal-today"]')).toBeNull();
    expect(document.querySelector('[data-shortcut-hint="search"]')).not.toBeNull();
  });

  it("renders nothing for an unknown id", () => {
    setup(<ShortcutHint id="nope" />);
    expect(document.querySelector("kbd")).toBeNull();
  });

  it("renders nothing when hints are turned off in settings", () => {
    setup(<ShortcutHint id="search" />, { shortcut_hints: false });
    expect(document.querySelector("kbd")).toBeNull();
  });

  it("renders nothing on a touch-only device", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("hover: none"), addEventListener() {}, removeEventListener() {} }));
    setup(<ShortcutHint id="search" />);
    expect(document.querySelector("kbd")).toBeNull();
  });

  it("is hidden below md by default and shown always in menus", () => {
    setup(<><ShortcutHint id="search" /><ShortcutHint id="sidebar" always /></>);
    expect(document.querySelector('[data-shortcut-hint="search"]')!.className).toContain("hidden md:inline-flex");
    expect(document.querySelector('[data-shortcut-hint="sidebar"]')!.className).not.toContain("hidden");
  });
});

describe("title and aria-keyshortcuts", () => {
  it("appends the keys to the title", () => {
    platform("Win32");
    setup(<><Probe id="cal-today" label="Today" /></>);
    expect(screen.getByRole("button")).toHaveAttribute("title", "Today (T)");
    expect(screen.getByRole("button")).toHaveAttribute("aria-keyshortcuts", "T");
  });

  it("uses spec format for Mod and omits it for sequences", () => {
    platform("Win32");
    setup(<><Probe id="search" label="Search" /><Probe id="go-board" label="Board" /></>);
    const [search, board] = screen.getAllByRole("button");
    expect(search).toHaveAttribute("aria-keyshortcuts", "Control+K");
    expect(search).toHaveAttribute("title", "Search (Ctrl K)");
    expect(board).not.toHaveAttribute("aria-keyshortcuts");
    expect(board).toHaveAttribute("title", "Board (G then B)");
  });

  it("drops the visible keys from the title with hints off but keeps aria-keyshortcuts", () => {
    setup(<Probe id="search" label="Search" />, { shortcut_hints: false });
    expect(screen.getByRole("button")).toHaveAttribute("title", "Search");
    expect(screen.getByRole("button")).toHaveAttribute("aria-keyshortcuts");
  });
});
