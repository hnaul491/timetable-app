import type { Locale } from "../i18n/locale";

export const LANGUAGE_KEY = "timetable:language";

export function browserLanguage(lang: string | undefined = typeof navigator === "undefined" ? undefined : navigator.language): Locale {
  return lang?.toLowerCase().startsWith("vi") ? "vi" : "en";
}

export function readStoredLanguage(): Locale | null {
  try {
    const value = localStorage.getItem(LANGUAGE_KEY);
    return value === "en" || value === "vi" ? value : null;
  } catch {
    return null;
  }
}

export function storeLanguage(locale: Locale): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, locale);
  } catch {
    // storage blocked: the server copy still applies after sign-in
  }
}

export function initialLanguage(): Locale {
  return readStoredLanguage() ?? browserLanguage();
}
