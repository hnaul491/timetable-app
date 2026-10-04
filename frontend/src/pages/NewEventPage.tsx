import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useT, type MessageKey } from "../i18n";
import { apiFetch } from "../lib/api";
import { calendarHref } from "../lib/calendarLocation";
import { addDays, parisLocalToUtc, todayParis, weekdayIndex } from "../lib/time";
import type { CustomKind } from "../types";

const WEEKDAYS: MessageKey[] = ["event.weekdays.mon", "event.weekdays.tue", "event.weekdays.wed", "event.weekdays.thu", "event.weekdays.fri", "event.weekdays.sat", "event.weekdays.sun"];
const field = "h-10 rounded-xl border border-line-strong bg-surface px-3 text-sm";
const labelCls = "flex flex-col gap-1.5 text-sm font-semibold text-ink-2";

export function NewEventPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const today = todayParis();
  const [form, setForm] = useState({
    title: "",
    kind: "work" as CustomKind,
    date: today,
    start: "09:00",
    end: "10:00",
    room: "",
    repeat: false,
    weekdays: [weekdayIndex(today)],
    until: addDays(today, 84),
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const create = useMutation({
    mutationFn: () =>
      form.repeat
        ? apiFetch("/api/recurring", {
            method: "POST",
            body: JSON.stringify({
              title: form.title.trim(),
              kind: form.kind,
              weekdays: [...form.weekdays].sort((a, b) => a - b),
              start_time: form.start,
              end_time: form.end,
              from_date: form.date,
              until_date: form.until,
              location: form.room.trim(),
            }),
          })
        : apiFetch("/api/events", {
            method: "POST",
            body: JSON.stringify({
              title: form.title.trim(),
              kind: form.kind,
              start: parisLocalToUtc(form.date, form.start),
              end: parisLocalToUtc(form.end > form.start ? form.date : addDays(form.date, 1), form.end),
              room: form.room.trim(),
            }),
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      navigate(calendarHref());
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return setError(t("event.errTitle"));
    if (!form.date || !form.start || !form.end) return setError(t("event.errTimes"));
    if (form.repeat && !form.until) return setError(t("event.errUntil"));
    if (form.start === form.end) return setError(t("event.errSameTime"));
    if (form.repeat && form.weekdays.length === 0) return setError(t("event.errWeekday"));
    if (form.repeat && form.until < form.date) return setError(t("event.errUntilBefore"));
    if (form.repeat && form.until > addDays(form.date, 400)) return setError(t("event.errTooLong"));
    setError(null);
    create.mutate();
  };

  const toggleDay = (day: number) =>
    set({ weekdays: form.weekdays.includes(day) ? form.weekdays.filter((d) => d !== day) : [...form.weekdays, day] });

  return (
    <div className="flex flex-col gap-4">
      <Link to={calendarHref()} className="text-sm font-semibold text-accent">
        {t("event.backToCalendar")}
      </Link>
      <form onSubmit={submit} className="flex max-w-xl flex-col gap-4 rounded-2xl border border-line bg-surface p-5 md:p-7">
        <h1 className="text-2xl font-bold tracking-tight">{t("event.newTitle")}</h1>
        <label className={labelCls}>
          {t("event.fieldTitle")}
          <input className={field} value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
        </label>
        <label className={labelCls}>
          {t("event.fieldType")}
          <select className={field} value={form.kind} onChange={(e) => set({ kind: e.target.value as CustomKind })}>
            <option value="work">{t("event.kindWork")}</option>
            <option value="french_ext">{t("event.kindFrench")}</option>
            <option value="other">{t("event.kindOtherOption")}</option>
          </select>
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className={labelCls}>
            {t("event.fieldDate")}
            <input type="date" className={field} value={form.date} onChange={(e) => set(e.target.value ? { date: e.target.value, weekdays: [weekdayIndex(e.target.value)] } : { date: "" })} />
          </label>
          <label className={labelCls}>
            {t("event.fieldStart")}
            <input type="time" className={field} value={form.start} onChange={(e) => set({ start: e.target.value })} />
          </label>
          <label className={labelCls}>
            {t("event.fieldEnd")}
            <input type="time" className={field} value={form.end} onChange={(e) => set({ end: e.target.value })} />
          </label>
        </div>
        <label className={labelCls}>
          {t("event.fieldPlace")}
          <input className={field} value={form.room} onChange={(e) => set({ room: e.target.value })} maxLength={200} />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={form.repeat} onChange={(e) => set({ repeat: e.target.checked })} />
          {t("event.repeatWeekly")}
        </label>
        {form.repeat && (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1.5 text-sm font-semibold text-ink-2">{t("event.repeatOn")}</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((name, day) => (
                <label key={name} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm">
                  <input type="checkbox" checked={form.weekdays.includes(day)} onChange={() => toggleDay(day)} />
                  {t(name)}
                </label>
              ))}
            </div>
            <label className={labelCls}>
              {t("event.until")}
              <input type="date" className={field} value={form.until} onChange={(e) => set({ until: e.target.value })} />
            </label>
          </fieldset>
        )}
        {(error || create.error) && <p className="text-sm text-danger">{error ?? (create.error as Error).message}</p>}
        <button type="submit" disabled={create.isPending} className="h-11 rounded-xl bg-accent text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-50">
          {t("event.saveEvent")}
        </button>
      </form>
    </div>
  );
}
