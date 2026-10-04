import type { DocumentItem, DocumentTag } from "../types";
import { getMessageLocale } from "../i18n/current";
import { translateServerMessage } from "../i18n/serverMessages";
import { ApiError, apiFetch, authHeaders, toApiError } from "./api";

export const MAX_FILE_BYTES = 104_857_600;
const MAX_NAME = 255;

/** Cuts a long file name to what the server accepts, keeping the extension. */
export function limitName(name: string): string {
  if (name.length <= MAX_NAME) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 20 ? name.slice(dot) : "";
  return name.slice(0, MAX_NAME - ext.length) + ext;
}

interface UploadStart {
  upload_id: string;
  chunk_size: number;
}
interface ChunkResult {
  received: number;
  document: DocumentItem | null;
}

/** Uploads a file to Google Drive through the backend, one sequential chunk at a time. */
export async function uploadFile(
  file: File,
  meta: { subjectId: number; eventId: number | null; tag: DocumentTag },
  onProgress: (sent: number, total: number) => void,
  signal?: AbortSignal,
): Promise<DocumentItem> {
  const start = await apiFetch<UploadStart>("/api/documents/uploads", {
    method: "POST",
    signal,
    body: JSON.stringify({
      subject_id: meta.subjectId,
      event_id: meta.eventId,
      tag: meta.tag,
      name: limitName(file.name),
      mime_type: file.type || "application/octet-stream",
      size: file.size,
    }),
  });
  const url = `/api/documents/uploads/${encodeURIComponent(start.upload_id)}`;
  const total = file.size;
  let offset = 0;
  let resumed = false;
  do {
    signal?.throwIfAborted();
    const chunk = file.slice(offset, Math.min(offset + start.chunk_size, total));
    const response = await fetch(`${url}?offset=${offset}`, {
      method: "PUT",
      headers: { ...(await authHeaders()), "Content-Type": "application/octet-stream" },
      body: chunk,
      signal,
    });
    if (!response.ok) {
      // Read the expected offset from the raw English text, before any translation.
      const raw = response.status === 409 ? await response.clone().json().then((b) => (typeof b?.detail === "string" ? b.detail : ""), () => "") : "";
      const expected = /expected offset (\d+)/.exec(raw);
      const error = await toApiError(response);
      if (response.status === 409 && expected && !resumed) {
        resumed = true;
        offset = Number(expected[1]);
        continue;
      }
      throw error;
    }
    const result = (await response.json()) as ChunkResult;
    offset = result.received;
    onProgress(Math.min(offset, total), total);
    if (result.document) return result.document;
  } while (offset < total);
  throw new ApiError(500, translateServerMessage("Upload finished without a document", getMessageLocale()));
}
