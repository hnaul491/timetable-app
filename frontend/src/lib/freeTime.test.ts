import { beforeEach, describe, expect, it } from "vitest";
import { isStepping, samePeriod, buildQuery, computeRange, defaultForm, loadForm, saveForm, validate, type FreeTimeForm, type Period, type PeriodUnit } from "./freeTime";

const TODAY = "2026-10-14"; // a Wednesday
const u = (unit: PeriodUnit, offset = 0): Period => ({ unit, offset });
const form = (over: Partial<FreeTimeForm> = {}): FreeTimeForm => ({ ...defaultForm(TODAY), ...over });

describe("computeRange", () => {
  it("this week is Monday to Sunday", () => {
    expect(computeRange(form({ period: u("week") }), TODAY, null)).toEqual({ start: "2026-10-12", end: "2026-10-18" });
  });
  it("this month is the first to the last day, including leap February", () => {
    expect(computeRange(form({ period: u("month") }), TODAY, null)).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(computeRange(form({ period: u("month") }), "2028-02-10", null)).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });
  it("next week is the following Monday to Sunday", () => {
    expect(computeRange(form({ period: u("week", 1) }), TODAY, null)).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(computeRange(form({ period: u("week", 1) }), "2026-10-18", null)).toEqual({ start: "2026-10-19", end: "2026-10-25" }); // from a Sunday
  });
  it("next month is the whole following month, also across the new year", () => {
    expect(computeRange(form({ period: u("month", 1) }), TODAY, null)).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(computeRange(form({ period: u("month", 1) }), "2026-12-20", null)).toEqual({ start: "2027-01-01", end: "2027-01-31" });
    expect(computeRange(form({ period: u("month", 1) }), "2028-01-31", null)).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });
  it("remembers next week and next month as saved periods", () => {
    saveForm(form({ period: u("month", 1) }));
    expect(loadForm(TODAY).period).toEqual(u("month", 1));
  });
  it("rest of semester runs from today to the semester end, and is unavailable without a usable end", () => {
    expect(computeRange(form({ period: u("semester") }), TODAY, "2027-01-20")).toEqual({ start: TODAY, end: "2027-01-20" });
    expect(computeRange(form({ period: u("semester") }), TODAY, null)).toBeNull();
    expect(computeRange(form({ period: u("semester") }), TODAY, "2026-10-01")).toBeNull();
  });
  it("custom uses the typed dates", () => {
    expect(computeRange(form({ period: u("custom"), customStart: "2026-11-02", customEnd: "2026-11-06" }), TODAY, null)).toEqual({ start: "2026-11-02", end: "2026-11-06" });
    expect(computeRange(form({ period: u("custom"), customStart: "" }), TODAY, null)).toBeNull();
  });
});

