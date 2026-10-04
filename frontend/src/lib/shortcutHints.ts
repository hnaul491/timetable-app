import { useCallback } from "react";
import { SHORTCUT_CATALOG } from "./shortcutCatalog";
import { ariaKeyShortcuts, isMac, parseKeys } from "./shortcutKeys";
import { useShortcutSettings } from "./shortcutPrefs";
import { effectiveKeys, isBlocked, useShortcutList } from "./shortcuts";
import { useMediaQuery } from "./useMediaQuery";

const KEY_NAMES: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", Delete: "Del", Backspace: "⌫" };

/** One chip per step: "Mod+k" -> ["Ctrl K"] (["⌘K"] on Mac), "g c" -> ["G", "C"], "Shift+w" -> ["⇧W"], "ArrowLeft" -> ["←"]. */
export function hintChips(keys: string, mac: boolean = isMac()): string[] {
  const parsed = parseKeys(keys);
  const bare = keys.replace(/^(Mod\+)?(Alt\+)?(Shift\+)?/, "");
  const name = (k: string) => KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k);
  if (parsed.steps.length === 2) return bare.split(" ").map(name);
  const tokens = [parsed.mod ? (mac ? "⌘" : "Ctrl") : null, parsed.alt ? (mac ? "⌥" : "Alt") : null, parsed.shift ? "⇧" : null, name(bare)].filter((x): x is string => x !== null);
  return [tokens.join(tokens.every((tok) => tok.length === 1) ? "" : " ")];
}

/** Plain-text form for a title tooltip: "Ctrl K", "G then C" (the word is passed in, so it can be translated). */
export function hintText(keys: string, then: string, mac: boolean = isMac()): string {
  return hintChips(keys, mac).join(` ${then} `);
}

/** Effective keys of a shortcut right now (live registration, else catalogue default plus the user's overrides); null when off or blocked. */
export function useShortcutKeys(): (id: string) => string | null {
  const live = useShortcutList();
  const { overrides, singleKey } = useShortcutSettings();
  return useCallback(
    (id: string) => {
      const info = live.find((s) => s.id === id);
      if (info) return info.disabled || info.blocked ? null : info.keys;
      const entry = SHORTCUT_CATALOG.find((c) => c.id === id);
      if (!entry) return null;
      const keys = effectiveKeys(id, entry.keys, overrides);
      return keys === null || isBlocked(keys, singleKey) ? null : keys;
    },
    [live, overrides, singleKey],
  );
}

/** Whether visible hints are wanted: the setting is on and the device has a keyboard-like pointer. */
export function useHintsVisible(): boolean {
  const { hints } = useShortcutSettings();
  const touchOnly = useMediaQuery("(hover: none) and (pointer: coarse)", false);
  return hints && !touchOnly;
}

/** Keys to show for an id, or null when hints are off, the device is touch-only, or the shortcut is off. */
export function useHintKeys(): (id: string) => string | null {
  const keysFor = useShortcutKeys();
  const visible = useHintsVisible();
  return useCallback((id: string) => (visible ? keysFor(id) : null), [keysFor, visible]);
}

/** Native tooltip text with the keys appended: "Today (T)". Returns the label alone when no hint applies. */
export function useHintTitle(): (label: string, id: string, then?: string) => string {
  const hintKeys = useHintKeys();
  return useCallback(
    (label: string, id: string, then = "then") => {
      const keys = hintKeys(id);
      return keys ? `${label} (${hintText(keys, then)})` : label;
    },
    [hintKeys],
  );
}

/** aria-keyshortcuts values (kept even when visible hints are off); undefined for sequences or a shortcut that is off. For lists, where one hook call serves many ids. */
export function useAriaKeyshortcutsFor(): (id: string) => string | undefined {
  const keysFor = useShortcutKeys();
  return useCallback(
    (id: string) => {
      const keys = keysFor(id);
      return keys ? ariaKeyShortcuts(keys) : undefined;
    },
    [keysFor],
  );
}

export function useAriaKeyshortcuts(id: string): string | undefined {
  return useAriaKeyshortcutsFor()(id);
}
