// Validates event form input on the server, and turns it into what is stored:
// exact instants for timed events, date-only values with an exclusive end for
// all-day events, and a rule (RRULE) for a repeating one. Errors are codes; the UI
// shows messages.events.errors.<code>.

import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { appConfig } from "@/config/app.config";
import {
  FREQUENCIES,
  type Repeat,
  type RepeatEnd,
  WEEKDAYS,
  toRRule,
  weekdayOf,
} from "./recurrence";
import {
  type LocalDate,
  compareDates,
  isLocalDate,
  isLocalTime,
  lastDayToExclusiveEnd,
  toInstant,
} from "./time";

export const TITLE_MAX = 200;
export const LOCATION_MAX = 300;
export const DESCRIPTION_MAX = 5000;
/** Longest event, against typos like an end date in the wrong year. */
export const MAX_SPAN_DAYS = 366;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Most occurrences a series may end after. */
export const REPEAT_COUNT_MAX = 999;
/**
 * The shortest time between occurrences, in days. An occurrence may not be longer, so
 * occurrences of a series never overlap one another (as in Google Calendar). Weekly
 * series on several days use the shortest gap between their days instead.
 */
const REPEAT_PERIOD_DAYS: Record<Repeat["frequency"], number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 28,
  yearly: 365,
};

export const SHARED_OWNER = "shared";

export type EventErrorCode =
  | "titleRequired"
  | "titleTooLong"
  | "locationTooLong"
  | "descriptionTooLong"
  | "categoryInvalid"
  | "ownerInvalid"
  | "dateInvalid"
  | "timeRequired"
  | "timeInvalid"
  | "endBeforeStart"
  | "endNotAfterStart"
  | "tooLong"
  | "repeatInvalid"
  | "repeatTooOften"
  | "startWeekdayNotChosen"
  | "repeatUntilBeforeStart"
  | "repeatCountInvalid";

export type EventField =
  | "title"
  | "location"
  | "description"
  | "category"
  | "owner"
  | "startDate"
  | "endDate"
  | "startTime"
  | "endTime"
  | "repeatFrequency"
  | "repeatWeekdays"
  | "repeatUntil"
  | "repeatCount";

/** What the event form sends. Dates are local; for all-day events endDate is the last day. */
export type EventInput = {
  title: string;
  description?: string;
  location?: string;
  category?: string;
  /** A user key from app.config.ts, or "shared". */
  owner: string;
  isAllDay: boolean;
  startDate: string;
  endDate: string;
  /** Required for timed events, ignored for all-day events. */
  startTime?: string;
  endTime?: string;
  /** Absent for an event that doesn't repeat. */
  repeat?: RepeatInput;
};

/** The form's repeat choices, as typed. */
export type RepeatInput = {
  frequency: string;
  /** Weekly and every two weeks: the days, as RRULE writes them ("SU", "MO", ...). */
  weekdays?: string[];
  end: RepeatEnd["kind"];
  /** end "until": the last date an occurrence may start on. */
  until?: string;
  /** end "count": how many times, as typed. */
  count?: string;
};

export type EventOwner = { type: "USER"; userKey: string } | { type: "SHARED" };

export type EventTime =
  | { kind: "allDay"; startDate: LocalDate; endDateExclusive: LocalDate }
  | { kind: "timed"; startAt: Date; endAt: Date };

/** A valid event, ready to store. */
export type EventDraft = {
  title: string;
  description: string | null;
  location: string | null;
  category: string;
  owner: EventOwner;
  timezone: string;
  time: EventTime;
  /** RRULE value of a repeating event (see recurrence.ts), or null. */
  rrule: string | null;
};

export type EventValidation =
  | { ok: true; draft: EventDraft }
  | { ok: false; errors: Partial<Record<EventField, EventErrorCode>> };

const userKeys: readonly string[] = appConfig.users.map((user) => user.key);
const categoryKeys: readonly string[] = appConfig.categories.map((category) => category.key);

/** Trims; an empty optional field becomes null. */
const optionalText = (max: number, tooLong: EventErrorCode) =>
  z
    .string()
    .optional()
    .transform((value) => value?.trim() || null)
    .refine((value) => value === null || value.length <= max, tooLong);

