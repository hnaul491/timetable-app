import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Banner, ErrorPanel, MissingSectionsBanner } from "../components/Banners";
import { Skeleton } from "../components/ui/Skeleton";
import { useLocale, useT, type MessageKey } from "../i18n";
import { INTL_LOCALE } from "../i18n/locale";
import { apiFetch } from "../lib/api";
import {
  BUFFER_PRESETS, buildQuery, computeRange, loadForm, saveForm, validate,
  type FreeDay, type FreeTimeForm, type FreeTimeResult, type Period, type Range,
} from "../lib/freeTime";
import { formatTime, todayParis } from "../lib/time";
import type { Semester } from "../types";

const DEBOUNCE_MS = 300;
const PERIODS: Period[] = ["week", "month", "semester", "custom"];
const MONDAY = "2024-01-01"; // a Monday, used only to get localized weekday names

const fieldClass = "h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[13px] font-semibold text-ink tabular-nums";
const labelClass = "flex flex-col gap-1 text-xs font-bold text-muted";
const chipClass = (on: boolean) =>
  `h-9 rounded-[9px] border px-2.5 text-xs font-bold ${on ? "border-accent bg-accent text-on-accent" : "border-line bg-surface text-ink-2 hover:bg-surface-2"}`;

const CELL_STYLE: Record<FreeDay["status"], string> = {
  free: "bg-success-soft text-success",
  partial: "bg-warn-soft text-warn",
  busy: "bg-subtle text-muted",
  off: "border-dashed border-line bg-transparent text-muted opacity-60",
  unknown: "border-dashed border-line bg-transparent text-muted",
};
const LEGEND_DOT: Record<FreeDay["status"], string> = {
  free: "bg-success", partial: "bg-warn", busy: "bg-line-strong", off: "border border-dashed border-muted", unknown: "border border-dashed border-warn",
};

function weekdayName(index: number, locale: "en" | "vi", style: "short" | "long"): string {
  const date = new Date(Date.UTC(2024, 0, 1 + index, 12));
  return date.toLocaleDateString(INTL_LOCALE[locale], { weekday: style, timeZone: "UTC" });
}

function Field({ label, error, children }: { label: string; error?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className={labelClass}>
        {label}
        {children}
      </label>
      {error}
    </div>
  );
}

