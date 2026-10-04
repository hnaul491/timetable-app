import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MessageKey } from "../i18n";

export type ShortcutOptions = { label?: MessageKey; inDialog?: boolean; enabled?: boolean };
type Handler = (e: KeyboardEvent) => void;
type Entry = { id: string; keys: string; label?: MessageKey; inDialog: boolean; handlerRef: { current: Handler } };
type Registry = {
  register: (entry: Entry) => () => void;
  list: { id: string; keys: string; label: MessageKey }[];
};

const SEQUENCE_MS = 1000;
const Ctx = createContext<Registry | null>(null);

const normalise = (key: string) => (key.length === 1 ? key.toLowerCase() : key);

function parse(keys: string): { mod: boolean; steps: string[] } {
  if (keys.startsWith("Mod+")) return { mod: true, steps: [normalise(keys.slice(4))] };
  return { mod: false, steps: keys.split(" ").map(normalise) };
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, Entry>());
  const [version, setVersion] = useState(0);
  const pending = useRef<{ prefix: string; at: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.defaultPrevented || ["Control", "Meta", "Shift", "Alt"].includes(e.key)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = normalise(e.key);
      const typing = isTyping(e.target);
      const inDialog = document.querySelector('[aria-modal="true"]') !== null;
      const eligible = [...entries.current.values()].filter((en) => {
        const parsed = parse(en.keys);
        if (parsed.mod !== mod) return false;
        if (typing && !parsed.mod) return false;
        if (inDialog && !en.inDialog) return false;
        return true;
      });
      const fire = (en: Entry) => {
        e.preventDefault();
        pending.current = null;
        en.handlerRef.current(e);
      };
      if (mod) {
        pending.current = null;
        const hit = eligible.find((en) => parse(en.keys).steps[0] === key);
        if (hit) fire(hit);
        return;
      }
      const prior = pending.current;
      pending.current = null;
      if (prior && Date.now() - prior.at <= SEQUENCE_MS) {
        const hit = eligible.find((en) => {
          const steps = parse(en.keys).steps;
          return steps.length === 2 && steps[0] === prior.prefix && steps[1] === key;
        });
        if (hit) return fire(hit);
      }
      const single = eligible.find((en) => {
        const steps = parse(en.keys).steps;
        return steps.length === 1 && steps[0] === key;
      });
      if (single) return fire(single);
      const startsSequence = eligible.some((en) => {
        const steps = parse(en.keys).steps;
        return steps.length === 2 && steps[0] === key;
      });
      if (startsSequence) pending.current = { prefix: key, at: Date.now() };
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
      .map(({ id, keys, label }) => ({ id, keys, label }));
    return { list, register };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, register]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

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

export function useShortcutList(): { id: string; keys: string; label: MessageKey }[] {
  return useContext(Ctx)?.list ?? [];
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function formatKeys(keys: string, mac: boolean = isMac()): string[] {
  if (keys.startsWith("Mod+")) return [mac ? "⌘" : "Ctrl", ...formatKeys(keys.slice(4), mac)];
  return keys.split(" ").map((k) => (k.length === 1 ? k.toUpperCase() : k));
}
