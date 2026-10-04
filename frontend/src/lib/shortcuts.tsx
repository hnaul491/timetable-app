import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MessageKey } from "../i18n";
import { eventKey, isAltGr, isModifierKey, isReserved, isSingleKey, parseKeys, shiftMatches } from "./shortcutKeys";

export { formatKeys, isSequence } from "./shortcutKeys";

export type ShortcutOptions = { label?: MessageKey; inDialog?: boolean; enabled?: boolean };
type Handler = (e: KeyboardEvent) => void;
type Entry = { id: string; keys: string; label?: MessageKey; inDialog: boolean; handlerRef: { current: Handler } };
/** id -> replacement keys; null turns the shortcut off. */
export type ShortcutOverrides = Record<string, string | null>;
export type ShortcutInfo = {
  id: string;
  /** Effective keys (override or default); empty when turned off. */
  keys: string;
  defaultKeys: string;
  label: MessageKey;
  disabled: boolean;
  /** Switched off by the single-key toggle (not by the user turning it off). */
  blocked: boolean;
};
type Registry = {
  register: (entry: Entry) => () => void;
  list: ShortcutInfo[];
};

const SEQUENCE_MS = 1000;
const Ctx = createContext<Registry | null>(null);

const NON_TEXT_INPUTS = ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.includes(target.type);
  return target.isContentEditable || target.closest('[contenteditable=""], [contenteditable="true"]') !== null || ["TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Override ?? default; null (off) gives null. An override that takes Tab, Enter or Space (old data) is ignored. */
export function effectiveKeys(id: string, defaultKeys: string, overrides: ShortcutOverrides): string | null {
  if (!Object.prototype.hasOwnProperty.call(overrides, id)) return defaultKeys;
  const own = overrides[id];
  return own !== null && isReserved(own) && !isReserved(defaultKeys) ? defaultKeys : own;
}

export const isBlocked = (keys: string, singleKey: boolean) => !singleKey && isSingleKey(keys) && keys !== "Escape";

export function ShortcutProvider({
  children,
  overrides,
  singleKey = true,
}: {
  children: ReactNode;
  overrides?: ShortcutOverrides;
  /** false: shortcuts without Mod or Alt are ignored, except Escape (WCAG 2.1.4). */
  singleKey?: boolean;
}) {
  const entries = useRef(new Map<string, Entry>());
  const [version, setVersion] = useState(0);
  const pending = useRef<{ prefix: string; at: number } | null>(null);
  const effective = overrides ?? NO_OVERRIDES;
  const live = useRef({ overrides: effective, singleKey });
  live.current = { overrides: effective, singleKey };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isModifierKey(e.key) || isAltGr(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      const alt = e.altKey;
      const key = eventKey(e);
      const arrow = key.startsWith("Arrow");
      // Held letter keys must not retrigger actions.
      if (e.repeat && !arrow) return;
      const typing = isTyping(e.target);
      const inDialog = document.querySelector('[aria-modal="true"]') !== null;
      const { overrides: current, singleKey: allowSingle } = live.current;
      const eligible = [...entries.current.values()].flatMap((en) => {
        const keys = effectiveKeys(en.id, en.keys, current);
        if (keys === null) return [];
        const parsed = parseKeys(keys);
        if (parsed.mod !== mod || parsed.alt !== alt) return [];
        // Shift+letter/arrow belongs to text selection unless the shortcut asks for Shift.
        if (!shiftMatches(parsed.shift, e.shiftKey, key)) return [];
        if (isBlocked(keys, allowSingle)) return [];
        if (typing && !parsed.mod) return [];
        if (inDialog && !en.inDialog) return [];
        return [{ en, steps: parsed.steps }];
      });
      const fire = (en: Entry) => {
        e.preventDefault();
        pending.current = null;
        en.handlerRef.current(e);
      };
      if (mod || alt) {
        pending.current = null;
        const hit = eligible.find((c) => c.steps[0] === key);
        if (hit) fire(hit.en);
        return;
      }
      const prior = pending.current;
      pending.current = null;
      if (prior && Date.now() - prior.at <= SEQUENCE_MS) {
        const hit = eligible.find((c) => c.steps.length === 2 && c.steps[0] === prior.prefix && c.steps[1] === key);
        if (hit) return fire(hit.en);
      }
      const single = eligible.find((c) => c.steps.length === 1 && c.steps[0] === key);
      if (single) return fire(single.en);
      if (eligible.some((c) => c.steps.length === 2 && c.steps[0] === key)) pending.current = { prefix: key, at: Date.now() };
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const register = useCallback((entry: Entry) => {
    entries.current.set(entry.id, entry);
    setVersion((v) => v + 1);
    return () => {
      if (entries.current.get(entry.id) === entry) {
        entries.current.delete(entry.id);
        setVersion((v) => v + 1);
      }
    };
  }, []);

  const value = useMemo<Registry>(() => {
    const list = [...entries.current.values()]
      .filter((en): en is Entry & { label: MessageKey } => en.label !== undefined)
      .map(({ id, keys, label }) => {
        const keysNow = effectiveKeys(id, keys, effective);
        return { id, keys: keysNow ?? "", defaultKeys: keys, label, disabled: keysNow === null, blocked: keysNow !== null && isBlocked(keysNow, singleKey) };
      });
    return { list, register };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, register, effective, singleKey]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const NO_OVERRIDES: ShortcutOverrides = {};

export function useShortcut(id: string, keys: string, handler: Handler, options: ShortcutOptions = {}) {
  const registry = useContext(Ctx);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const register = registry?.register;
  const { label, inDialog = false, enabled = true } = options;
  useEffect(() => {
    if (!register || !enabled) return;
    return register({ id, keys, label, inDialog, handlerRef });
  }, [register, id, keys, label, inDialog, enabled]);
}

export function useShortcutList(): ShortcutInfo[] {
  return useContext(Ctx)?.list ?? [];
}
