import { beforeEach, describe, expect, it } from "vitest";
import { buildQuery, computeRange, defaultForm, loadForm, saveForm, validate, type FreeTimeForm } from "./freeTime";

const TODAY = "2026-10-14"; // a Wednesday
const form = (over: Partial<FreeTimeForm> = {}): FreeTimeForm => ({ ...defaultForm(TODAY), ...over });

describe("computeRange", () => {
  it("this week is Monday to Sunday", () => {
    expect(computeRange(form({ period: "week" }), TODAY, null)).toEqual({ start: "2026-10-12", end: "2026-10-18" });
  });
  it("this month is the first to the last day, including leap February", () => {
    expect(computeRange(form({ period: "month" }), TODAY, null)).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(computeRange(form({ period: "month" }), "2028-02-10", null)).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });
  it("rest of semester runs from today to the semester end, and is unavailable without a usable end", () => {
    expect(computeRange(form({ period: "semester" }), TODAY, "2027-01-20")).toEqual({ start: TODAY, end: "2027-01-20" });
    expect(computeRange(form({ period: "semester" }), TODAY, null)).toBeNull();
    expect(computeRange(form({ period: "semester" }), TODAY, "2026-10-01")).toBeNull();
  });
  it("custom uses the typed dates", () => {
    expect(computeRange(form({ period: "custom", customStart: "2026-11-02", customEnd: "2026-11-06" }), TODAY, null)).toEqual({ start: "2026-11-02", end: "2026-11-06" });
    expect(computeRange(form({ period: "custom", customStart: "" }), TODAY, null)).toBeNull();
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
    expect(validate(form({ period: "semester" }), null).range).toBe("semesterEnded");
    expect(validate(form({ period: "semester" }), null, "noSemester").range).toBe("noSemester");
    expect(validate(form({ period: "custom" }), null).range).toBe("dates");
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
  });
});

describe("computeRange semester clamp", () => {
  it("never exceeds the 200 day limit", () => {
    expect(computeRange(form({ period: "semester" }), TODAY, "2030-01-01")).toEqual({ start: TODAY, end: "2027-05-01" });
  });
});
