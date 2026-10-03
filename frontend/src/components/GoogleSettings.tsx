import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { startGoogleConnect, takeConnectFlag, takeProviderRefreshToken } from "../lib/google";
import { formatTime, parisParts } from "../lib/time";
import type { GoogleKind, GoogleStatus, PushResult } from "../types";

const KINDS: [GoogleKind, string][] = [
  ["class", "Classes"],
  ["exam", "Exams"],
  ["holiday", "Holidays"],
  ["work", "Work shifts"],
  ["french_ext", "External French"],
  ["other", "Other events"],
];
const MAX_ROUNDS = 15;
const card = "flex flex-col gap-3 rounded-2xl border border-line bg-white p-5";
const primary = "h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-60";
const secondary = "h-10 rounded-xl border border-line bg-white px-4 text-sm font-semibold disabled:opacity-60";

export function GoogleSettings() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const handled = useRef(false);
  const status = useQuery({ queryKey: ["google"], queryFn: () => apiFetch<GoogleStatus>("/api/google") });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["google"] });

  const connect = useMutation({
    mutationFn: (refresh_token: string) =>
      apiFetch<GoogleStatus>("/api/google/connect", { method: "POST", body: JSON.stringify({ refresh_token }) }),
    onSuccess: () => {
      setNotice("Connected. Press “Push now” to fill your “My Timetable” calendar.");
      refresh();
    },
  });
  const kinds = useMutation({
    mutationFn: (next: GoogleKind[]) => apiFetch<GoogleStatus>("/api/google/kinds", { method: "PUT", body: JSON.stringify({ kinds: next }) }),
    onSuccess: refresh,
  });
  const disconnect = useMutation({
    mutationFn: () => apiFetch("/api/google", { method: "DELETE" }),
    onSuccess: () => {
      setConfirm(false);
      setProgress(null);
      refresh();
    },
  });
  const push = useMutation({
    mutationFn: async () => {
      let sent = 0;
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const result = await apiFetch<PushResult>("/api/google/push", { method: "POST" });
        sent += result.done;
        setProgress(result.remaining > 0 ? `${sent} changes sent, ${result.remaining} left…` : `${sent} changes sent`);
        if (result.status !== "partial" || result.remaining === 0) return result;
      }
      return null;
    },
    onSettled: refresh,
  });

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    if (!takeConnectFlag()) return;
    takeProviderRefreshToken().then((token) => {
      if (token) connect.mutate(token);
      else setNotice("Google didn't give offline access. Remove “Timetable” at myaccount.google.com/permissions, then connect again.");
    });
  }, [connect]);

  const s = status.data;
  const error = (connect.error ?? kinds.error ?? disconnect.error ?? push.error) as Error | null;
  return (
    <section className={card} aria-labelledby="google-heading">
      <h2 id="google-heading" className="text-base font-bold">
        Google Calendar
      </h2>
      {!s ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !s.configured ? (
        <p className="text-sm text-muted">Google Calendar push isn't set up on the server yet — follow “Google Calendar” in docs/SETUP.md.</p>
      ) : !s.connected ? (
        <>
          <p className="text-sm text-[#3A3F4B]">
            Creates a calendar called “My Timetable” in your Google account and keeps it up to date. Notes are never sent. Reminders come from Google
            Calendar — set them on that calendar.
          </p>
          <button type="button" className={primary} onClick={() => startGoogleConnect()} disabled={connect.isPending}>
            Connect Google Calendar
          </button>
        </>
      ) : (
        <>
          <p className="text-sm">
            Connected as <span className="font-semibold">{s.email}</span>
          </p>
          {s.needs_reconnect && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#F3C4C4] bg-[#FDECEC] px-4 py-3 text-sm text-[#8B1A1A]">
              <span>{s.last_push_error ?? "Google access stopped working."}</span>
              <button type="button" className={primary} onClick={() => startGoogleConnect()}>
                Reconnect Google
              </button>
            </div>
          )}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-semibold text-[#3A3F4B]">Send to Google</legend>
            {KINDS.map(([kind, label]) => (
              <label key={kind} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.kinds.includes(kind)}
                  disabled={kinds.isPending}
                  onChange={(e) => kinds.mutate(e.target.checked ? [...s.kinds, kind] : s.kinds.filter((k) => k !== kind))}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <p className="text-sm text-muted">
            {s.pending === 0 ? "Everything is up to date." : `${s.pending} ${s.pending === 1 ? "change" : "changes"} waiting to be sent.`} Last push:{" "}
            {s.last_push_at ? `${parisParts(s.last_push_at).date} ${formatTime(s.last_push_at)}` : "never"}.
          </p>
          {s.last_push_error && !s.needs_reconnect && <p className="text-sm text-[#8B1A1A]">Last push: {s.last_push_error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} onClick={() => push.mutate()} disabled={push.isPending || s.needs_reconnect}>
              {push.isPending ? "Pushing…" : "Push now"}
            </button>
            <button
              type="button"
              className={secondary}
              onClick={() => (confirm ? disconnect.mutate() : setConfirm(true))}
              onBlur={() => setConfirm(false)}
            >
              {confirm ? "Click again to disconnect" : "Disconnect"}
            </button>
          </div>
          {progress && <p className="text-sm text-[#3A3F4B]">{progress}</p>}
        </>
      )}
      {notice && <p className="text-sm text-[#3A3F4B]">{notice}</p>}
      {error && <p className="text-sm text-[#8B1A1A]">{error.message}</p>}
    </section>
  );
}
