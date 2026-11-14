// Repeating events: the form's repeat choices <-> an RRULE (RFC 5545), and the
// occurrences of a series in a range. The rule is stored without DTSTART: a series
// starts at its event's start, in its event's time zone, as in Google Calendar.

import { RRuleTemporal } from "rrule-temporal";
import { Temporal } from "temporal-polyfill";
import {
  type LocalDate,
  addDays,
  compareDates,
  instantRangeToDates,
  toInstant,
  toLocal,
} from "./time";

export const FREQUENCIES = ["daily", "weekly", "biweekly", "monthly", "yearly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** Days of the week as RRULE writes them, Sunday first as in Israel. */
export const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type RepeatEnd =
  | { kind: "never" }
  /** The last date an occurrence may start on, inclusive. */
  | { kind: "until"; lastDate: LocalDate }
  | { kind: "count"; count: number };

/** What the event form offers. A monthly or yearly series keeps its start's day. */
export type Repeat = {
  frequency: Frequency;
  /** Weekly and every-two-weeks only: the days it happens on. */
  weekdays: Weekday[];
  end: RepeatEnd;
};

/** A repeating event: its first occurrence, in CalendarEvent's formats, and its rule. */
export type Series = {
  rrule: string;
  isAllDay: boolean;
  /** Timed: ISO instants. All-day: "YYYY-MM-DD" dates with an exclusive end. */
  start: string;
  end: string;
  timezone: string;
};

/** One occurrence, in the same formats. Its start also identifies it in exceptions. */
export type Occurrence = { start: string; end: string };

const FREQ: Record<Frequency, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  biweekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};

const isWeekly = (frequency: Frequency) => frequency === "weekly" || frequency === "biweekly";

export function weekdayOf(date: LocalDate): Weekday {
  // Temporal numbers the days Monday 1 to Sunday 7.
  return WEEKDAYS[Temporal.PlainDate.from(date).dayOfWeek % 7];
}

/** "2026-11-05" -> "20261105". */
const compactDate = (date: LocalDate) => date.replaceAll("-", "");
/** "20261105" -> "2026-11-05". */
const isoDate = (compact: string) =>
  `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;

/** The RRULE value (without "RRULE:") for the form's choices. */
export function toRRule(repeat: Repeat, isAllDay: boolean, timeZone: string): string {
  const parts = [`FREQ=${FREQ[repeat.frequency]}`];
  if (repeat.frequency === "biweekly") parts.push("INTERVAL=2");
  if (isWeekly(repeat.frequency)) {
    const days = WEEKDAYS.filter((day) => repeat.weekdays.includes(day));
    // Weeks start on Sunday. RFC 5545 defaults to Monday, which would put Sunday and
    // Tuesday in different weeks and break "every two weeks on Sunday and Tuesday".
    parts.push(`BYDAY=${days.join(",")}`, "WKST=SU");
  }
  const { end } = repeat;
  if (end.kind === "count") parts.push(`COUNT=${end.count}`);
  if (end.kind === "until") {
    // RFC 5545: a date for all-day series; for timed ones a UTC time, here the last
    // second of the last date in the series' time zone.
    const until = isAllDay
      ? compactDate(end.lastDate)
      : Temporal.Instant.fromEpochMilliseconds(
          toInstant(addDays(end.lastDate, 1), "00:00", timeZone).getTime() - 1000,
        )
          .toString()
          .replace(/[-:]/g, "");
    parts.push(`UNTIL=${until}`);
  }
  return parts.join(";");
}

/** The form's choices for a stored RRULE. Throws on a rule the form can't make. */
export function fromRRule(rrule: string, isAllDay: boolean, timeZone: string): Repeat {
  const fields = new Map(rrule.split(";").map((part) => part.split("=") as [string, string]));
  const interval = fields.get("INTERVAL") ?? "1";
  const frequency = FREQUENCIES.find(
    (candidate) =>
      FREQ[candidate] === fields.get("FREQ") && interval === (candidate === "biweekly" ? "2" : "1"),
  );
  if (!frequency) throw new Error(`Unsupported RRULE: ${rrule}`);

  const until = fields.get("UNTIL");
  const count = fields.get("COUNT");
  const end: RepeatEnd = count
    ? { kind: "count", count: Number(count) }
    : until
      ? {
          kind: "until",
          lastDate: isAllDay
            ? isoDate(until)
            : toLocal(new Date(utcStampToIso(until)), timeZone).date,
        }
      : { kind: "never" };

  return {
    frequency,
    weekdays: isWeekly(frequency) ? ((fields.get("BYDAY")?.split(",") ?? []) as Weekday[]) : [],
    end,
  };
}

/** "20261231T215959Z" -> "2026-12-31T21:59:59Z". */
function utcStampToIso(stamp: string): string {
  return `${isoDate(stamp)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
}

