import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewEventPage } from "./NewEventPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/events/new"]}>
        <Routes>
          <Route path="/events/new" element={<NewEventPage />} />
          <Route path="/" element={<p>Calendar home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillCommon() {
  await userEvent.type(screen.getByLabelText("Title"), "French (external)");
  await userEvent.selectOptions(screen.getByLabelText("Type"), "french_ext");
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-26" } });
  fireEvent.change(screen.getByLabelText("Start"), { target: { value: "19:30" } });
  fireEvent.change(screen.getByLabelText("End"), { target: { value: "21:00" } });
  await userEvent.type(screen.getByLabelText("Place"), "Alliance");
}

describe("NewEventPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({});
  });

  it("creates a one-off event with Paris times converted to UTC", async () => {
    renderPage();
    await fillCommon();
    await userEvent.click(screen.getByRole("button", { name: "Save event" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/events", {
      method: "POST",
      body: JSON.stringify({ title: "French (external)", kind: "french_ext", start: "2026-10-26T18:30:00.000Z",
                             end: "2026-10-26T20:00:00.000Z", room: "Alliance" }),
    });
    expect(await screen.findByText("Calendar home")).toBeInTheDocument();
  });

  it("creates a weekly rule", async () => {
    renderPage();
    await fillCommon();
    await userEvent.click(screen.getByLabelText("Repeat weekly"));
    await userEvent.click(screen.getByRole("checkbox", { name: "Thu" }));
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2026-12-17" } });
    await userEvent.click(screen.getByRole("button", { name: "Save event" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/recurring", {
      method: "POST",
      body: JSON.stringify({ title: "French (external)", kind: "french_ext", weekdays: [0, 3], start_time: "19:30",
                             end_time: "21:00", from_date: "2026-10-26", until_date: "2026-12-17", location: "Alliance" }),
    });
  });

  it("requires a title", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Save event" }));
    expect(screen.getByText("Give the event a title.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects a cleared start time", async () => {
    renderPage();
    await fillCommon();
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "" } });
    await userEvent.click(screen.getByRole("button", { name: "Save event" }));
    expect(screen.getByText("Pick a date, a start time and an end time.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects a weekly rule longer than 400 days", async () => {
    renderPage();
    await fillCommon();
    await userEvent.click(screen.getByLabelText("Repeat weekly"));
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2028-01-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Save event" }));
    expect(screen.getByText("A repeating event can last at most 400 days.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
