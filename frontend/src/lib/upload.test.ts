import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentItem } from "../types";
import { uploadFile } from "./upload";

const apiFetch = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  authHeaders: async () => ({ Authorization: "Bearer tok" }),
}));

const CHUNK = 4 * 1024 * 1024;
const doc: DocumentItem = {
  id: 7, subject_id: 1, event_id: null, event_start: null, name: "big.pdf", mime_type: "application/pdf",
  size: 9 * 1024 * 1024, tag: "slides", web_view_link: "https://drive/x", created_at: "2026-10-04T10:00:00Z",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function makeFile(size: number) {
  return new File([new Uint8Array(size)], "big.pdf", { type: "application/pdf" });
}

describe("uploadFile", () => {
  const puts: { url: string; size: number; headers: Record<string, string> }[] = [];
  beforeEach(() => {
    puts.length = 0;
    apiFetch.mockReset().mockResolvedValue({ upload_id: "u1", chunk_size: CHUNK });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends a 9 MiB file as 3 chunks with offsets and progress", async () => {
    const total = 9 * 1024 * 1024;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const size = (init.body as Blob).size;
      puts.push({ url, size, headers: init.headers as Record<string, string> });
      const received = Number(new URL(url, "http://x").searchParams.get("offset")) + size;
      return json({ received, document: received >= total ? doc : null });
    }));
    const progress: [number, number][] = [];
    const result = await uploadFile(makeFile(total), { subjectId: 1, eventId: null, tag: "slides" }, (s, t) => progress.push([s, t]));
    expect(result).toEqual(doc);
    expect(apiFetch).toHaveBeenCalledWith("/api/documents/uploads", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ subject_id: 1, event_id: null, tag: "slides", name: "big.pdf", mime_type: "application/pdf", size: total });
    expect(puts.map((p) => p.url)).toEqual([
      "/api/documents/uploads/u1?offset=0",
      `/api/documents/uploads/u1?offset=${CHUNK}`,
      `/api/documents/uploads/u1?offset=${2 * CHUNK}`,
    ]);
    expect(puts.map((p) => p.size)).toEqual([CHUNK, CHUNK, total - 2 * CHUNK]);
    expect(puts[0].headers).toMatchObject({ Authorization: "Bearer tok", "Content-Type": "application/octet-stream" });
    expect(progress.at(-1)).toEqual([total, total]);
    expect(progress.map((p) => p[0])).toEqual([CHUNK, 2 * CHUNK, total]);
  });

  it("resumes from the offset the server expects after a 409", async () => {
    const total = 9 * 1024 * 1024;
    let first = true;
    const offsets: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
      offsets.push(offset);
      if (first) {
        first = false;
        return json({ detail: `expected offset ${CHUNK}` }, 409);
      }
      const received = offset + (init.body as Blob).size;
      return json({ received, document: received >= total ? doc : null });
    }));
    await uploadFile(makeFile(total), { subjectId: 1, eventId: 5, tag: "other" }, () => {});
    expect(offsets).toEqual([0, CHUNK, 2 * CHUNK]);
  });

  it("throws an ApiError when the server refuses a chunk", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "boom" }, 500)));
    await expect(uploadFile(makeFile(10), { subjectId: 1, eventId: null, tag: "other" }, () => {})).rejects.toMatchObject({ status: 500, message: "boom" });
  });
});
