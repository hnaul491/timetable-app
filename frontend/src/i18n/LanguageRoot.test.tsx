import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useT } from "./index";
import { LanguageRoot } from "./LanguageRoot";

const apiFetch = vi.fn();
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

function Hello() {
  const t = useT();
  return <p>{t("common.save")}</p>;
}

function renderRoot() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LanguageRoot>
        <Hello />
      </LanguageRoot>
    </QueryClientProvider>,
  );
}

describe("LanguageRoot", () => {
  beforeEach(() => {
    localStorage.clear();
    apiFetch.mockReset();
  });

  it("uses the server language over the cached one", async () => {
    localStorage.setItem("timetable:language", "en");
    apiFetch.mockResolvedValue({ language: "vi" });
    renderRoot();
    expect(await screen.findByText("Lưu")).toBeInTheDocument();
    expect(localStorage.getItem("timetable:language")).toBe("vi");
    expect(document.documentElement.lang).toBe("vi");
  });

  it("keeps the cached language when the server has none", async () => {
    localStorage.setItem("timetable:language", "vi");
    apiFetch.mockResolvedValue({ language: null });
    renderRoot();
    expect(await screen.findByText("Lưu")).toBeInTheDocument();
  });
});
