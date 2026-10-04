import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, translate } from "../i18n";
import type { DocumentItem, GoogleStatus, SubjectDetail } from "../types";
import { DocumentsSection } from "./DocumentsSection";
import { ConfirmProvider } from "./ui/Confirm";
import { ToastProvider } from "./ui/Toast";

const apiFetch = vi.fn();
const uploadFile = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
vi.mock("../lib/upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/upload")>()),
  uploadFile: (...args: unknown[]) => uploadFile(...args),
}));

const google: GoogleStatus = {
  configured: true, connected: true, email: "me@example.com", kinds: ["class"], needs_reconnect: false,
  last_push_at: null, last_push_error: null, pending: 0, drive_enabled: true,
};
const doc = (over: Partial<DocumentItem>): DocumentItem => ({
  id: 1, subject_id: 3, event_id: null, event_start: null, name: "syllabus.pdf", mime_type: "application/pdf", size: 2048,
  tag: "other", web_view_link: "https://drive.example/1", created_at: "2026-10-01T10:00:00Z", ...over,
});
const DOCS: DocumentItem[] = [
  doc({ id: 1, name: "syllabus.pdf" }),
  doc({ id: 2, name: "lecture1.pptx", mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", size: 3 * 1024 * 1024, tag: "slides", event_id: 10, event_start: "2026-10-05T07:00:00Z" }),
  doc({ id: 3, name: "td1.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", tag: "exercises", event_id: 11, event_start: "2026-10-12T07:00:00Z" }),
];
const DETAIL = {
  subject: { id: 3 },
  sessions: [{ id: 10, start: "2026-10-05T07:00:00Z", end: "2026-10-05T09:00:00Z" }, { id: 11, start: "2026-10-12T07:00:00Z", end: "2026-10-12T09:00:00Z" }],
  tasks: [],
} as unknown as SubjectDetail;

let calls: [string, RequestInit | undefined][] = [];
function setup(options: { googleError?: boolean; status?: Partial<GoogleStatus>; docs?: DocumentItem[]; eventId?: number; locale?: "en" | "vi"; folder?: string } = {}) {
  calls = [];
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    calls.push([path, init]);
    if (path === "/api/google") {
      if (options.googleError) throw new Error("google down");
      return { ...google, ...options.status };
    }
    if (path === "/api/documents") return { documents: [], subjects: [{ id: 3, name: "DB", color: "#000000", hidden: false, folder_url: options.folder ?? null }], root_url: null, semester_url: null };
    if (path.endsWith("/documents")) return options.docs ?? DOCS;
    if (path === "/api/subjects/3") return DETAIL;
    return undefined;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <I18nProvider locale={options.locale ?? "en"}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ToastProvider>
            <ConfirmProvider>
              <DocumentsSection subjectId={3} eventId={options.eventId} />
            </ConfirmProvider>
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe("DocumentsSection", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    uploadFile.mockReset();
  });

  it("links to the subject's Drive folder when it has one", async () => {
    setup({ folder: "https://drive.google.com/drive/folders/F1" });
    const link = await screen.findByRole("link", { name: "Open folder in Drive" });
    expect(link).toHaveAttribute("href", "https://drive.google.com/drive/folders/F1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("has no folder link without a folder or for a single class", async () => {
    setup();
    await screen.findByText("syllabus.pdf");
    expect(screen.queryByRole("link", { name: "Open folder in Drive" })).not.toBeInTheDocument();
  });

  it("lists documents grouped by class and filters by tag", async () => {
    setup();
    expect(await screen.findByText("syllabus.pdf")).toBeInTheDocument();
    expect(screen.getByText("Not linked to a class")).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings.at(-1)).toBe("Not linked to a class");
    expect(screen.getByText(/5 October 2026/)).toBeInTheDocument();
    expect(screen.getByText(/12 October 2026/)).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("PPT")).toBeInTheDocument();
    expect(screen.getByText("DOC")).toBeInTheDocument();
    expect(screen.getByText(/3 MB/)).toBeInTheDocument();
    const open = screen.getByRole("link", { name: "Open lecture1.pptx" });
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");

    await userEvent.click(screen.getByRole("button", { name: "Slides" }));
    expect(screen.getByText("lecture1.pptx")).toBeInTheDocument();
    expect(screen.queryByText("syllabus.pdf")).not.toBeInTheDocument();
    expect(screen.queryByText("td1.docx")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Exercises & exams" }));
    expect(screen.getByText("td1.docx")).toBeInTheDocument();
    expect(screen.queryByText("lecture1.pptx")).not.toBeInTheDocument();
  });

  it("asks before deleting and sends nothing on cancel", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Delete syllabus.pdf" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Delete syllabus.pdf" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some(([path, init]) => path === "/api/documents/1" && init?.method === "DELETE")).toBe(true));
    expect(await screen.findByText("Document deleted")).toBeInTheDocument();
  });

  it("shows the error with a retry when the Google status cannot be loaded", async () => {
    setup({ googleError: true });
    expect(await screen.findByText(/google down/)).toBeInTheDocument();
  });

  it("Cancel while uploading aborts the upload and marks the file cancelled", async () => {
    let signal: AbortSignal | undefined;
    uploadFile.mockImplementation(
      (_f: File, _m: unknown, _p: unknown, s: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal = s;
          s.addEventListener("abort", () => reject(s.reason));
        }),
    );
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Upload documents" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.upload(dialog.querySelector<HTMLInputElement>('input[type="file"]')!, new File(["abc"], "a.pdf", { type: "application/pdf" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(signal).toBeDefined());
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(signal?.aborted).toBe(true);
    expect(await within(dialog).findByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByText(/Could not upload/)).not.toBeInTheDocument();
  });

  it("refuses files over 100 MB in the upload dialog", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Upload documents" }));
    const dialog = await screen.findByRole("dialog");
    const huge = new File(["x"], "huge.zip", { type: "application/zip" });
    Object.defineProperty(huge, "size", { value: 104_857_601 });
    const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, huge);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("“huge.zip” is larger than 100 MB");
    expect(within(dialog).queryByText("huge.zip")).not.toBeInTheDocument();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("uploads a file with the chosen class and tag", async () => {
    uploadFile.mockResolvedValue(DOCS[0]);
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Upload documents" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getAllByRole("option").length).toBeGreaterThan(4));
    await userEvent.selectOptions(within(dialog).getByLabelText("Class"), "11");
    await userEvent.selectOptions(within(dialog).getByLabelText("Type"), "exercises");
    await userEvent.upload(dialog.querySelector<HTMLInputElement>('input[type="file"]')!, new File(["abc"], "a.pdf", { type: "application/pdf" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(uploadFile).toHaveBeenCalled());
    expect(uploadFile.mock.calls[0][1]).toEqual({ subjectId: 3, eventId: 11, tag: "exercises" });
    expect(await screen.findByText("1 document uploaded")).toBeInTheDocument();
  });

  it("presets the class and shows a compact list for a class", async () => {
    setup({ eventId: 10, docs: [DOCS[1]] });
    expect(await screen.findByText("lecture1.pptx")).toBeInTheDocument();
    expect(calls.some(([path]) => path === "/api/events/10/documents")).toBe(true);
    expect(screen.queryByRole("group", { name: "Filter documents" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Upload documents" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Class")).toHaveValue("10");
  });

  it("shows reconnect when drive is off", async () => {
    setup({ status: { drive_enabled: false } });
    expect(await screen.findByText(/Reconnect Google in Settings to turn them on/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "/settings/google");
    expect(screen.queryByRole("button", { name: "Upload documents" })).not.toBeInTheDocument();
  });

  it("renders in Vietnamese", async () => {
    setup({ locale: "vi" });
    expect(await screen.findByText(translate("vi", "documents.noClass"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: translate("vi", "documents.filterExercises") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: translate("vi", "documents.upload") })).toBeInTheDocument();
    expect(screen.getByText(/5 tháng 10/)).toBeInTheDocument();
  });
});
