import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../components/ui/Confirm";
import { ToastProvider } from "../components/ui/Toast";
import { I18nProvider } from "../i18n";
import { ApiError } from "../lib/api";
import { ShortcutProvider } from "../lib/shortcuts";
import type { ChatMessage, PendingAction } from "../types";
import { AssistantPage } from "./AssistantPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const action = (over: Partial<PendingAction> = {}): PendingAction => ({
  id: 11, kind: "task", status: "pending", summary: "Revise chapter 3", payload: { title: "Revise chapter 3" }, expires_at: null, ...over,
});
const reply = (over: Partial<ChatMessage> = {}): ChatMessage => ({ id: 2, role: "assistant", content: "Here is a plan.\n- Read notes\n- Do ex 3", actions: [action()], ...over });

let history: ChatMessage[];
let enabled: boolean;
function route(extra: (path: string, init?: RequestInit) => unknown = () => undefined) {
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const custom = extra(path, init);
    if (custom !== undefined) return custom;
    if (path === "/api/ai/status") return { enabled, model: "gemini-2.5-flash" };
    if (path === "/api/chat" && (!init || !init.method)) return { messages: history };
    return undefined;
  });
}

function renderPage(locale: "en" | "vi" = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>
        <ToastProvider>
          <ConfirmProvider>
            <ShortcutProvider>
              <MemoryRouter>
                <AssistantPage />
              </MemoryRouter>
            </ShortcutProvider>
          </ConfirmProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe("AssistantPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    localStorage.clear();
    history = [];
    enabled = true;
  });

  it("sends a message and shows the reply as text with its action card", async () => {
    route((path, init) => (path === "/api/chat" && init?.method === "POST" ? reply({ content: "Hi <b>x</b>\n- Read notes" }) : undefined));
    renderPage();
    await userEvent.type(await screen.findByRole("textbox", { name: "Message the assistant" }), "plan my week{Enter}");
    expect(await screen.findByText("Revise chapter 3")).toBeInTheDocument();
    expect(screen.getByText("plan my week")).toBeInTheDocument();
    expect(screen.getByText("Read notes").closest("li")).not.toBeNull();
    expect(screen.getByText(/Hi <b>x<\/b>/)).toBeInTheDocument(); // rendered as text, not HTML
    const post = apiFetch.mock.calls.find((c) => c[0] === "/api/chat" && c[1]?.method === "POST")!;
    expect(JSON.parse(post[1].body)).toMatchObject({ message: "plan my week", context: { path: "/" }, locale: "en" });
  });

  it("Shift+Enter adds a line and does not send", async () => {
    route();
    renderPage();
    const box = await screen.findByRole("textbox", { name: "Message the assistant" });
    await userEvent.type(box, "a{Shift>}{Enter}{/Shift}b");
    expect(box).toHaveValue("a\nb");
    expect(apiFetch.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });

  it("Add confirms the action, toasts and refreshes tasks, events and notes", async () => {
    history = [reply()];
    route((path, init) => (path === "/api/actions/11/confirm" && init?.method === "POST" ? { status: "confirmed", result: { kind: "task", ids: [5] } } : undefined));
    const { invalidate } = renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Add" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/actions/11/confirm", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("Added to your timetable")).toBeInTheDocument();
    const keys = invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey?: unknown })?.queryKey));
    expect(keys).toEqual(expect.arrayContaining(['["tasks"]', '["events"]', '["event"]', '["chat"]']));
  });

  it("Dismiss calls the dismiss endpoint", async () => {
    history = [reply()];
    route((path, init) => (path === "/api/actions/11/dismiss" && init?.method === "POST" ? { status: "dismissed" } : undefined));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/actions/11/dismiss", expect.objectContaining({ method: "POST" })));
  });

  it("shows the limit message when the server answers 429", async () => {
    route((path, init) => {
      if (path === "/api/chat" && init?.method === "POST") throw new ApiError(429, "AI limit reached, try again later");
      return undefined;
    });
    renderPage();
    await userEvent.type(await screen.findByRole("textbox", { name: "Message the assistant" }), "hello{Enter}");
    expect(await screen.findByText(/AI limit reached, try again later/)).toBeInTheDocument();
  });

  it("explains when the AI is off and links to Settings", async () => {
    enabled = false;
    route();
    renderPage();
    expect(await screen.findByText("The assistant is not set up")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("textbox", { name: "Message the assistant" })).toBeNull();
  });

  it("quick prompts send their text; the privacy notice is dismissible per device", async () => {
    route((path, init) => (path === "/api/chat" && init?.method === "POST" ? reply({ actions: [] }) : undefined));
    renderPage();
    expect(await screen.findByText(/sent to Google/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText(/sent to Google/)).toBeNull();
    expect(localStorage.getItem("timetable:ai-privacy")).toBe("1");
    await userEvent.click(screen.getByRole("button", { name: "What's due this week?" }));
    await waitFor(() => {
      const post = apiFetch.mock.calls.find((c) => c[0] === "/api/chat" && c[1]?.method === "POST")!;
      expect(JSON.parse(post[1].body).message).toBe("What's due this week?");
    });
  });

  it("Clear chat asks first, then deletes", async () => {
    history = [reply({ actions: [] })];
    route();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Clear chat" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Clear chat" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/chat", expect.objectContaining({ method: "DELETE" })));
  });

  it("renders in Vietnamese", async () => {
    route();
    renderPage("vi");
    expect(await screen.findByRole("textbox", { name: "Nhắn cho trợ lý" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tuần này có gì đến hạn?" })).toBeInTheDocument();
  });
});
