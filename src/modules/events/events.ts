import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { type Occurrence, type Series, hasOccurrence, occurrencesBetween } from "./recurrence";
import { compareDates, dateFromDb, dateToDb, instantRangeToDates } from "./time";
import { SHARED_OWNER, type EventDraft } from "./validation";

/** Longest range the calendar may ask for (a month view shows at most 6 weeks). */
export const MAX_RANGE_DAYS = 100;

/**
 * An event as sent to the browser: a one-off event, or one occurrence of a series.
 * Timed events: start/end are ISO instants. All-day events: start/end are "YYYY-MM-DD"
 * dates with an EXCLUSIVE end, which is also what FullCalendar expects.
 */
export type CalendarEvent = {
  /** The event's id; every occurrence of a series has the series' id. */
  id: string;
  /** Unique among the events on screen: the id, plus the occurrence's original start. */
  key: string;
  /** Set on a series' occurrence. */
  recurrence: {
    rrule: string;
    /** Identifies the occurrence, even after it was moved: its start as the rule makes it. */
    originalStart: string;
  } | null;
  title: string;
  description: string | null;
  location: string | null;
  category: string;
  /** A user key from app.config.ts, or "shared". */
  owner: string;
  isAllDay: boolean;
  start: string;
  end: string;
  timezone: string;
  version: number;
  createdBy: string;
  updatedBy: string;
  updatedAt: string;
};

export type EventFailure =
  | { ok: false; reason: "notFound" }
  /** Someone else saved the event since it was loaded. */
  | { ok: false; reason: "conflict" }
  /** A personal event for a user who has never signed in (no user row yet). */
  | { ok: false; reason: "ownerNotSignedIn"; userKey: string };

export type EventResult = { ok: true; event: CalendarEvent } | EventFailure;

const eventInclude = {
  owner: { select: { configKey: true } },
  createdBy: { select: { configKey: true } },
  updatedBy: { select: { configKey: true } },
} satisfies Prisma.EventInclude;

type EventRow = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

const seriesInclude = {
  ...eventInclude,
  exceptions: { include: { updatedBy: { select: { configKey: true } } } },
} satisfies Prisma.EventInclude;

type SeriesRow = Prisma.EventGetPayload<{ include: typeof seriesInclude }>;
type ExceptionRow = SeriesRow["exceptions"][number];

/** Start and end of an event, or of an exception's moved occurrence, as sent to the browser. */
function timesOf(row: {
  isAllDay: boolean | null;
  startAt: Date | null;
  endAt: Date | null;
  startDate: Date | null;
  endDate: Date | null;
}): { isAllDay: boolean; start: string; end: string } {
  return row.isAllDay
    ? { isAllDay: true, start: dateFromDb(row.startDate!), end: dateFromDb(row.endDate!) }
    : { isAllDay: false, start: row.startAt!.toISOString(), end: row.endAt!.toISOString() };
}

