import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceSettings } from "./AppearanceSettings";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AppearanceSettings />
    </QueryClientProvider>,
  );
}

describe("AppearanceSettings", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ language: "vi" });
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("saves the chosen language to the account", async () => {
    renderCard();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Language" }), "Tiếng Việt");
    expect(apiFetch).toHaveBeenCalledWith("/api/preferences", { method: "PUT", body: JSON.stringify({ language: "vi" }) });
  });

  it("applies and remembers the chosen theme", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("timetable:theme")).toBe("dark");
  });
});
