import type { MessageKey, Vars } from "../i18n";
import { ApiError } from "./api";

/** Message for a failed assistant request; a gateway timeout (504) or a bad gateway gets the translated "not available" text. */
export function aiErrorText(error: Error, t: (key: MessageKey, vars?: Vars) => string): string {
  if (error instanceof ApiError && (error.status === 502 || error.status === 504)) return t("ai.unavailable");
  return error.message;
}
