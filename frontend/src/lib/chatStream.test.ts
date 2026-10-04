import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { streamChat } from "./chatStream";

vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), authHeaders: async () => ({}) }));

function body(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}
const handlers = () => ({ onStatus: vi.fn(), onDelta: vi.fn(), onDone: vi.fn(), onError: vi.fn() });

afterEach(() => vi.unstubAllGlobals());

describe("streamChat", () => {
  it("parses frames split across chunks, including CRLF", async () => {
    const text = 'event: status\r\ndata: {"step":"tasks"}\r\n\r\nevent: delta\ndata: {"text":"Hel"}\n\nevent: delta\ndata: {"text":"lo"}\n\nevent: done\ndata: {"message":{"id":1,"role":"assistant","content":"Hello","actions":[]}}\n\n';
    const chunks = [text.slice(0, 20), text.slice(20, 75), text.slice(75, 130), text.slice(130)];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body(chunks), { status: 200 })));
    const h = handlers();
    await streamChat({ message: "x" }, h);
    expect(h.onStatus).toHaveBeenCalledWith("tasks");
    expect(h.onDelta.mock.calls.map((c) => c[0])).toEqual(["Hel", "lo"]);
    expect(h.onDone).toHaveBeenCalledWith(expect.objectContaining({ content: "Hello" }));
  });

  it("reports an error event", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body(['event: error\ndata: {"message":"nope"}\n\n']), { status: 200 })));
    const h = handlers();
    await streamChat({}, h);
    expect(h.onError).toHaveBeenCalledWith("nope");
  });

  it("throws an ApiError on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "AI is not set up" }), { status: 503 })));
    await expect(streamChat({}, handlers())).rejects.toBeInstanceOf(ApiError);
  });

  it("throws when the stream ends without done or error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body(['event: delta\ndata: {"text":"a"}\n\n']), { status: 200 })));
    await expect(streamChat({}, handlers())).rejects.toThrow();
  });
});
