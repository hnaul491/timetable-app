import { supabase } from "../lib/supabase";

export function LoginPage() {
  const signIn = () =>
    supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-line bg-surface p-8">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-accent font-bold text-on-accent">T</div>
          <h1 className="text-xl font-bold">Timetable</h1>
        </div>
        <p className="text-sm text-muted">Sign in with your Google account to see your timetable.</p>
        <button type="button" onClick={signIn} className="h-11 rounded-xl bg-accent font-semibold text-on-accent hover:bg-accent-strong">
          Continue with Google
        </button>
      </div>
    </main>
  );
}
