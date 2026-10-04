import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecurringList } from "./RecurringList";
import { ConfirmProvider } from "./ui/Confirm";
import { ToastProvider } from "./ui/Toast";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const RULE = { id: 5, title: "French (external)", kind: "french_ext", weekdays: [0, 3], start_time: "19:30", end_time: "21:00",
               from_date: "2026-10-19", until_date: "2026-12-17", location: "Alliance", occurrences: 18 };

describe("RecurringList", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (_p: string, init?: RequestInit) => (init?.method === "DELETE" ? { deleted: true } : [RULE]));
  });

  it("lists rules and deletes after the dialog is confirmed", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ConfirmProvider>
            <RecurringList />
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("French (external)")).toBeInTheDocument();
    expect(screen.getByText(/Mon, Thu · 19:30–21:00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete French (external)" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/api/recurring/5", { method: "DELETE" });
    await userEvent.click(screen.getByRole("button", { name: "Delete French (external)" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/recurring/5", { method: "DELETE" });
    expect(await screen.findByText("Repeating event deleted")).toBeInTheDocument();
  });
});

describe("RecurringList edit", () => {
  it("edits a rule in a dialog prefilled from the list and saves with PUT", async () => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (_p: string, init?: RequestInit) => (init?.method === "PUT" ? { ...RULE } : [RULE]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ConfirmProvider>
            <RecurringList />
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Edit French (external)" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Title")).toHaveValue("French (external)");
    expect(within(dialog).getByLabelText("Type")).toHaveValue("french_ext");
    expect(within(dialog).getByLabelText("Start")).toHaveValue("19:30");
    expect(within(dialog).getByLabelText("End")).toHaveValue("21:00");
    expect(within(dialog).getByLabelText("From")).toHaveValue("2026-10-19");
    expect(within(dialog).getByLabelText("Until")).toHaveValue("2026-12-17");
    expect(within(dialog).getByLabelText("Place")).toHaveValue("Alliance");
    expect(within(dialog).getByRole("checkbox", { name: "Mon" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Tue" })).not.toBeChecked();
    expect(within(dialog).getByText("Changes apply to future occurrences without notes.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Tue" }));
    await userEvent.clear(within(dialog).getByLabelText("Place"));
    await userEvent.type(within(dialog).getByLabelText("Place"), "Online");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save event" }));
    const put = apiFetch.mock.calls.find((c) => c[0] === "/api/recurring/5" && c[1]?.method === "PUT");
    expect(JSON.parse(put![1].body)).toEqual({
      title: "French (external)", kind: "french_ext", weekdays: [0, 1, 3], start_time: "19:30", end_time: "21:00",
      from_date: "2026-10-19", until_date: "2026-12-17", location: "Online",
    });
    expect(await screen.findByText("Repeating event updated")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
