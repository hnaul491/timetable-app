import { getMessageLocale } from "../i18n/current";
import { translateServerMessage } from "../i18n/serverMessages";
import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Bearer header for raw fetches (e.g. binary uploads) that cannot go through apiFetch. */
export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

/** Turns a failed response into an ApiError with a translated message. */
export async function toApiError(response: Response): Promise<ApiError> {
  let message = response.statusText || `HTTP ${response.status}`;
  try {
    const body = await response.json();
    if (typeof body.detail === "string") message = body.detail;
    else if (Array.isArray(body.detail))
      message = body.detail
        .map((d: { msg?: unknown }) => String(d?.msg ?? "").replace(/^Value error, /, ""))
        .filter(Boolean)
        .join("; ");
  } catch {
    // error body was not JSON; keep the status text
  }
  return new ApiError(response.status, translateServerMessage(message, getMessageLocale()));
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(await authHeaders())) headers.set(name, value);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
