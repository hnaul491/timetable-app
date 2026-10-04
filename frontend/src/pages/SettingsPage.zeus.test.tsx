import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/Toast";
import { SettingsAt } from "../test/settingsRoute";

let putResult: unknown = { configured: true, group_mismatch: null };
const calls: { path: string; init?: RequestInit }[] = [];

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      if (path === "/api/settings/zeus-key" && init?.method === "PUT") return putResult;
      if (path === "/api/settings/zeus-key") return { configured: true };
      if (path === "/api/sync/status") return { last_run: null, last_success_at: null };
      if (path === "/api/semesters")
        return [
          { id: 4, code: "S5", name: "Semester 5", zeus_group_id: 1111, start_date: null, end_date: null, is_active: false },
          { id: 5, code: "S7", name: "Semester 7", zeus_group_id: 2222, start_date: null, end_date: null, is_active: true },
        ];
      if (path.startsWith("/api/semesters/") && init?.method === "PATCH") return {};
      return [];
    }),
  };
});

async function saveLink() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SettingsAt />
      </ToastProvider>
    </QueryClientProvider>,
  );
  await userEvent.type(await screen.findByLabelText("Zeus ICS subscription link"), "https://zeus.example/api/group/3333/ics/key");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("Zeus link group mismatch", () => {
  beforeEach(() => {
    calls.length = 0;
    putResult = { configured: true, group_mismatch: { link_group: 3333, semester_group: 2222 } };
  });

  it("warns and keeps the semester group", async () => {
    await saveLink();
    const note = await screen.findByRole("alert");
    expect(note).toHaveTextContent("3333");
    expect(note).toHaveTextContent("2222");
    await userEvent.click(screen.getByRole("button", { name: "Keep 2222" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(calls.some((c) => c.init?.method === "PATCH")).toBe(false);
  });

  it("uses the link group on the active semester", async () => {
    await saveLink();
    await userEvent.click(await screen.findByRole("button", { name: "Use group 3333" }));
    await vi.waitFor(() => {
      const patch = calls.find((c) => c.init?.method === "PATCH");
      expect(patch?.path).toBe("/api/semesters/5");
      expect(JSON.parse(String(patch?.init?.body))).toEqual({ zeus_group_id: 3333 });
    });
    await vi.waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("shows no warning without a mismatch", async () => {
    putResult = { configured: true, group_mismatch: null };
    await saveLink();
    expect(await screen.findByText("Zeus link saved")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
