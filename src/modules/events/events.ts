import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  type Occurrence,
  type RepeatScope,
  type Series,
  countBefore,
  countOf,
  endBefore,
  occurrenceAt,
  occurrencesBetween,
  rulePattern,
} from "./recurrence";
import { compareDates, dateFromDb, dateToDb, instantRangeToDates } from "./time";
import { SHARED_OWNER, type EventDraft, type EventTime } from "./validation";

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
    /** The original starts of the series' occurrences that were changed on their own. */
    changedOccurrences: string[];
    /** A series that ends after a number of times: how many from this occurrence on. */
    remainingCount: number | null;
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

/**
 * A change to an occurrence of a series: which occurrences it is for, and the original
 * start of the occurrence it was made from. Without one, a change is for the whole event.
 */
export type OccurrenceTarget = { scope: RepeatScope; originalStart: string };

export type EventFailure =
  | { ok: false; reason: "notFound" }
  /** Someone else saved the event since it was loaded. */
  | { ok: false; reason: "conflict" }
  /** A personal event for a user who has never signed in (no user row yet). */
  | { ok: false; reason: "ownerNotSignedIn"; userKey: string };

export type EventResult = { ok: true; event: CalendarEvent } | EventFailure;

const NOT_FOUND = { ok: false, reason: "notFound" } as const;

const eventInclude = {
  owner: { select: { configKey: true } },
  createdBy: { select: { configKey: true } },
  updatedBy: { select: { configKey: true } },
  exceptions: { select: { originalStartAt: true, originalStartDate: true } },
} satisfies Prisma.EventInclude;

type EventRow = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

const seriesInclude = {
  ...eventInclude,
  exceptions: { include: { updatedBy: { select: { configKey: true } } } },
} satisfies Prisma.EventInclude;

type SeriesRow = Prisma.EventGetPayload<{ include: typeof seriesInclude }>;
type ExceptionRow = SeriesRow["exceptions"][number];

type TimeColumns = {
  isAllDay: boolean | null;
  startAt: Date | null;
  endAt: Date | null;
  startDate: Date | null;
  endDate: Date | null;
};

/** Start and end of an event, or of an exception's moved occurrence, as sent to the browser. */
function timesOf(row: TimeColumns): { isAllDay: boolean; start: string; end: string } {
  return row.isAllDay
    ? { isAllDay: true, start: dateFromDb(row.startDate!), end: dateFromDb(row.endDate!) }
    : { isAllDay: false, start: row.startAt!.toISOString(), end: row.endAt!.toISOString() };
}

/** A draft's times in the same formats. */
function draftTimes(time: EventTime): { isAllDay: boolean; start: string; end: string } {
  return time.kind === "allDay"
    ? { isAllDay: true, start: time.startDate, end: time.endDateExclusive }
    : { isAllDay: false, start: time.startAt.toISOString(), end: time.endAt.toISOString() };
}

/** The columns for a draft's times, as on Event and on an exception. */
function timeColumns(time: EventTime) {
  return time.kind === "timed"
    ? {
        isAllDay: false,
        startAt: time.startAt,
        endAt: time.endAt,
        startDate: null,
        endDate: null,
      }
    : {
        isAllDay: true,
        startAt: null,
        endAt: null,
        startDate: dateToDb(time.startDate),
        endDate: dateToDb(time.endDateExclusive),
      };
}

function originalStartOf(exception: {
  originalStartAt: Date | null;
  originalStartDate: Date | null;
}): string {
  return exception.originalStartAt
    ? exception.originalStartAt.toISOString()
    : dateFromDb(exception.originalStartDate!);
}

/** The column that identifies an occurrence in an exception. */
function originalStartColumn(series: Series, originalStart: string) {
  return series.isAllDay
    ? { originalStartDate: dateToDb(originalStart) }
    : { originalStartAt: new Date(originalStart) };
}

function seriesOf(row: EventRow): Series {
  const { start, end } = timesOf(row);
  return { rrule: row.rrule!, isAllDay: row.isAllDay, start, end, timezone: row.timezone };
}

