import type { Session } from "@supabase/supabase-js";
import { useEffect, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { supabase } from "../lib/supabase";
import { LoginPage } from "./LoginPage";

export function AuthGate({ children }: { children: ReactNode }) {
  const t = useT();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <p className="p-8 text-muted">{t("common.loading")}</p>;
  if (session === null) return <LoginPage />;
  return <>{children}</>;
}
