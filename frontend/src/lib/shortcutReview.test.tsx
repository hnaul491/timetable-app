import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ariaKeyShortcuts, comboFromEvent, isAltGr, isReserved, keysConflict } from "./shortcutKeys";
import { ShortcutProvider, useShortcut, useShortcutList, type ShortcutOverrides } from "./shortcuts";

describe("key strings", () => {
  it("reserves Tab, Enter and Space in any step, with or without Shift", () => {
    for (const keys of ["Tab", "Enter", "Space", "Shift+Tab", "Shift+Enter", "g Tab", "Space g", "g Enter"]) expect(isReserved(keys), keys).toBe(true);
    expect(isReserved("Mod+Enter")).toBe(false);
    expect(isReserved("Alt+Space")).toBe(false);
  });

  it("reserves the extra browser combos", () => {
    for (const keys of ["Mod+1", "Mod+9", "Mod+0", "Mod+=", "Mod+-", "Mod+h", "Mod+m", "F12", "Mod+Shift+i", "Mod+Shift+j", "Mod+Shift+c"]) {
      expect(isReserved(keys), keys).toBe(true);
    }
    expect(isReserved("Mod+i")).toBe(false);
  });

  it("flags exact and prefix conflicts", () => {
    expect(keysConflict("g", "g b")).toBe(true);
    expect(keysConflict("t b", "t")).toBe(true);
    expect(keysConflict("g b", "g c")).toBe(false);
    expect(keysConflict("g b", "g b")).toBe(true);
    expect(keysConflict("Mod+g", "g b")).toBe(false);
    expect(keysConflict("w", "Shift+w")).toBe(false);
    expect(keysConflict("1", "Shift+1")).toBe(true);
    expect(keysConflict("Mod+k", "Mod+k")).toBe(true);
    expect(keysConflict("Mod+k", "Alt+k")).toBe(false);
  });

  it("writes aria-keyshortcuts in spec format and omits sequences", () => {
    expect(ariaKeyShortcuts("Mod+k", false)).toBe("Control+K");
    expect(ariaKeyShortcuts("Mod+k", true)).toBe("Meta+K");
    expect(ariaKeyShortcuts("n", false)).toBe("N");
    expect(ariaKeyShortcuts("Shift+w", false)).toBe("Shift+W");
    expect(ariaKeyShortcuts("ArrowLeft", false)).toBe("ArrowLeft");
    expect(ariaKeyShortcuts("g c", false)).toBeUndefined();
  });

  it("recognises AltGr and does not turn it into a combo", () => {
    const e = new KeyboardEvent("keydown", { key: "@", ctrlKey: true, altKey: true });
    expect(isAltGr(e)).toBe(true);
    expect(comboFromEvent(e)).toBeNull();
    expect(isAltGr(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))).toBe(false);
  });
});

const NAMES = ["enter", "w", "sw", "esc", "help", "one", "alt", "mod"] as const;

function Bindings({ fns }: { fns: Record<string, () => void> }) {
  useShortcut("enter", "Enter", fns.enter);
  useShortcut("w", "w", fns.w);
  useShortcut("sw", "Shift+w", fns.sw);
  useShortcut("esc", "Escape", fns.esc);
  useShortcut("help", "?", fns.help);
  useShortcut("one", "1", fns.one);
  useShortcut("alt", "Alt+x", fns.alt);
  useShortcut("mod", "Mod+k", fns.mod);
  return <input aria-label="field" />;
}

function mount(overrides?: ShortcutOverrides, singleKey = true) {
  const fns = Object.fromEntries(NAMES.map((k) => [k, vi.fn()]));
  render(
    <ShortcutProvider overrides={overrides} singleKey={singleKey}>
      <Bindings fns={fns} />
    </ShortcutProvider>,
  );
  return fns;
}
const key = (init: KeyboardEventInit) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })));

describe("engine", () => {
  it("ignores a stored override on Tab, Enter or Space and keeps the default", () => {
    const fns = mount({ w: "Tab", esc: "Enter", one: "Space" });
    key({ key: "Tab" });
    key({ key: "Enter" });
    key({ key: " " });
    expect(fns.w).not.toHaveBeenCalled();
    expect(fns.esc).not.toHaveBeenCalled();
    expect(fns.one).not.toHaveBeenCalled();
    key({ key: "w" });
    key({ key: "Escape" });
    key({ key: "1" });
    expect(fns.w).toHaveBeenCalledTimes(1);
    expect(fns.esc).toHaveBeenCalledTimes(1);
    expect(fns.one).toHaveBeenCalledTimes(1);
  });

  it("matches Shift exactly for letters and named keys", () => {
    const fns = mount();
    key({ key: "w" });
    expect([fns.w.mock.calls.length, fns.sw.mock.calls.length]).toEqual([1, 0]);
    key({ key: "W", shiftKey: true });
    expect([fns.w.mock.calls.length, fns.sw.mock.calls.length]).toEqual([1, 1]);
    key({ key: "Escape", shiftKey: true });
    expect(fns.esc).not.toHaveBeenCalled();
    key({ key: "Escape" });
    expect(fns.esc).toHaveBeenCalledTimes(1);
  });

  it("keeps ? (Shift+/) and AZERTY digits (Shift+digit gives a digit) working", () => {
    const fns = mount();
    key({ key: "?", shiftKey: true });
    key({ key: "1", shiftKey: true });
    expect(fns.help).toHaveBeenCalledTimes(1);
    expect(fns.one).toHaveBeenCalledTimes(1);
  });

  it("only Mod shortcuts fire while typing, and AltGr never counts as Mod+Alt", () => {
    const fns = mount();
    const input = document.querySelector("input")!;
    input.focus();
    act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "x", altKey: true, bubbles: true })));
    expect(fns.alt).not.toHaveBeenCalled();
    act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })));
    expect(fns.mod).toHaveBeenCalledTimes(1);
    input.blur();
    key({ key: "x", altKey: true });
    expect(fns.alt).toHaveBeenCalledTimes(1);
    key({ key: "x", ctrlKey: true, altKey: true }); // AltGr+x types a character
    key({ key: "k", ctrlKey: true, altKey: true });
    expect(fns.alt).toHaveBeenCalledTimes(1);
    expect(fns.mod).toHaveBeenCalledTimes(1);
  });

  it("marks shortcuts blocked by the single-key toggle", () => {
    function Listed() {
      useShortcut("new", "n", () => {}, { label: "shortcuts.newEvent" });
      useShortcut("find", "Mod+k", () => {}, { label: "shortcuts.search" });
      useShortcut("esc", "Escape", () => {}, { label: "shortcuts.exitFullScreen" });
      return (
        <ul>
          {useShortcutList().map((s) => (
            <li key={s.id}>{`${s.id}:${s.blocked}`}</li>
          ))}
        </ul>
      );
    }
    const { container } = render(
      <ShortcutProvider singleKey={false}>
        <Listed />
      </ShortcutProvider>,
    );
    expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["new:true", "find:false", "esc:false"]);
  });
});
