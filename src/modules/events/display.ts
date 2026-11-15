// How an event's time reads in its details: dates in words, times in 24-hour format,
// all in the calendar's time zone; and how a repeating event repeats.

import type { CalendarEvent } from "./events";
import { type Frequency, type Weekday, fromRRule } from "./recurrence";
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

/** The parts of a series' description in the event's details; the UI words them. */
export type RepeatSummary = {
  frequency: Frequency;
  /** Weekly and every two weeks: the days, Sunday first. */
  weekdays: Weekday[];
  /** Monthly: the day of the month, 1-31. */
  dayOfMonth: number;
  /** Yearly: "5 בנובמבר". */
  dayOfYear: string;
  /** The last date, in words ("31 בדצמבר 2026"), or null. */
  until: string | null;
  /** How many times in all, or null. */
  count: number | null;
};

/** The repeat rule of an occurrence (or series) starting on the given local date. */
export function summarizeRepeat(
  rrule: string,
  startDate: LocalDate,
  isAllDay: boolean,
  timeZone: string,
  locale: string,
): RepeatSummary {
  const { frequency, weekdays, end } = fromRRule(rrule, isAllDay, timeZone);
  return {
    frequency,
    weekdays,
    dayOfMonth: Number(startDate.slice(8, 10)),
    dayOfYear: new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(new Date(`${startDate}T00:00:00Z`)),
    until: end.kind === "until" ? formatDate(end.lastDate, locale, false) : null,
    count: end.kind === "count" ? end.count : null,
  };
}

/** Looks up a message by key, as next-intl's t() does. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The summary in words, from the messages under eventDetails.repeat: "כל שבועיים
 * בימים ראשון וחמישי, עד 31 בדצמבר 2026".
 */
export function describeRepeat(summary: RepeatSummary, t: Translate, locale: string): string {
  const days = new Intl.ListFormat(locale, { type: "conjunction" }).format(
    summary.weekdays.map((day) => t(`weekdays.${day}`)),
  );
  const how = t(`eventDetails.repeat.${summary.frequency}`, {
    days,
    dayCount: summary.weekdays.length,
    day: summary.dayOfMonth,
    date: summary.dayOfYear,
  });
  if (summary.until) return `${how}, ${t("eventDetails.repeat.until", { date: summary.until })}`;
  if (summary.count) return `${how}, ${t("eventDetails.repeat.count", { count: summary.count })}`;
  return how;
}
