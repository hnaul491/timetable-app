import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, readTheme, resolveTheme, storeTheme, watchSystemTheme } from "./theme";

describe("theme", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    document.documentElement.removeAttribute("data-theme");
  });

  it("resolves system, light and dark", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("stores the choice and applies it to the page", () => {
    expect(readTheme()).toBe("system");
    storeTheme("dark");
    expect(readTheme()).toBe("dark");
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(meta.content).toBe("#121418");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    meta.remove();
  });

  it("theme helpers survive blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readTheme()).toBe("system");
    expect(() => storeTheme("dark")).not.toThrow();
  });

  describe("watchSystemTheme", () => {
    function mockMedia() {
      const state = { matches: false, handler: undefined as undefined | (() => void) };
      vi.stubGlobal("matchMedia", () => ({
        get matches() {
          return state.matches;
        },
        addEventListener: (_type: string, handler: () => void) => {
          state.handler = handler;
        },
        removeEventListener: () => {
          state.handler = undefined;
        },
      }));
      return state;
    }
    afterEach(() => vi.unstubAllGlobals());

    it("follows the OS when no choice is stored", () => {
      const media = mockMedia();
      const stop = watchSystemTheme();
      media.matches = true;
      media.handler!();
      expect(document.documentElement.dataset.theme).toBe("dark");
      stop();
      expect(media.handler).toBeUndefined();
    });

    it("keeps an explicit choice", () => {
      storeTheme("light");
      applyTheme("light");
      const media = mockMedia();
      watchSystemTheme();
      media.matches = true;
      media.handler!();
      expect(document.documentElement.dataset.theme).toBe("light");
    });
  });
});
