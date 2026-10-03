import { supabase } from "./supabase";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const FLAG_KEY = "timetable:google-connect";

/** Re-run the Google login asking for calendar access that keeps working offline. */
export async function startGoogleConnect() {
  try {
    sessionStorage.setItem(FLAG_KEY, "1");
  } catch {
    // storage blocked: the token can't be picked up after the redirect; connecting again shows why
  }
  let email: string | undefined;
  try {
    email = (await supabase.auth.getSession()).data.session?.user?.email ?? undefined;
  } catch {
    // no hint: Google shows its account chooser
  }
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/settings`,
      scopes: CALENDAR_SCOPE,
      queryParams: { access_type: "offline", prompt: "consent", ...(email ? { login_hint: email } : {}) },
    },
  });
}

/** True once after coming back from startGoogleConnect. */
export function takeConnectFlag(): boolean {
  try {
    const set = sessionStorage.getItem(FLAG_KEY) === "1";
    sessionStorage.removeItem(FLAG_KEY);
    return set;
  } catch {
    return false;
  }
}

let captured: string | null = null;

/** supabase-js only exposes provider_refresh_token right after sign-in, so grab it as it is emitted. */
export function watchProviderToken(): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.provider_refresh_token) captured = session.provider_refresh_token;
  });
  return () => data.subscription.unsubscribe();
}

export async function takeProviderRefreshToken(): Promise<string | null> {
  if (captured) {
    const token = captured;
    captured = null;
    return token;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.provider_refresh_token ?? null;
}

/** Drop the provider token from browser storage once the server has it: a refreshed session no longer carries it. */
export async function forgetProviderToken(): Promise<void> {
  try {
    await supabase.auth.refreshSession();
  } catch {
    // best effort
  }
}
