import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { ShortcutProvider, useShortcut, type ShortcutOverrides } from "../lib/shortcuts";
import { ShortcutHelp } from "./ShortcutHelp";

function Registered({ streaming }: { streaming: boolean }) {
  useShortcut("go-board", "g b", () => {}, { label: "shortcuts.goBoard" });
  useShortcut("cal-today", "t", () => {}, { label: "shortcuts.today" });
  useShortcut("settings-find", "f", () => {}, { label: "shortcuts.settingsFind" });
  useShortcut("free-week", "w", () => {}, { label: "shortcuts.freeWeek" });
  useShortcut("assistant-focus", "i", () => {}, { label: "shortcuts.assistantFocus" });
  useShortcut("assistant-stop", "Escape", () => {}, { label: "shortcuts.assistantStop", enabled: streaming });
  return null;
}

function renderAt(path: string, locale: "en" | "vi" = "en", streaming = false, overrides?: ShortcutOverrides) {
  render(
    <I18nProvider locale={locale}>
      <ShortcutProvider overrides={overrides}>
        <MemoryRouter initialEntries={[path]}>
          <Registered streaming={streaming} />
          <ShortcutHelp open onClose={() => {}} />
        </MemoryRouter>
      </ShortcutProvider>
    </I18nProvider>,
  );
  return screen.findByRole("dialog");
}

const headings = (dialog: HTMLElement) => within(dialog).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

describe("ShortcutHelp grouping", () => {
  it("shows Everywhere plus only the current page's group", async () => {
    expect(headings(await renderAt("/free-time"))).toEqual(["Everywhere", "Free time"]);
  });

  it.each([
    ["/", "Calendar", "Go to today"],
    ["/settings/ai", "Settings", "Find a setting"],
    ["/free-time", "Free time", "This week"],
    ["/assistant", "Assistant", "Write a message"],
  ])("on %s lists the %s group and no other page's entries", async (path, group, label) => {
    const dialog = await renderAt(path);
    expect(within(dialog).getByRole("heading", { name: group })).toBeInTheDocument();
    expect(within(dialog).getByText(label)).toBeInTheDocument();
    expect(within(dialog).getByText("Go to Board")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem").length).toBe(2);
    expect(within(dialog).queryByText(/More shortcuts appear/)).toBeNull();
  });

  it("on a page without its own shortcuts shows only the global group and the hint", async () => {
    const dialog = await renderAt("/board");
    expect(headings(dialog)).toEqual(["Everywhere"]);
    expect(within(dialog).getByText("More shortcuts appear on the Calendar, Settings, Free time and Assistant pages.")).toBeInTheDocument();
  });

  it("lists the stop key only while it is registered", async () => {
    expect(within(await renderAt("/assistant", "en", true)).getByText("Stop the reply")).toBeInTheDocument();
  });

  it("shows customised keys, hides turned-off entries, and groups unknown ids by prefix", async () => {
    function Extra() {
      useShortcut("free-new-thing", "z", () => {}, { label: "shortcuts.freeWeek" });
      useShortcut("misc-thing", "y", () => {}, { label: "shortcuts.help" });
      return null;
    }
    render(
      <I18nProvider locale="en">
        <ShortcutProvider overrides={{ "free-week": "Alt+w", "go-board": null }}>
          <MemoryRouter initialEntries={["/free-time"]}>
            <Registered streaming={false} />
            <Extra />
            <ShortcutHelp open onClose={() => {}} />
          </MemoryRouter>
        </ShortcutProvider>
      </I18nProvider>,
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Go to Board")).toBeNull();
    const week = within(dialog).getAllByText("This week").map((n) => n.closest("li")!);
    expect(week.map((li) => li.textContent)).toContain("This weekAltW");
    const free = within(dialog).getByRole("heading", { name: "Free time" }).closest("section")!;
    expect(within(free).getAllByText("This week")).toHaveLength(2);
    const global = within(dialog).getByRole("heading", { name: "Everywhere" }).closest("section")!;
    expect(within(global).getByText("Show shortcuts")).toBeInTheDocument();
  });

  it("has Vietnamese group names and hint", async () => {
    const dialog = await renderAt("/board", "vi");
    expect(headings(dialog)).toEqual(["Mọi nơi"]);
    expect(within(dialog).getByText(/có thêm phím tắt riêng/)).toBeInTheDocument();
  });
});