const daysBetween = (from: LocalDate, to: LocalDate) =>
  Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to)).days;

/**
 * The occurrences of a series that overlap the half-open range [rangeStart, rangeEnd),
 * oldest first, including ones that start before the range and run into it.
 */
export function occurrencesBetween(series: Series, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  return series.isAllDay
    ? allDayOccurrences(series, rangeStart, rangeEnd)
    : timedOccurrences(series, rangeStart, rangeEnd);
}

/**
 * Every occurrence starts at the first one's local time, and ends at its local end time
 * (on the same day, or as many days later): an event from 22:00 to 06:00 still ends at
 * 06:00 on the night the clocks change.
 *
 * Daylight saving: as RFC 5545 requires, an occurrence whose start time doesn't exist
 * that day (02:00-03:00 when summer time starts) is left out. A start time that happens
 * twice (01:00-02:00 when it ends) is the earlier one.
 */
function timedOccurrences(series: Series, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const timeZone = series.timezone;
  const first = toLocal(new Date(series.start), timeZone);
  const last = toLocal(new Date(series.end), timeZone);
  const endDayOffset = daysBetween(first.date, last.date);
  const rule = new RRuleTemporal({
    rruleString: `DTSTART;TZID=${timeZone}:${compactDate(first.date)}T${first.time.replace(":", "")}00\nRRULE:${series.rrule}`,
    temporal: Temporal,
  });
  const zoned = (ms: number) =>
    Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(timeZone);
  // Look back by the event's length (and a day for clock changes) for occurrences that
  // start before the range.
  const length = new Date(series.end).getTime() - new Date(series.start).getTime();
  const starts = rule.between(
    zoned(rangeStart.getTime() - length - 24 * 60 * 60 * 1000),
    zoned(rangeEnd.getTime()),
    true,
  );
  return starts.flatMap((occurrence) => {
    const start = new Date(occurrence.epochMilliseconds);
    const end = toInstant(
      addDays(occurrence.toPlainDate().toString(), endDayOffset),
      last.time,
      timeZone,
    );
    return start < rangeEnd && end > rangeStart
      ? [{ start: start.toISOString(), end: end.toISOString() }]
      : [];
  });
}

/** Every occurrence lasts as many days as the first. */
function allDayOccurrences(series: Series, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const days = daysBetween(series.start, series.end);
  const range = instantRangeToDates(rangeStart, rangeEnd, series.timezone);
  const rule = new RRuleTemporal({
    rruleString: `DTSTART;VALUE=DATE:${compactDate(series.start)}\nRRULE:${series.rrule}`,
    temporal: Temporal,
  });
  // Date-only rules work in UTC days.
  const utcDay = (date: LocalDate) => Temporal.ZonedDateTime.from(`${date}T00:00[UTC]`);
  const starts = rule.between(utcDay(addDays(range.startDate, -days)), utcDay(range.endDate), true);
  return starts.flatMap((occurrence) => {
    const start = occurrence.toPlainDate().toString();
    const end = addDays(start, days);
    return compareDates(start, range.endDate) < 0 && compareDates(end, range.startDate) > 0
      ? [{ start, end }]
      : [];
  });
}
