import { useMemo, type CSSProperties } from "react";
import { layoutDay, type Span } from "../lib/layout";
import { dayLabel, formatTime, parisParts, todayParis } from "../lib/time";
import type { ApiEvent } from "../types";

interface Props {
  days: string[];
  events: ApiEvent[];
  hourHeight?: number;
  onSelect?: (id: number) => void;
}

type Timed = ApiEvent & Span;

const DAY_MIN = 24 * 60;

function bounds(timed: Timed[]): [number, number] {
  let first = 8;
  let last = 21;
  for (const t of timed) {
    first = Math.min(first, Math.floor(t.startMin / 60));
    last = Math.max(last, Math.ceil(t.endMin / 60));
  }
  return [first, last];
}

export function WeekGrid({ days, events, hourHeight = 52, onSelect }: Props) {
  const today = todayParis();
  const { byDay, holidays, firstHour, lastHour } = useMemo(() => {
    const byDay = new Map<string, Timed[]>(days.map((d) => [d, []]));
    const holidays = new Map<string, string[]>();
    for (const ev of events) {
      const start = parisParts(ev.start);
      if (ev.kind === "holiday") {
        holidays.set(start.date, [...(holidays.get(start.date) ?? []), ev.title]);
        continue;
      }
      const end = parisParts(ev.end);
      byDay.get(start.date)?.push({ ...ev, startMin: start.minutes, endMin: end.date === start.date ? end.minutes : DAY_MIN });
    }
    const [firstHour, lastHour] = bounds([...byDay.values()].flat());
    return { byDay, holidays, firstHour, lastHour };
  }, [days, events]);

  const height = (lastHour - firstHour) * hourHeight;
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const columns = `56px repeat(${days.length}, minmax(${days.length > 1 ? 110 : 0}px, 1fr))`;

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white">
      <div className="grid" style={{ gridTemplateColumns: columns }}>
        <div className="border-b border-line" />
        {days.map((date) => {
          const label = dayLabel(date);
          const isToday = date === today;
          return (
            <div key={date} className="flex flex-wrap items-center gap-2 border-b border-l border-line px-2 py-2.5">
              <span className="text-xs font-semibold tracking-wide text-muted uppercase">{label.weekday}</span>
              <span className={`flex size-[30px] items-center justify-center rounded-full text-[15px] font-bold ${isToday ? "bg-accent text-white" : ""}`}>
                {label.day}
              </span>
              {(holidays.get(date) ?? []).map((name) => (
                <span key={name} className="rounded-full bg-[#F0F1F4] px-2 py-0.5 text-[11px] font-semibold text-[#3A3F4B]">
                  {name}
                </span>
              ))}
            </div>
          );
        })}
        <div className="relative" style={{ height }}>
          {hours.map((h) => (
            <div key={h} className="absolute right-2 font-mono text-[11px] text-muted" style={{ top: (h - firstHour) * hourHeight + 2 }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {days.map((date) => (
          <div
            key={date}
            className="relative border-l border-[#EEF0F3]"
            style={{
              height,
              backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${hourHeight - 1}px, #EEF0F3 ${hourHeight - 1}px, #EEF0F3 ${hourHeight}px)`,
            }}
          >
            {layoutDay(byDay.get(date) ?? []).map(({ item, column, columns: count }) => (
              <EventBlock
                key={item.id}
                ev={item}
                column={column}
                columns={count}
                onSelect={onSelect}
                style={{
                  top: ((item.startMin - firstHour * 60) / 60) * hourHeight + 2,
                  height: ((item.endMin - item.startMin) / 60) * hourHeight - 4,
                  left: `calc(${(column / count) * 100}% + 3px)`,
                  width: `calc(${100 / count}% - 6px)`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const KIND_COLORS: Partial<Record<ApiEvent["kind"], string>> = { work: "#3B4252", french_ext: "#0E7F72" };

function EventBlock({
  ev,
  style,
  column,
  columns,
  onSelect,
}: {
  ev: ApiEvent;
  style: CSSProperties;
  column: number;
  columns: number;
  onSelect?: (id: number) => void;
}) {
  const color = ev.color ?? KIND_COLORS[ev.kind] ?? "#3B4252";
  const title = ev.section ? `${ev.title} ${ev.section}` : ev.title;
  const label = `${title}, ${formatTime(ev.start)} to ${formatTime(ev.end)}${ev.room ? `, ${ev.room}` : ""}`;
  const outline = ev.kind === "french_ext" ? { border: `1.5px dashed ${color}`, background: "#FFFFFF" } : { background: `${color}1F` };
  return (
    <div
      role="group"
      aria-label={label}
      data-column={column}
      data-columns={columns}
      data-kind={ev.kind}
      className={`absolute flex flex-col gap-0.5 overflow-hidden rounded-lg px-2 py-1.5 text-xs ${ev.status === "cancelled" ? "line-through opacity-60" : ""}`}
      style={{ ...style, ...outline, ...(ev.important ? { boxShadow: "inset 3px 0 0 #EA580C" } : {}) }}
    >
      {onSelect && (
        <button
          type="button"
          aria-label={`Open ${title}`}
          className="absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => onSelect(ev.id)}
        />
      )}
      <span className="flex items-center gap-1.5 leading-tight font-bold">
        <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
        {ev.important && (
          <span role="img" aria-label="Important" className="shrink-0 text-[13px] leading-none text-[#EA580C]">
            ★
          </span>
        )}
        {ev.title}
        {ev.section ? ` · ${ev.section}` : ""}
      </span>
      <span className="font-mono text-[10.5px] text-[#3A3F4B]">
        {formatTime(ev.start)}–{formatTime(ev.end)}
      </span>
      {ev.room && <span className="text-[11px] text-[#3A3F4B]">{ev.room}</span>}
      <span className="flex flex-wrap gap-1">
        {ev.kind === "exam" && <span className="rounded-full bg-[#8B1A1A] px-1.5 text-[10.5px] font-bold text-white">Exam</span>}
        {ev.status === "changed" && <span className="rounded-full bg-[#9A3412] px-1.5 text-[10.5px] font-bold text-white">Changed</span>}
        {ev.note_count > 0 && <span className="rounded-full bg-white px-1.5 text-[10.5px] font-semibold">Note</span>}
        {ev.open_tasks > 0 && (
          <span className="rounded-full bg-white px-1.5 text-[10.5px] font-semibold">
            {ev.open_tasks} {ev.open_tasks === 1 ? "task" : "tasks"}
          </span>
        )}
      </span>
    </div>
  );
}
