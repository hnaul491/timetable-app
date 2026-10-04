import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_SCOPE, forgetProviderToken, startGoogleConnect, takeConnectFlag, takeProviderRefreshToken, watchProviderToken } from "./google";

const supabase = vi.hoisted(() => ({ auth: { signInWithOAuth: vi.fn(), getSession: vi.fn(), refreshSession: vi.fn(), onAuthStateChange: vi.fn() } }));
vi.mock("./supabase", () => ({ supabase }));

describe("google connect helpers", () => {
  beforeEach(() => {
    sessionStorage.clear();
    supabase.auth.signInWithOAuth.mockReset();
    supabase.auth.getSession.mockReset();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
  });

  it("asks Google for offline calendar access and comes back to Settings", async () => {
    await startGoogleConnect();
    expect(CALENDAR_SCOPE).toBe(
      "https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/drive.file",
    );
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

  it("hints the signed-in Google account", async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { email: "me@example.com" } } } });
    await startGoogleConnect();
    expect(supabase.auth.signInWithOAuth.mock.calls[0][0].options.queryParams).toEqual({
      access_type: "offline", prompt: "consent", login_hint: "me@example.com",
    });
  });

  it("forgets the provider token by refreshing the session, ignoring errors", async () => {
    supabase.auth.refreshSession.mockRejectedValue(new Error("x"));
    await expect(forgetProviderToken()).resolves.toBeUndefined();
    expect(supabase.auth.refreshSession).toHaveBeenCalled();
  });

  it("reads the provider refresh token from the session", async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: { provider_refresh_token: "1//tok" } } });
    expect(await takeProviderRefreshToken()).toBe("1//tok");
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await takeProviderRefreshToken()).toBeNull();
  });

  it("captures the provider token emitted at sign-in, once, then falls back to the session", async () => {
    const unsubscribe = vi.fn();
    supabase.auth.onAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
      cb("SIGNED_IN", { provider_refresh_token: "1//fresh" });
      return { data: { subscription: { unsubscribe } } };
    });
    const stop = watchProviderToken();
    supabase.auth.getSession.mockResolvedValue({ data: { session: { provider_refresh_token: "1//stored" } } });
    expect(await takeProviderRefreshToken()).toBe("1//fresh");
    expect(await takeProviderRefreshToken()).toBe("1//stored");
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
