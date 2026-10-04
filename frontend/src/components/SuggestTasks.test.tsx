import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { SuggestTasks } from "./SuggestTasks";
import { ToastProvider } from "./ui/Toast";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

let enabled = true;
function setup(locale: "en" | "vi" = "en") {
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/ai/status") return { enabled, model: "m" };
    if (path === "/api/ai/suggest") return { suggestions: [{ title: "Redo exercise 4", due_date: "2026-10-22" }, { title: "Read chapter 2" }] };
    if (path === "/api/tasks" && init?.method === "POST") return { id: 9 };
    return undefined;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>
        <ToastProvider>
          <SuggestTasks eventId={7} subjectId={3} tab="after" />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("SuggestTasks", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    enabled = true;
  });

  it("lists suggestions; Add creates a task for the event and subject", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Suggest tasks" }));
    expect(await screen.findByText("Redo exercise 4")).toBeInTheDocument();
    const suggest = apiFetch.mock.calls.find((c) => c[0] === "/api/ai/suggest")!;
    expect(JSON.parse(suggest[1].body)).toEqual({ event_id: 7, tab: "after", locale: "en" });
    await userEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);
    await waitFor(() => {
      const post = apiFetch.mock.calls.find((c) => c[0] === "/api/tasks")!;
      expect(JSON.parse(post[1].body)).toEqual({ title: "Redo exercise 4", due_date: "2026-10-22", subject_id: 3, event_id: 7 });
    });
    await waitFor(() => expect(screen.queryByText("Redo exercise 4")).toBeNull());
  });

  it("Dismiss removes a suggestion without calling the task API", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Suggest tasks" }));
    await screen.findByText("Read chapter 2");
    await userEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[1]);
    expect(screen.queryByText("Read chapter 2")).toBeNull();
    expect(apiFetch.mock.calls.some((c) => c[0] === "/api/tasks")).toBe(false);
  });

  it("is disabled when the AI is off", async () => {
    enabled = false;
    setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Suggest tasks" })).toBeDisabled());
  });

  it("sends the interface language", async () => {
    setup("vi");
    await userEvent.click(await screen.findByRole("button", { name: "Gợi ý công việc" }));
    await waitFor(() => {
      const suggest = apiFetch.mock.calls.find((c) => c[0] === "/api/ai/suggest")!;
      expect(JSON.parse(suggest[1].body).locale).toBe("vi");
    });
  });

  it("renders in Vietnamese", async () => {
    setup("vi");
    expect(await screen.findByRole("button", { name: "Gợi ý công việc" })).toBeInTheDocument();
  });
});
