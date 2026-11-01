// The event form's behavior, kept out of the component so it can be tested: default
// values for a new event, keeping the length when the start moves, and the "all day"
// checkbox. All values are local (dates "YYYY-MM-DD", times "HH:mm").

import { Temporal } from "temporal-polyfill";
import type { CalendarEvent } from "./events";
import {
  type LocalDate,
  type LocalTime,
  exclusiveEndToLastDay,
  isLocalDate,
  isLocalTime,
  toLocal,
} from "./time";
import type { EventInput } from "./validation";

export type EventFormValues = {
  title: string;
  category: string;
  /** A user key, or "shared". */
  owner: string;
  isAllDay: boolean;
  startDate: LocalDate;
  startTime: LocalTime;
  endDate: LocalDate;
  endTime: LocalTime;
  location: string;
  description: string;
};

export const DEFAULT_DURATION_MINUTES = 60;
/** Times used when a day is chosen without a time (month view) or "all day" is unticked. */
export const DEFAULT_START_TIME = "09:00";

/** Where the user clicked in the calendar, if anywhere. */
export type NewEventClick =
  /** A day in the month view: a timed event on that day. */
  | { kind: "day"; date: LocalDate }
  /** A time slot in the week or day view. */
  | { kind: "time"; date: LocalDate; time: LocalTime }
  /** The "all day" row of the week or day view. */
  | { kind: "allDay"; date: LocalDate };

type Moment = { date: LocalDate; time: LocalTime };

function plain({ date, time }: Moment): Temporal.PlainDateTime {
  return Temporal.PlainDateTime.from(`${date}T${time}`);
}

function moment(value: Temporal.PlainDateTime): Moment {
  return {
    date: value.toPlainDate().toString(),
    time: value.toPlainTime().toString({ smallestUnit: "minute" }),
  };
}

/** Adds minutes on the wall clock (what the form shows), across midnight if needed. */
export function addMinutes(at: Moment, minutes: number): Moment {
  return moment(plain(at).add({ minutes }));
}

/** The next full hour after now, in the given time zone: 09:20 becomes 10:00. */
export function nextFullHour(now: Date, timeZone: string): Moment {
  const local = Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime();
  return moment(local.round({ smallestUnit: "hour", roundingMode: "floor" }).add({ hours: 1 }));
}

export function newEventValues(options: {
  owner: string;
  category: string;
  now: Date;
  timeZone: string;
  today: LocalDate;
  click?: NewEventClick;
}): EventFormValues {
  const { click } = options;
  const nextHour = nextFullHour(options.now, options.timeZone);
  let start: Moment;
  if (click?.kind === "time") start = { date: click.date, time: click.time };
  // The "new event" button: the next full hour (late at night that may be tomorrow).
  else if (!click) start = nextHour;
  // Today, clicked: the next full hour, unless that is already tomorrow.
  else if (click.date === options.today && nextHour.date === options.today) start = nextHour;
  // Another day: the default hour on the day that was clicked.
  else start = { date: click.date, time: DEFAULT_START_TIME };

  const end = addMinutes(start, DEFAULT_DURATION_MINUTES);
  return {
    title: "",
    category: options.category,
    owner: options.owner,
    isAllDay: click?.kind === "allDay",
    startDate: start.date,
    startTime: start.time,
    endDate: click?.kind === "allDay" ? start.date : end.date,
    endTime: end.time,
    location: "",
    description: "",
  };
}

/** An existing event, as the form shows it for editing. */
export function eventFormValues(event: CalendarEvent, timeZone: string): EventFormValues {
  const common = {
    title: event.title,
    category: event.category,
    owner: event.owner,
    isAllDay: event.isAllDay,
    location: event.location ?? "",
    description: event.description ?? "",
  };
  if (event.isAllDay) {
    // The form shows the last day itself; the times are what unticking "all day" would give.
    return {
      ...common,
      startDate: event.start,
      endDate: exclusiveEndToLastDay(event.end),
      startTime: DEFAULT_START_TIME,
      endTime: addMinutes({ date: event.start, time: DEFAULT_START_TIME }, DEFAULT_DURATION_MINUTES)
        .time,
    };
  }
  const start = toLocal(new Date(event.start), timeZone);
  const end = toLocal(new Date(event.end), timeZone);
  return {
    ...common,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
  };
}

/**
 * New start date or time. The end moves with it, keeping the event's length (like
 * Google Calendar). If the current end isn't valid or isn't after the start, the end
 * becomes the start plus the default length.
 */
export function withStart(
  values: EventFormValues,
  startDate: string,
  startTime: string,
): EventFormValues {
  const next = { ...values, startDate, startTime };
  if (!isLocalDate(startDate) || !isLocalDate(values.startDate) || !isLocalDate(values.endDate)) {
    return next; // Still typing: leave the end alone until the dates are real.
  }

  if (values.isAllDay) {
    const days = Temporal.PlainDate.from(values.startDate).until(values.endDate).days;
    const endDate = Temporal.PlainDate.from(startDate)
      .add({ days: Math.max(days, 0) })
      .toString();
    return { ...next, endDate };
  }

  if (!isLocalTime(startTime) || !isLocalTime(values.startTime)) return next;
  const oldStart = plain({ date: values.startDate, time: values.startTime });
  const minutes = isLocalTime(values.endTime)
    ? oldStart.until(plain({ date: values.endDate, time: values.endTime }), {
        largestUnit: "minute",
      }).minutes
    : 0;
  const end = addMinutes(
    { date: startDate, time: startTime },
    minutes > 0 ? minutes : DEFAULT_DURATION_MINUTES,
  );
  return { ...next, endDate: end.date, endTime: end.time };
}

/**
 * Ticking "all day" keeps the dates and hides the times. Unticking does not bring back
 * the old times: it starts again from the default hour on the start day, so a value
 * nobody has looked at in a while is never saved by surprise.
 */
export function withAllDay(values: EventFormValues, isAllDay: boolean): EventFormValues {
  if (isAllDay) {
    const endDate =
      isLocalDate(values.endDate) &&
      isLocalDate(values.startDate) &&
      values.endDate < values.startDate
        ? values.startDate
        : values.endDate;
    return { ...values, isAllDay: true, endDate };
  }
  const end = addMinutes(
    { date: values.startDate, time: DEFAULT_START_TIME },
    DEFAULT_DURATION_MINUTES,
  );
  return {
    ...values,
    isAllDay: false,
    startTime: DEFAULT_START_TIME,
    endDate: isLocalDate(values.startDate) ? end.date : values.endDate,
    endTime: end.time,
  };
}

/** What the server action receives; times are left out of an all-day event. */
export function toEventInput(values: EventFormValues): EventInput {
  return {
    title: values.title,
    category: values.category,
    owner: values.owner,
    isAllDay: values.isAllDay,
    startDate: values.startDate,
    endDate: values.endDate,
    ...(values.isAllDay ? {} : { startTime: values.startTime, endTime: values.endTime }),
    location: values.location,
    description: values.description,
  };
}
