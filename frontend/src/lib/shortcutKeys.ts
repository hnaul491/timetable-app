/** Key strings: an optional Mod+/Alt+/Shift+ prefix (in that order) plus one key, or a two-step sequence like "g x". */
export interface ParsedKeys {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  steps: string[];
}

export const normaliseKey = (key: string) => (key.length === 1 ? key.toLowerCase() : key);

export function parseKeys(keys: string): ParsedKeys {
  let rest = keys;
  const out: ParsedKeys = { mod: false, alt: false, shift: false, steps: [] };
  for (const [prefix, field] of [["Mod+", "mod"], ["Alt+", "alt"], ["Shift+", "shift"]] as const) {
    if (rest.startsWith(prefix) && rest.length > prefix.length) {
      out[field] = true;
      rest = rest.slice(prefix.length);
    }
  }
  const modified = out.mod || out.alt || out.shift;
  out.steps = (modified ? [rest] : rest.split(" ")).map(normaliseKey);
  return out;
}

export const isSequence = (keys: string) => parseKeys(keys).steps.length === 2;

/** True when a shortcut needs no Mod or Alt, i.e. a plain key, Shift+key or sequence (WCAG 2.1.4 single-key shortcuts). */
export function isSingleKey(keys: string): boolean {
  const parsed = parseKeys(keys);
  return !parsed.mod && !parsed.alt;
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function formatKeys(keys: string, mac: boolean = isMac()): string[] {
  const parsed = parseKeys(keys);
  const named = (k: string) => (k.length === 1 ? k.toUpperCase() : k);
  const out: string[] = [];
  if (parsed.mod) out.push(mac ? "⌘" : "Ctrl");
  if (parsed.alt) out.push(mac ? "⌥" : "Alt");
  if (parsed.shift) out.push(mac ? "⇧" : "Shift");
  // Display keeps the original case of the key part; steps are lower-cased for matching.
  const bare = keys.replace(/^(Mod\+)?(Alt\+)?(Shift\+)?/, "");
  const modified = parsed.mod || parsed.alt || parsed.shift;
  return [...out, ...(modified ? [named(bare)] : bare.split(" ").map(named))];
}

const RESERVED_WITH_MOD = new Set(["w", "t", "n", "l", "r", "q", "f", "p", "h", "m", "=", "-", "Tab", ..."0123456789"]);
const RESERVED_MOD_SHIFT = new Set(["i", "j", "c"]);
const FOCUS_KEYS = new Set(["Tab", "Enter", "Space"]);

/** Combos the browser or OS owns, plus plain Tab/Enter/Space (focus and activation must keep working), in any step. */
export function isReserved(keys: string): boolean {
  const parsed = parseKeys(keys);
  const plain = !parsed.mod && !parsed.alt;
  if (plain && parsed.steps.some((k) => FOCUS_KEYS.has(k))) return true;
  if (parsed.steps.length !== 1) return false;
  const key = parsed.steps[0];
  if (parsed.mod && (RESERVED_WITH_MOD.has(key) || (parsed.shift && RESERVED_MOD_SHIFT.has(key)))) return true;
  if (key === "F5" || key === "F11" || key === "F12") return true;
  if (parsed.alt && (key === "ArrowLeft" || key === "ArrowRight")) return true;
  return false;
}

/** Letters and named keys must match Shift exactly; digits and symbols vary with the keyboard layout (AZERTY digits need Shift). */
export const shiftMatters = (key: string) => key.length > 1 || /^\p{L}$/u.test(key);

export function shiftMatches(wantsShift: boolean, shiftDown: boolean, key: string): boolean {
  if (shiftMatters(key)) return wantsShift === shiftDown;
  return wantsShift ? shiftDown : true;
}

/** AltGr on Windows reports Ctrl+Alt with a printable key; it types a character and is no shortcut. */
export function isAltGr(e: KeyboardEvent): boolean {
  return (e.ctrlKey && e.altKey && e.key.length === 1) || e.getModifierState?.("AltGraph") === true;
}

/** Two key strings clash when one would fire on the keys the other uses, including a plain key that starts a sequence. */
export function keysConflict(a: string, b: string): boolean {
  const pa = parseKeys(a);
  const pb = parseKeys(b);
  const plainSingle = (p: ParsedKeys) => p.steps.length === 1 && !p.mod && !p.alt && !p.shift;
  if (pa.steps.length === 2 && plainSingle(pb)) return pa.steps[0] === pb.steps[0];
  if (pb.steps.length === 2 && plainSingle(pa)) return pb.steps[0] === pa.steps[0];
  if (pa.mod !== pb.mod || pa.alt !== pb.alt || pa.steps.length !== pb.steps.length) return false;
  if (!pa.steps.every((s, i) => s === pb.steps[i])) return false;
  return pa.steps.length === 2 || !shiftMatters(pa.steps[0]) || pa.shift === pb.shift;
}

/** WAI-ARIA aria-keyshortcuts value ("Control+K", "Meta+K", "Shift+W"); sequences have no equivalent. */
export function ariaKeyShortcuts(keys: string, mac: boolean = isMac()): string | undefined {
  const parsed = parseKeys(keys);
  if (parsed.steps.length !== 1) return undefined;
  const bare = keys.replace(/^(Mod\+)?(Alt\+)?(Shift\+)?/, "");
  const key = bare.length === 1 ? bare.toUpperCase() : bare;
  return [parsed.mod ? (mac ? "Meta" : "Control") : null, parsed.alt ? "Alt" : null, parsed.shift ? "Shift" : null, key].filter(Boolean).join("+");
}

const MODIFIER_KEYS = ["Control", "Meta", "Shift", "Alt", "AltGraph", "OS", "CapsLock"];
export const isModifierKey = (key: string) => MODIFIER_KEYS.includes(key);

/** The key a keydown stands for; Alt+letter on macOS types symbols, so letters and digits come from the physical key. */
export function eventKey(e: KeyboardEvent): string {
  if (e.altKey) {
    const m = /^(?:Key([A-Z])|Digit(\d))$/.exec(e.code ?? "");
    if (m) return (m[1] ?? m[2]).toLowerCase();
  }
  return e.key === " " ? "Space" : normaliseKey(e.key);
}

/** Keys string for a single non-sequence keydown, or null for a modifier on its own. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (isModifierKey(e.key) || isAltGr(e)) return null;
  const key = eventKey(e);
  const mod = e.ctrlKey || e.metaKey;
  // A shifted symbol (e.g. "?") already says so in the key itself.
  const shift = e.shiftKey && (mod || e.altKey || key.length > 1 || /^[a-z0-9]$/.test(key));
  return `${mod ? "Mod+" : ""}${e.altKey ? "Alt+" : ""}${shift ? "Shift+" : ""}${key}`;
}
