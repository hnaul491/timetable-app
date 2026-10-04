import { addDays, startOfWeek } from "./time";

export type PeriodUnit = "day" | "week" | "month" | "semester" | "custom";
/** `offset` counts units away from the current one; semester and custom ignore it. */
export interface Period { unit: PeriodUnit; offset: number }

export const PERIOD_PRESETS = [
  { key: "today", period: { unit: "day", offset: 0 } },
  { key: "tomorrow", period: { unit: "day", offset: 1 } },
  { key: "week", period: { unit: "week", offset: 0 } },
  { key: "nextWeek", period: { unit: "week", offset: 1 } },
  { key: "month", period: { unit: "month", offset: 0 } },
  { key: "nextMonth", period: { unit: "month", offset: 1 } },
  { key: "semester", period: { unit: "semester", offset: 0 } },
  { key: "custom", period: { unit: "custom", offset: 0 } },
] as const satisfies readonly { key: string; period: Period }[];
export type PeriodKey = (typeof PERIOD_PRESETS)[number]["key"];

export const isStepping = (p: Period): boolean => p.unit === "day" || p.unit === "week" || p.unit === "month";
export function samePeriod(a: Period, b: Period): boolean {
  return a.unit === b.unit && (!isStepping(a) || a.offset === b.offset);
}

export interface FreeTimeForm {
  from: string;
  to: string;
  period: Period;
  customStart: string;
  customEnd: string;
  weekdays: number[];
  /** Kept as typed so partial input like "3" or "" is representable. */
  buffer: string;
  useMinFree: boolean;
  minFree: string;
}

export interface Blocker {
  event_id: number;
  title: string;
  start: string;
  end: string;
  kind: string;
}
export type DayStatus = "free" | "partial" | "busy" | "off" | "unknown";
export interface FreeDay {
  date: string;
  weekday: number;
  status: DayStatus;
  counts: boolean;
  free_minutes: number;
  longest_free: number;
  blockers: Blocker[];
}
export interface FreeTimeResult {
  window: { from: string; to: string };
  start: string;
  end: string;
  buffer: number;
  min_free: number | null;
  counted_days: number;
  /** Counted days outside the active semester (or all of them without one): shown as "?", never as free. */
  uncovered_days: number;
  free_days: number;
  semester: { id: number; name: string; start: string | null; end: string | null } | null;
  missing_sections: { subject_id: number | null; name: string }[];
  by_weekday: { weekday: number; free: number; total: number }[];
  days: FreeDay[];
}

export const MAX_DAYS = 200;
export const MAX_BUFFER = 240;
export const BUFFER_PRESETS = [0, 15, 30, 45] as const;
const STORAGE_KEY = "timetable:free-time";

export function defaultForm(today: string): FreeTimeForm {
  return {
    from: "06:00", to: "08:00", period: { unit: "month", offset: 0 }, customStart: today, customEnd: addDays(today, 30),
    weekdays: [0, 1, 2, 3, 4], buffer: "0", useMinFree: false, minFree: "60",
  };
}

export interface Range { start: string; end: string }

export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The whole calendar month `offset` months after the month of `today`. */
function monthRange(today: string, offset: number): Range {
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(first), end: iso(last) };
}

/** The inclusive Paris-date range for a period, or null when it cannot be computed (no/over semester end). */
export function computeRange(form: FreeTimeForm, today: string, semesterEnd: string | null): Range | null {
  const { unit, offset } = form.period;
  switch (unit) {
    case "day": {
      const day = addDays(today, offset);
      return { start: day, end: day };
    }
    case "week": {
      const start = addDays(startOfWeek(today), 7 * offset);
      return { start, end: addDays(start, 6) };
    }
    case "month":
      return monthRange(today, offset);
    case "semester":
      return semesterEnd && semesterEnd >= today ? { start: today, end: semesterEnd < addDays(today, MAX_DAYS - 1) ? semesterEnd : addDays(today, MAX_DAYS - 1) } : null;
    case "custom":
      return DATE.test(form.customStart) && DATE.test(form.customEnd) ? { start: form.customStart, end: form.customEnd } : null;
  }
}