const inputSchema = z.object({
  title: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, "titleRequired")
    .refine((value) => value.length <= TITLE_MAX, "titleTooLong"),
  description: optionalText(DESCRIPTION_MAX, "descriptionTooLong"),
  location: optionalText(LOCATION_MAX, "locationTooLong"),
  category: z
    .string()
    .optional()
    .transform((value) => value || appConfig.defaultCategory)
    .refine((value) => categoryKeys.includes(value), "categoryInvalid"),
  owner: z
    .string()
    .refine((value) => value === SHARED_OWNER || userKeys.includes(value), "ownerInvalid"),
  isAllDay: z.boolean(),
  startDate: z.string().refine(isLocalDate, "dateInvalid"),
  endDate: z.string().refine(isLocalDate, "dateInvalid"),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  repeat: z
    .object({
      frequency: z.enum(FREQUENCIES),
      weekdays: z.array(z.enum(WEEKDAYS)).optional(),
      end: z.enum(["never", "until", "count"]),
      until: z.string().optional(),
      count: z.string().optional(),
    })
    .optional(),
});

type Errors = Partial<Record<EventField, EventErrorCode>>;

export function validateEvent(input: unknown, timeZone = appConfig.timeZone): EventValidation {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Partial<Record<EventField, EventErrorCode>> = {};
    for (const issue of parsed.error.issues) {
      // A problem outside the form fields (such as isAllDay) is shown on the start date.
      const path = String(issue.path[0]);
      const field =
        path === "repeat"
          ? (REPEAT_FIELDS[String(issue.path[1])] ?? "repeatFrequency")
          : (FIELDS as readonly string[]).includes(path)
            ? (path as EventField)
            : "startDate";
      // Our refinements carry an error code as their message; anything else (a wrong
      // type, a missing field) is reported as the field being invalid.
      const code = isErrorCode(issue.message) ? issue.message : fallbackCode(field);
      errors[field] ??= code;
    }
    return { ok: false, errors };
  }

  const value = parsed.data;
  const time = validateTime(value, timeZone);
  const repeat = value.repeat ? validateRepeat(value.repeat, value.startDate) : null;
  // Time and repeat errors are reported together.
  const errors: Errors = {
    ...(time.ok ? {} : time.errors),
    ...(repeat && !repeat.ok ? repeat.errors : {}),
  };
  if (time.ok && repeat?.ok) {
    const gap = shortestGapDays(repeat.repeat);
    if (isLongerThan(time.time, gap, timeZone)) {
      // Blame the days if they are what brings occurrences closer than the frequency.
      const field =
        gap < REPEAT_PERIOD_DAYS[repeat.repeat.frequency] ? "repeatWeekdays" : "repeatFrequency";
      errors[field] = "repeatTooOften";
    }
  }
  if (!time.ok || Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    draft: {
      title: value.title,
      description: value.description,
      location: value.location,
      category: value.category,
      owner:
        value.owner === SHARED_OWNER ? { type: "SHARED" } : { type: "USER", userKey: value.owner },
      timezone: timeZone,
      time: time.time,
      rrule: repeat?.ok ? toRRule(repeat.repeat, value.isAllDay, timeZone) : null,
    },
  };
}

type Parsed = z.infer<typeof inputSchema>;

function validateTime(
  value: Parsed,
  timeZone: string,
): { ok: true; time: EventTime } | { ok: false; errors: Errors } {
  if (value.isAllDay) {
    // Times are ignored on purpose: unticking "all day" must not bring back old times.
    if (compareDates(value.endDate, value.startDate) < 0) {
      return { ok: false, errors: { endDate: "endBeforeStart" } };
    }
    const endDateExclusive = lastDayToExclusiveEnd(value.endDate);
    if (daysBetween(value.startDate, endDateExclusive) > MAX_SPAN_DAYS) {
      return { ok: false, errors: { endDate: "tooLong" } };
    }
    return { ok: true, time: { kind: "allDay", startDate: value.startDate, endDateExclusive } };
  }

  const timeErrors: Errors = {};
  for (const field of ["startTime", "endTime"] as const) {
    const time = value[field];
    if (!time) timeErrors[field] = "timeRequired";
    else if (!isLocalTime(time)) timeErrors[field] = "timeInvalid";
  }
  if (Object.keys(timeErrors).length > 0) return { ok: false, errors: timeErrors };

  const startAt = toInstant(value.startDate, value.startTime!, timeZone);
  const endAt = toInstant(value.endDate, value.endTime!, timeZone);
  if (endAt <= startAt) {
    // A different message when the end is on an earlier day than the start.
    const field = compareDates(value.endDate, value.startDate) < 0 ? "endDate" : "endTime";
    const code = field === "endDate" ? "endBeforeStart" : "endNotAfterStart";
    return { ok: false, errors: { [field]: code } };
  }
  if (endAt.getTime() - startAt.getTime() > MAX_SPAN_DAYS * MS_PER_DAY) {
    return { ok: false, errors: { endDate: "tooLong" } };
  }
  return { ok: true, time: { kind: "timed", startAt, endAt } };
}

