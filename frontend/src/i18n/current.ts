import type { Locale } from "./locale";

let current: Locale = "en";

/** The language used for texts produced outside React (apiFetch error messages). */
export function getMessageLocale(): Locale {
  return current;
}

export function setMessageLocale(locale: Locale): void {
  current = locale;
}
