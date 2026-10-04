import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../components/ui/Confirm";
import { ToastProvider } from "../components/ui/Toast";
import { I18nProvider, translate } from "../i18n";
import type { AllDocuments, DocListItem, GoogleStatus, SubjectDetail } from "../types";
import { DocumentsPage } from "./DocumentsPage";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const google: GoogleStatus = {
  configured: true, connected: true, email: "me@example.com", kinds: ["class"], needs_reconnect: false,
  last_push_at: null, last_push_error: null, pending: 0, drive_enabled: true,
};
const db = { id: 1, name: "Relational Databases", color: "#2E55E6", hidden: false };
const gen = { id: 2, name: "GenAI 101", color: "#E65C2E", hidden: true };
const unused = { id: 3, name: "Cơ sở dữ liệu", color: "#2EE65C", hidden: false };
const doc = (over: Partial<DocListItem>): DocListItem => ({
  id: 1, subject: db, event: null, tag: "other", name: "syllabus.pdf", mime_type: "application/pdf", size: 2048,
  web_view_link: "https://drive.example/1", preview_url: "https://drive.google.com/file/d/PREVIEW1234/preview", created_at: "2026-10-01T10:00:00Z", ...over,
});
const DATA: AllDocuments = {
  documents: [
    doc({ id: 1, name: "syllabus.pdf", created_at: "2026-10-01T10:00:00Z" }),
    doc({ id: 2, name: "Lecture 1.pptx", mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", size: 3 * 1024 * 1024, tag: "slides", event: { id: 10, title: "Relational Databases", start: "2026-10-19T11:00:00Z" }, created_at: "2026-10-05T10:00:00Z" }),
    doc({ id: 3, subject: gen, name: "Bài tập tuần 1.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", tag: "exercises", created_at: "2026-10-03T10:00:00Z" }),
  ],
  subjects: [
    { ...db, folder_url: "https://drive.google.com/drive/folders/DBF" },
    { ...gen, folder_url: null },
    { ...unused, folder_url: "https://drive.google.com/drive/folders/EMPTYF" },
  ],
  root_url: "https://drive.google.com/drive/folders/ROOT",
  semester_url: "https://drive.google.com/drive/folders/SEM",
};
const DETAIL = { subject: { id: 1 }, sessions: [], tasks: [] } as unknown as SubjectDetail;

let calls: [string, RequestInit | undefined][] = [];
function setup(options: { data?: AllDocuments | Error; status?: Partial<GoogleStatus>; locale?: "en" | "vi"; pending?: boolean } = {}) {
  calls = [];
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    calls.push([path, init]);
    if (path === "/api/google") return { ...google, ...options.status };
    if (path === "/api/documents" && !init) {
      if (options.pending) return new Promise(() => {});
      if (options.data instanceof Error) throw options.data;
      return options.data ?? DATA;
    }
    if (path.startsWith("/api/subjects/")) return DETAIL;
    return undefined;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <I18nProvider locale={options.locale ?? "en"}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ToastProvider>
            <ConfirmProvider>
              <DocumentsPage />
            </ConfirmProvider>
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

const names = () => screen.queryAllByRole("link").map((a) => a.textContent).filter((x) => /\.(pdf|pptx|docx)$/.test(x ?? ""));

describe("DocumentsPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  it("groups documents by subject with counts, colour and hidden flag", async () => {
    setup();
    const dbSection = await screen.findByRole("region", { name: "Relational Databases" });
    expect(within(dbSection).getByText("2 documents")).toBeInTheDocument();
    expect(within(dbSection).getByRole("link", { name: "syllabus.pdf" })).toHaveAttribute("href", "https://drive.example/1");
    expect(within(dbSection).getByRole("link", { name: "syllabus.pdf" })).toHaveAttribute("target", "_blank");
    const genSection = screen.getByRole("region", { name: "GenAI 101" });
    expect(within(genSection).getByText("Hidden")).toBeInTheDocument();
    expect(within(genSection).getByText("1 document")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Cơ sở dữ liệu" })).not.toBeInTheDocument();
  });

  it("shows type, tag, class link, size and date on a row", async () => {
    setup();
    const row = (await screen.findByRole("link", { name: "Lecture 1.pptx" })).closest("li")!;
    expect(row.querySelector('[data-kind="PPT"]')).not.toBeNull();
    expect(within(row).getByText("Slides")).toBeInTheDocument();
    expect(within(row).getByText("3 MB")).toBeInTheDocument();
    expect(within(row).getByText(/Uploaded 5 October 2026/)).toBeInTheDocument();
    const cls = within(row).getByRole("link", { name: /Mon 19 October · Relational Databases/ });
    expect(cls).toHaveAttribute("href", "/?date=2026-10-19&event=10");
    expect(screen.getByRole("link", { name: "syllabus.pdf" }).closest("li")!.querySelector('[data-kind="PDF"]')).not.toBeNull();
  });

  it("search ignores accents and case in vi", async () => {
    const user = userEvent.setup();
    setup({ locale: "vi" });
    await screen.findByRole("region", { name: "GenAI 101" });
    await user.type(screen.getByRole("searchbox", { name: translate("vi", "documents.page.searchLabel") }), "BAI TAP");
    expect(names()).toEqual(["Bài tập tuần 1.docx"]);
    expect(screen.queryByRole("region", { name: "Relational Databases" })).not.toBeInTheDocument();
  });

  it("shows a message when nothing matches", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("region", { name: "GenAI 101" });
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText("No document matches your search.")).toBeInTheDocument();
  });

  it("filters by tag with aria-pressed chips", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("region", { name: "GenAI 101" });
    const all = screen.getByRole("button", { name: "All" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Slides" }));
    expect(screen.getByRole("button", { name: "Slides" })).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");
    expect(names()).toEqual(["Lecture 1.pptx"]);
    expect(screen.queryByRole("region", { name: "GenAI 101" })).not.toBeInTheDocument();
  });

  it("sorts newest first by default and by name on request", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("region", { name: "GenAI 101" });
    const dbSection = screen.getByRole("region", { name: "Relational Databases" });
    expect(within(dbSection).getAllByRole("link").map((a) => a.textContent).filter((x) => /\.(pdf|pptx)$/.test(x ?? ""))).toEqual(["Lecture 1.pptx", "syllabus.pdf"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "Name A–Z");
    expect(within(screen.getByRole("region", { name: "Relational Databases" })).getAllByRole("link").map((a) => a.textContent).filter((x) => /\.(pdf|pptx)$/.test(x ?? ""))).toEqual(["Lecture 1.pptx", "syllabus.pdf"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "Newest first");
    expect(names()[0]).toBe("Lecture 1.pptx");
  });

  it("name sort reorders rows", async () => {
    const user = userEvent.setup();
    setup({
      data: { ...DATA, documents: [doc({ id: 1, name: "b.pdf", created_at: "2026-10-09T10:00:00Z" }), doc({ id: 2, name: "a.pdf", created_at: "2026-10-01T10:00:00Z" })] },
    });
    await screen.findByRole("link", { name: "a.pdf" });
    expect(names()).toEqual(["b.pdf", "a.pdf"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "Name A–Z");
    expect(names()).toEqual(["a.pdf", "b.pdf"]);
  });

  it("collapses a subject and remembers it", async () => {
    const user = userEvent.setup();
    setup();
    const toggle = await screen.findByRole("button", { name: /^Relational Databases/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: /^Relational Databases/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "syllabus.pdf" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("documents.collapsed")!)).toEqual([1]);
  });

  it("starts collapsed from the remembered state, and survives broken storage", async () => {
    localStorage.setItem("documents.collapsed", "[1]");
    setup();
    expect(await screen.findByRole("button", { name: /^Relational Databases/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /^GenAI 101/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("ignores unreadable remembered state", async () => {
    localStorage.setItem("documents.collapsed", "{oops");
    setup();
    expect(await screen.findByRole("button", { name: /^Relational Databases/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("lists subjects without documents only when asked", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("region", { name: "GenAI 101" });
    const toggle = screen.getByRole("checkbox", { name: "Show subjects without documents" });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    const empty = screen.getByRole("region", { name: "Cơ sở dữ liệu" });
    expect(within(empty).getByText("No documents in this subject yet.")).toBeInTheDocument();
    expect(within(empty).getByRole("button", { name: "Upload to Cơ sở dữ liệu" })).toBeInTheDocument();
  });

  it("links to the Drive folders in a new tab", async () => {
    setup();
    const semester = await screen.findByRole("link", { name: "Open in Drive" });
    expect(semester).toHaveAttribute("href", "https://drive.google.com/drive/folders/SEM");
    expect(semester).toHaveAttribute("target", "_blank");
    const folder = screen.getByRole("link", { name: "Open the Relational Databases folder in Drive" });
    expect(folder).toHaveAttribute("href", "https://drive.google.com/drive/folders/DBF");
    expect(folder).toHaveAttribute("rel", "noopener noreferrer");
    const genSection = screen.getByRole("region", { name: "GenAI 101" });
    expect(within(genSection).queryByRole("link", { name: /folder in Drive/ })).not.toBeInTheDocument();
  });

  it("deletes a document after confirming", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Delete syllabus.pdf" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("syllabus.pdf");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some(([path, init]) => path === "/api/documents/1" && init?.method === "DELETE")).toBe(true));
  });

  it("does not delete when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Delete syllabus.pdf" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("the header Upload button opens the dialog with a subject picker", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Upload" }));
    const dialog = await screen.findByRole("dialog");
    const picker = within(dialog).getByRole("combobox", { name: "Subject" });
    expect(picker).toHaveValue("1");
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["Relational Databases", "GenAI 101", "Cơ sở dữ liệu"]);
  });

  it("a section's + Upload opens the dialog with that subject preselected", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole("button", { name: "Upload to GenAI 101" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Subject" })).toHaveValue("2");
    await waitFor(() => expect(calls.some(([path]) => path === "/api/subjects/2")).toBe(true));
  });

  it("explains an empty library and offers Upload", async () => {
    const user = userEvent.setup();
    setup({ data: { ...DATA, documents: [] } });
    expect(await screen.findByRole("heading", { name: "No documents yet" })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Upload" });
    await user.click(buttons[buttons.length - 1]);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    setup({ pending: true });
    expect(screen.getByRole("status")).toHaveTextContent("Loading documents");
  });

  it("shows an error with Retry", async () => {
    const user = userEvent.setup();
    setup({ data: new Error("boom") });
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
    const before = calls.filter(([p]) => p === "/api/documents").length;
    await user.click(screen.getByRole("button", { name: /retry|try again/i }));
    await waitFor(() => expect(calls.filter(([p]) => p === "/api/documents").length).toBeGreaterThan(before));
  });

  it("points to Google settings when Drive is not connected, with no upload buttons", async () => {
    setup({ status: { connected: false, drive_enabled: false } });
    expect(await screen.findByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "/settings/google");
    await screen.findByRole("region", { name: "GenAI 101" });
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Upload to/ })).not.toBeInTheDocument();
  });

  it("speaks Vietnamese", async () => {
    setup({ locale: "vi" });
    await screen.findByRole("region", { name: "GenAI 101" });
    expect(screen.getByRole("heading", { name: "Tài liệu" })).toBeInTheDocument();
    for (const key of ["documents.page.openDrive", "documents.page.uploadShort"] as const) {
      expect(screen.getAllByText(translate("vi", key)).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("checkbox", { name: translate("vi", "documents.page.showEmpty") })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: translate("vi", "documents.page.sortLabel") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: translate("vi", "documents.filterSlides") })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: translate("vi", "documents.page.openFolderNamed", { name: "Relational Databases" }) })).toBeInTheDocument();
  });

  it("opens a file in the preview dialog, walks the visible list and keeps Drive links on the rows", async () => {
    setup();
    const row = await screen.findByRole("link", { name: "Lecture 1.pptx" });
    expect(row).toHaveAttribute("href", "https://drive.example/1");
    expect(screen.getByRole("link", { name: "Open Lecture 1.pptx in Drive" })).toHaveAttribute("target", "_blank");
    expect(fireEvent.click(row, { ctrlKey: true })).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(row);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTitle("Lecture 1.pptx")).toHaveAttribute("src", "https://drive.google.com/file/d/PREVIEW1234/preview");
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByTitle("syllabus.pdf")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByTitle("Bài tập tuần 1.docx")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
