import type { ReactNode } from "react";
import { Link } from "react-router";
import { ApiError } from "../lib/api";
import { supabase } from "../lib/supabase";
import { formatTime, parisParts } from "../lib/time";
import type { GoogleStatus, SyncStatus } from "../types";

function Banner({ tone, children }: { tone: "warn" | "error"; children: ReactNode }) {
  const styles = tone === "warn" ? "border-[#F5D9B8] bg-[#FFF7ED] text-[#7C2D12]" : "border-[#F3C4C4] bg-[#FDECEC] text-[#8B1A1A]";
  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

function since(iso: string | null): string {
  if (!iso) return "never";
  const { date } = parisParts(iso);
  return `${date} ${formatTime(iso)}`;
}

export const STALE_AFTER_MS = 36 * 3600 * 1000;

export function SyncBanner({ status, now = new Date() }: { status: SyncStatus | undefined; now?: Date }) {
  if (!status) return null;
  const run = status.last_run;
  if (run === null) {
    return (
      <Banner tone="warn">
        No school data yet. <Link to="/settings" className="font-semibold underline">Paste your Zeus link in Settings</Link>, then press Sync now.
      </Banner>
    );
  }
  if (run.status === "auth_failed") {
    return (
      <Banner tone="error">
        Zeus rejected the link. Generate a new link in Zeus and <Link to="/settings" className="font-semibold underline">paste it in Settings</Link>. Showing data from {since(status.last_success_at)}.
      </Banner>
    );
  }
  if (run.status === "failed") {
    return <Banner tone="warn">School sync failed. Showing data from {since(status.last_success_at)}.</Banner>;
  }
  if (run.status === "partial") {
    return (
      <Banner tone="warn">
        School sync: {run.error}. Check Zeus — if those classes were really removed, they will be cancelled once the feed is complete.
      </Banner>
    );
  }
  if (status.last_success_at && now.getTime() - new Date(status.last_success_at).getTime() > STALE_AFTER_MS) {
    return (
      <Banner tone="warn">
        School timetable last updated {since(status.last_success_at)}. The daily sync may have stopped — press{" "}
        <Link to="/settings" className="font-semibold underline">Sync now in Settings</Link> or check GitHub Actions.
      </Banner>
    );
  }
  return null;
}

export function MissingSectionsBanner({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <Banner tone="warn">
      Some classes are hidden until you pick your group: {names.join(", ")}.{" "}
      <Link to="/settings" className="font-semibold underline">Choose your groups</Link>
    </Banner>
  );
}

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.status === 403) {
    return (
      <Banner tone="error">
        This Google account is not allowed to use this app.{" "}
        <button type="button" className="font-semibold underline" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </Banner>
    );
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return (
    <Banner tone="error">
      Could not load data: {message}.{" "}
      {onRetry && (
        <button type="button" className="font-semibold underline" onClick={onRetry}>
          Try again
        </button>
      )}
    </Banner>
  );
}

export function GoogleBanner({ status }: { status: GoogleStatus | undefined }) {
  if (!status?.connected || !status.needs_reconnect) return null;
  return (
    <Banner tone="error">
      Google Calendar stopped updating: {status.last_push_error ?? "access was revoked"}.{" "}
      <Link to="/settings" className="font-semibold underline">
        Reconnect Google
      </Link>
    </Banner>
  );
}