/**
 * The repeat choices, checked against the event's start date: a weekly series must
 * include the start's day of the week (the first occurrence is the event itself), and
 * its last date can't be before the start.
 */
function validateRepeat(
  input: NonNullable<Parsed["repeat"]>,
  startDate: LocalDate,
): { ok: true; repeat: Repeat } | { ok: false; errors: Errors } {
  const isWeekly = input.frequency === "weekly" || input.frequency === "biweekly";
  const weekdays = isWeekly ? [...new Set(input.weekdays ?? [])] : [];
  const errors: Errors = {};
  if (isWeekly && !weekdays.includes(weekdayOf(startDate))) {
    errors.repeatWeekdays = "startWeekdayNotChosen";
  }

  let end: RepeatEnd = { kind: "never" };
  if (input.end === "until") {
    const lastDate = input.until ?? "";
    if (!isLocalDate(lastDate)) errors.repeatUntil = "dateInvalid";
    else if (compareDates(lastDate, startDate) < 0) errors.repeatUntil = "repeatUntilBeforeStart";
    else end = { kind: "until", lastDate };
  }
  if (input.end === "count") {
    const count = /^\d{1,4}$/.test(input.count?.trim() ?? "") ? Number(input.count) : 0;
    if (count < 1 || count > REPEAT_COUNT_MAX) errors.repeatCount = "repeatCountInvalid";
    else end = { kind: "count", count };
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, repeat: { frequency: input.frequency, weekdays, end } };
}

/**
 * The fewest days from one occurrence's start to the next one's: the frequency's period,
 * or for several weekdays the shortest gap between them, counting the gap from the last
 * day back round to the first (a week later, or two weeks for every two weeks).
 */
function shortestGapDays(repeat: Repeat): number {
  const period = REPEAT_PERIOD_DAYS[repeat.frequency];
  if (repeat.weekdays.length < 2) return period;
  const days = repeat.weekdays.map((day) => WEEKDAYS.indexOf(day)).sort((a, b) => a - b);
  const gaps = days.map((day, index) =>
    index === 0 ? days[0] + period - days[days.length - 1] : day - days[index - 1],
  );
  return Math.min(...gaps);
}

/**
 * Whether the event runs past the start of the next occurrence, days later on the local
 * clock: a daily 10:00 to 10:00 the next day still fits on the 25-hour day the clocks
 * go back.
 */
function isLongerThan(time: EventTime, days: number, timeZone: string): boolean {
  if (time.kind === "allDay") return daysBetween(time.startDate, time.endDateExclusive) > days;
  const nextStart = Temporal.Instant.fromEpochMilliseconds(time.startAt.getTime())
    .toZonedDateTimeISO(timeZone)
    .add({ days });
  return time.endAt.getTime() > nextStart.epochMilliseconds;
}

/** The form field for each part of the repeat input. */
const REPEAT_FIELDS: Record<string, EventField> = {
  frequency: "repeatFrequency",
  end: "repeatFrequency",
  weekdays: "repeatWeekdays",
  until: "repeatUntil",
  count: "repeatCount",
};

const FIELDS: readonly EventField[] = [
  "title",
  "location",
  "description",
  "category",
  "owner",
  "startDate",
  "endDate",
  "startTime",
  "endTime",
  "repeatFrequency",
  "repeatWeekdays",
  "repeatUntil",
  "repeatCount",
];

/** Every error code, for checking that each has a Hebrew message. */
export const EVENT_ERROR_CODES: readonly EventErrorCode[] = [
  "titleRequired",
  "titleTooLong",
  "locationTooLong",
  "descriptionTooLong",
  "categoryInvalid",
  "ownerInvalid",
  "dateInvalid",
  "timeRequired",
  "timeInvalid",
  "endBeforeStart",
  "endNotAfterStart",
  "tooLong",
  "repeatInvalid",
  "repeatTooOften",
  "startWeekdayNotChosen",
  "repeatUntilBeforeStart",
  "repeatCountInvalid",
];

function isErrorCode(value: string): value is EventErrorCode {
  return (EVENT_ERROR_CODES as readonly string[]).includes(value);
}

function fallbackCode(field: EventField): EventErrorCode {
  switch (field) {
    case "title":
      return "titleRequired";
    case "category":
      return "categoryInvalid";
    case "owner":
      return "ownerInvalid";
    case "startTime":
    case "endTime":
      return "timeInvalid";
    case "repeatFrequency":
    case "repeatWeekdays":
      return "repeatInvalid";
    case "repeatCount":
      return "repeatCountInvalid";
    default:
      return "dateInvalid";
  }
}

function daysBetween(start: LocalDate, end: LocalDate): number {
  return (Date.parse(end) - Date.parse(start)) / MS_PER_DAY;
}
