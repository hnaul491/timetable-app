import { useEffect, useState } from "react";

export function useMediaQuery(query: string, fallback = false): boolean {
  const get = () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** True from the md breakpoint up; assumes desktop when matchMedia is missing (tests, old browsers). */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 768px)", true);
}
