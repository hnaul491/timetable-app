import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { AiStatus } from "../types";
import { AISettings } from "./AISettings";
import { ToastProvider } from "./ui/Toast";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "best quality" },
  { id: "gemini-3-flash", label: "Gemini 3 Flash", note: "" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", note: "fastest" },
];

function setup(status: Partial<AiStatus> & { enabled: boolean }, locale: "en" | "vi" = "en") {
  const full = { model: null, ...status } as AiStatus;
  apiFetch.mockImplementation(async (path: string) => (path === "/api/ai/status" ? full : full));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>
        <ToastProvider>
          <AISettings />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return invalidate;
}

const enabled = { enabled: true, model: "gemini-3.8-flash", models: MODELS, auto_fallback: true };

describe("AISettings", () => {
  beforeEach(() => apiFetch.mockReset());

  it("shows the model when enabled, with the privacy notice", async () => {
    setup(enabled);
    expect(await screen.findByText(/On · model gemini-3.8-flash/)).toBeInTheDocument();
    expect(screen.getByText(/sent to Google/)).toBeInTheDocument();
    expect(screen.getByText(/only a few requests per minute/)).toBeInTheDocument();
  });

  it("lists the models and saves the chosen one", async () => {
    const invalidate = setup(enabled);
    const select = await screen.findByRole("combobox", { name: "Model" });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Gemini 3.8 Flash — best quality",
      "Gemini 3 Flash",
      "Gemini 2.5 Flash-Lite — fastest",
    ]);
    expect(select).toHaveValue("gemini-3.8-flash");
    await userEvent.selectOptions(select, "gemini-2.5-flash-lite");
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/api/ai/settings", { method: "PUT", body: JSON.stringify({ model: "gemini-2.5-flash-lite" }) }),
    );
    expect(await screen.findByText("AI settings saved")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["ai-status"] });
  });

  it("toggles automatic fallback", async () => {
    setup(enabled);
    const box = await screen.findByRole("checkbox", { name: "Switch model automatically when the limit is reached" });
    expect(box).toBeChecked();
    await userEvent.click(box);
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/api/ai/settings", { method: "PUT", body: JSON.stringify({ auto_fallback: false }) }),
    );
  });

  it("hides the model controls when the assistant is off and explains how to enable it", async () => {
    setup({ enabled: false, model: null, models: MODELS, auto_fallback: true });
    expect(await screen.findByText("Not set up")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/GEMINI_API_KEY/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /aistudio\.google\.com/ })).toHaveAttribute("href", "https://aistudio.google.com/apikey");
  });

  it("renders in Vietnamese", async () => {
    setup(enabled, "vi");
    expect(await screen.findByRole("combobox", { name: "Mô hình" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Tự động đổi mô hình khi hết lượt" })).toBeInTheDocument();
    expect(screen.getByText(/Gói miễn phí chỉ cho phép vài yêu cầu/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Gemini 3.8 Flash — chất lượng tốt nhất" })).toBeInTheDocument();
  });
});
