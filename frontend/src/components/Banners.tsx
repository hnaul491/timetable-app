import type { ReactNode } from "react";
import { Link } from "react-router";
import { useLocale, useT } from "../i18n";
import { translateServerMessage } from "../i18n/serverMessages";
import { ApiError } from "../lib/api";
import { supabase } from "../lib/supabase";
import { formatTime, parisParts } from "../lib/time";
import type { GoogleStatus, SyncStatus } from "../types";

function Banner({ tone, children }: { tone: "warn" | "error"; children: ReactNode }) {
  const styles = tone === "warn" ? "border-warn-line bg-warn-soft text-warn" : "border-danger-line bg-danger-soft text-danger";
  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

function since(iso: string | null, never: string): string {
  if (!iso) return never;
  const { date } = parisParts(iso);
  return `${date} ${formatTime(iso)}`;
}

export const STALE_AFTER_MS = 36 * 3600 * 1000;

export function SyncBanner({ status, now = new Date() }: { status: SyncStatus | undefined; now?: Date }) {
  const t = useT();
  const locale = useLocale();
  if (!status) return null;
  const sinceText = since(status.last_success_at, t("common.never"));
  const run = status.last_run;
  if (run === null) {
    return (
      <Banner tone="warn">
        {t("calendar.banner.noDataBefore")}{" "}
        <Link to="/settings/school" className="font-semibold underline">{t("calendar.banner.noDataLink")}</Link>
        {t("calendar.banner.noDataAfter")}
      </Banner>
    );
  }
  if (run.status === "auth_failed") {
    return (
      <Banner tone="error">
        {t("calendar.banner.authFailedBefore")}{" "}
        <Link to="/settings/school" className="font-semibold underline">{t("calendar.banner.authFailedLink")}</Link>
        {t("calendar.banner.authFailedAfter", { since: sinceText })}
      </Banner>
    );
  }
  if (run.status === "failed") {
    return <Banner tone="warn">{t("calendar.banner.failed", { since: sinceText })}</Banner>;
  }
  if (run.status === "partial") {
    return (
      <Banner tone="warn">
        {t("calendar.banner.partial", { error: translateServerMessage(run.error ?? "", locale) })}
      </Banner>
    );
  }
  if (status.last_success_at && now.getTime() - new Date(status.last_success_at).getTime() > STALE_AFTER_MS) {
    return (
      <Banner tone="warn">
        {t("calendar.banner.staleBefore", { since: sinceText })}{" "}
        <Link to="/settings/school" className="font-semibold underline">{t("calendar.banner.staleLink")}</Link>{" "}
        {t("calendar.banner.staleAfter")}
      </Banner>
    );
  }
  return null;
}

export function MissingSectionsBanner({ names }: { names: string[] }) {
  const t = useT();
  if (names.length === 0) return null;
  return (
    <Banner tone="warn">
      {t("calendar.banner.missingBefore", { names: names.join(", ") })}{" "}
      <Link to="/settings/school" className="font-semibold underline">{t("calendar.banner.missingLink")}</Link>
    </Banner>
  );
}

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  if (error instanceof ApiError && error.status === 403) {
    return (
      <Banner tone="error">
        {t("calendar.banner.notAllowed")}{" "}
        <button type="button" className="font-semibold underline" onClick={() => supabase.auth.signOut()}>
          {t("calendar.banner.signOut")}
        </button>
      </Banner>
    );
  }
  const message = error instanceof Error ? error.message : t("calendar.banner.unknownError");
  return (
    <Banner tone="error">
      {t("calendar.banner.loadFailed", { message })}{" "}
      {onRetry && (
        <button type="button" className="font-semibold underline" onClick={onRetry}>
          {t("common.retry")}
        </button>
      )}
    </Banner>
  );
}

export function GoogleBanner({ status }: { status: GoogleStatus | undefined }) {
  const t = useT();
  const locale = useLocale();
  if (!status?.connected || !status.needs_reconnect) return null;
  return (
    <Banner tone="error">
      {t("calendar.banner.googleStopped", { reason: status.last_push_error ? translateServerMessage(status.last_push_error, locale) : t("calendar.banner.accessRevoked") })}{" "}
      <Link to="/settings/google" className="font-semibold underline">
        {t("calendar.banner.reconnectGoogle")}
      </Link>
    </Banner>
  );
}
