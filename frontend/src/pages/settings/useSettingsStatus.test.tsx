import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { apiFetch } from "../../lib/api";
import { useSettingsStatus } from "./useSettingsStatus";

const fetcher = () => vi.mocked(apiFetch);
const NOW = new Date("2026-10-19T12:00:00Z");
let data: Record<string, unknown> = {};

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, apiFetch: vi.fn(async (path: string) => data[path] ?? []) };
});

const base = () => ({
  "/api/settings/zeus-key": { configured: true },
  "/api/sync/status": { last_run: { status: "ok", finished_at: "2026-10-19T10:00:00Z" }, last_success_at: "2026-10-19T10:00:00Z" },
  "/api/subjects": [{ hidden: false }, { hidden: true }, { hidden: false }],
  "/api/google": { connected: true, needs_reconnect: false },
  "/api/ai/status": { enabled: true, model: "m2", models: [{ id: "m1", label: "One" }, { id: "m2", label: "Gemini Two" }] },
  "/api/backup/status": { drive_available: true, last_at: "2026-10-04T05:01:00Z" },
});

function statusFor(locale: "en" | "vi" = "en") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>{children}</I18nProvider>
    </QueryClientProvider>
  );
  return renderHook(() => useSettingsStatus(NOW), { wrapper });
}

beforeEach(() => {
  fetcher().mockImplementation(async (path: string) => (data[path] ?? []) as never);
  localStorage.setItem("timetable:theme", "dark");
  data = base();
});

describe("useSettingsStatus", () => {
  it("summarises every section from the fetched data", async () => {
    const { result } = statusFor();
    await waitFor(() => expect(result.current.backup.text).not.toBe(""));
    await waitFor(() => expect(result.current.school.text).not.toBe(""));
    expect(result.current.general).toEqual({ text: "Dark · English", dot: "none" });
    expect(result.current.school).toEqual({ text: "Synced 2 h ago", dot: "ok" });
    expect(result.current.subjects).toEqual({ text: "3 subjects · 1 hidden", dot: "none" });
    expect(result.current.google).toEqual({ text: "Connected", dot: "ok" });
    expect(result.current.ai).toEqual({ text: "Gemini Two", dot: "none" });
    expect(result.current.backup).toEqual({ text: "Last Drive backup: 4 October 2026", dot: "ok" });
  });

  it("speaks Vietnamese", async () => {
    const { result } = statusFor("vi");
    await waitFor(() => expect(result.current.school.text).not.toBe(""));
    expect(result.current.general.text).toBe("Tối · Tiếng Việt");
    expect(result.current.school.text).toBe("Đã đồng bộ 2 giờ trước");
    expect(result.current.subjects.text).toBe("3 môn · 1 đã ẩn");
  });

  it("warns about failed, partial, stale and missing-link syncs", async () => {
    data["/api/sync/status"] = { last_run: { status: "failed", finished_at: "x" }, last_success_at: "2026-10-19T10:00:00Z" };
    const failed = statusFor();
    await waitFor(() => expect(failed.result.current.school.dot).toBe("warn"));
    expect(failed.result.current.school.text).toBe("Sync failed");

    data["/api/sync/status"] = { last_run: { status: "partial", finished_at: "x" }, last_success_at: "2026-10-19T10:00:00Z" };
    const partial = statusFor();
    await waitFor(() => expect(partial.result.current.school.text).toBe("Needs attention"));

    data["/api/sync/status"] = { last_run: { status: "ok", finished_at: "x" }, last_success_at: "2026-10-10T10:00:00Z" };
    const stale = statusFor();
    await waitFor(() => expect(stale.result.current.school).toEqual({ text: "Needs attention", dot: "warn" }));

    data["/api/settings/zeus-key"] = { configured: false };
    const none = statusFor();
    await waitFor(() => expect(none.result.current.school).toEqual({ text: "Add your Zeus link", dot: "warn" }));
  });

  it("reports Google, AI and backup edge states", async () => {
    data["/api/google"] = { connected: true, needs_reconnect: true };
    data["/api/ai/status"] = { enabled: false, model: null };
    data["/api/backup/status"] = { drive_available: false, last_at: null };
    const a = statusFor();
    await waitFor(() => expect(a.result.current.backup.text).toBe("Download only"));
    expect(a.result.current.google).toEqual({ text: "Reconnect needed", dot: "warn" });
    expect(a.result.current.ai).toEqual({ text: "Off", dot: "none" });

    data["/api/google"] = { connected: false, needs_reconnect: false };
    data["/api/backup/status"] = { drive_available: true, last_at: null };
    const b = statusFor();
    await waitFor(() => expect(b.result.current.backup).toEqual({ text: "Never", dot: "none" }));
    expect(b.result.current.google).toEqual({ text: "Not connected", dot: "none" });
  });

  it("is empty with a neutral dot while loading", () => {
    fetcher().mockImplementation(() => new Promise(() => {}));
    const { result } = statusFor();
    for (const id of ["school", "subjects", "google", "ai", "backup"] as const) expect(result.current[id]).toEqual({ text: "", dot: "none" });
  });

  it("stays empty when a query fails, except a failed Zeus link check which needs attention", async () => {
    fetcher().mockImplementation(async (path: string) => {
      throw new Error(path === "/api/settings/zeus-key" ? "403" : "boom");
    });
    const { result } = statusFor();
    await waitFor(() => expect(result.current.school).toEqual({ text: "Needs attention", dot: "warn" }));
    for (const id of ["subjects", "google", "ai", "backup"] as const) expect(result.current[id]).toEqual({ text: "", dot: "none" });

    fetcher().mockImplementation(async (path: string) => {
      if (path === "/api/settings/zeus-key") return { configured: true };
      throw new Error("boom");
    });
    const sync = statusFor();
    await waitFor(() => expect(fetcher().mock.calls.length).toBeGreaterThan(8));
    expect(sync.result.current.school).toEqual({ text: "", dot: "none" });
  });
});
