import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { initialLanguage, storeLanguage } from "../lib/language";
import { I18nProvider } from "./index";
import type { Locale } from "./locale";

export interface Preferences {
  language: Locale | null;
}

export function usePreferences() {
  return useQuery({ queryKey: ["preferences"], queryFn: () => apiFetch<Preferences>("/api/preferences"), staleTime: Infinity });
}

export function useSetLanguage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (language: Locale) => apiFetch<Preferences>("/api/preferences", { method: "PUT", body: JSON.stringify({ language }) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["preferences"], data);
      if (data.language) storeLanguage(data.language);
    },
  });
}

/** Language from the account (server); until it answers, the cached or browser language. */
export function LanguageRoot({ children }: { children: ReactNode }) {
  const preferences = usePreferences();
  const server = preferences.data?.language ?? null;
  const locale = server ?? initialLanguage();
  useEffect(() => {
    document.documentElement.lang = locale;
    if (server) storeLanguage(server);
  }, [locale, server]);
  return <I18nProvider locale={locale}>{children}</I18nProvider>;
}
