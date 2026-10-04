import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecurringList } from "../components/RecurringList";
import { ConfirmProvider } from "../components/ui/Confirm";
import { GoogleSettings } from "../components/GoogleSettings";
import { SettingsAt } from "../test/settingsRoute";
import { I18nProvider, translate } from "./index";

const RULE = { id: 5, title: "French (external)", kind: "french_ext", weekdays: [0, 3], start_time: "19:30", end_time: "21:00",
               from_date: "2026-10-19", until_date: "2026-12-17", location: "Alliance", occurrences: 18 };
const GOOGLE = { configured: true, connected: true, email: "me@example.com", needs_reconnect: false, kinds: ["class"], pending: 2, drive_enabled: true,
                 last_push_at: null, last_push_error: "Could not reach Google" };

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(async (path: string) => {
      if (path === "/api/settings/zeus-key") return { configured: true };
      if (path === "/api/sync/status") return { last_run: null, last_success_at: null };
      if (path === "/api/recurring") return [RULE];
      if (path === "/api/google") return GOOGLE;
      return [];
    }),
  };
});

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="vi">
        <ConfirmProvider>{ui}</ConfirmProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}
const vi_ = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("vi", key, vars);

describe("settings in Vietnamese", () => {
  it("translates the settings page and the appearance card", async () => {
    wrap(<SettingsAt url="/settings/general" />);
    expect(await screen.findByRole("heading", { name: vi_("settings.title") })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: vi_("settings.appearance.title") })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: vi_("settings.appearance.themes.dark") })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: vi_("settings.sectionsLabel") })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(vi_("settings.sections.school")) })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: vi_("settings.find.label") })).toBeInTheDocument();
  });

  it("translates the school timetable section", async () => {
    wrap(<SettingsAt />);
    expect(await screen.findByRole("button", { name: vi_("settings.zeus.syncNow") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: vi_("settings.zeus.syncNow") })).toBeInTheDocument();
    expect(screen.getByText(vi_("settings.zeus.lastSync", { value: vi_("common.never") }))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: vi_("settings.groups.title") })).toBeInTheDocument();
  });

  it("translates repeating events with a confirm dialog", async () => {
    wrap(<RecurringList />);
    expect(await screen.findByText(new RegExp(`${vi_("settings.days.mon")}, ${vi_("settings.days.thu")} · 19:30`))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: vi_("settings.recurring.deleteAria", { title: RULE.title }) }));
    expect(screen.getByRole("dialog", { name: vi_("settings.recurring.deleteTitle", { title: RULE.title }) })).toBeInTheDocument();
  });

  it("translates Google settings including the server error text", async () => {
    wrap(<GoogleSettings />);
    expect(await screen.findByRole("button", { name: vi_("google.pushNow") })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: vi_("google.kinds.class") })).toBeInTheDocument();
    expect(screen.getByText(vi_("google.lastPushError", { error: vi_("errors.googleUnreachable") }))).toBeInTheDocument();
  });
});
