import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, translate } from "../i18n";
import { BackupSettings } from "./BackupSettings";
import { ToastProvider } from "./ui/Toast";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  authHeaders: async () => ({ Authorization: "Bearer t" }),
}));

function renderWith(status: { drive_available: boolean; last_at: string | null }, locale: "en" | "vi" = "en") {
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/backup/drive" && init?.method === "POST") return { file_name: "timetable-backup-2026-10-15.json", created_at: "x" };
    return status;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>
        <ToastProvider>
          <BackupSettings />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("BackupSettings", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("shows never when there is no automatic backup", async () => {
    renderWith({ drive_available: true, last_at: null });
    expect(await screen.findByText(translate("en", "backup.never"))).toBeInTheDocument();
  });

  it("shows the last automatic backup date", async () => {
    renderWith({ drive_available: true, last_at: "2026-10-15T12:00:00Z" });
    expect(await screen.findByText(/15 October 2026/)).toBeInTheDocument();
  });

  it("downloads with auth headers and the server file name", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { headers: { "Content-Disposition": 'attachment; filename="timetable-backup-2026-10-15.json"' } }));
    vi.stubGlobal("fetch", fetchMock);
    renderWith({ drive_available: true, last_at: null });
    await userEvent.click(await screen.findByRole("button", { name: translate("en", "backup.download") }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/backup", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer t" }) }));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(await screen.findByText(translate("en", "backup.downloaded"))).toBeInTheDocument();
  });

  it("reports a failed download", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "boom" }), { status: 500 })));
    renderWith({ drive_available: true, last_at: null });
    await userEvent.click(await screen.findByRole("button", { name: translate("en", "backup.download") }));
    expect(await screen.findByText(translate("en", "backup.downloadFailed", { error: "boom" }))).toBeInTheDocument();
  });

  it("disables the Drive button with a hint when Drive is not connected", async () => {
    renderWith({ drive_available: false, last_at: null });
    expect(await screen.findByRole("button", { name: translate("en", "backup.drive") })).toBeDisabled();
    expect(await screen.findByText(translate("en", "backup.needDrive"))).toBeInTheDocument();
  });

  it("backs up to Drive when available", async () => {
    renderWith({ drive_available: true, last_at: null });
    const button = await screen.findByRole("button", { name: translate("en", "backup.drive") });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(await screen.findByText(translate("en", "backup.driveDone", { name: "timetable-backup-2026-10-15.json" }))).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/api/backup/drive", { method: "POST" });
  });

  it("speaks Vietnamese", async () => {
    renderWith({ drive_available: true, last_at: null }, "vi");
    expect(await screen.findByRole("button", { name: "Tải bản sao lưu (.json)" })).toBeInTheDocument();
    expect(screen.getByText(/Google Drive của bạn/)).toBeInTheDocument();
  });
});
