import type { Locale } from "../i18n";
import type { DocListItem, DocumentItem, DocumentTag } from "../types";

export type DocBadge = "PDF" | "PPT" | "DOC" | "XLS" | "IMG" | "ZIP" | "FILE";

/** Short type label for a document, from its mime type or file extension. */
export function docBadge(doc: Pick<DocumentItem, "mime_type" | "name">): DocBadge {
  const mime = doc.mime_type.toLowerCase();
  const ext = doc.name.toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || ext === "pdf") return "PDF";
  if (mime.includes("presentation") || mime.includes("powerpoint") || ["ppt", "pptx", "odp", "key"].includes(ext)) return "PPT";
  if (mime.includes("spreadsheet") || mime.includes("excel") || ["xls", "xlsx", "ods", "csv"].includes(ext)) return "XLS";
  if (mime.includes("word") || mime.includes("opendocument.text") || ["doc", "docx", "odt", "rtf"].includes(ext)) return "DOC";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(ext)) return "IMG";
  if (mime.includes("zip") || mime.includes("compressed") || ["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "ZIP";
  return "FILE";
}

export function formatSize(bytes: number, locale: Locale): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(locale)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
}

/** What the preview dialog needs from either list shape. */
export interface PreviewDoc {
  id: number;
  name: string;
  mime_type: string;
  tag: DocumentTag;
  web_view_link: string;
  preview_url: string | null;
  event: { id: number; start: string } | null;
}

export const previewOfItem = (d: DocumentItem): PreviewDoc => ({
  id: d.id, name: d.name, mime_type: d.mime_type, tag: d.tag, web_view_link: d.web_view_link, preview_url: d.preview_url ?? null,
  event: d.event_id !== null && d.event_start ? { id: d.event_id, start: d.event_start } : null,
});

export const previewOfListItem = (d: DocListItem): PreviewDoc => ({
  id: d.id, name: d.name, mime_type: d.mime_type, tag: d.tag, web_view_link: d.web_view_link, preview_url: d.preview_url ?? null,
  event: d.event ? { id: d.event.id, start: d.event.start } : null,
});
