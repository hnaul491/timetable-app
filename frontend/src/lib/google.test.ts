import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_SCOPE, startGoogleConnect, takeConnectFlag, takeProviderRefreshToken } from "./google";

const supabase = vi.hoisted(() => ({ auth: { signInWithOAuth: vi.fn(), getSession: vi.fn() } }));
vi.mock("./supabase", () => ({ supabase }));

describe("google connect helpers", () => {
  beforeEach(() => {
    sessionStorage.clear();
    supabase.auth.signInWithOAuth.mockReset();
    supabase.auth.getSession.mockReset();
  });

  it("asks Google for offline calendar access and comes back to Settings", async () => {
    await startGoogleConnect();
    expect(CALENDAR_SCOPE).toBe("https://www.googleapis.com/auth/calendar.app.created");
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/settings`,
        scopes: CALENDAR_SCOPE,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    expect(takeConnectFlag()).toBe(true);
    expect(takeConnectFlag()).toBe(false);
  });

  it("reads the provider refresh token from the session", async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { provider_refresh_token: "1//tok" } } });
    expect(await takeProviderRefreshToken()).toBe("1//tok");
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await takeProviderRefreshToken()).toBeNull();
  });
});
