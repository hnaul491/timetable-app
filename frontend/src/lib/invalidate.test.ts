import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateTaskViews } from "./invalidate";

describe("invalidateTaskViews", () => {
  it("also refreshes the free time answer, which depends on events", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    invalidateTaskViews(client);
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining(["events", "free-time"]));
  });
});
