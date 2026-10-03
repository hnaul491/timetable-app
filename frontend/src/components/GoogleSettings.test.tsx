import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleStatus, PushResult } from "../types";
import { GoogleSettings } from "./GoogleSettings";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
const google = vi.hoisted(() => ({ startGoogleConnect: vi.fn(), takeConnectFlag: vi.fn(), takeProviderRefreshToken: vi.fn(), forgetProviderToken: vi.fn() }));
vi.mock("../lib/google", () => google);

const connected: GoogleStatus = {
  configured: true, connected: true, email: "me@example.com", kinds: ["class", "exam", "holiday", "work", "french_ext"],
  needs_reconnect: false, last_push_at: null, last_push_error: null, pending: 12,
};

function renderWith(status: GoogleStatus, pushes: PushResult[] = []) {
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/google/push") return pushes.shift();
    return init?.method === "DELETE" ? undefined : status;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GoogleSettings />
    </QueryClientProvider>,
  );
}

describe("GoogleSettings", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    google.startGoogleConnect.mockReset();
    google.takeConnectFlag.mockReset().mockReturnValue(false);
    google.takeProviderRefreshToken.mockReset();
    google.forgetProviderToken.mockReset();
  });

  it("explains when the server is not set up", async () => {
    renderWith({ ...connected, configured: false, connected: false });
    expect(await screen.findByText(/isn't set up on the server/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Google Calendar" })).not.toBeInTheDocument();
  });

  it("starts the Google consent when connecting", async () => {
    renderWith({ ...connected, connected: false, email: null });
    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Calendar" }));
    expect(google.startGoogleConnect).toHaveBeenCalled();
  });

  it("hands the refresh token to the server after coming back from Google", async () => {
    google.takeConnectFlag.mockReturnValue(true);
    google.takeProviderRefreshToken.mockResolvedValue("1//tok");
    renderWith({ ...connected, connected: false, email: null });
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/api/google/connect", { method: "POST", body: JSON.stringify({ refresh_token: "1//tok" }) }),
    );
    await waitFor(() => expect(google.forgetProviderToken).toHaveBeenCalled());
  });

  it("explains when Google gave no offline access", async () => {
    google.takeConnectFlag.mockReturnValue(true);
    google.takeProviderRefreshToken.mockResolvedValue(null);
    renderWith({ ...connected, connected: false, email: null });
    expect(await screen.findByText(/didn't give offline access/)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith("/api/google/connect", expect.anything());
  });

  it("switches a kind off", async () => {
    renderWith(connected);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Work shifts" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/google/kinds", {
      method: "PUT",
      body: JSON.stringify({ kinds: ["class", "exam", "holiday", "french_ext"] }),
    });
  });

  it("keeps pushing until nothing is left", async () => {
    renderWith(connected, [
      { status: "partial", done: 5, failed: 0, remaining: 3, error: null },
      { status: "ok", done: 3, failed: 0, remaining: 0, error: null },
    ]);
    await userEvent.click(await screen.findByRole("button", { name: "Push now" }));
    expect(await screen.findByText("8 changes sent")).toBeInTheDocument();
    expect(apiFetch.mock.calls.filter(([path]) => path === "/api/google/push")).toHaveLength(2);
  });

  it("disconnects only after a second click", async () => {
    renderWith(connected);
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(apiFetch).not.toHaveBeenCalledWith("/api/google", { method: "DELETE" });
    await userEvent.click(screen.getByRole("button", { name: "Click again to disconnect" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/google", { method: "DELETE" });
  });

  it("says the calendar stays in Google after disconnecting", async () => {
    renderWith(connected);
    expect(await screen.findByText(/stays in Google/)).toBeInTheDocument();
  });

  it("offers to reconnect when access was revoked", async () => {
    renderWith({ ...connected, needs_reconnect: true, last_push_error: "Google access was revoked or expired — reconnect Google in Settings" });
    expect(await screen.findByText(/access was revoked or expired/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Push now" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Reconnect Google" }));
    expect(google.startGoogleConnect).toHaveBeenCalled();
  });

  it("stops pushing when a round makes no progress and shows the rate limit", async () => {
    const msg = "Google rate limit reached; the rest is sent on the next push";
    renderWith(connected, [
      { status: "partial", done: 0, failed: 0, remaining: 5, error: msg },
      { status: "ok", done: 5, failed: 0, remaining: 0, error: null },
    ]);
    await userEvent.click(await screen.findByRole("button", { name: "Push now" }));
    expect(await screen.findByText(`0 changes sent. ${msg}`)).toBeInTheDocument();
    expect(apiFetch.mock.calls.filter(([path]) => path === "/api/google/push")).toHaveLength(1);
  });

  it("shows a failed push", async () => {
    renderWith(connected, [{ status: "failed", done: 0, failed: 3, remaining: 3, error: "boom" }]);
    await userEvent.click(await screen.findByRole("button", { name: "Push now" }));
    expect(await screen.findByText("Push failed: boom")).toBeInTheDocument();
  });

  it("shows when Google rejects the consent start", async () => {
    google.startGoogleConnect.mockResolvedValue({ error: { message: "popup blocked" } });
    renderWith({ ...connected, connected: false, email: null });
    await userEvent.click(await screen.findByRole("button", { name: "Connect Google Calendar" }));
    expect(await screen.findByText("popup blocked")).toBeInTheDocument();
  });
});
