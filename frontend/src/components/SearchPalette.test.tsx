import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, translate } from "../i18n";
import type { Locale } from "../i18n/locale";
import { ChromeProvider } from "../lib/chrome";
import { ShortcutProvider } from "../lib/shortcuts";
import type { SearchResults } from "../types";
import { Layout } from "./Layout";

const RESULTS: SearchResults = {
  events: [{ id: 7, title: "Python lab", start: "2026-10-20T07:00:00Z", end: "2026-10-20T09:00:00Z", room: "B12", cancelled: false, title_raw: "CM python raw" }],
  subjects: [{ id: 3, name: "Python Programming" }],
  notes: [{ id: 11, event_id: 7, event_title: "Python lab", snippet: "Remember python venv <img src=x onerror=alert(1)>" }],
  tasks: [
    { id: 1, title: "Python homework", done: false, due: "2026-10-25", event_id: 7 },
    { id: 2, title: "Python reading", done: true, due: null, event_id: null },
  ],
  documents: [{ id: 5, name: "python-slides.pdf", subject_id: 3, web_view_link: "https://drive.example/f" }],
};

const EMPTY = { events: [], subjects: [], notes: [], tasks: [], documents: [] };
const searchCalls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).startsWith("/api/search"));

function Where() {
  const loc = useLocation();
  return <p data-testid="path">{loc.pathname + loc.search}</p>;
}

