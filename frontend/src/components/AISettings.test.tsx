import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AISettings } from "./AISettings";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

function setup(status: { enabled: boolean; model: string | null }, locale: "en" | "vi" = "en") {
  apiFetch.mockResolvedValue(status);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale={locale}>
        <AISettings />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("AISettings", () => {
  beforeEach(() => apiFetch.mockReset());

  it("shows the model when enabled, with the privacy notice", async () => {
    setup({ enabled: true, model: "gemini-2.5-flash" });
    expect(await screen.findByText(/On · model gemini-2.5-flash/)).toBeInTheDocument();
    expect(screen.getByText(/sent to Google/)).toBeInTheDocument();
  });

  it("explains how to enable it when off", async () => {
    setup({ enabled: false, model: null });
    expect(await screen.findByText("Not set up")).toBeInTheDocument();
    expect(screen.getByText(/GEMINI_API_KEY/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /aistudio\.google\.com/ })).toHaveAttribute("href", "https://aistudio.google.com/apikey");
  });

  it("renders in Vietnamese", async () => {
    setup({ enabled: false, model: null }, "vi");
    expect(await screen.findByText("Chưa thiết lập")).toBeInTheDocument();
  });
});
