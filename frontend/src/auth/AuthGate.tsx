import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { supabase } from "../lib/supabase";
import { LoginPage } from "./LoginPage";

export function AuthGate({ children }: { children: ReactNode }) {
  const t = useT();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const readSession = useCallback(() => {
    setFailed(false);
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        // keep a session an auth event already delivered
        setSession((cur) => cur ?? data.session);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    // subscribe first, so a change between subscribing and reading the session is not lost
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setFailed(false);
      setSession(next);
    });
    readSession();
    return () => data.subscription.unsubscribe();
  }, [readSession]);

  if (session === undefined && failed) {
    return (
      <div role="alert" className="m-8 flex max-w-md flex-col gap-3 rounded-xl border border-danger-line bg-danger-soft p-4 text-sm text-danger">
        <p className="font-semibold">{t("common.authErrorTitle")}</p>
        <p>{t("common.authErrorBody")}</p>
        <button type="button" onClick={readSession} className="h-10 self-start rounded-xl border border-danger-line bg-surface px-4 font-semibold text-danger">
          {t("common.retry")}
        </button>
      </div>
    );
  }
  if (session === undefined) return <p className="p-8 text-muted">{t("common.loading")}</p>;
  if (session === null) return <LoginPage />;
  return <>{children}</>;
}
