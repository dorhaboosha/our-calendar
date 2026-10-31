import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { dateFromDb, dateToDb, instantRangeToDates } from "./time";
import { SHARED_OWNER, type EventDraft } from "./validation";

/** Longest range the calendar may ask for (a month view shows at most 6 weeks). */
export const MAX_RANGE_DAYS = 100;

/**
 * An event as sent to the browser. Timed events: start/end are ISO instants.
 * All-day events: start/end are "YYYY-MM-DD" dates with an EXCLUSIVE end, which is
 * also what FullCalendar expects.
 */
export type CalendarEvent = {
  id: string;
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

function toCalendarEvent(row: EventRow): CalendarEvent {
  const [start, end] = row.isAllDay
    ? [dateFromDb(row.startDate!), dateFromDb(row.endDate!)]
    : [row.startAt!.toISOString(), row.endAt!.toISOString()];
  return {
    id: row.id,
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
 * Events that overlap the half-open range [start, end), oldest start first. Deleted
 * events are left out. All-day events are matched by the local dates the range covers.
 */
export async function listEvents(
  start: Date,
  end: Date,
  timeZone: string,
): Promise<CalendarEvent[]> {
  const dates = instantRangeToDates(start, end, timeZone);
  const rows = await prisma.event.findMany({
    where: {
      deletedAt: null,
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
  return rows.map(toCalendarEvent).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
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
      ...time,
    },
  };
}

export async function createEvent(draft: EventDraft, actorUserId: string): Promise<EventResult> {
  const columns = await columnsFor(draft);
  if (!columns.ok) return columns;
  const row = await prisma.event.create({
    data: {
      ...(columns.data as Prisma.EventUncheckedCreateInput),
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
    },
    include: eventInclude,
  });
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
