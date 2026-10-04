import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventPanel } from "./EventPanel";
import { ConfirmProvider } from "./ui/Confirm";
import { ToastProvider } from "./ui/Toast";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const RULE = { id: 5, title: "Gym", kind: "other", weekdays: [1], start_time: "18:00", end_time: "19:00", from_date: "2026-10-20", until_date: "2026-12-15", location: "", occurrences: 9 };
const detail = (ruleId: number | null) => ({
  event: { id: 7, title: "Gym", subject_id: null, subject_name: null, color: null, section: null, start: "2026-10-20T16:00:00Z", end: "2026-10-20T17:00:00Z", room: "", kind: "other", status: "normal", source: "custom", note_count: 0, open_tasks: 0, important: false },
  notes: { before: { body: "" }, after: { body: "" } },
  tasks: [], next_event_id: null, next_event_start: null, recurring_rule_id: ruleId,
});

function setup(ruleId: number | null) {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/events/7") return detail(ruleId);
    if (path === "/api/recurring" && !init?.method) return [RULE];
    if (path === "/api/recurring/5" && init?.method === "PUT") return RULE;
    return [];
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>
          <MemoryRouter>
            <EventPanel eventId={7} onClose={() => {}} onEdit={() => {}} />
          </MemoryRouter>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("EventPanel Edit series", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens the repeating rule dialog from an occurrence and saves it", async () => {
    setup(5);
    await userEvent.click(await screen.findByRole("button", { name: "Edit series" }));
    const dialogs = screen.getAllByRole("dialog");
    const dialog = dialogs[dialogs.length - 1];
    expect(await within(dialog).findByDisplayValue("Gym")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Start")).toHaveValue("18:00");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save event" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/recurring/5", expect.objectContaining({ method: "PUT" }));
    expect(await screen.findByText("Repeating event updated")).toBeInTheDocument();
  });

  it("has no Edit series for a one-off event", async () => {
    setup(null);
    await screen.findByRole("button", { name: "Edit" });
    expect(screen.queryByRole("button", { name: "Edit series" })).not.toBeInTheDocument();
  });
});
