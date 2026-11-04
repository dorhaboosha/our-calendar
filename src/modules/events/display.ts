// How an event's time reads in its details: dates in words, times in 24-hour format,
// all in the calendar's time zone.

import type { CalendarEvent } from "./events";
import { type LocalDate, exclusiveEndToLastDay, toLocal } from "./time";

export type EventWhen = {
  /** "יום חמישי, 5 בנובמבר 2026", or a range of dates. */
  dates: string;
  /** "10:00–11:00" for an event within one day; null otherwise. */
  times: string | null;
};

function formatDate(date: LocalDate, locale: string, withWeekday: boolean): string {
  // A date-only value: formatted at UTC midnight, in UTC, so it never shifts a day.
  return new Intl.DateTimeFormat(locale, {
    ...(withWeekday && { weekday: "long" }),
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function describeWhen(
  event: Pick<CalendarEvent, "isAllDay" | "start" | "end">,
  timeZone: string,
  locale: string,
): EventWhen {
  if (event.isAllDay) {
    const lastDay = exclusiveEndToLastDay(event.end);
    return lastDay === event.start
      ? { dates: formatDate(event.start, locale, true), times: null }
      : {
          dates: `${formatDate(event.start, locale, false)} – ${formatDate(lastDay, locale, false)}`,
          times: null,
        };
  }
  const start = toLocal(new Date(event.start), timeZone);
  const end = toLocal(new Date(event.end), timeZone);
  if (start.date === end.date) {
    return { dates: formatDate(start.date, locale, true), times: `${start.time}–${end.time}` };
  }
  // Across midnight or several days: each end with its own date.
  return {
    dates: `${formatDate(start.date, locale, false)}, ${start.time} – ${formatDate(end.date, locale, false)}, ${end.time}`,
    times: null,
  };
}