/** A one-off event, or a series as its first occurrence. */
function toCalendarEvent(row: EventRow): CalendarEvent {
  const { start, end } = timesOf(row);
  return {
    id: row.id,
    key: row.id,
    recurrence: row.rrule ? { rrule: row.rrule, originalStart: start } : null,
    title: row.title,
    description: row.description,
    location: row.location,
    category: row.category,
    owner: row.ownerType === "SHARED" ? SHARED_OWNER : row.owner!.configKey,
    isAllDay: row.isAllDay,
    start,
    end,
    timezone: row.timezone,
    version: row.version,
    createdBy: row.createdBy.configKey,
    updatedBy: row.updatedBy.configKey,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Events that overlap the half-open range [start, end), oldest start first: one-off
 * events, and the occurrences of each series, with their exceptions applied. Deleted
 * events are left out. All-day events are matched by the local dates the range covers.
 */
export async function listEvents(
  start: Date,
  end: Date,
  timeZone: string,
): Promise<CalendarEvent[]> {
  const dates = instantRangeToDates(start, end, timeZone);
  const oneOffRows = await prisma.event.findMany({
    where: {
      deletedAt: null,
      rrule: null,
      OR: [
        { isAllDay: false, startAt: { lt: end }, endAt: { gt: start } },
        {
          isAllDay: true,
          startDate: { lt: dateToDb(dates.endDate) },
          endDate: { gt: dateToDb(dates.startDate) },
        },
      ],
    },
    include: eventInclude,
  });
  // A series may have occurrences in the range if it starts before the range ends, or if
  // one of its occurrences was moved to before then. Its end (a count or a last date)
  // is only known from the rule, so the rest is left to occurrencesBetween.
  const startsBeforeEnd = [
    { startAt: { lt: end } },
    { startDate: { lt: dateToDb(dates.endDate) } },
  ] satisfies Prisma.EventExceptionWhereInput[];
  const seriesRows = await prisma.event.findMany({
    where: {
      deletedAt: null,
      rrule: { not: null },
      OR: [...startsBeforeEnd, { exceptions: { some: { OR: startsBeforeEnd } } }],
    },
    include: seriesInclude,
  });
  return [
    ...oneOffRows.map(toCalendarEvent),
    ...seriesRows.flatMap((row) => seriesOccurrences(row, start, end, dates)),
  ].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

/**
 * A series' occurrences in the range, with its exceptions applied: a cancelled occurrence
 * is left out, a changed one shows its changes, and a moved one shows where it was moved
 * to, even from outside the range.
 */
function seriesOccurrences(
  row: SeriesRow,
  start: Date,
  end: Date,
  dates: { startDate: string; endDate: string },
): CalendarEvent[] {
  const first = toCalendarEvent(row);
  const series: Series = {
    rrule: row.rrule!,
    isAllDay: row.isAllDay,
    start: first.start,
    end: first.end,
    timezone: row.timezone,
  };
  const exceptions = new Map(
    row.exceptions.map((exception) => [originalStartOf(exception), exception]),
  );
  const isMoved = (exception: ExceptionRow) => exception.isAllDay !== null;

  const inPlace = occurrencesBetween(series, start, end).flatMap((occurrence) => {
    const exception = exceptions.get(occurrence.start);
    if (exception && (exception.isCancelled || isMoved(exception))) return [];
    return [
      occurrenceOf(first, occurrence.start, { ...occurrence, isAllDay: row.isAllDay }, exception),
    ];
  });

  const moved = row.exceptions.flatMap((exception) => {
    if (exception.isCancelled || !isMoved(exception)) return [];
    const times = timesOf(exception);
    const overlaps = times.isAllDay
      ? compareDates(times.start, dates.endDate) < 0 && compareDates(times.end, dates.startDate) > 0
      : new Date(times.start) < end && new Date(times.end) > start;
    const originalStart = originalStartOf(exception);
    // An exception whose occurrence is no longer part of the series is ignored.
    return overlaps && hasOccurrence(series, originalStart)
      ? [occurrenceOf(first, originalStart, times, exception)]
      : [];
  });

  return [...inPlace, ...moved];
}

function originalStartOf(exception: ExceptionRow): string {
  return exception.originalStartAt
    ? exception.originalStartAt.toISOString()
    : dateFromDb(exception.originalStartDate!);
}

/** One occurrence: the series' details, with the exception's changes if it has one. */
function occurrenceOf(
  first: CalendarEvent,
  originalStart: string,
  times: Occurrence & { isAllDay: boolean },
  exception: ExceptionRow | undefined,
): CalendarEvent {
  // "" in an exception: cleared on this occurrence only.
  const text = (changed: string | null | undefined, ofSeries: string | null) =>
    changed === null || changed === undefined ? ofSeries : changed || null;
  const changedLater = exception && exception.updatedAt.toISOString() > first.updatedAt;
  return {
    ...first,
    key: `${first.id}@${originalStart}`,
    recurrence: { rrule: first.recurrence!.rrule, originalStart },
    title: exception?.title ?? first.title,
    description: text(exception?.description, first.description),
    location: text(exception?.location, first.location),
    category: exception?.category ?? first.category,
    isAllDay: times.isAllDay,
    start: times.start,
    end: times.end,
    ...(changedLater && {
      updatedBy: exception.updatedBy.configKey,
      updatedAt: exception.updatedAt.toISOString(),
    }),
  };
}

/** By start; "YYYY-MM-DDT" sorts before any time on that day, so all-day events come first. */
function sortKey(event: CalendarEvent): string {
  return event.isAllDay ? `${event.start}T` : event.start;
}

export async function getEvent(id: string): Promise<CalendarEvent | null> {
  const row = await prisma.event.findFirst({
    where: { id, deletedAt: null },
    include: eventInclude,
  });
  return row ? toCalendarEvent(row) : null;
}

/** The database columns for a validated draft, including the owner's user id. */
async function columnsFor(
  draft: EventDraft,
): Promise<{ ok: true; data: Prisma.EventUncheckedUpdateInput } | EventFailure> {
  let ownerUserId: string | null = null;
  if (draft.owner.type === "USER") {
    const owner = await prisma.user.findUnique({
      where: { configKey: draft.owner.userKey },
      select: { id: true },
    });
    if (!owner) return { ok: false, reason: "ownerNotSignedIn", userKey: draft.owner.userKey };
    ownerUserId = owner.id;
  }
  const time =
    draft.time.kind === "timed"
      ? { startAt: draft.time.startAt, endAt: draft.time.endAt, startDate: null, endDate: null }
      : {
          startAt: null,
          endAt: null,
          startDate: dateToDb(draft.time.startDate),
          endDate: dateToDb(draft.time.endDateExclusive),
        };
  return {
    ok: true,
    data: {
      title: draft.title,
      description: draft.description,
      location: draft.location,
      category: draft.category,
      ownerType: draft.owner.type,
      ownerUserId,
      isAllDay: draft.time.kind === "allDay",
      timezone: draft.timezone,
      rrule: draft.rrule,
      ...time,
    },
  };
}

export async function createEvent(draft: EventDraft, actorUserId: string): Promise<EventResult> {
  const columns = await columnsFor(draft);
  if (!columns.ok) return columns;
  const { id } = await prisma.event.create({
    data: {
      ...(columns.data as Prisma.EventUncheckedCreateInput),
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
    },
    select: { id: true },
  });
  // Read back separately, like updateEvent: an `include` on create makes Prisma load the
  // three related users in parallel on the transaction's single connection, which pg
  // deprecates ("client is already executing a query"; an error from pg 9).
  const row = await prisma.event.findUniqueOrThrow({ where: { id }, include: eventInclude });
  return { ok: true, event: toCalendarEvent(row) };
}

/**
 * Replaces an event with a validated draft. expectedVersion is the version the user
 * loaded: if someone saved or deleted the event since, nothing is changed and the
 * result is "conflict", so one person's edit never silently overwrites the other's.
 */
export async function updateEvent(
  id: string,
  expectedVersion: number,
  draft: EventDraft,
  actorUserId: string,
): Promise<EventResult> {
  const columns = await columnsFor(draft);
  if (!columns.ok) return columns;
  const { count } = await prisma.event.updateMany({
    where: { id, version: expectedVersion, deletedAt: null },
    data: { ...columns.data, updatedByUserId: actorUserId, version: { increment: 1 } },
  });
  if (count === 0) return missingOrConflict(id);
  const row = await prisma.event.findUniqueOrThrow({ where: { id }, include: eventInclude });
  return { ok: true, event: toCalendarEvent(row) };
}

/**
 * Soft-deletes an event: it disappears from the calendar but stays in the database so
 * the Google export (Phase 4) can delete its copy. The version goes up, like any change.
 */
export async function deleteEvent(
  id: string,
  expectedVersion: number,
  actorUserId: string,
): Promise<{ ok: true } | EventFailure> {
  const { count } = await prisma.event.updateMany({
    where: { id, version: expectedVersion, deletedAt: null },
    data: { deletedAt: new Date(), updatedByUserId: actorUserId, version: { increment: 1 } },
  });
  if (count === 0) return missingOrConflict(id);
  return { ok: true };
}

async function missingOrConflict(id: string): Promise<EventFailure> {
  const existing = await prisma.event.findUnique({ where: { id }, select: { deletedAt: true } });
  // Missing or deleted (possibly by the other user meanwhile): not found.
  // Still there but at another version: someone else saved it first.
  return existing && !existing.deletedAt
    ? { ok: false, reason: "conflict" }
    : { ok: false, reason: "notFound" };
}
