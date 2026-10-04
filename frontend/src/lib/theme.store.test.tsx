import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AppearanceSettings } from "../components/AppearanceSettings";
import { setTheme } from "./theme";

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme as an external store", () => {
  it("setTheme from outside updates the mounted Settings radio and the page", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppearanceSettings />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    act(() => setTheme("dark"));
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("timetable:theme")).toBe("dark");
  });

  it("choosing System afterwards works", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AppearanceSettings />
      </QueryClientProvider>,
    );
    act(() => setTheme("dark"));
    await user.click(screen.getByRole("radio", { name: "System" }));
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(localStorage.getItem("timetable:theme")).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
