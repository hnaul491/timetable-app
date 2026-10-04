import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useT, type MessageKey } from "../i18n";
import { apiFetch } from "../lib/api";
import { invalidateTaskViews } from "../lib/invalidate";
import { useShortcut } from "../lib/shortcuts";
import { addDays, parisLocalToUtc, todayParis, weekdayIndex } from "../lib/time";
import type { CustomKind } from "../types";

const WEEKDAYS: MessageKey[] = ["event.weekdays.mon", "event.weekdays.tue", "event.weekdays.wed", "event.weekdays.thu", "event.weekdays.fri", "event.weekdays.sat", "event.weekdays.sun"];
const field = "h-10 rounded-xl border border-line-strong bg-surface px-3 text-sm";
const labelCls = "flex flex-col gap-1.5 text-sm font-semibold text-ink-2";

export interface FormValues {
  title: string;
  kind: CustomKind;
  date: string;
  start: string;
  end: string;
  room: string;
  repeat: boolean;
  weekdays: number[];
  until: string;
}

interface Props {
  initial?: Partial<FormValues>;
  /** When set, the form edits that custom event instead of creating one. */
  eventId?: number;
  /** The id of the saved event, or null when a weekly rule was created (it makes many events). */
  onDone: (eventId: number | null) => void;
  onCancel?: () => void;
}

export function EventForm({ initial, eventId, onDone, onCancel }: Props) {
  const t = useT();
  const queryClient = useQueryClient();
  const editing = eventId !== undefined;
  const [form, setForm] = useState<FormValues>(() => {
    const date = initial?.date ?? todayParis();
    return {
      title: "",
      kind: "work",
      date,
      start: "09:00",
      end: "10:00",
      room: "",
      repeat: false,
      weekdays: [weekdayIndex(date)],
      until: addDays(date, 84),
      ...initial,
    };
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FormValues>) => setForm((f) => ({ ...f, ...patch }));

  const save = useMutation({
    mutationFn: async (): Promise<number | null> => {
      if (form.repeat && !editing) {
        await apiFetch("/api/recurring", {
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
        });
        return null;
      }
      const saved = await apiFetch<{ id?: number }>(editing ? `/api/events/${eventId}` : "/api/events", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          kind: form.kind,
          start: parisLocalToUtc(form.date, form.start),
          end: parisLocalToUtc(form.end > form.start ? form.date : addDays(form.date, 1), form.end),
          room: form.room.trim(),
        }),
      });
      return saved?.id ?? eventId ?? null;
    },
    onSuccess: (id) => {
      invalidateTaskViews(queryClient);
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      onDone(id);
    },
  });

  const submit = () => {
    if (save.isPending) return;
    if (!form.title.trim()) return setError(t("event.errTitle"));
    if (!form.date || !form.start || !form.end) return setError(t("event.errTimes"));
    const repeat = form.repeat && !editing;
    if (repeat && !form.until) return setError(t("event.errUntil"));
    if (form.start === form.end) return setError(t("event.errSameTime"));
    if (repeat && form.weekdays.length === 0) return setError(t("event.errWeekday"));
    if (repeat && form.until < form.date) return setError(t("event.errUntilBefore"));
    if (repeat && form.until > addDays(form.date, 400)) return setError(t("event.errTooLong"));
    setError(null);
    save.mutate();
  };
  useShortcut("form-save", "Mod+s", submit, { inDialog: true, label: "shortcuts.save" });

  const toggleDay = (day: number) =>
    set({ weekdays: form.weekdays.includes(day) ? form.weekdays.filter((d) => d !== day) : [...form.weekdays, day] });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <label className={labelCls}>
        {t("event.fieldTitle")}
        <input data-autofocus className={field} value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
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
      {!editing && (
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={form.repeat} onChange={(e) => set({ repeat: e.target.checked })} />
          {t("event.repeatWeekly")}
        </label>
      )}
      {form.repeat && !editing && (
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
      {(error || save.error) && <p role="alert" className="text-sm text-danger">{error ?? t("event.saveFailed", { message: (save.error as Error).message })}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={save.isPending} className="h-11 flex-1 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-50">
          {t("event.saveEvent")}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-11 rounded-xl border border-line px-4 text-sm font-semibold text-ink-2">
            {t("common.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