export function FreeTimePage() {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const [today, setToday] = useState(() => todayParis());
  const [form, setForm] = useState<FreeTimeForm>(() => loadForm(today));
  const [focused, setFocused] = useState<string | null>(null);
  const set = (patch: Partial<FreeTimeForm>) => setForm((f) => ({ ...f, ...patch }));

  const semesters = useQuery({ queryKey: ["semesters"], queryFn: () => apiFetch<Semester[]>("/api/semesters") });
  const activeSemester = semesters.data?.find((s) => s.is_active);
  const semesterEnd = activeSemester?.end_date ?? null;
  const semesterPending = form.period === "semester" && semesters.isPending;

  const range = computeRange(form, today, semesterEnd);
  const errors = validate(form, range, activeSemester ? "semesterEnded" : "noSemester");
  const valid = Object.keys(errors).length === 0 && !semesterPending && range !== null;
  const queryString = valid ? buildQuery(form, range as Range) : null;

  useEffect(() => saveForm(form), [form]);

  // A tab left open past midnight must not keep yesterday's "this week / this month / rest of semester".
  useEffect(() => {
    const refresh = () => setToday(todayParis());
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Typing fires on every keystroke; only the value that stays for 300 ms is sent.
  const [debounced, setDebounced] = useState<string | null>(queryString);
  useEffect(() => {
    if (queryString === null) {
      setDebounced(null);
      return;
    }
    const timer = setTimeout(() => setDebounced(queryString), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [queryString]);

  const result = useQuery({
    queryKey: ["free-time", debounced],
    queryFn: () => apiFetch<FreeTimeResult>(`/api/free-time?${debounced}`),
    enabled: debounced !== null && valid,
    placeholderData: keepPreviousData,
  });
  const data = valid && debounced !== null ? result.data : undefined;

  const err = (key: keyof typeof errors) =>
    errors[key] ? <span role="alert" className="max-w-64 text-xs font-medium text-danger">{t(`freeTime.errors.${errors[key]}` as MessageKey)}</span> : null;
  const bufferValue = form.buffer.trim();

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold tracking-tight">{t("freeTime.title")}</h1>

      <form className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-xl border border-line bg-surface-2 p-3.5" onSubmit={(e) => e.preventDefault()}>
        <Field label={t("freeTime.from")} error={err("time")}>
          <input type="time" value={form.from} onChange={(e) => set({ from: e.target.value })} className={fieldClass} />
        </Field>
        <Field label={t("freeTime.to")}>
          <input type="time" value={form.to} onChange={(e) => set({ to: e.target.value })} className={fieldClass} />
        </Field>
        <Field label={t("freeTime.period")} error={form.period === "custom" ? null : err("range")}>
          <select value={form.period} onChange={(e) => set({ period: e.target.value as Period })} className={fieldClass}>
            {PERIODS.map((p) => (
              <option key={p} value={p}>{t(`freeTime.periods.${p}` as MessageKey)}</option>
            ))}
          </select>
        </Field>
        {form.period === "custom" && (
          <>
            <Field label={t("freeTime.customStart")}>
              <input type="date" value={form.customStart} onChange={(e) => set({ customStart: e.target.value })} className={fieldClass} />
            </Field>
            <Field label={t("freeTime.customEnd")} error={err("range")}>
              <input type="date" value={form.customEnd} onChange={(e) => set({ customEnd: e.target.value })} className={fieldClass} />
            </Field>
          </>
        )}
        <div className={labelClass} role="group" aria-label={t("freeTime.weekdays")}>
          {t("freeTime.weekdays")}
          <div className="flex gap-1">
            {Array.from({ length: 7 }, (_, i) => {
              const on = form.weekdays.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  aria-label={weekdayName(i, locale, "long")}
                  onClick={() => set({ weekdays: on ? form.weekdays.filter((d) => d !== i) : [...form.weekdays, i] })}
                  className={`min-w-10 ${chipClass(on)}`}
                >
                  {weekdayName(i, locale, "short")}
                </button>
              );
            })}
          </div>
          {err("weekdays")}
        </div>
        <div className={labelClass} role="group" aria-label={t("freeTime.buffer")}>
          {t("freeTime.buffer")}
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="number" inputMode="numeric" min={0} max={240} step={5}
              aria-label={t("freeTime.buffer")} value={form.buffer}
              aria-invalid={errors.buffer ? true : undefined}
              onChange={(e) => set({ buffer: e.target.value })}
              className={`w-20 ${fieldClass}`}
            />
            <span className="text-xs font-semibold text-ink-2">{t("freeTime.bufferUnit")}</span>
            {BUFFER_PRESETS.map((n) => (
              <button key={n} type="button" aria-pressed={bufferValue === String(n)} onClick={() => set({ buffer: String(n) })} className={chipClass(bufferValue === String(n))}>
                {n === 0 ? t("freeTime.bufferNone") : n}
              </button>
            ))}
          </div>
          {err("buffer")}
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex h-9 items-center gap-2 text-[13px] font-semibold text-ink-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.useMinFree} onChange={(e) => set({ useMinFree: e.target.checked })} />
              {t("freeTime.minFreeBefore")}
            </label>
            <input
              type="number" inputMode="numeric" min={1} max={1440} aria-label={t("freeTime.minFreeInput")}
              value={form.minFree} disabled={!form.useMinFree} aria-invalid={errors.minFree ? true : undefined}
              onChange={(e) => set({ minFree: e.target.value })} className={`w-20 ${fieldClass}`}
            />
            <span>{t("freeTime.minFreeAfter")}</span>
          </div>
          {err("minFree")}
        </div>
      </form>

      {valid && result.error && !data ? (
        <ErrorPanel error={result.error} onRetry={() => result.refetch()} />
      ) : !valid ? null : !data ? (
        <div role="status" aria-label={t("freeTime.loading")} className="flex flex-col gap-3">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <Results
          data={data} form={form} range={range as Range}
          focused={focused} onFocus={setFocused}
          onOpen={(date) => navigate(`/?date=${date}`)}
          retry={result.error ? <ErrorPanel error={result.error} onRetry={() => result.refetch()} /> : null}
        />
      )}
    </div>
  );
}

function Results({ data, form, range, focused, onFocus, onOpen, retry }: {
  data: FreeTimeResult; form: FreeTimeForm; range: Range; focused: string | null;
  onFocus: (date: string | null) => void; onOpen: (date: string) => void; retry: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const intl = INTL_LOCALE[locale];
  const longDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(intl, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const cellDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(intl, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const monthName = new Date(`${data.start}T12:00:00Z`).toLocaleDateString(intl, { month: "long", year: "numeric", timeZone: "UTC" });

  // The sentence describes the response; the form may already have moved on while a new answer loads.
  const samePeriod = data.start === range.start && data.end === range.end;
  const summary =
    t("freeTime.summaryWindow", { from: data.window.from, to: data.window.to }) +
    t(`freeTime.summaryPeriod.${samePeriod ? form.period : "custom"}` as MessageKey, { month: monthName, start: longDate(data.start), end: longDate(data.end) }) +
    (data.buffer > 0 ? t("freeTime.summaryBuffer", { minutes: data.buffer }) : "") +
    (data.min_free ? t("freeTime.summaryMinFree", { minutes: data.min_free }) : "") +
    ".";

  const detail = (day: FreeDay): string => {
    const head = cellDate(day.date);
    if (day.status === "off") return `${head} · ${t("freeTime.detailOff")}`;
    if (day.status === "unknown") return `${head} · ${t("freeTime.detailUnknown")}`;
    if (day.status === "free") return `${head} · ${t("freeTime.detailFree", { from: data.window.from, to: data.window.to })}`;
    const parts = day.blockers.map(
      (b) => `${b.title} ${formatTime(b.start)}–${formatTime(b.end)}${data.buffer > 0 ? ` (${t("freeTime.detailTravel", { minutes: data.buffer })})` : ""}`,
    );
    if (day.longest_free > 0) parts.push(t("freeTime.detailFreeMinutes", { minutes: day.longest_free }));
    return `${head} · ${parts.join(", ")}`;
  };
  const focusedDay = data.days.find((d) => d.date === focused);
  const lead = data.days[0]?.weekday ?? 0;
  const label = (day: FreeDay) =>
    day.status === "free" ? t("freeTime.cell.free")
    : day.status === "partial" ? t("freeTime.cell.partialShort", { minutes: day.longest_free })
    : day.status === "busy" ? t("freeTime.cell.busy")
    : day.status === "unknown" ? "?"
    : "";
  const ariaStatus = (day: FreeDay) =>
    day.status === "partial" ? t("freeTime.cell.partialLabel", { minutes: day.longest_free })
    : day.status === "off" ? t("freeTime.legend.off")
    : day.status === "unknown" ? t("freeTime.cell.unknownLabel")
    : label(day);
  const checked = data.counted_days - data.uncovered_days;

  return (
    <>
      {retry}
      {data.semester === null ? (
        <Banner tone="warn">
          {t("freeTime.notice.noSemesterBefore")}{" "}
          <Link to="/settings/school" className="font-semibold underline">{t("freeTime.notice.noSemesterLink")}</Link>.
        </Banner>
      ) : data.uncovered_days > 0 ? (
        <Banner tone="warn">{t("freeTime.notice.outside", { count: data.uncovered_days, name: data.semester.name })}</Banner>
      ) : null}
      <MissingSectionsBanner names={data.missing_sections.map((m) => m.name)} />
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div className="text-[40px] font-extrabold leading-tight tracking-tight tabular-nums max-md:text-[32px]" data-testid="free-big">
          <span>{data.free_days}</span> <small className="text-lg font-bold text-muted">{t("freeTime.daysOf", { total: checked })}</small>
        </div>
        <p className="max-w-[60ch] text-ink-2">{summary}</p>
      </div>
      <div className="grid items-start gap-4 md:grid-cols-[300px_1fr]">
        <section className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-line p-3.5">
          <h2 className="text-[13px] font-extrabold uppercase tracking-wider text-muted">{t("freeTime.byWeekday")}</h2>
          {data.by_weekday.filter((w) => w.total > 0).map((w) => (
            <div key={w.weekday} className="grid grid-cols-[40px_1fr_44px] items-center gap-2 text-[13px] tabular-nums" data-testid={`wd-${w.weekday}`}>
              <span>{weekdayName(w.weekday, locale, "short")}</span>
              <div className="h-2.5 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
                <i className="block h-full rounded-full bg-success motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${(w.free / w.total) * 100}%` }} />
              </div>
              <span className="text-right text-ink-2">{w.free}/{w.total}</span>
            </div>
          ))}
        </section>
        <section className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-line p-3.5">
          <h2 className="text-[13px] font-extrabold uppercase tracking-wider text-muted">{t("freeTime.dayByDay")}</h2>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="text-center text-[11px] font-bold text-muted">{weekdayName(i, locale, "short")}</div>
            ))}
            {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} aria-hidden="true" />)}
            {data.days.map((day) => (
              <button
                key={day.date}
                type="button"
                data-status={day.status}
                aria-label={t("freeTime.cellLabel", { date: cellDate(day.date), status: ariaStatus(day) })}
                onClick={() => onOpen(day.date)}
                onMouseEnter={() => onFocus(day.date)}
                onFocus={() => onFocus(day.date)}
                className={`flex aspect-[1.15] min-w-0 flex-col justify-between rounded-[9px] border border-transparent p-1.5 text-left text-[11px] tabular-nums hover:border-ink-2 focus-visible:border-ink-2 ${CELL_STYLE[day.status]}`}
              >
                <b className="text-xs">{Number(day.date.slice(8))}</b>
                <span>{label(day)}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-ink-2">
            {(["free", "partial", "busy", "off", "unknown"] as const).map((s) => (
              <span key={s}>
                <i className={`mr-1.5 inline-block size-2.5 rounded-[3px] align-[-1px] ${LEGEND_DOT[s]}`} />
                {t(`freeTime.legend.${s}` as MessageKey)}
              </span>
            ))}
          </div>
          <p aria-live="polite" data-testid="free-detail" className="min-h-10 border-t border-line pt-2.5 text-[13px] text-ink-2">
            {focusedDay ? detail(focusedDay) : t("freeTime.detailHint")}
          </p>
        </section>
      </div>
    </>
  );
}
