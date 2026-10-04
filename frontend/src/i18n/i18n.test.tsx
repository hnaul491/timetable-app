import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { en } from "./en";
import { I18nProvider, translate, useT } from "./index";
import { translateServerMessage } from "./serverMessages";
import { vi } from "./vi";

function leaves(node: unknown, prefix = ""): [string, unknown][] {
  if (typeof node === "string") return [[prefix, node]];
  if (node && typeof node === "object" && "other" in node) return [[prefix, node]];
  return Object.entries(node as object).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

// Words that are the same in both languages.
const SAME_IN_BOTH = new Set(["OK", "Zeus", "Google", "Google Calendar", "Timetable", "Email", "ICS"]);

describe("i18n", () => {
  it("fills placeholders and picks plurals", () => {
    expect(translate("en", "common.itemsCount", { count: 1 })).toBe("1 item");
    expect(translate("en", "common.itemsCount", { count: 3 })).toBe("3 items");
    expect(translate("vi", "common.itemsCount", { count: 3 })).toBe("3 mục");
  });

  it("has every English key in Vietnamese, translated", () => {
    const enLeaves = leaves(en);
    const viMap = new Map(leaves(vi));
    for (const [key, value] of enLeaves) {
      expect(viMap.has(key), `missing vi key ${key}`).toBe(true);
      const viValue = viMap.get(key);
      expect(JSON.stringify(viValue).length, `empty vi text ${key}`).toBeGreaterThan(2);
      if (typeof value === "string" && !SAME_IN_BOTH.has(value)) {
        expect(viValue, `untranslated ${key}`).not.toBe(value);
      }
    }
  });

  it("renders through the provider and defaults to English", () => {
    function Hello() {
      const t = useT();
      return <p>{t("common.save")}</p>;
    }
    const { unmount } = render(<Hello />);
    expect(screen.getByText("Save")).toBeInTheDocument();
    unmount();
    render(
      <I18nProvider locale="vi">
        <Hello />
      </I18nProvider>,
    );
    expect(screen.getByText("Lưu")).toBeInTheDocument();
  });

  it("translates known server texts, with numbers", () => {
    expect(translateServerMessage("end date must be on or after start date", "vi")).toBe("Ngày kết thúc phải bằng hoặc sau ngày bắt đầu");
    expect(translateServerMessage("Google Calendar returned 500 (backendError)", "vi")).toBe("Lịch Google trả về lỗi 500 (backendError)");
    expect(translateServerMessage("end date must be on or after start date", "en")).toBe("end date must be on or after start date");
  });

  it("translates the specific invalid-feed and session texts", () => {
    const tr = (text: string) => translateServerMessage(text, "vi");
    expect(tr("invalid feed: feed contains no events")).toBe(translate("vi", "errors.emptyFeed"));
    expect(tr("invalid feed: response is not an iCalendar document")).toBe(translate("vi", "errors.notIcal"));
    expect(tr("invalid feed: could not parse calendar: bad line")).toBe(translate("vi", "errors.unparsable"));
    expect(tr("invalid feed: something else")).toBe(translate("vi", "errors.invalidFeed", { detail: "something else" }));
    expect(tr("invalid token")).toBe(translate("vi", "errors.sessionExpired"));
    expect(tr("Failed to fetch")).toBe(translate("vi", "errors.offline"));
  });

  it("unknown server texts are kept", () => {
    expect(translateServerMessage("something new from the server", "vi")).toBe("something new from the server");
  });
});
