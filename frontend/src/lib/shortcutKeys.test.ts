import { describe, expect, it } from "vitest";
import { comboFromEvent, formatKeys, isReserved, isSequence, isSingleKey, parseKeys } from "./shortcutKeys";

const press = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("shortcut key strings", () => {
  it("parses prefixes and sequences", () => {
    expect(parseKeys("Mod+k")).toEqual({ mod: true, alt: false, shift: false, steps: ["k"] });
    expect(parseKeys("Mod+Alt+Shift+K")).toEqual({ mod: true, alt: true, shift: true, steps: ["k"] });
    expect(parseKeys("g x").steps).toEqual(["g", "x"]);
    expect(parseKeys("Shift+ArrowLeft")).toMatchObject({ shift: true, steps: ["ArrowLeft"] });
    expect(parseKeys("+").steps).toEqual(["+"]);
    expect(isSequence("g x")).toBe(true);
    expect(isSequence("Mod+g")).toBe(false);
  });

  it("calls plain, Shift and sequence keys single-key", () => {
    expect(isSingleKey("n")).toBe(true);
    expect(isSingleKey("g x")).toBe(true);
    expect(isSingleKey("Shift+n")).toBe(true);
    expect(isSingleKey("Mod+n")).toBe(false);
    expect(isSingleKey("Alt+n")).toBe(false);
  });

  it("formats for each platform", () => {
    expect(formatKeys("Mod+Shift+k", false)).toEqual(["Ctrl", "Shift", "K"]);
    expect(formatKeys("Mod+Alt+k", true)).toEqual(["⌘", "⌥", "K"]);
    expect(formatKeys("g c", false)).toEqual(["G", "C"]);
    expect(formatKeys("ArrowLeft", false)).toEqual(["ArrowLeft"]);
  });

  it("flags the browser's own combos", () => {
    for (const keys of ["Mod+w", "Mod+t", "Mod+n", "Mod+l", "Mod+r", "Mod+q", "Mod+f", "Mod+p", "Mod+Tab", "Mod+Shift+t", "F5", "F11", "Alt+ArrowLeft", "Alt+ArrowRight"]) {
      expect(isReserved(keys), keys).toBe(true);
    }
    for (const keys of ["Mod+k", "Mod+s", "Alt+t", "n", "t", "ArrowLeft", "F1", "g t", "Shift+ArrowLeft"]) {
      expect(isReserved(keys), keys).toBe(false);
    }
  });

  it("turns key events into key strings", () => {
    expect(comboFromEvent(press({ key: "k", ctrlKey: true }))).toBe("Mod+k");
    expect(comboFromEvent(press({ key: "K", metaKey: true, shiftKey: true }))).toBe("Mod+Shift+k");
    expect(comboFromEvent(press({ key: "G", shiftKey: true }))).toBe("Shift+g");
    expect(comboFromEvent(press({ key: "?", shiftKey: true }))).toBe("?");
    expect(comboFromEvent(press({ key: "å", altKey: true, code: "KeyA" }))).toBe("Alt+a");
    expect(comboFromEvent(press({ key: " " }))).toBe("Space");
    expect(comboFromEvent(press({ key: "ArrowLeft", shiftKey: true }))).toBe("Shift+ArrowLeft");
    expect(comboFromEvent(press({ key: "Shift", shiftKey: true }))).toBeNull();
  });
});
