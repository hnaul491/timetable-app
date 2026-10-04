import type { MessageKey, Vars } from "../i18n";
import { ApiError } from "./api";

/** Message for a failed assistant request; a gateway timeout (504) or a bad gateway gets the translated "not available" text, a 429 the translated limit text. */
export function aiErrorText(error: Error, t: (key: MessageKey, vars?: Vars) => string): string {
  if (error instanceof ApiError && (error.status === 502 || error.status === 504)) return t("ai.unavailable");
  if (error instanceof ApiError && error.status === 429) return t("ai.limit");
  return error.message;
}

/** "Could not send: <message>", plus a pointer to the model picker when the message is the rate-limit one. */
export function sendFailedText(message: string, t: (key: MessageKey, vars?: Vars) => string): string {
  const text = t("ai.sendFailed", { message });
  return message === "AI limit reached, try again later" || message === t("ai.limit") ? `${text} ${t("ai.pickModelHint")}` : text;
}
