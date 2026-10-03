import { supabase } from "./supabase";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const FLAG_KEY = "timetable:google-connect";

/** Re-run the Google login asking for calendar access that keeps working offline. */
export function startGoogleConnect() {
  try {
    sessionStorage.setItem(FLAG_KEY, "1");
  } catch {
    // storage blocked: the token can't be picked up after the redirect; connecting again shows why
  }
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/settings`,
      scopes: CALENDAR_SCOPE,
      queryParams: { access_type: "offline", prompt: "consent" },
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

export async function takeProviderRefreshToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.provider_refresh_token ?? null;
}