describe("computeRange with offsets", () => {
  it("day is a single date, today plus offset", () => {
    expect(computeRange(form({ period: u("day") }), TODAY, null)).toEqual({ start: "2026-10-14", end: "2026-10-14" });
    expect(computeRange(form({ period: u("day", 1) }), TODAY, null)).toEqual({ start: "2026-10-15", end: "2026-10-15" });
    expect(computeRange(form({ period: u("day", -14) }), TODAY, null)).toEqual({ start: "2026-09-30", end: "2026-09-30" });
    expect(computeRange(form({ period: u("day", 20) }), "2028-02-20", null)).toEqual({ start: "2028-03-11", end: "2028-03-11" });
  });
  it("week steps by seven days, forwards and backwards", () => {
    expect(computeRange(form({ period: u("week", 3) }), TODAY, null)).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(computeRange(form({ period: u("week", -1) }), TODAY, null)).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    expect(computeRange(form({ period: u("week", 11) }), TODAY, null)).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });
  it("month steps across year boundaries and leap February", () => {
    expect(computeRange(form({ period: u("month", -1) }), TODAY, null)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(computeRange(form({ period: u("month", 3) }), TODAY, null)).toEqual({ start: "2027-01-01", end: "2027-01-31" });
    expect(computeRange(form({ period: u("month", -10) }), "2026-02-10", null)).toEqual({ start: "2025-04-01", end: "2025-04-30" });
    expect(computeRange(form({ period: u("month", 4) }), "2027-10-31", null)).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });
  it("semester and custom ignore the offset", () => {
    expect(computeRange(form({ period: u("semester", 5) }), TODAY, "2027-01-20")).toEqual({ start: TODAY, end: "2027-01-20" });
    expect(computeRange(form({ period: u("custom", 5), customStart: "2026-11-02", customEnd: "2026-11-06" }), TODAY, null)).toEqual({ start: "2026-11-02", end: "2026-11-06" });
  });
  it("a stepped far-out month still obeys the 200 day limit through validate", () => {
    expect(validate(form({ period: u("month", 2) }), { start: "2026-12-01", end: "2026-12-31" })).toEqual({});
  });
});

describe("period helpers", () => {
  it("isStepping and samePeriod", () => {
    expect(isStepping(u("day"))).toBe(true);
    expect(isStepping(u("semester"))).toBe(false);
    expect(samePeriod(u("week", 1), u("week", 1))).toBe(true);
    expect(samePeriod(u("week", 2), u("week", 1))).toBe(false);
    expect(samePeriod(u("semester", 4), u("semester", 0))).toBe(true);
    expect(samePeriod(u("day"), u("week"))).toBe(false);
  });
});

describe("validate", () => {
  const range = { start: "2026-10-01", end: "2026-10-31" };
  it("accepts the defaults", () => expect(validate(form(), range)).toEqual({}));
  it("requires from < to", () => {
    expect(validate(form({ from: "08:00", to: "08:00" }), range).time).toBe("timeOrder");
    expect(validate(form({ from: "09:00", to: "08:00" }), range).time).toBe("timeOrder");
  });
  it("limits the buffer to whole minutes 0-240", () => {
    for (const bad of ["300", "241", "-5", "", "2.5", "abc"]) expect(validate(form({ buffer: bad }), range).buffer).toBe("buffer");
    for (const ok of ["0", "25", "240"]) expect(validate(form({ buffer: ok }), range).buffer).toBeUndefined();
  });
  it("checks min free only when enabled", () => {
    expect(validate(form({ minFree: "0" }), range).minFree).toBeUndefined();
    expect(validate(form({ useMinFree: true, minFree: "0" }), range).minFree).toBe("minFree");
    expect(validate(form({ useMinFree: true, minFree: "1441" }), range).minFree).toBe("minFree");
  });
  it("checks the range order and the 200 day limit", () => {
    expect(validate(form(), { start: "2026-10-05", end: "2026-10-04" }).range).toBe("rangeOrder");
    expect(validate(form(), { start: "2026-01-01", end: "2026-07-19" }).range).toBeUndefined(); // exactly 200 days
    expect(validate(form(), { start: "2026-01-01", end: "2026-07-20" }).range).toBe("rangeLong");
    expect(validate(form({ period: u("semester") }), null).range).toBe("semesterEnded");
    expect(validate(form({ period: u("semester") }), null, "noSemester").range).toBe("noSemester");
    expect(validate(form({ period: u("custom") }), null).range).toBe("dates");
  });
  it("needs a weekday", () => expect(validate(form({ weekdays: [] }), range).weekdays).toBe("weekdays"));
});

describe("buildQuery", () => {
  it("builds the contract parameters", () => {
    const q = new URLSearchParams(buildQuery(form({ buffer: " 25 ", weekdays: [4, 0, 2] }), { start: "2026-10-01", end: "2026-10-31" }));
    expect(Object.fromEntries(q)).toEqual({ from: "06:00", to: "08:00", start: "2026-10-01", end: "2026-10-31", weekdays: "0,2,4", buffer: "25" });
  });
  it("adds min_free only when enabled", () => {
    const q = new URLSearchParams(buildQuery(form({ useMinFree: true, minFree: "45" }), { start: "2026-10-01", end: "2026-10-31" }));
    expect(q.get("min_free")).toBe("45");
  });
});

describe("storage", () => {
  beforeEach(() => localStorage.clear());
  it("round-trips the form", () => {
    saveForm(form({ buffer: "35", from: "07:00", weekdays: [1, 3] }));
    expect(loadForm(TODAY)).toMatchObject({ buffer: "35", from: "07:00", weekdays: [1, 3] });
  });
  it("falls back to defaults on junk", () => {
    localStorage.setItem("timetable:free-time", "{nope");
    expect(loadForm(TODAY)).toEqual(defaultForm(TODAY));
    localStorage.setItem("timetable:free-time", JSON.stringify({ period: "bogus", weekdays: [9] }));
    expect(loadForm(TODAY)).toEqual(defaultForm(TODAY));
    localStorage.setItem("timetable:free-time", JSON.stringify({ period: { unit: "decade", offset: 1 } }));
    expect(loadForm(TODAY)).toEqual(defaultForm(TODAY));
    localStorage.setItem("timetable:free-time", JSON.stringify({ period: { unit: "week", offset: 1.5 } }));
    expect(loadForm(TODAY)).toEqual(defaultForm(TODAY));
  });
  it("migrates the old saved period strings", () => {
    const old = { week: u("week"), nextWeek: u("week", 1), month: u("month"), nextMonth: u("month", 1), semester: u("semester"), custom: u("custom") };
    for (const [saved, expected] of Object.entries(old)) {
      localStorage.setItem("timetable:free-time", JSON.stringify({ period: saved }));
      expect(loadForm(TODAY).period).toEqual(expected);
    }
  });
  it("round-trips a stepped period and ignores inherited property names", () => {
    saveForm(form({ period: u("day", -3) }));
    expect(loadForm(TODAY).period).toEqual(u("day", -3));
    localStorage.setItem("timetable:free-time", JSON.stringify({ period: "constructor" }));
    expect(loadForm(TODAY)).toEqual(defaultForm(TODAY));
  });
});

describe("computeRange semester clamp", () => {
  it("never exceeds the 200 day limit", () => {
    expect(computeRange(form({ period: u("semester") }), TODAY, "2030-01-01")).toEqual({ start: TODAY, end: "2027-05-01" });
  });
});
