import { describe, expect, it } from "vitest";
import { addDays, dayLabel, formatLongDate, formatTime, parisLocalToUtc, parisMidnightUtc, parisParts, rangeUtc, startOfWeek, todayParis, weekdayIndex } from "./time";

describe("Paris time", () => {
  it("converts summer time (CEST, UTC+2)", () => {
    expect(parisParts("2026-10-20T12:30:00Z")).toEqual({ date: "2026-10-20", minutes: 870 });
    expect(formatTime("2026-10-20T12:30:00Z")).toBe("14:30");
  });

  it("converts winter time after the 25 Oct switch (CET, UTC+1)", () => {
    expect(formatTime("2026-10-26T12:00:00Z")).toBe("13:00");
  });

  it("week range across the DST switch ends at 23:00Z", () => {
    expect(rangeUtc("2026-10-19", 7)).toEqual({ start: "2026-10-18T22:00:00.000Z", end: "2026-10-25T23:00:00.000Z" });
  });

  it("midnight on spring-forward day", () => {
    expect(parisMidnightUtc("2026-03-29")).toBe("2026-03-28T23:00:00.000Z");
  });

  it("startOfWeek returns Monday", () => {
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19");
    expect(startOfWeek("2026-10-26")).toBe("2026-10-26");
    expect(startOfWeek("2026-11-01")).toBe("2026-10-26");
  });

  it("today is computed in Paris, not UTC", () => {
    expect(todayParis(new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-25");
    expect(todayParis(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-26");
  });

  it("date arithmetic and labels", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(dayLabel("2026-10-19")).toEqual({ weekday: "Mon", day: "19" });
    expect(formatLongDate("2026-10-25")).toBe("25 October 2026");
  });
});

describe("Paris local → UTC", () => {
  it("converts summer and winter local times", () => {
    expect(parisLocalToUtc("2026-10-19", "19:30")).toBe("2026-10-19T17:30:00.000Z");
    expect(parisLocalToUtc("2026-10-26", "19:30")).toBe("2026-10-26T18:30:00.000Z");
  });
  it("weekdayIndex is Monday-based", () => {
    expect(weekdayIndex("2026-10-19")).toBe(0);
    expect(weekdayIndex("2026-10-25")).toBe(6);
  });
});
