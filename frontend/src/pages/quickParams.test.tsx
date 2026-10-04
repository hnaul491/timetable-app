import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configure, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../components/ui/Confirm";
import { ToastProvider } from "../components/ui/Toast";
import { I18nProvider } from "../i18n";
import { ShortcutProvider } from "../lib/shortcuts";
import { AssistantPage } from "./AssistantPage";
import { BoardPage } from "./BoardPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  authHeaders: async () => ({}),
}));

// these pages wait for two queries before the target control mounts; 1 s was too short when the suite runs under load
configure({ asyncUtilTimeout: 4000 });

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderAt(url: string, page: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <ShortcutProvider>
          <ToastProvider>
            <ConfirmProvider>
              <MemoryRouter initialEntries={[url]}>
                {page}
                <Where />
              </MemoryRouter>
            </ConfirmProvider>
          </ToastProvider>
        </ShortcutProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (path === "/api/ai/status") return { enabled: true, model: "m" };
    if (path === "/api/chat") return { messages: [] };
    return [];
  });
});

describe("quick-action landing params", () => {
  it("/board?new=1 focuses the new-task input and drops the param", async () => {
    renderAt("/board?new=1", <BoardPage />);
    const input = await screen.findByLabelText("New task");
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/board$/);
  });

  it("/board without the param leaves focus alone", async () => {
    renderAt("/board", <BoardPage />);
    const input = await screen.findByLabelText("New task");
    expect(input).not.toHaveFocus();
  });

  it("/assistant?compose=1 focuses the composer and drops the param", async () => {
    renderAt("/assistant?compose=1", <AssistantPage />);
    const composer = await screen.findByRole("textbox");
    await waitFor(() => expect(composer).toHaveFocus());
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/assistant$/);
  });
});
