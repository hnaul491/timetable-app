import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, translate } from "../i18n";
import { ShortcutProvider } from "../lib/shortcuts";
import type { DocumentItem, GoogleStatus } from "../types";
import { DocumentsSection } from "./DocumentsSection";
import { ConfirmProvider } from "./ui/Confirm";
import { ToastProvider } from "./ui/Toast";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const google: GoogleStatus = {
  configured: true, connected: true, email: "me@example.com", kinds: ["class"], needs_reconnect: false,
  last_push_at: null, last_push_error: null, pending: 0, drive_enabled: true,
};
const doc = (id: number, name: string, over: Partial<DocumentItem> = {}): DocumentItem => ({
  id, subject_id: 3, event_id: null, event_start: null, name, mime_type: "application/pdf", size: 2048, tag: "other",
  web_view_link: `https://drive.example/${id}`, preview_url: `https://drive.google.com/file/d/ID${id}abcdefgh/preview`,
  created_at: "2026-10-01T10:00:00Z", ...over,
});
const DOCS = [
  doc(1, "a.pdf", { event_id: 10, event_start: "2026-10-12T07:00:00Z", tag: "slides" }),
  doc(2, "b.pdf", { event_id: 10, event_start: "2026-10-12T07:00:00Z" }),
  doc(3, "c.pdf", { event_id: 10, event_start: "2026-10-12T07:00:00Z" }),
];

function setup(options: { docs?: DocumentItem[]; email?: string | null; locale?: "en" | "vi" } = {}) {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === "/api/google") return { ...google, email: options.email === undefined ? "me@example.com" : options.email };
    if (typeof path === "string" && path.endsWith("/documents")) return options.docs ?? DOCS;
    return undefined;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["preferences"], { language: "en" });
  return render(
    <I18nProvider locale={options.locale ?? "en"}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ShortcutProvider>
            <ToastProvider>
              <ConfirmProvider>
                <DocumentsSection subjectId={3} eventId={10} />
              </ConfirmProvider>
            </ToastProvider>
          </ShortcutProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

const frame = () => within(screen.getByRole("dialog")).getByTitle(/\.pdf$/) as HTMLIFrameElement;

describe("document preview", () => {
  beforeEach(() => apiFetch.mockReset());

  it("opens the dialog with the iframe on click and returns focus on close", async () => {
    setup();
    const row = await screen.findByRole("link", { name: "b.pdf" });
    await userEvent.click(row);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "b.pdf" })).toBeInTheDocument();
    const iframe = frame();
    expect(iframe).toHaveAttribute("src", "https://drive.google.com/file/d/ID2abcdefgh/preview");
    expect(iframe).toHaveAttribute("allow", "autoplay");
    expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(within(dialog).getByRole("status")).toBeInTheDocument();
    fireEvent.load(iframe);
    expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(row).toHaveFocus();
  });

  it("leaves modified clicks to the browser", async () => {
    setup();
    const row = await screen.findByRole("link", { name: "b.pdf" });
    expect(row).toHaveAttribute("href", "https://drive.example/2");
    expect(fireEvent.click(row, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(row, { metaKey: true })).toBe(true);
    expect(fireEvent.click(row, { shiftKey: true })).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fireEvent.click(row)).toBe(false);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("falls back to Drive when there is no preview url", async () => {
    setup({ docs: [doc(1, "a.pdf", { preview_url: null })] });
    const row = await screen.findByRole("link", { name: "a.pdf" });
    expect(fireEvent.click(row)).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(row).toHaveAttribute("target", "_blank");
  });

  it("moves with the buttons and disables them at the ends", async () => {
    setup();
    await userEvent.click(await screen.findByRole("link", { name: "a.pdf" }));
    const dialog = await screen.findByRole("dialog");
    const prev = within(dialog).getByRole("button", { name: "Previous" });
    const next = within(dialog).getByRole("button", { name: "Next" });
    expect(prev).toBeDisabled();
    await userEvent.click(next);
    expect(frame()).toHaveAttribute("title", "b.pdf");
    expect(prev).toBeEnabled();
    await userEvent.click(next);
    expect(frame()).toHaveAttribute("title", "c.pdf");
    expect(next).toBeDisabled();
    await userEvent.click(prev);
    expect(frame()).toHaveAttribute("title", "b.pdf");
  });

  it("moves with the arrow keys and stops at the ends", async () => {
    setup();
    await userEvent.click(await screen.findByRole("link", { name: "b.pdf" }));
    await screen.findByRole("dialog");
    await userEvent.keyboard("{ArrowRight}");
    expect(frame()).toHaveAttribute("title", "c.pdf");
    await userEvent.keyboard("{ArrowRight}");
    expect(frame()).toHaveAttribute("title", "c.pdf");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(frame()).toHaveAttribute("title", "a.pdf");
  });

  it("has an Open in Drive link, a class link and the sign-in hint with the email", async () => {
    setup();
    await userEvent.click(await screen.findByRole("link", { name: "a.pdf" }));
    const dialog = await screen.findByRole("dialog");
    const drive = within(dialog).getByRole("link", { name: "Open in Drive" });
    expect(drive).toHaveAttribute("href", "https://drive.example/1");
    expect(drive).toHaveAttribute("target", "_blank");
    expect(drive).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(dialog).getByText("Slides")).toBeInTheDocument();
    expect(within(dialog).getByText("PDF")).toBeInTheDocument();
    expect(await within(dialog).findByText(/Sign in to Google as me@example.com in this browser/)).toBeInTheDocument();
    const cls = within(dialog).getByRole("link", { name: /12 October/ });
    expect(cls).toHaveAttribute("href", "/?date=2026-10-12&event=10");
    await userEvent.click(cls);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("omits the email from the hint when unknown", async () => {
    setup({ email: null });
    await userEvent.click(await screen.findByRole("link", { name: "a.pdf" }));
    expect(await screen.findByText("Not showing? Sign in to Google in this browser, or open it in Drive.")).toBeInTheDocument();
  });

  it("renders in Vietnamese", async () => {
    setup({ locale: "vi" });
    await userEvent.click(await screen.findByRole("link", { name: "a.pdf" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: translate("vi", "documents.preview.next") })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: translate("vi", "documents.preview.open") })).toBeInTheDocument();
    expect(within(dialog).getByText(translate("vi", "documents.preview.hintAs", { email: "me@example.com" }))).toBeInTheDocument();
  });
});
