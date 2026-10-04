import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { setMessageLocale } from "./current";
import { en } from "./en";
import type { Locale } from "./locale";
import type { Messages, Plural } from "./types";
import { vi } from "./vi";

export type { Locale } from "./locale";
export type Vars = Record<string, string | number>;

type Leaf = string | Plural;
type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];
/** Dotted keys of the English messages, e.g. "common.save". */
export type MessageKey = Paths<Messages>;

const DICTS: Record<Locale, Messages> = { en, vi };

function lookup(dict: Messages, key: string): Leaf | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && "other" in node) return node as Plural;
  return undefined;
}

export function translate(locale: Locale, key: MessageKey, vars: Vars = {}): string {
  const leaf = lookup(DICTS[locale], key) ?? lookup(en, key) ?? key;
  const text = typeof leaf === "string" ? leaf : Number(vars.count) === 1 ? leaf.one : leaf.other;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

const LocaleContext = createContext<Locale>("en");

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  useEffect(() => setMessageLocale(locale), [locale]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): (key: MessageKey, vars?: Vars) => string {
  const locale = useLocale();
  return useMemo(() => (key: MessageKey, vars?: Vars) => translate(locale, key, vars), [locale]);
}