export type FreeTimeErrors = Partial<Record<"time" | "buffer" | "minFree" | "range" | "weekdays", "timeOrder" | "buffer" | "minFree" | "weekdays" | "dates" | "rangeOrder" | "rangeLong" | "noSemester" | "semesterEnded">>;

const isInt = (s: string) => /^\d+$/.test(s.trim());

/** Error message keys (under freeTime.errors) per invalid field; an empty object means the query can be sent. */
export function validate(form: FreeTimeForm, range: Range | null, semesterReason: "noSemester" | "semesterEnded" = "semesterEnded"): FreeTimeErrors {
  const errors: FreeTimeErrors = {};
  if (!form.from || !form.to || form.from >= form.to) errors.time = "timeOrder";
  const buffer = form.buffer.trim();
  if (!isInt(buffer) || Number(buffer) > MAX_BUFFER) errors.buffer = "buffer";
  if (form.useMinFree && (!isInt(form.minFree) || Number(form.minFree) < 1 || Number(form.minFree) > 1440)) errors.minFree = "minFree";
  if (form.weekdays.length === 0) errors.weekdays = "weekdays";
  if (!range) errors.range = form.period.unit === "semester" ? semesterReason : "dates";
  else if (range.end < range.start) errors.range = "rangeOrder";
  else if (daysBetween(range.start, range.end) > MAX_DAYS) errors.range = "rangeLong";
  return errors;
}

export function buildQuery(form: FreeTimeForm, range: Range): string {
  const q = new URLSearchParams({
    from: form.from, to: form.to, start: range.start, end: range.end,
    weekdays: [...form.weekdays].sort((a, b) => a - b).join(","), buffer: String(Number(form.buffer.trim())),
  });
  if (form.useMinFree) q.set("min_free", String(Number(form.minFree.trim())));
  return q.toString();
}

const LEGACY_PERIODS: Record<string, Period> = {
  week: { unit: "week", offset: 0 }, nextWeek: { unit: "week", offset: 1 },
  month: { unit: "month", offset: 0 }, nextMonth: { unit: "month", offset: 1 },
  semester: { unit: "semester", offset: 0 }, custom: { unit: "custom", offset: 0 },
};
const UNITS: PeriodUnit[] = ["day", "week", "month", "semester", "custom"];

/** Accepts the current shape and the old string values; anything else is rejected. */
function parsePeriod(raw: unknown): Period | null {
  if (typeof raw === "string") return Object.prototype.hasOwnProperty.call(LEGACY_PERIODS, raw) ? { ...LEGACY_PERIODS[raw] } : null;
  if (raw && typeof raw === "object") {
    const { unit, offset } = raw as { unit?: unknown; offset?: unknown };
    if (UNITS.includes(unit as PeriodUnit) && typeof offset === "number" && Number.isInteger(offset)) return { unit: unit as PeriodUnit, offset };
  }
  return null;
}

export function loadForm(today: string): FreeTimeForm {
  const base = defaultForm(today);
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<FreeTimeForm> | null;
    if (!raw || typeof raw !== "object") return base;
    return {
      from: typeof raw.from === "string" ? raw.from : base.from,
      to: typeof raw.to === "string" ? raw.to : base.to,
      period: parsePeriod(raw.period) ?? base.period,
      customStart: typeof raw.customStart === "string" ? raw.customStart : base.customStart,
      customEnd: typeof raw.customEnd === "string" ? raw.customEnd : base.customEnd,
      weekdays: Array.isArray(raw.weekdays) && raw.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ? raw.weekdays : base.weekdays,
      buffer: typeof raw.buffer === "string" ? raw.buffer : base.buffer,
      useMinFree: raw.useMinFree === true,
      minFree: typeof raw.minFree === "string" ? raw.minFree : base.minFree,
    };
  } catch {
    return base;
  }
}

export function saveForm(form: FreeTimeForm): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  } catch {
    // storage blocked: the query simply is not remembered
  }
}
