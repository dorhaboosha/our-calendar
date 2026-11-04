// The calendar's view and date in the page URL (?view=week&date=2026-11-05), so a
// refresh or a shared link opens the same place. Anything invalid falls back to the
// defaults: today, in month view on a computer or day view on a phone.

import { type LocalDate, isLocalDate } from "@/modules/events/time";

export const CALENDAR_VIEWS = {
  month: "dayGridMonth",
  week: "timeGridWeek",
  day: "timeGridDay",
} as const;

export type CalendarViewName = keyof typeof CALENDAR_VIEWS;
export type FullCalendarView = (typeof CALENDAR_VIEWS)[CalendarViewName];

/** Screens up to this width count as phones and open in day view. */
export const PHONE_MAX_WIDTH = 640;

export type CalendarPlace = {
  view: CalendarViewName;
  /** null: today. */
  date: LocalDate | null;
};

function isViewName(value: string | null): value is CalendarViewName {
  return value !== null && Object.hasOwn(CALENDAR_VIEWS, value);
}

export function defaultView(isPhone: boolean): CalendarViewName {
  return isPhone ? "day" : "month";
}

export function readCalendarPlace(search: string, isPhone: boolean): CalendarPlace {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  const date = params.get("date");
  return {
    view: isViewName(view) ? view : defaultView(isPhone),
    date: date && isLocalDate(date) ? date : null,
  };
}

/** The URL query for a place; other parameters in `search` are kept. */
export function writeCalendarPlace(search: string, place: Required<CalendarPlace>): string {
  const params = new URLSearchParams(search);
  params.set("view", place.view);
  if (place.date) params.set("date", place.date);
  else params.delete("date");
  return `?${params}`;
}

/** The URL name of a FullCalendar view type, or null for a view we don't offer. */
export function viewNameOf(fullCalendarView: string): CalendarViewName | null {
  const entry = Object.entries(CALENDAR_VIEWS).find(([, type]) => type === fullCalendarView);
  return entry ? (entry[0] as CalendarViewName) : null;
}
