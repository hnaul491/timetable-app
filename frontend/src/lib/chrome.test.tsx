import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChromeProvider, useChrome } from "./chrome";

const wrapper = ({ children }: { children: ReactNode }) => <ChromeProvider>{children}</ChromeProvider>;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("chrome", () => {
  it("persists the collapsed sidebar and reads it back", () => {
    const first = renderHook(() => useChrome(), { wrapper });
    expect(first.result.current.sidebarCollapsed).toBe(false);
    act(() => first.result.current.toggleSidebar());
    expect(first.result.current.sidebarCollapsed).toBe(true);
    expect(localStorage.getItem("timetable:sidebar")).toBe("collapsed");
    first.unmount();
    const second = renderHook(() => useChrome(), { wrapper });
    expect(second.result.current.sidebarCollapsed).toBe(true);
  });

  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useChrome(), { wrapper });
    expect(result.current.sidebarCollapsed).toBe(false);
    act(() => result.current.toggleSidebar());
    expect(result.current.sidebarCollapsed).toBe(true);
  });

  it("exposes full screen", () => {
    const { result } = renderHook(() => useChrome(), { wrapper });
    act(() => result.current.setFullScreen(true));
    expect(result.current.fullScreen).toBe(true);
  });
});
