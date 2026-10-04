import type { DocumentItem, DocumentTag } from "../types";
import { ApiError, apiFetch, authHeaders, toApiError } from "./api";

export const MAX_FILE_BYTES = 104_857_600;

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
): Promise<DocumentItem> {
  const start = await apiFetch<UploadStart>("/api/documents/uploads", {
    method: "POST",
    body: JSON.stringify({
      subject_id: meta.subjectId,
      event_id: meta.eventId,
      tag: meta.tag,
      name: file.name,
      mime_type: file.type || "application/octet-stream",
      size: file.size,
    }),
  });
  const url = `/api/documents/uploads/${encodeURIComponent(start.upload_id)}`;
  const total = file.size;
  let offset = 0;
  let resumed = false;
  do {
    const chunk = file.slice(offset, Math.min(offset + start.chunk_size, total));
    const response = await fetch(`${url}?offset=${offset}`, {
      method: "PUT",
      headers: { ...(await authHeaders()), "Content-Type": "application/octet-stream" },
      body: chunk,
    });
    if (!response.ok) {
      const error = await toApiError(response);
      const expected = /expected offset (\d+)/.exec(error.message);
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
  throw new ApiError(500, "Upload finished without a document");
}
