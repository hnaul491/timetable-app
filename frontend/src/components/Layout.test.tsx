import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { ChromeProvider, useChrome } from "../lib/chrome";
import { ShortcutProvider } from "../lib/shortcuts";
import { Layout } from "./Layout";

function Marker() {
  const { setFullScreen } = useChrome();
  return (
    <>
      <p data-testid="path">{useLocation().pathname}</p>
      <button onClick={() => setFullScreen(true)}>enter-fs</button>
    </>
  );
}

function setup(path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <ShortcutProvider>
          <ChromeProvider>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="*" element={<Marker />} />
                </Route>
              </Routes>
            </MemoryRouter>
          </ChromeProvider>
        </ShortcutProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Layout shortcuts", () => {
  it("[ collapses the sidebar into an icon rail with named links", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getAllByRole("link", { name: "Board" }).length).toBeGreaterThan(0);
    await user.keyboard("[[");
    expect(localStorage.getItem("timetable:sidebar")).toBe("collapsed");
    const rail = screen.getAllByRole("link", { name: "Board" }).find((a) => a.getAttribute("title") === "Board (G then B)");
    expect(rail).toBeDefined();
    expect(rail!.textContent).toBe("");
  });

  it("the sidebar stays in place while the page scrolls and its toggle sits at the top", async () => {
    const user = userEvent.setup();
    setup();
    const sidebar = screen.getAllByRole("navigation", { name: "Main" }).find((n) => n.className.includes("md:flex"))!;
    expect(sidebar.className).toMatch(/\bsticky\b/);
    expect(sidebar.className).toMatch(/\btop-0\b/);
    expect(sidebar.className).toMatch(/\bh-screen\b/);
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    const firstLink = screen.getAllByRole("link", { name: "Calendar" }).find((a) => sidebar.contains(a))!;
    expect(toggle.compareDocumentPosition(firstLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(toggle);
    expect(localStorage.getItem("timetable:sidebar")).toBe("collapsed");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("g then b navigates to the board", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("gb");
    expect(screen.getByTestId("path")).toHaveTextContent("/board");
  });

  it("g then o navigates to documents; the sidebar links it after Subjects but the phone bar does not", async () => {
    const user = userEvent.setup();
    setup();
    const side = screen.getAllByRole("navigation", { name: "Main" }).find((n) => n.className.includes("md:flex"))!;
    const labels = within(side).getAllByRole("link").map((a) => a.textContent);
    expect(labels.findIndex((l) => l?.startsWith("Documents"))).toBe(labels.findIndex((l) => l?.startsWith("Subjects")) + 1);
    expect(within(side).getByRole("link", { name: /Documents/ })).toHaveAttribute("href", "/documents");
    expect(side.querySelector('[data-shortcut-hint="go-documents"]')).not.toBeNull();
    const phone = screen.getAllByRole("navigation", { name: "Main" }).find((n) => n.className.includes("md:hidden"))!;
    expect(within(phone).queryByRole("link", { name: "Documents" })).toBeNull();
    await user.keyboard("go");
    expect(screen.getByTestId("path")).toHaveTextContent("/documents");
  });

  it("g then a navigates to the assistant", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("ga");
    expect(screen.getByTestId("path")).toHaveTextContent("/assistant");
  });

  it("g then f navigates to free time and the help lists it", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("?");
    expect(within(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).getByText("Go to Free time")).toBeInTheDocument();
    await user.keyboard("{Escape}gf");
    expect(screen.getByTestId("path")).toHaveTextContent("/free-time");
  });

  it("? opens the shortcuts dialog", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("?");
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  it("the shortcut help points to the calendar's extra shortcuts off the calendar page", async () => {
    const user = userEvent.setup();
    setup("/board");
    await user.keyboard("?");
    expect(await screen.findByText("More shortcuts appear on the Calendar, Settings, Free time and Assistant pages.")).toBeInTheDocument();
  });

  it("the shortcut help has no hint on the calendar", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("?");
    await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(screen.queryByText("More shortcuts appear on the Calendar, Settings, Free time and Assistant pages.")).toBeNull();
  });

  it("full screen hides the navigation and Escape exits", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "enter-fs" }));
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Exit full screen" })).toBeNull(); // the toggle lives in the calendar header
    await user.keyboard("{Escape}");
    expect(screen.getAllByRole("navigation").length).toBeGreaterThan(0);
  });
});
