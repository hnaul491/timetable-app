import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShortcutHelp } from "../components/ShortcutHelp";
import { ConfirmProvider } from "../components/ui/Confirm";
import { ToastProvider } from "../components/ui/Toast";
import { I18nProvider } from "../i18n";
import { ApiError } from "../lib/api";
import { ShortcutProvider, type ShortcutOverrides } from "../lib/shortcuts";
import { chatSendResponse, expiredAction, studyBlocksAction, taskAction } from "../test/aiContract";
import type { ChatMessage, PendingAction } from "../types";
import { AssistantPage } from "./AssistantPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  authHeaders: async () => ({}),
}));

const enc = new TextEncoder();
function sseBody(chunks: string[], opts: { hang?: boolean; signal?: AbortSignal } = {}) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      if (opts.hang) opts.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
      else c.close();
    },
  });
}
const frame = (event: string, data: unknown) => `event: ${event}
data: ${JSON.stringify(data)}

`;
const fetchMock = vi.fn();

const action = (over: Partial<PendingAction> = {}): PendingAction => ({ ...taskAction, ...over });
const reply = (over: Partial<ChatMessage> = {}): ChatMessage => ({ id: 2, role: "assistant", content: "Here is a plan.\n- Read notes\n- Do ex 3", actions: [action()], ...over });

let history: ChatMessage[];
let enabled: boolean;
let sendAnswer: () => ChatMessage;
function route(extra: (path: string, init?: RequestInit) => unknown = () => undefined) {
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const custom = extra(path, init);
    if (custom !== undefined) return custom;
    if (path === "/api/ai/status") return { enabled, model: "gemini-2.5-flash" };
    if (path === "/api/chat" && (!init || !init.method)) return { messages: history };
    if (path === "/api/chat" && init?.method === "POST") {
      // like the real server: the exchange is stored, the answer is {message}
      const answer = sendAnswer();
      history = [...history, { id: 100, role: "user", content: JSON.parse(String(init.body)).message, actions: [] }, answer];
      return chatSendResponse(answer);
    }
    return undefined;
  });
}