function setup(locale: Locale = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>
        <ShortcutProvider>
          <ChromeProvider>
            <MemoryRouter initialEntries={["/board"]}>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="*" element={<><Where /><textarea aria-label="memo" /></>} />
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
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = String(url).startsWith("/api/search") ? RESULTS : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const palette = () => screen.findByRole("dialog", { name: "Search" });

describe("SearchPalette", () => {
  it("opens with Ctrl+K, even from a text field, and with / otherwise", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("textbox", { name: "memo" }));
    await user.keyboard("/");
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "memo" })).toHaveValue("/");
    await user.keyboard("{Control>}k{/Control}");
    expect(await palette()).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    (document.activeElement as HTMLElement).blur();
    await user.keyboard("/");
    expect(await palette()).toBeInTheDocument();
  });

  it("opens from the search button and is listed in the shortcut help", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getAllByRole("button", { name: "Search" })[0]);
    expect(await palette()).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    await user.keyboard("?");
    const help = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(help).getAllByText("Search")).toHaveLength(2);
  });

  it("shows quick actions for an empty query and filters them", async () => {
    const user = userEvent.setup();
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      new Response(JSON.stringify(String(url).startsWith("/api/search") ? EMPTY : []), { status: 200, headers: { "Content-Type": "application/json" } }));
    setup();
    await user.keyboard("/");
    const box = await screen.findByRole("combobox", { name: "Search" });
    expect(within(screen.getByRole("listbox")).getAllByRole("option").length).toBeGreaterThanOrEqual(8);
    expect(searchCalls()).toHaveLength(0);
    await user.type(box, "go to cal");
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Go to Calendar"]);
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("path").textContent).toBe("/");
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it("offers a Free time quick action", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("/");
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "free");
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("path").textContent).toBe("/free-time");
  });

  it("debounces the request and groups results with headings", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("/");
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "python");
    expect(searchCalls()).toHaveLength(0);
    await screen.findByRole("option", { name: /Python homework/ });
    expect(searchCalls()).toHaveLength(1);
    expect(String(searchCalls()[0][0])).toBe("/api/search?q=python&limit=8");
    for (const heading of ["Classes", "Subjects", "Notes", "Tasks", "Documents"]) expect(within(screen.getByRole("listbox")).getByText(heading)).toBeInTheDocument();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("moves with the arrow keys and opens the chosen result", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("/");
    const box = await screen.findByRole("combobox", { name: "Search" });
    await user.type(box, "python");
    await screen.findByRole("option", { name: /Python homework/ });
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(box).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(box).toHaveAttribute("aria-activedescendant", options[1].id);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(box).toHaveAttribute("aria-activedescendant", options[options.length - 1].id);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByTestId("path").textContent).toBe("/?event=7&date=2026-10-20");
  });

  it("navigates for each kind of result", async () => {
    const user = userEvent.setup();
    setup();
    const open = async (name: RegExp) => {
      await user.keyboard("/");
      await user.type(await screen.findByRole("combobox", { name: "Search" }), "python");
      await user.click(await screen.findByRole("option", { name }));
    };
    await open(/Python Programming/);
    expect(screen.getByTestId("path").textContent).toBe("/subjects/3");
    await open(/Remember python/);
    expect(screen.getByTestId("path").textContent).toBe("/events/7");
    await open(/Python homework/);
    expect(screen.getByTestId("path").textContent).toBe("/events/7");
    await open(/Python reading/);
    expect(screen.getByTestId("path").textContent).toBe("/board");
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await open(/python-slides/);
    expect(openSpy).toHaveBeenCalledWith("https://drive.example/f", "_blank", "noopener,noreferrer");
  });

  it("highlights matches as text and never injects HTML", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("/");
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "python");
    const option = await screen.findByRole("option", { name: /Remember python/ });
    expect(option.querySelector("img")).toBeNull();
    expect(option.textContent).toContain("<img src=x onerror=alert(1)>");
    expect([...option.querySelectorAll("mark")].map((m) => m.textContent?.toLowerCase())).toContain("python");
  });

  it("shows an empty state naming the query", async () => {
    const user = userEvent.setup();
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      new Response(JSON.stringify(String(url).startsWith("/api/search") ? EMPTY : []), { status: 200, headers: { "Content-Type": "application/json" } }));
    setup();
    await user.keyboard("/");
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzz");
    expect(await screen.findByText("No results for “zzz”")).toBeInTheDocument();
  });

  it("is translated to Vietnamese", async () => {
    const user = userEvent.setup();
    setup("vi");
    await user.keyboard("/");
    expect(await screen.findByRole("dialog", { name: translate("vi", "search.title") })).toBeInTheDocument();
    expect(within(screen.getByRole("listbox")).getByRole("option", { name: translate("vi", "shortcuts.goBoard") })).toBeInTheDocument();
    await user.type(screen.getByRole("combobox", { name: translate("vi", "search.inputLabel") }), "python");
    await screen.findByText(translate("vi", "search.classes"));
    expect(translate("vi", "search.empty", { q: "x" })).toBe("Không có kết quả cho “x”");
  });

  it("opens with Meta+K, closes with Ctrl+K, and stays shut behind another dialog", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(await palette()).toBeInTheDocument();
    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    await user.keyboard("?");
    await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it("does not open from / inside an input or contenteditable", async () => {
    const user = userEvent.setup();
    setup();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.tabIndex = 0;
    document.body.appendChild(editable);
    editable.focus();
    await user.keyboard("/");
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
    editable.remove();
  });

  it("scrolls the active option into view and groups results accessibly", async () => {
    const user = userEvent.setup();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    setup();
    await user.keyboard("/");
    const box = await screen.findByRole("combobox", { name: "Search" });
    expect(box).toHaveAttribute("aria-expanded", "true");
    await user.type(box, "python");
    await screen.findByRole("option", { name: /Python homework/ });
    scroll.mockClear();
    await user.keyboard("{ArrowDown}");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    const group = screen.getByRole("group", { name: "Classes" });
    expect(within(group).getAllByRole("option")).toHaveLength(1);
    expect(group.textContent).toContain("CM python raw");
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("highlights with the query the results came from while a new one loads", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("/");
    const box = await screen.findByRole("combobox", { name: "Search" });
    await user.type(box, "python");
    await screen.findByRole("option", { name: /Python homework/ });
    await user.type(box, "x");
    const marks = within(screen.getByRole("listbox")).getAllByText("Python", { selector: "mark" });
    expect(marks.length).toBeGreaterThan(0);
  });
});
