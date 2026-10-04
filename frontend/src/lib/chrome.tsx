import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export const SIDEBAR_KEY = "timetable:sidebar";

type Chrome = { sidebarCollapsed: boolean; toggleSidebar: () => void; fullScreen: boolean; setFullScreen: (v: boolean) => void };
const Ctx = createContext<Chrome | null>(null);

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
}

function storeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded");
  } catch {
    // storage blocked: the choice lasts until the page is reloaded
  }
}

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setCollapsed] = useState(readCollapsed);
  const [fullScreen, setFullScreen] = useState(false);
  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      storeCollapsed(!c);
      return !c;
    });
  }, []);
  const value = useMemo(() => ({ sidebarCollapsed, toggleSidebar, fullScreen, setFullScreen }), [sidebarCollapsed, toggleSidebar, fullScreen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChrome(): Chrome {
  const value = useContext(Ctx);
  if (!value) throw new Error("useChrome must be used inside ChromeProvider");
  return value;
}
