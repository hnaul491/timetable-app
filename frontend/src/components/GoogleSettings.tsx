import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocale, useT, type Locale, type Vars, type MessageKey } from "../i18n";
import { translateServerMessage } from "../i18n/serverMessages";
import { apiFetch } from "../lib/api";
import { forgetProviderToken, startGoogleConnect, takeConnectFlag, takeProviderRefreshToken } from "../lib/google";
import { formatTime, parisParts } from "../lib/time";
import type { GoogleKind, GoogleStatus, PushResult } from "../types";
import { useConfirm } from "./ui/Confirm";
import { Skeleton } from "./ui/Skeleton";
import { useToast } from "./ui/Toast";

const KINDS: GoogleKind[] = ["class", "exam", "holiday", "work", "french_ext", "other"];
const MAX_ROUNDS = 15;
const card = "flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5";
const primary = "h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-60";
const secondary = "h-10 rounded-xl border border-line bg-surface px-4 text-sm font-semibold disabled:opacity-60";

type T = (key: MessageKey, vars?: Vars) => string;

function summary(t: T, locale: Locale, sent: number, r: PushResult): string {
  const error = r.error ? translateServerMessage(r.error, locale) : null;
  if (r.status === "failed") return t("google.pushFailed", { error: error ?? t("google.unknownError") });
  if (r.status === "skipped") return t("google.skipped");
  if (error) return t("google.sentWithError", { sent, error });
  return r.remaining > 0 ? t("google.sentLeft", { sent, remaining: r.remaining }) : t("google.sent", { sent });
}

export function GoogleSettings() {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const handled = useRef(false);
  const status = useQuery({ queryKey: ["google"], queryFn: () => apiFetch<GoogleStatus>("/api/google") });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["google"] });

  const connect = useMutation({
    mutationFn: (refresh_token: string) =>
      apiFetch<GoogleStatus>("/api/google/connect", { method: "POST", body: JSON.stringify({ refresh_token }) }),
    onSuccess: () => {
      void forgetProviderToken();
      setNotice(t("google.connected"));
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
      setProgress(null);
      refresh();
      toast.success(t("google.disconnected"));
    },
  });
  const askDisconnect = async () => {
    const ok = await confirm({
      title: t("google.disconnectTitle"),
      body: t("google.disconnectHelp"),
      confirmLabel: t("google.disconnect"),
      tone: "danger",
    });
    if (ok) disconnect.mutate();
  };
  const push = useMutation({
    mutationFn: async () => {
      let sent = 0;
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const result = await apiFetch<PushResult>("/api/google/push", { method: "POST" });
        sent += result.done;
        setProgress(summary(t, locale, sent, result));
        if (result.status !== "partial" || result.remaining === 0 || result.done === 0) return { result, sent };
      }
      return null;
    },
    onSuccess: (outcome) => {
      setProgress(null);
      if (outcome?.result.status === "failed") toast.error(summary(t, locale, 0, outcome.result), { retry: () => push.mutate() });
      else if (outcome) toast.success(summary(t, locale, outcome.sent, outcome.result));
    },
    onError: (error) => {
      setProgress(null);
      toast.error(error.message, { retry: () => push.mutate() });
    },
    onSettled: refresh,
  });

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    if (!takeConnectFlag()) return;
    takeProviderRefreshToken().then((token) => {
      if (token) connect.mutate(token);
      else setNotice(t("google.noOffline"));
    });
  }, [connect, t]);

  const startConnect = async () => {
    const res = await startGoogleConnect();
    if (res?.error) setNotice(res.error.message);
  };

  const s = status.data;
  const error = (connect.error ?? kinds.error ?? disconnect.error) as Error | null;
  return (
    <section className={card} aria-labelledby="google-heading">
      <h2 id="google-heading" className="text-base font-bold">
        {t("google.title")}
      </h2>
      {!s ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : !s.configured ? (
        <p className="text-sm text-muted">{t("google.notConfigured")}</p>
      ) : !s.connected ? (
        <>
          <p className="text-sm text-ink-2">{t("google.intro")}</p>
          <button type="button" className={primary} onClick={startConnect} disabled={connect.isPending}>
            {t("google.connect")}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm">
            {t("google.connectedAs")} <span className="font-semibold">{s.email}</span>
          </p>
          {s.needs_reconnect && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger">
              <span>{s.last_push_error ? translateServerMessage(s.last_push_error, locale) : t("google.accessStopped")}</span>
              <button type="button" className={primary} onClick={startConnect}>
                {t("google.reconnect")}
              </button>
            </div>
          )}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-semibold text-ink-2">{t("google.sendToGoogle")}</legend>
            {KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.kinds.includes(kind)}
                  disabled={kinds.isPending}
                  onChange={(e) => kinds.mutate(e.target.checked ? [...s.kinds, kind] : s.kinds.filter((k) => k !== kind))}
                />
                {t(`google.kinds.${kind}`)}
              </label>
            ))}
          </fieldset>
          <p className="text-sm text-muted">
            {s.pending === 0 ? t("google.upToDate") : t("google.waiting", { count: s.pending })}{" "}
            {t("google.lastPush", {
              value: s.last_push_at ? `${parisParts(s.last_push_at).date} ${formatTime(s.last_push_at)}` : t("common.never"),
            })}
          </p>
          {s.last_push_error && !s.needs_reconnect && (
            <p className="text-sm text-danger">{t("google.lastPushError", { error: translateServerMessage(s.last_push_error, locale) })}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} onClick={() => push.mutate()} disabled={push.isPending || s.needs_reconnect}>
              {push.isPending ? t("google.pushing") : t("google.pushNow")}
            </button>
            <button
              type="button"
              className={secondary}
              onClick={() => void askDisconnect()}
              disabled={disconnect.isPending}
            >
              {t("google.disconnect")}
            </button>
          </div>
          <p className="text-xs text-muted">{t("google.disconnectHelp")}</p>
          {progress && <p className="text-sm text-ink-2">{progress}</p>}
        </>
      )}
      {notice && <p className="text-sm text-ink-2">{notice}</p>}
      {error && <p className="text-sm text-danger">{error.message}</p>}
    </section>
  );
}
