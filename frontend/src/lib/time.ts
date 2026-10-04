import { INTL_LOCALE, type Locale } from "../i18n/locale";

export const TZ = "Europe/Paris";

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const offsetFormat = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" });

export interface ParisParts {
  date: string;
  minutes: number;
}

export function parisParts(iso: string): ParisParts {
  const p = Object.fromEntries(partsFormat.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function formatTime(iso: string): string {
  const { minutes } = parisParts(iso);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function offsetMinutes(utcMs: number): number {
  const name = offsetFormat.formatToParts(new Date(utcMs)).find((x) => x.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return 0;
  const total = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -total : total;
}

function utcNoon(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function parisMidnightUtc(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d);
  const firstGuess = naive - offsetMinutes(naive) * 60_000;
  return new Date(naive - offsetMinutes(firstGuess) * 60_000).toISOString();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function startOfWeek(date: string): string {
  const mondayIndex = (utcNoon(date).getUTCDay() + 6) % 7;
  return addDays(date, -mondayIndex);
}

export function todayParis(now: Date = new Date()): string {
  return parisParts(now.toISOString()).date;
}

export function rangeUtc(firstDate: string, days: number): { start: string; end: string } {
  return { start: parisMidnightUtc(firstDate), end: parisMidnightUtc(addDays(firstDate, days)) };
}

export function dayLabel(date: string, locale: Locale = "en"): { weekday: string; day: string } {
  const dt = utcNoon(date);
  return { weekday: dt.toLocaleDateString(INTL_LOCALE[locale], { weekday: "short", timeZone: "UTC" }), day: String(dt.getUTCDate()) };
}

export function formatLongDate(date: string, locale: Locale = "en"): string {
  return utcNoon(date).toLocaleDateString(INTL_LOCALE[locale], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function parisLocalToUtc(date: string, hhmm: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const firstGuess = naive - offsetMinutes(naive) * 60_000;
  return new Date(naive - offsetMinutes(firstGuess) * 60_000).toISOString();
}

export function weekdayIndex(date: string): number {
  return (utcNoon(date).getUTCDay() + 6) % 7;
}