/** A one-off event, or a series as its first occurrence. */
function toCalendarEvent(row: EventRow): CalendarEvent {
  const { start, end } = timesOf(row);
  return {
    id: row.id,
    key: row.id,
    recurrence: row.rrule
      ? {
          rrule: row.rrule,
          originalStart: start,
          changedOccurrences: row.exceptions.map(originalStartOf),
          remainingCount: countOf(row.rrule),
        }
      : null,
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

const isMoved = (exception: ExceptionRow) => exception.isAllDay !== null;

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
  const series = seriesOf(row);
  const exceptions = new Map(
    row.exceptions.map((exception) => [originalStartOf(exception), exception]),
  );

  const inPlace = occurrencesBetween(series, start, end).flatMap((occurrence) => {
    const exception = exceptions.get(occurrence.start);
    if (exception && (exception.isCancelled || isMoved(exception))) return [];
    return [
      occurrenceOf(
        first,
        series,
        occurrence.start,
        { ...occurrence, isAllDay: row.isAllDay },
        exception,
      ),
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
    return overlaps && occurrenceAt(series, originalStart)
      ? [occurrenceOf(first, series, originalStart, times, exception)]
      : [];
  });

  return [...inPlace, ...moved];
}

/** One occurrence: the series' details, with the exception's changes if it has one. */
function occurrenceOf(
  first: CalendarEvent,
  series: Series,
  originalStart: string,
  times: Occurrence & { isAllDay: boolean },
  exception: ExceptionRow | undefined,
): CalendarEvent {
  // "" in an exception: cleared on this occurrence only.
  const text = (changed: string | null | undefined, ofSeries: string | null) =>
    changed === null || changed === undefined ? ofSeries : changed || null;
  const changedLater = exception && exception.updatedAt.toISOString() > first.updatedAt;
  const count = countOf(series.rrule);
  return {
    ...first,
    key: `${first.id}@${originalStart}`,
    recurrence: {
      ...first.recurrence!,
      originalStart,
      remainingCount: count === null ? null : count - countBefore(series, originalStart),
    },
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

/** One occurrence of a series as now stored, by its original start. */
async function getOccurrence(id: string, originalStart: string): Promise<CalendarEvent> {
  const row = await prisma.event.findUniqueOrThrow({ where: { id }, include: seriesInclude });
  const series = seriesOf(row);
  const exception = row.exceptions.find((each) => originalStartOf(each) === originalStart);
  const times =
    exception && isMoved(exception)
      ? timesOf(exception)
      : { ...occurrenceAt(series, originalStart)!, isAllDay: row.isAllDay };
  return occurrenceOf(toCalendarEvent(row), series, originalStart, times, exception);
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
  const { isAllDay, ...time } = timeColumns(draft.time);
  return {
    ok: true,
    data: {
      title: draft.title,
      description: draft.description,
      location: draft.location,
      category: draft.category,
      ownerType: draft.owner.type,
      ownerUserId,
      isAllDay,
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
 * Within a transaction: raises the event's version, as the user who changed it, but only
 * if it is still at the version the user loaded. False if it was saved or deleted since.
 */
async function bumpVersion(
  tx: Prisma.TransactionClient,
  id: string,
  expectedVersion: number,
  actorUserId: string,
  data: Prisma.EventUncheckedUpdateManyInput = {},
): Promise<boolean> {
  const { count } = await tx.event.updateMany({
    where: { id, version: expectedVersion, deletedAt: null },
    data: { ...data, updatedByUserId: actorUserId, version: { increment: 1 } },
  });
  return count === 1;
}

/** A series, and the occurrence a change was made from (by its original start). */
async function findOccurrence(id: string, originalStart: string) {
  const row = await prisma.event.findFirst({
    where: { id, deletedAt: null, rrule: { not: null } },
    include: seriesInclude,
  });
  if (!row) return null;
  const series = seriesOf(row);
  const occurrence = occurrenceAt(series, originalStart);
  return occurrence && { row, series, occurrence };
}

/**
 * Whether a change keeps the occurrences where they were: the same times and the same
 * days. Changes to single occurrences survive only such a change (changing where the
 * series ends drops just the occurrences it no longer has).
 */
function keepsTiming(
  before: { isAllDay: boolean; start: string; end: string; rrule: string | null },
  draft: EventDraft,
): boolean {
  const after = draftTimes(draft.time);
  return (
    draft.rrule !== null &&
    before.isAllDay === after.isAllDay &&
    before.start === after.start &&
    before.end === after.end &&
    rulePattern(before.rrule) === rulePattern(draft.rrule)
  );
}

/** The exceptions a series keeps under its new rule: those of occurrences it still has. */
function exceptionsKept(
  exceptions: ExceptionRow[],
  before: { isAllDay: boolean; start: string; end: string; rrule: string | null },
  draft: EventDraft,
): ExceptionRow[] {
  if (!keepsTiming(before, draft)) return [];
  const { isAllDay, start, end } = draftTimes(draft.time);
  const series: Series = { rrule: draft.rrule!, isAllDay, start, end, timezone: draft.timezone };
  return exceptions.filter((exception) => occurrenceAt(series, originalStartOf(exception)));
}

/**
 * Saves a change to an event. expectedVersion is the version the user loaded: if someone
 * saved or deleted the event since, nothing is changed and the result is "conflict", so
 * one person's edit never silently overwrites the other's. For an occurrence of a series,
 * target says which occurrences the change is for.
 */
export async function updateEvent(
  id: string,
  expectedVersion: number,
  draft: EventDraft,
  actorUserId: string,
  target?: OccurrenceTarget,
): Promise<EventResult> {
  if (target?.scope === "this") {
    return updateOccurrence(id, expectedVersion, target.originalStart, draft, actorUserId);
  }
  if (target?.scope === "following") {
    return updateFollowing(id, expectedVersion, target.originalStart, draft, actorUserId);
  }
  return updateAll(id, expectedVersion, draft, actorUserId);
}

/**
 * Replaces the whole event with the draft. On a series, changes to single occurrences
 * are kept if the times and days stay the same, and dropped if they change.
 */
async function updateAll(
  id: string,
  expectedVersion: number,
  draft: EventDraft,
  actorUserId: string,
): Promise<EventResult> {
  const columns = await columnsFor(draft);
  if (!columns.ok) return columns;
  const row = await prisma.event.findFirst({
    where: { id, deletedAt: null },
    include: seriesInclude,
  });
  if (!row) return NOT_FOUND;
  const kept = new Set(
    exceptionsKept(row.exceptions, { ...timesOf(row), rrule: row.rrule }, draft).map(
      (exception) => exception.id,
    ),
  );
  const dropped = row.exceptions.filter((exception) => !kept.has(exception.id));

  const saved = await prisma.$transaction(async (tx) => {
    if (!(await bumpVersion(tx, id, expectedVersion, actorUserId, columns.data))) return false;
    await tx.eventException.deleteMany({ where: { id: { in: dropped.map((each) => each.id) } } });
    return true;
  });
  if (!saved) return missingOrConflict(id);
  return { ok: true, event: (await getEvent(id))! };
}

/**
 * One occurrence of a series takes the draft's details and times, as an exception: only
 * what differs from the series is stored, so later changes to the series still reach the
 * rest. An occurrence changed back to match the series has no exception any more. The
 * owner stays the series'.
 */
async function updateOccurrence(
  id: string,
  expectedVersion: number,
  originalStart: string,
  draft: EventDraft,
  actorUserId: string,
): Promise<EventResult> {
  const found = await findOccurrence(id, originalStart);
  if (!found) return missingOrConflict(id);
  const { row, series, occurrence } = found;

  // A description or location cleared on this occurrence only is stored as "".
  const text = (value: string | null, ofSeries: string | null) =>
    value === ofSeries ? null : (value ?? "");
  const times = draftTimes(draft.time);
  const sameTimes =
    times.isAllDay === row.isAllDay &&
    times.start === occurrence.start &&
    times.end === occurrence.end;
  const changes = {
    title: draft.title === row.title ? null : draft.title,
    description: text(draft.description, row.description),
    location: text(draft.location, row.location),
    category: draft.category === row.category ? null : draft.category,
    ...(sameTimes ? {} : timeColumns(draft.time)),
  };
  const changed = Object.values(changes).some((value) => value !== null);

  const saved = await setException(
    id,
    expectedVersion,
    actorUserId,
    series,
    occurrence,
    changed && changes,
  );
  if (!saved) return missingOrConflict(id);
  return { ok: true, event: await getOccurrence(id, occurrence.start) };
}

/**
 * Within one transaction: raises the series' version and replaces the exception of one
 * occurrence (none if exception is false).
 */
async function setException(
  id: string,
  expectedVersion: number,
  actorUserId: string,
  series: Series,
  occurrence: Occurrence,
  exception: Omit<Prisma.EventExceptionUncheckedCreateInput, "eventId" | "updatedByUserId"> | false,
): Promise<boolean> {
  const key = originalStartColumn(series, occurrence.start);
  return prisma.$transaction(async (tx) => {
    if (!(await bumpVersion(tx, id, expectedVersion, actorUserId))) return false;
    await tx.eventException.deleteMany({ where: { eventId: id, ...key } });
    if (exception) {
      await tx.eventException.create({
        data: { ...exception, ...key, eventId: id, updatedByUserId: actorUserId },
      });
    }
    return true;
  });
}

/**
 * "This and following": the series stops before the occurrence, and a new series (or a
 * one-off event, if the draft doesn't repeat) starts from it, pointing back to the
 * original. Changes to the later occurrences move to the new series if the times and
 * days stay the same, and are dropped otherwise. From the first occurrence, it is a
 * change to the whole series.
 */
async function updateFollowing(
  id: string,
  expectedVersion: number,
  originalStart: string,
  draft: EventDraft,
  actorUserId: string,
): Promise<EventResult> {
  const found = await findOccurrence(id, originalStart);
  if (!found) return missingOrConflict(id);
  const { row, series, occurrence } = found;
  if (occurrence.start === series.start) {
    return updateAll(id, expectedVersion, draft, actorUserId);
  }
  const columns = await columnsFor(draft);
  if (!columns.ok) return columns;

  const later = row.exceptions.filter(
    (exception) => originalStartOf(exception) >= occurrence.start,
  );
  const moved = exceptionsKept(
    later,
    { isAllDay: row.isAllDay, ...occurrence, rrule: row.rrule },
    draft,
  ).map((exception) => exception.id);

  const newId = await prisma.$transaction(async (tx) => {
    const rrule = endBefore(series, occurrence.start);
    if (!(await bumpVersion(tx, id, expectedVersion, actorUserId, { rrule }))) return null;
    const created = await tx.event.create({
      data: {
        ...(columns.data as Prisma.EventUncheckedCreateInput),
        splitFromEventId: id,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
      },
      select: { id: true },
    });
    await tx.eventException.updateMany({
      where: { id: { in: moved } },
      data: { eventId: created.id },
    });
    await tx.eventException.deleteMany({
      where: { id: { in: later.map((each) => each.id).filter((each) => !moved.includes(each)) } },
    });
    return created.id;
  });
  if (!newId) return missingOrConflict(id);
  return { ok: true, event: (await getEvent(newId))! };
}

/**
 * Deletes an event; for an occurrence of a series, target says which occurrences. The
 * whole event is soft-deleted: it disappears from the calendar but stays in the database
 * so the Google export (Phase 4) can delete its copy. The version goes up, like any change.
 */
export async function deleteEvent(
  id: string,
  expectedVersion: number,
  actorUserId: string,
  target?: OccurrenceTarget,
): Promise<{ ok: true } | EventFailure> {
  if (target && target.scope !== "all") {
    const found = await findOccurrence(id, target.originalStart);
    if (!found) return missingOrConflict(id);
    const { row, series, occurrence } = found;

    if (target.scope === "this") {
      const cancelled = { isCancelled: true };
      const saved = await setException(
        id,
        expectedVersion,
        actorUserId,
        series,
        occurrence,
        cancelled,
      );
      return saved ? { ok: true } : missingOrConflict(id);
    }
    // This and following, from a later occurrence: the series stops before it.
    if (occurrence.start !== series.start) {
      const later = row.exceptions
        .filter((exception) => originalStartOf(exception) >= occurrence.start)
        .map((exception) => exception.id);
      const saved = await prisma.$transaction(async (tx) => {
        const rrule = endBefore(series, occurrence.start);
        if (!(await bumpVersion(tx, id, expectedVersion, actorUserId, { rrule }))) return false;
        await tx.eventException.deleteMany({ where: { id: { in: later } } });
        return true;
      });
      return saved ? { ok: true } : missingOrConflict(id);
    }
  }

  const saved = await prisma.$transaction((tx) =>
    bumpVersion(tx, id, expectedVersion, actorUserId, { deletedAt: new Date() }),
  );
  return saved ? { ok: true } : missingOrConflict(id);
}

async function missingOrConflict(id: string): Promise<EventFailure> {
  const existing = await prisma.event.findUnique({ where: { id }, select: { deletedAt: true } });
  // Missing or deleted (possibly by the other user meanwhile): not found.
  // Still there but at another version: someone else saved it first.
  return existing && !existing.deletedAt ? { ok: false, reason: "conflict" } : NOT_FOUND;
}
