import { authHeaders, toApiError } from "./api";
import type { ChatMessage } from "../types";

export type ChatStep = "events" | "tasks" | "notes" | "subjects" | "free_slots" | "proposal";

export interface ChatStreamHandlers {
  onStatus(step: string): void;
  onDelta(text: string): void;
  onDone(message: ChatMessage): void;
  onError(message: string): void;
}

/** Reads `POST /api/chat/stream` (Server-Sent Events). A non-OK answer before streaming throws an ApiError. */
export async function streamChat(body: unknown, handlers: ChatStreamHandlers, signal?: AbortSignal): Promise<void> {
  const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
  const response = await fetch("/api/chat/stream", { method: "POST", headers, body: JSON.stringify(body), signal });
  if (!response.ok) throw await toApiError(response);
  if (!response.body) throw new Error("No response body");

  let finished = false;
  const dispatch = (frame: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data.join("\n"));
    } catch {
      return;
    }
    if (event === "status" && typeof payload.step === "string") handlers.onStatus(payload.step);
    else if (event === "delta" && typeof payload.text === "string") handlers.onDelta(payload.text);
    else if (event === "done" && payload.message) {
      finished = true;
      handlers.onDone(payload.message as ChatMessage);
    } else if (event === "error") {
      finished = true;
      handlers.onError(typeof payload.message === "string" ? payload.message : "");
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const drain = (flush: boolean) => {
    // a lone trailing \r may be the first half of a CRLF split across chunks: keep it for the next read
    const hold = !flush && buffer.endsWith("\r");
    if (hold) buffer = buffer.slice(0, -1);
    buffer = buffer.replace(/\r\n?/g, "\n");
    let at: number;
    while ((at = buffer.indexOf("\n\n")) >= 0) {
      dispatch(buffer.slice(0, at));
      buffer = buffer.slice(at + 2);
    }
    if (flush && buffer.trim()) dispatch(buffer);
    if (hold) buffer += "\r";
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drain(false);
  }
  buffer += decoder.decode();
  drain(true);
  if (!finished) throw new Error("Stream ended unexpectedly");
}