function renderPage(locale: "en" | "vi" = "en", url = "/", help = false, overrides?: ShortcutOverrides) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>
        <ToastProvider>
          <ConfirmProvider>
            <ShortcutProvider overrides={overrides}>
              <MemoryRouter initialEntries={[url]}>
                <AssistantPage />
                {help && <ShortcutHelp open onClose={() => {}} />}
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
    sendAnswer = () => reply();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response("{}", { status: 404 })); // no stream: fall back to POST
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends a message and shows the reply as text with its action card", async () => {
    sendAnswer = () => reply({ id: 101, content: "Hi <b>x</b>\n- Read notes" });
    route();
    renderPage();
    await userEvent.type(await screen.findByRole("textbox", { name: "Message the assistant" }), "plan my week{Enter}");
    expect(await screen.findByText("Task: Revise chapter 3")).toBeInTheDocument();
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
    expect(await screen.findByText(/You can pick another model in Settings\./)).toBeInTheDocument();
    expect(await screen.findByText(/AI limit reached, try again later/)).toBeInTheDocument();
  });

  it("shows the Vietnamese limit text and the hint when a 429 arrives in Vietnamese", async () => {
    route((path, init) => {
      if (path === "/api/chat" && init?.method === "POST") throw new ApiError(429, "some server text");
      return undefined;
    });
    renderPage("vi");
    await userEvent.type(await screen.findByRole("textbox", { name: "Nhắn cho trợ lý" }), "xin chào{Enter}");
    expect(await screen.findByText(/Đã đạt giới hạn AI, hãy thử lại sau/)).toBeInTheDocument();
    expect(screen.getByText(/Bạn có thể chọn mô hình khác/)).toBeInTheDocument();
  });

  it("explains when the AI is off and links to Settings", async () => {
    enabled = false;
    route();
    renderPage();
    expect(await screen.findByText("The assistant is not set up")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "/settings/ai");
    expect(screen.queryByRole("textbox", { name: "Message the assistant" })).toBeNull();
  });

  it("quick prompts send their text; the privacy notice is dismissible per device", async () => {
    sendAnswer = () => reply({ actions: [] });
    route();
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

  it("renders a study_blocks action and an unknown kind without throwing", async () => {
    history = [reply({ actions: [studyBlocksAction, action({ id: 20, kind: "mystery", summary: "Something new", payload: {} })] })];
    route();
    renderPage();
    expect(await screen.findByText("Study blocks")).toBeInTheDocument();
    expect(screen.getByText("2 study blocks for Relational Databases")).toBeInTheDocument();
    expect(screen.getByText("Suggestion")).toBeInTheDocument();
    expect(screen.getByText("Something new")).toBeInTheDocument();
  });

  it("an expired action has no buttons", async () => {
    history = [reply({ actions: [expiredAction] })];
    route();
    renderPage();
    expect(await screen.findByText("Expired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("tolerates a message whose content is not a string", async () => {
    history = [reply({ content: null as unknown as string, actions: [] })];
    route();
    renderPage();
    expect(await screen.findByRole("textbox", { name: "Message the assistant" })).toBeInTheDocument();
  });

  it("shows the translated unavailable text on a gateway timeout", async () => {
    route((path, init) => {
      if (path === "/api/chat" && init?.method === "POST") throw new ApiError(504, "Gateway Timeout");
      return undefined;
    });
    renderPage();
    await userEvent.type(await screen.findByRole("textbox", { name: "Message the assistant" }), "hello{Enter}");
    expect(await screen.findByText(/The assistant is not available right now/)).toBeInTheDocument();
  });

  it("limits the composer to 2000 characters and counts down near the end", async () => {
    route();
    renderPage();
    const box = await screen.findByRole("textbox", { name: "Message the assistant" });
    expect(box).toHaveAttribute("maxlength", "2000");
    expect(screen.queryByText(/characters left/)).toBeNull();
    fireEvent.change(box, { target: { value: "x".repeat(1850) } });
    expect(screen.getByText("150 characters left")).toBeInTheDocument();
  });

  it("renders in Vietnamese", async () => {
    route();
    renderPage("vi");
    expect(await screen.findByRole("textbox", { name: "Nhắn cho trợ lý" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tuần này có gì đến hạn?" })).toBeInTheDocument();
  });

  describe("streaming", () => {
    const final = (over: Partial<ChatMessage> = {}) => reply({ id: 101, content: "Hello there", ...over });
    const hang = (chunks: string[]) => async (_u: string, init: RequestInit) => new Response(sseBody(chunks, { hang: true, signal: init.signal as AbortSignal }), { status: 200 });
    const typeHi = async (name = "Message the assistant") => userEvent.type(await screen.findByRole("textbox", { name }), "hi{Enter}");

    it("renders deltas live, then the final message with cards", async () => {
      const finalMsg = final();
      fetchMock.mockImplementation(async () => {
        const text = frame("status", { step: "tasks" }) + frame("delta", { text: "Hello " }) + frame("delta", { text: "there" }) + frame("done", { message: finalMsg });
        return new Response(sseBody([text.slice(0, 30), text.slice(30, 110), text.slice(110)]), { status: 200 });
      });
      route();
      history = [{ id: 100, role: "user", content: "hi", actions: [] }, finalMsg]; // what the server stored after done
      renderPage();
      await typeHi();
      expect(await screen.findByText("Task: Revise chapter 3")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith("/api/chat/stream", expect.objectContaining({ method: "POST" }));
      expect(apiFetch.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
      expect(screen.getByText("hi")).toBeInTheDocument();
      expect(screen.getByText("Hello there")).toBeInTheDocument();
    });

    it("shows the status chip and partial text while streaming, as text only", async () => {
      fetchMock.mockImplementation(hang([frame("status", { step: "tasks" }), frame("delta", { text: "Partial <b>x</b>" })]));
      route();
      renderPage();
      await typeHi();
      expect(await screen.findByText(/Partial <b>x<\/b>/)).toBeInTheDocument();
      expect(screen.getByText("Looking at your tasks…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    });

    it("Stop aborts, keeps the partial text marked stopped and resyncs the chat", async () => {
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementation(async (u: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return hang([frame("delta", { text: "Partial" })])(u, init);
      });
      route();
      const { invalidate } = renderPage();
      await typeHi();
      await screen.findByText("Partial");
      await userEvent.click(screen.getByRole("button", { name: "Stop" }));
      expect(signal?.aborted).toBe(true);
      expect(await screen.findByText("Stopped")).toBeInTheDocument();
      expect(screen.getByText("Partial")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
      expect(invalidate.mock.calls.some((c) => JSON.stringify((c[0] as { queryKey?: unknown })?.queryKey) === '["chat"]')).toBe(true);
      expect(apiFetch.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
    });

    it("falls back to POST /api/chat on a 500 before any data", async () => {
      fetchMock.mockImplementation(async () => new Response("boom", { status: 500 }));
      sendAnswer = () => reply({ id: 101, content: "Fallback answer", actions: [] });
      route();
      renderPage();
      await typeHi();
      expect(await screen.findByText("Fallback answer")).toBeInTheDocument();
      expect(apiFetch.mock.calls.some((c) => c[0] === "/api/chat" && c[1]?.method === "POST")).toBe(true);
    });

    it("an error event shows a toast and does not fall back", async () => {
      fetchMock.mockImplementation(async () => new Response(sseBody([frame("error", { message: "AI limit reached, try again later" })]), { status: 200 }));
      route();
      renderPage();
      await typeHi();
      expect(await screen.findByText(/AI limit reached, try again later/)).toBeInTheDocument();
      expect(screen.getByText(/You can pick another model in Settings\./)).toBeInTheDocument();
      expect(apiFetch.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
      expect(screen.getByRole("textbox", { name: "Message the assistant" })).toHaveValue("hi");
    });

    const dying = (chunks: string[]) => async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            for (const ch of chunks) c.enqueue(enc.encode(ch));
            setTimeout(() => c.error(new TypeError("network error")), 0);
          },
        }),
        { status: 200 },
      );
    const chatInvalidations = (invalidate: { mock: { calls: unknown[][] } }) =>
      invalidate.mock.calls.filter((c) => JSON.stringify((c[0] as { queryKey?: unknown })?.queryKey) === '["chat"]').length;

    it("a stream that dies after a status keeps the partial bubble, toasts and does not fall back", async () => {
      fetchMock.mockImplementation(dying([frame("status", { step: "tasks" })]));
      route();
      const { invalidate } = renderPage();
      await typeHi();
      expect(await screen.findByText("Stopped")).toBeInTheDocument();
      expect(screen.getByText(/Could not send/)).toBeInTheDocument();
      expect(apiFetch.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
      expect(chatInvalidations(invalidate)).toBeGreaterThan(0);
    });

    it("translates a known error text for Vietnamese users", async () => {
      fetchMock.mockImplementation(async () => new Response(sseBody([frame("error", { message: "AI limit reached, try again later" })]), { status: 200 }));
      route();
      renderPage("vi");
      await typeHi("Nhắn cho trợ lý");
      expect(await screen.findByText(/Đã đạt giới hạn AI, hãy thử lại sau/)).toBeInTheDocument();
    });

    it("a status after text resets the live bubble to the next round", async () => {
      fetchMock.mockImplementation(hang([frame("delta", { text: "Round one" }), frame("status", { step: "tasks" }), frame("delta", { text: "Round two" })]));
      route();
      renderPage();
      await typeHi();
      expect(await screen.findByText("Round two")).toBeInTheDocument();
      expect(screen.queryByText(/Round one/)).toBeNull();
    });

    it("blocks a second send fired in the same tick", async () => {
      fetchMock.mockImplementation(hang([frame("delta", { text: "Partial" })]));
      route();
      renderPage();
      const box = await screen.findByRole("textbox", { name: "Message the assistant" });
      await userEvent.type(box, "hi");
      const form = box.closest("form")!;
      act(() => {
        fireEvent.submit(form);
        fireEvent.submit(form);
      });
      await screen.findByText("Partial");
      expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/chat/stream")).toHaveLength(1);
    });

    it("after Stop resyncs again shortly after and drops the stopped bubble once history has the exchange", async () => {
      fetchMock.mockImplementation(hang([frame("delta", { text: "Partial" })]));
      route();
      const { invalidate } = renderPage();
      await typeHi();
      await screen.findByText("Partial");
      history = [
        { id: 100, role: "user", content: "hi", actions: [] },
        { id: 101, role: "assistant", content: "Stored answer", actions: [] },
      ];
      await userEvent.click(screen.getByRole("button", { name: "Stop" }));
      expect(await screen.findByText("Stored answer")).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText("Stopped")).toBeNull());
      await waitFor(() => expect(chatInvalidations(invalidate)).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    });

    it("keeps the stopped bubble while history only holds an older identical message", async () => {
      history = [
        { id: 5, role: "user", content: "hi", actions: [] },
        { id: 6, role: "assistant", content: "Old answer", actions: [] },
      ];
      fetchMock.mockImplementation(hang([frame("delta", { text: "Partial" })]));
      route();
      renderPage();
      await typeHi();
      await screen.findByText("Partial");
      await userEvent.click(screen.getByRole("button", { name: "Stop" }));
      expect(await screen.findByText("Stopped")).toBeInTheDocument();
    });

    it("Clear chat also clears a stopped bubble", async () => {
      history = [reply({ actions: [] })];
      fetchMock.mockImplementation(hang([frame("delta", { text: "Partial" })]));
      route();
      renderPage();
      await typeHi();
      await screen.findByText("Partial");
      await userEvent.click(screen.getByRole("button", { name: "Stop" }));
      await screen.findByText("Stopped");
      await userEvent.click(screen.getByRole("button", { name: "Clear chat" }));
      const dialog = await screen.findByRole("dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Clear chat" }));
      await waitFor(() => expect(screen.queryByText("Partial")).toBeNull());
    });

    it("Clear chat is disabled while a reply is streaming", async () => {
      history = [reply({ actions: [] })];
      fetchMock.mockImplementation(hang([frame("delta", { text: "Partial" })]));
      route();
      renderPage();
      await screen.findByRole("button", { name: "Clear chat" });
      await typeHi();
      await screen.findByText("Partial");
      expect(screen.getByRole("button", { name: "Clear chat" })).toBeDisabled();
      await userEvent.click(screen.getByRole("button", { name: "Stop" }));
      await screen.findByText("Stopped");
      expect(screen.getByRole("button", { name: "Clear chat" })).toBeEnabled();
    });

    it("shows status chips and Stop in Vietnamese", async () => {
      fetchMock.mockImplementation(hang([frame("status", { step: "free_slots" })]));
      route();
      renderPage("vi");
      await typeHi("Nhắn cho trợ lý");
      expect(await screen.findByText("Đang tìm thời gian trống…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Dừng" })).toBeInTheDocument();
    });
  });

  describe("shortcuts", () => {
    const hang = (chunks: string[]) => async (_u: string, init: RequestInit) => new Response(sseBody(chunks, { hang: true, signal: init.signal as AbortSignal }), { status: 200 });

    it("i focuses the message box but types nothing into it", async () => {
      route();
      renderPage();
      const box = await screen.findByRole("textbox", { name: "Message the assistant" });
      expect(box).not.toHaveFocus();
      await userEvent.keyboard("i");
      expect(box).toHaveFocus();
      expect(box).toHaveValue("");
      await userEvent.keyboard("i"); // now typing: the letter is text
      expect(box).toHaveValue("i");
    });

    it("i does nothing while the assistant is off", async () => {
      enabled = false;
      route();
      renderPage();
      await screen.findByText("The assistant is not set up");
      await userEvent.keyboard("i");
      expect(document.body).toHaveFocus();
    });

    it("Escape stops a streaming reply, from the box or from the page", async () => {
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementation(async (u: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return hang([frame("delta", { text: "Partial" })])(u, init);
      });
      route();
      renderPage();
      await userEvent.type(await screen.findByRole("textbox", { name: "Message the assistant" }), "hi{Enter}");
      await screen.findByText("Partial");
      await userEvent.keyboard("{Escape}");
      expect(signal?.aborted).toBe(true);
      expect(await screen.findByText("Stopped")).toBeInTheDocument();
    });

    it("a customised stop key replaces Escape, also inside the box", async () => {
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementation(async (u: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return hang([frame("delta", { text: "Partial" })])(u, init);
      });
      route();
      renderPage("en", "/", false, { "assistant-stop": "Mod+." });
      await userEvent.type(await screen.findByRole("textbox", { name: "Message the assistant" }), "hi{Enter}");
      await screen.findByText("Partial");
      await userEvent.keyboard("{Escape}");
      expect(signal?.aborted).toBe(false);
      await userEvent.keyboard("{Control>}.{/Control}");
      expect(signal?.aborted).toBe(true);
    });

    it("Escape from the page (focus outside the box) also stops", async () => {
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementation(async (u: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return hang([frame("delta", { text: "Partial" })])(u, init);
      });
      route();
      renderPage();
      await userEvent.type(await screen.findByRole("textbox", { name: "Message the assistant" }), "hi{Enter}");
      await screen.findByText("Partial");
      (document.activeElement as HTMLElement).blur();
      await userEvent.keyboard("{Escape}");
      expect(signal?.aborted).toBe(true);
    });

    it("the help lists the focus key, and no stop key while idle", async () => {
      route();
      renderPage("en", "/assistant", true);
      const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
      await screen.findByText("Write a message");
      expect(within(dialog).getByRole("heading", { name: "Assistant" })).toBeInTheDocument();
      expect(within(dialog).queryByText("Stop the reply")).toBeNull();
    });

    it("the help is in Vietnamese", async () => {
      route();
      renderPage("vi", "/assistant", true);
      const dialog = await screen.findByRole("dialog", { name: "Phím tắt" });
      expect(await within(dialog).findByText("Soạn tin nhắn")).toBeInTheDocument();
      expect(within(dialog).getByRole("heading", { name: "Trợ lý" })).toBeInTheDocument();
    });

    it("Escape does nothing when no reply is streaming", async () => {
      route();
      renderPage();
      await screen.findByRole("textbox", { name: "Message the assistant" });
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByText("Stopped")).toBeNull();
    });
  });
});

describe("AssistantPage context chip", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    localStorage.clear();
    history = [];
    enabled = true;
    sendAnswer = () => reply({ actions: [] });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(sseBody([frame("done", { message: reply({ actions: [] }) })]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  const eventDetail = { event: { id: 7, title: "DB lecture", start: "2026-10-20T08:00:00Z" } };
  const subjectDetail = { subject: { id: 3, display_name: "Databases" } };
  const ctx = (path: string, init?: RequestInit) => {
    if (path === "/api/events/7") return eventDetail;
    if (path === "/api/subjects/3") return subjectDetail;
    return undefined;
  };
  const posted = () => JSON.parse(String(fetchMock.mock.calls.find((c) => c[0] === "/api/chat/stream")![1].body));

  it("shows an event chip, adapts quick prompts and sends event_id", async () => {
    route(ctx);
    renderPage("en", "/assistant?event=7");
    expect(await screen.findByText(/About: DB lecture · /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quiz me on a subject" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Make a quiz from this class" }));
    await waitFor(() => expect(posted().context).toEqual({ path: "/assistant", event_id: 7 }));
  });

  it("shows a subject chip with subject prompts and sends subject_id", async () => {
    route(ctx);
    renderPage("en", "/assistant?subject=3");
    expect(await screen.findByText("About: Databases")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Quiz me on this subject" }));
    await waitFor(() => expect(posted().context).toEqual({ path: "/assistant", subject_id: 3 }));
  });

  it("clearing the chip restores the default prompts and context", async () => {
    route(ctx);
    renderPage("en", "/assistant?subject=3");
    await screen.findByText("About: Databases");
    await userEvent.click(screen.getByRole("button", { name: "Clear the context" }));
    expect(screen.queryByText("About: Databases")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Quiz me on a subject" }));
    await waitFor(() => expect(posted().context).toEqual({ path: "/assistant" }));
  });

  it("is translated in Vietnamese", async () => {
    route(ctx);
    renderPage("vi", "/assistant?subject=3");
    expect(await screen.findByText("Về: Databases")).toBeInTheDocument();
  });
});
