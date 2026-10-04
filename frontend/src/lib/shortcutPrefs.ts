import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "../components/ui/Toast";
import { useT } from "../i18n";
import { usePreferences, type Preferences } from "../i18n/LanguageRoot";
import { apiFetch } from "./api";
import type { ShortcutOverrides } from "./shortcuts";

const NONE: ShortcutOverrides = {};

/** Overrides and the single-key toggle from the account preferences (the query the language already uses). */
export function useShortcutSettings(): { overrides: ShortcutOverrides; singleKey: boolean; hints: boolean; loaded: boolean } {
  const { data } = usePreferences();
  const prefs = data && !Array.isArray(data) ? (data as Partial<Preferences>) : null;
  const overrides = prefs?.shortcuts && typeof prefs.shortcuts === "object" ? prefs.shortcuts : NONE;
  return { overrides, singleKey: prefs?.single_key_shortcuts !== false, hints: prefs?.shortcut_hints !== false, loaded: prefs !== null };
}

type Patch = { shortcuts?: ShortcutOverrides; single_key_shortcuts?: boolean; shortcut_hints?: boolean };

/** Saves a partial preferences update: applied at once, rolled back with a Retry toast if the server refuses it. */
export function useSaveShortcutPrefs(): (patch: Patch) => void {
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useT();
  const mutation = useMutation({
    mutationFn: (patch: Patch) => apiFetch<Preferences>("/api/preferences", { method: "PUT", body: JSON.stringify(patch) }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ["preferences"] });
      const previous = queryClient.getQueryData(["preferences"]);
      const base = previous && !Array.isArray(previous) ? (previous as object) : {};
      queryClient.setQueryData(["preferences"], { ...base, ...patch });
      return { previous };
    },
    onError: (_error, patch, context) => {
      queryClient.setQueryData(["preferences"], context?.previous);
      toast.error(t("shortcuts.settings.saveFailed"), { retry: () => mutation.mutate(patch) });
    },
  });
  const { mutate } = mutation;
  return useCallback((patch: Patch) => mutate(patch), [mutate]);
}
