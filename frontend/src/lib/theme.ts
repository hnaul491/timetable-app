import { useEffect, useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export const THEME_KEY = "timetable:theme";
const META_COLOR = { light: "#2E55E6", dark: "#121418" } as const;

export function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

const THEME_EVENT = "timetable:theme-change";

export function storeTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // storage blocked: the choice lasts until the page is reloaded
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Saves and applies a choice from anywhere; mounted useTheme hooks follow it. */
export function setTheme(choice: ThemeChoice): void {
  storeTheme(choice);
  applyTheme(choice);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): "light" | "dark" {
  return choice === "system" ? (prefersDark ? "dark" : "light") : choice;
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(choice: ThemeChoice): void {
  const theme = resolveTheme(choice, systemPrefersDark());
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_COLOR[theme]);
}

/** Current choice plus a setter that saves and applies it; follows the system setting live in "system" mode. */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, readTheme, () => "system" as ThemeChoice);
  useEffect(() => {
    applyTheme(choice);
    if (choice !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);
  return [choice, setTheme];
}

/** Keeps the page in step with the OS light/dark setting while the choice is "system", on every page. */
export function watchSystemTheme(): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (readTheme() === "system") applyTheme("system");
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
