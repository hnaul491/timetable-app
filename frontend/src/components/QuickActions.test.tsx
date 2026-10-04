import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { ChromeProvider, useChrome } from "../lib/chrome";
import { ShortcutProvider, useShortcut } from "../lib/shortcuts";
import { Layout } from "./Layout";

function Marker() {
  const { setFullScreen } = useChrome();
  const loc = useLocation();
  useShortcut("cal-new", "n", () => {}, { label: "shortcuts.newEvent" });
  return (
    <>
      <p data-testid="where">{loc.pathname + loc.search}</p>
      <button onClick={() => setFullScreen(true)}>enter-fs</button>
    </>
  );
}

function setup(path = "/", locale: "en" | "vi" = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>
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

const fab = () => screen.getByRole("button", { name: "Quick actions" });

describe("quick-action button", () => {
  it("opens a menu with the five actions and closes on Escape, returning focus", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(fab());
    expect(fab()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "New eventN",
      "New task",
      "Ask AIG A",
      "Free timeG F",
      "SearchCtrl K",
    ]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(fab()).toHaveFocus();
  });

  it("hides the shortcut hint when the shortcut is not registered", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(fab());
    expect(screen.getByRole("menuitem", { name: /New task/ }).querySelector("kbd")).toBeNull();
  });

  it("focuses the first item and moves with the arrow keys, wrapping", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(fab());
    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(items[4]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(items[0]).toHaveFocus();
  });

  it("closes when clicking outside", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(fab());
    await user.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("New event opens the calendar's new-event popup for today", async () => {
    const user = userEvent.setup();
    setup("/board");
    await user.click(fab());
    await user.click(screen.getByRole("menuitem", { name: /New event/ }));
    expect(screen.getByTestId("where").textContent).toMatch(/^\/\?new=\d{4}-\d{2}-\d{2}T09:00$/);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("New task, Ask AI and Free time navigate", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(fab());
    await user.click(screen.getByRole("menuitem", { name: /New task/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/board?new=1");
    await user.click(fab());
    await user.click(screen.getByRole("menuitem", { name: /Ask AI/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/assistant?compose=1");
    await user.click(fab());
    await user.click(screen.getByRole("menuitem", { name: /Free time/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/free-time");
  });

  it("Search opens the palette", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(fab());
    await user.click(screen.getByRole("menuitem", { name: /Search/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("is hidden in full-screen mode", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("enter-fs"));
    expect(screen.queryByRole("button", { name: "Quick actions" })).toBeNull();
  });

  it("sits above the phone bottom nav and animates only when motion is allowed", async () => {
    const user = userEvent.setup();
    setup();
    expect(fab().parentElement!.className).toMatch(/bottom-\[5\.5rem\]/);
    expect(fab().parentElement!.className).toMatch(/md:bottom-6/);
    await user.click(fab());
    expect(screen.getByRole("menu").className).toMatch(/motion-safe:animate-\[quick-in_150ms/);
  });

  it("is translated to Vietnamese", async () => {
    const user = userEvent.setup();
    setup("/", "vi");
    await user.click(screen.getByRole("button", { name: "Thao tác nhanh" }));
    expect(screen.getByRole("menuitem", { name: /Việc mới/ })).toBeInTheDocument();
  });
});

describe("?search=1 home-screen shortcut", () => {
  it("opens the palette and removes the param", async () => {
    setup("/?search=1&date=2026-10-05");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/?date=2026-10-05");
  });

  it("does nothing without the param", () => {
    setup("/");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
