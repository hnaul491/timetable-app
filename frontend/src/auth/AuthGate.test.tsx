import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AuthGate } from "./AuthGate";

const getSession = vi.fn();
const unsubscribe = vi.fn();
let listener: ((event: string, session: unknown) => void) | null = null;
const order: string[] = [];
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => {
        order.push("getSession");
        return getSession();
      },
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        order.push("subscribe");
        listener = cb;
        return { data: { subscription: { unsubscribe } } };
      },
    },
  },
}));
vi.mock("./LoginPage", () => ({ LoginPage: () => <p>Login page</p> }));

const renderGate = (locale: "en" | "vi" = "en") =>
  render(
    <I18nProvider locale={locale}>
      <AuthGate>
        <p>Secret app</p>
      </AuthGate>
    </I18nProvider>,
  );

describe("AuthGate", () => {
  beforeEach(() => {
    getSession.mockReset();
    unsubscribe.mockReset();
    order.length = 0;
    listener = null;
  });

  it("subscribes before reading the session", async () => {
    getSession.mockResolvedValue({ data: { session: { user: {} } }, error: null });
    renderGate();
    expect(await screen.findByText("Secret app")).toBeInTheDocument();
    expect(order).toEqual(["subscribe", "getSession"]);
  });

  it("shows the login page without a session", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    renderGate();
    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });

  it("shows an error with Retry when getSession rejects, and retries", async () => {
    getSession.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({ data: { session: { user: {} } }, error: null });
    renderGate();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not check your sign-in");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Secret app")).toBeInTheDocument();
  });

  it("shows the error when getSession returns an error object, in Vietnamese too", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: new Error("boom") });
    renderGate("vi");
    expect(await screen.findByRole("alert")).toHaveTextContent("Không kiểm tra được phiên đăng nhập");
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });

  it("an auth state change event wins over a failed initial read", async () => {
    getSession.mockRejectedValue(new Error("x"));
    renderGate();
    await screen.findByRole("alert");
    listener?.("SIGNED_IN", { user: {} });
    await waitFor(() => expect(screen.getByText("Secret app")).toBeInTheDocument());
  });
});
