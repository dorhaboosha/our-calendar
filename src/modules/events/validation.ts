// Validates event form input on the server, and turns it into what is stored:
// exact instants for timed events, date-only values with an exclusive end for
// all-day events. Errors are codes; the UI shows messages.events.errors.<code>.

import { z } from "zod";
import { appConfig } from "@/config/app.config";
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
  | "tooLong";

export type EventField =
  | "title"
  | "location"
  | "description"
  | "category"
  | "owner"
  | "startDate"
  | "endDate"
  | "startTime"
  | "endTime";

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
});

export function validateEvent(input: unknown, timeZone = appConfig.timeZone): EventValidation {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Partial<Record<EventField, EventErrorCode>> = {};
    for (const issue of parsed.error.issues) {
      // A problem outside the form fields (such as isAllDay) is shown on the start date.
      const path = String(issue.path[0]);
      const field = (FIELDS as readonly string[]).includes(path)
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
  const base = {
    title: value.title,
    description: value.description,
    location: value.location,
    category: value.category,
    owner:
      value.owner === SHARED_OWNER
        ? ({ type: "SHARED" } as const)
        : ({ type: "USER", userKey: value.owner } as const),
    timezone: timeZone,
  };

  if (value.isAllDay) {
    // Times are ignored on purpose: unticking "all day" must not bring back old times.
    if (compareDates(value.endDate, value.startDate) < 0) {
      return { ok: false, errors: { endDate: "endBeforeStart" } };
    }
    const endDateExclusive = lastDayToExclusiveEnd(value.endDate);
    if (daysBetween(value.startDate, endDateExclusive) > MAX_SPAN_DAYS) {
      return { ok: false, errors: { endDate: "tooLong" } };
    }
    return {
      ok: true,
      draft: { ...base, time: { kind: "allDay", startDate: value.startDate, endDateExclusive } },
    };
  }

  const timeErrors: Partial<Record<EventField, EventErrorCode>> = {};
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
  return { ok: true, draft: { ...base, time: { kind: "timed", startAt, endAt } } };
}

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
    default:
      return "dateInvalid";
  }
}

function daysBetween(start: LocalDate, end: LocalDate): number {
  return (Date.parse(end) - Date.parse(start)) / MS_PER_DAY;
}
