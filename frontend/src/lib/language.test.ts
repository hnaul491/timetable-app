import { afterEach, describe, expect, it, vi } from "vitest";
import { browserLanguage, initialLanguage, readStoredLanguage, storeLanguage } from "./language";

describe("language helpers", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("initial language follows the browser", () => {
    expect(browserLanguage("vi-VN")).toBe("vi");
    expect(browserLanguage("fr-FR")).toBe("en");
    vi.spyOn(navigator, "language", "get").mockReturnValue("vi");
    expect(initialLanguage()).toBe("vi");
  });

  it("prefers the stored language", () => {
    storeLanguage("vi");
    expect(readStoredLanguage()).toBe("vi");
    expect(initialLanguage()).toBe("vi");
    localStorage.setItem("timetable:language", "xx");
    expect(readStoredLanguage()).toBeNull();
  });

  it("language helpers survive blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStoredLanguage()).toBeNull();
    expect(() => storeLanguage("vi")).not.toThrow();
  });
});
