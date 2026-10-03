import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "tok" } } })) } },
}));

import { ApiError, apiFetch } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
  it("sends the bearer token and parses JSON", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiFetch<{ ok: number }>("/api/x")).resolves.toEqual({ ok: 1 });
    const headers = new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });

  it("sets JSON content type when sending a body", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/x", { method: "PUT", body: JSON.stringify({ a: 1 }) });
    const headers = new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("throws ApiError with the FastAPI detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "this account is not allowed" }), { status: 403 })));
    const error = await apiFetch("/api/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, message: "this account is not allowed" });
  });

  it("returns undefined for 204 No Content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(apiFetch("/api/x", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("joins FastAPI validation messages", async () => {
    const detail = [
      { loc: ["body", "until_date"], msg: "Value error, a repeating event can span at most 400 days", type: "value_error" },
      { loc: ["body", "title"], msg: "String should have at least 1 character", type: "string_too_short" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail }), { status: 422 })));
    const error = await apiFetch("/api/x").catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 422,
      message: "a repeating event can span at most 400 days; String should have at least 1 character",
    });
  });
});
