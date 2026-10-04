import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
    const rail = screen.getAllByRole("link", { name: "Board" }).find((a) => a.getAttribute("title") === "Board");
    expect(rail).toBeDefined();
    expect(rail!.textContent).toBe("");
  });

  it("g then b navigates to the board", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("gb");
    expect(screen.getByTestId("path")).toHaveTextContent("/board");
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
    expect(await screen.findByText("More shortcuts appear on the calendar.")).toBeInTheDocument();
  });

  it("the shortcut help has no hint on the calendar", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("?");
    await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(screen.queryByText("More shortcuts appear on the calendar.")).toBeNull();
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
