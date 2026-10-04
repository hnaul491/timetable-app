import type { ReactNode } from "react";
import { useShortcutSettings } from "../lib/shortcutPrefs";
import { ShortcutProvider } from "../lib/shortcuts";

/** The shortcut engine fed with the account's overrides, so edits in Settings apply at once. */
export function ShortcutRoot({ children }: { children: ReactNode }) {
  const { overrides, singleKey } = useShortcutSettings();
  return (
    <ShortcutProvider overrides={overrides} singleKey={singleKey}>
      {children}
    </ShortcutProvider>
  );
}
