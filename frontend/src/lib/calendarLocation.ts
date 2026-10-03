const KEY = "timetable:calendar-search";

/** Remember which week/view the calendar showed, so "Back to calendar" returns there. */
export function rememberCalendarSearch(search: string): void {
  try {
    sessionStorage.setItem(KEY, search);
  } catch {
    // storage blocked: "Back to calendar" falls back to today
  }
}

export function calendarHref(): string {
  try {
    return `/${sessionStorage.getItem(KEY) ?? ""}`;
  } catch {
    return "/";
  }
}
