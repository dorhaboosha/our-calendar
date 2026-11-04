// Conversions between what the user sees (local dates and times in the app's time zone)
// and what is stored (exact instants for timed events, date-only values for all-day
// events). All daylight-saving handling lives here.

import { Temporal } from "temporal-polyfill";

/** A calendar date, "YYYY-MM-DD". */
export type LocalDate = string;
/** A wall-clock time, "HH:mm". */
export type LocalTime = string;

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True for a real calendar date in "YYYY-MM-DD" form (rejects 2026-02-30). */
export function isLocalDate(value: string): boolean {
  if (!LOCAL_DATE.test(value)) return false;
  try {
    Temporal.PlainDate.from(value, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}

/** True for a time in "HH:mm" form, 00:00 to 23:59. */
export function isLocalTime(value: string): boolean {
  return LOCAL_TIME.test(value);
}

// ---- Timed events: local date + time <-> instant ----

/**
 * The instant of a local date and time in the given time zone.
 *
 * Daylight saving: a time that doesn't exist (the hour skipped when clocks go forward)
 * moves forward by the gap, e.g. 02:30 becomes 03:30. A time that happens twice (when
 * clocks go back) takes the earlier one. This matches Google Calendar ("compatible").
 */
export function toInstant(date: LocalDate, time: LocalTime, timeZone: string): Date {
  const zoned = Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(timeZone, {
    disambiguation: "compatible",
  });
  return new Date(zoned.epochMilliseconds);
}

/** The local date and time of an instant in the given time zone. */
export function toLocal(instant: Date, timeZone: string): { date: LocalDate; time: LocalTime } {
  const zoned = Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(
    timeZone,
  );
  return {
    date: zoned.toPlainDate().toString(),
    time: zoned.toPlainTime().toString({ smallestUnit: "minute" }),
  };
}

// ---- All-day events: the form's last day <-> the stored exclusive end ----

export function addDays(date: LocalDate, days: number): LocalDate {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

/** The form shows the last day of an all-day event; storage keeps the day after it. */
export function lastDayToExclusiveEnd(lastDay: LocalDate): LocalDate {
  return addDays(lastDay, 1);
}

export function exclusiveEndToLastDay(exclusiveEnd: LocalDate): LocalDate {
  return addDays(exclusiveEnd, -1);
}

/** Compares two local dates: negative, zero or positive. */
export function compareDates(a: LocalDate, b: LocalDate): number {
  return Temporal.PlainDate.compare(Temporal.PlainDate.from(a), Temporal.PlainDate.from(b));
}

// ---- Date-only database columns ----

/**
 * Value for a Postgres DATE column. Prisma reads and writes DATE as a JS Date at UTC
 * midnight, so the date is taken from the UTC fields, never from local time.
 */
export function dateToDb(date: LocalDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function dateFromDb(value: Date): LocalDate {
  return value.toISOString().slice(0, 10);
}

// ---- Visible ranges ----

/**
 * The local dates covered by the half-open instant range [start, end), as a half-open
 * date range [startDate, endDate). Used to find the all-day events that overlap a
 * calendar view: a view ending exactly at local midnight doesn't include that day.
 */
export function instantRangeToDates(
  start: Date,
  end: Date,
  timeZone: string,
): { startDate: LocalDate; endDate: LocalDate } {
  const startDate = toLocal(start, timeZone).date;
  const endLocal = toLocal(end, timeZone);
  const endIsMidnight = toInstant(endLocal.date, "00:00", timeZone).getTime() === end.getTime();
  return {
    startDate,
    endDate: endIsMidnight ? endLocal.date : addDays(endLocal.date, 1),
  };
}
