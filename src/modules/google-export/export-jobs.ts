// Runs the export jobs against Google: creates the "Our Calendar" calendar, exports every
// event to it, and keeps each event's copy up to date. Every job reads the current state
// when it runs and is safe to run again, so a retry never makes a duplicate.

import "server-only";
import { createTranslator } from "next-intl";
import { appConfig } from "@/config/app.config";
import { prisma } from "@/lib/prisma";
import type {
  ExportJob,
  GoogleConnection,
  GoogleExportTarget,
  Prisma,
} from "@/generated/prisma/client";
import { dateFromDb } from "@/modules/events/time";
import { SHARED_OWNER } from "@/modules/events/validation";
import {
  type JobOutcome,
  enqueueEventExports,
  enqueueTargetJob,
  runDueJobs,
} from "@/modules/jobs/outbox";
import { getSharedColor, listCalendarUsers } from "@/modules/users/users";
import { type GoogleCalendarApi, GoogleApiError, failureKind, isFailure } from "./google-api";
import {
  type ExportContext,
  type ExportEvent,
  type GoogleEvent,
  googleEventId,
  instanceUpdates,
  toGoogleEvent,
} from "./mapping";

/** The name of the calendar the app creates in each connected account. */
export const CALENDAR_NAME = "Our Calendar";

/** lastError of a target whose calendar was deleted in Google. */
export const CALENDAR_DELETED = "calendarDeleted";

/** The Google API for a connection, with its user's tokens. */
export type ApiFor = (connection: GoogleConnection) => GoogleCalendarApi;

type Target = GoogleExportTarget & { connection: GoogleConnection };

/** Runs the export jobs that are due. Returns how many ran. */
export function runExportJobs(
  apiFor: ApiFor,
  options?: Parameters<typeof runDueJobs>[1],
): Promise<number> {
  return runDueJobs((job) => handleExportJob(job, apiFor), options);
}

/**
 * Does one job. A job for a target that is no longer exported to (disconnected, or
 * waiting for the user) is dropped: connecting again, or creating the calendar again,
 * exports everything.
 */
export async function handleExportJob(job: ExportJob, apiFor: ApiFor): Promise<JobOutcome> {
  const target = await prisma.googleExportTarget.findUnique({
    where: { id: job.exportTargetId },
    include: { connection: true },
  });
  if (!target || target.status !== "ACTIVE" || target.connection.status !== "ACTIVE") {
    return { ok: true };
  }
  const api = apiFor(target.connection);
  try {
    if (job.type === "CREATE_CALENDAR") await createCalendar(target, api);
    else if (job.type === "FULL_RECONCILE") await reconcile(target);
    else await syncEvent(target, api, job.eventId!);
  } catch (error) {
    if (!(error instanceof GoogleApiError)) throw error;
    return failed(target, api, error);
  }
  return { ok: true };
}

/**
 * A failed job: what it means for the target, and whether to try again. Revoked access
 * and a deleted calendar stop the whole target until the user acts.
 */
async function failed(target: Target, api: GoogleCalendarApi, error: GoogleApiError) {
  let kind = failureKind(error);
  let message = error.message;
  const stillActive = { id: target.id, status: "ACTIVE" as const };
  if (kind === "notFound") {
    // A 404 that wasn't expected: most likely the calendar was deleted in Google.
    const exists = target.googleCalendarId
      ? await api.calendarExists(target.googleCalendarId).catch(() => true)
      : true;
    if (!exists) {
      await prisma.googleExportTarget.updateMany({
        where: stillActive,
        data: { status: "NEEDS_ACTION", lastError: CALENDAR_DELETED },
      });
      return { ok: false, error: CALENDAR_DELETED, retry: false } as const;
    }
    kind = "temporary";
  }
  // Only while still connected: the user may have disconnected while the job ran.
  if (kind === "reauth") {
    await prisma.googleConnection.updateMany({
      where: { id: target.connectionId, status: "ACTIVE" },
      data: { status: "NEEDS_REAUTH", lastError: message },
    });
  } else {
    await prisma.googleExportTarget.updateMany({
      where: stillActive,
      data: { lastError: message },
    });
  }
  if (kind !== "temporary") message = `${message} (${kind})`;
  return { ok: false, error: message, retry: kind === "temporary" } as const;
}

/**
 * Creates the calendar, then queues the export of every event. A calendar created
 * before (connecting again) is kept if it is still there; if it was deleted, a new one
 * starts empty. If the calendar was created but saving its id failed, a retry creates a
 * second one: the app may not list the user's calendars to find it, and the chance is
 * small.
 */
async function createCalendar(target: Target, api: GoogleCalendarApi) {
  if (target.googleCalendarId && !(await api.calendarExists(target.googleCalendarId))) {
    await prisma.eventExportMapping.deleteMany({ where: { exportTargetId: target.id } });
    target.googleCalendarId = null;
  }
  if (!target.googleCalendarId) {
    const t = await translator();
    const { id } = await api.createCalendar({
      summary: CALENDAR_NAME,
      description: t("calendarDescription"),
      timeZone: appConfig.timeZone,
    });
    target.googleCalendarId = id;
  }
  await prisma.$transaction(async (tx) => {
    await tx.googleExportTarget.update({
      where: { id: target.id },
      data: { googleCalendarId: target.googleCalendarId, lastError: null },
    });
    await enqueueTargetJob(tx, target.id, "FULL_RECONCILE");
  });
}

/**
 * Queues the export of every event to the target, past ones too, and the deletion of
 * every deleted event it still has. Each event is its own job, so one failure doesn't
 * hold up the rest, and the number of jobs left shows the progress.
 */
async function reconcile(target: Target) {
  if (!target.googleCalendarId) {
    await enqueueTargetJob(prisma, target.id, "CREATE_CALENDAR");
    return;
  }
  const events = await prisma.event.findMany({
    where: {
      OR: [
        { deletedAt: null },
        { exportMappings: { some: { exportTargetId: target.id, status: "EXPORTED" } } },
      ],
    },
    select: { id: true },
  });
  await enqueueEventExports(
    prisma,
    events.map((event) => event.id),
    undefined,
    target.id,
  );
}

/** Brings the event's copy in Google to the event's current state. */
async function syncEvent(target: Target, api: GoogleCalendarApi, eventId: string) {
  const calendarId = target.googleCalendarId;
  // No calendar yet: creating it exports every event.
  if (!calendarId) return;
  const row = await prisma.event.findUnique({
    where: { id: eventId },
    include: eventInclude,
  });
  if (!row) return;
  const key = { exportTargetId: target.id, eventId };
  const mapping = await prisma.eventExportMapping.findUnique({
    where: { exportTargetId_eventId: key },
  });
  const googleId = googleEventId(row.id);

  let status: "EXPORTED" | "DELETED";
  let exported: string[] = [];
  if (row.deletedAt) {
    // Deleted even without a mapping: an earlier attempt may have created the event and
    // failed before saving one.
    if (mapping?.status !== "DELETED") await ignoreMissing(api.deleteEvent(calendarId, googleId));
    status = "DELETED";
  } else {
    const event = toExportEvent(row);
    const context = await exportContext();
    await putEvent(api, calendarId, toGoogleEvent(event, context), mapping?.status === "EXPORTED");
    const occurrences = instanceUpdates(event, context, mapping?.exportedOccurrences ?? []);
    for (const update of occurrences.updates) {
      if (update.kind === "change") {
        await api.updateEvent(calendarId, update.instance.id, update.instance);
      } else {
        await ignoreMissing(api.deleteEvent(calendarId, update.instanceId));
      }
    }
    status = "EXPORTED";
    exported = occurrences.exported;
  }

  const now = new Date();
  const data = {
    googleEventId: googleId,
    exportedVersion: row.version,
    exportedOccurrences: exported,
    status,
    lastExportedAt: now,
    lastError: null,
  };
  await prisma.$transaction([
    prisma.eventExportMapping.upsert({
      where: { exportTargetId_eventId: key },
      create: { ...key, ...data },
      update: data,
    }),
    prisma.googleExportTarget.update({
      where: { id: target.id },
      data: { lastSuccessfulExportAt: now, lastError: null },
    }),
  ]);
}

/**
 * Creates the event in Google, or replaces it if it is there (also deleted, which brings
 * it back). One known to be there is replaced first; otherwise created first, and a 409
 * means an earlier attempt already created it.
 */
async function putEvent(
  api: GoogleCalendarApi,
  calendarId: string,
  event: GoogleEvent,
  knownToExist: boolean,
) {
  if (knownToExist) {
    try {
      await api.updateEvent(calendarId, event.id, event);
      return;
    } catch (error) {
      if (!isFailure(error, "notFound")) throw error;
    }
  }
  try {
    await api.insertEvent(calendarId, event);
  } catch (error) {
    if (!isFailure(error, "conflict")) throw error;
    await api.updateEvent(calendarId, event.id, event);
  }
}

/** A deletion of something Google no longer has is done. */
async function ignoreMissing(call: Promise<void>) {
  try {
    await call;
  } catch (error) {
    if (!isFailure(error, "notFound", "gone")) throw error;
  }
}

type TimeColumns = {
  isAllDay: boolean | null;
  startAt: Date | null;
  endAt: Date | null;
  startDate: Date | null;
  endDate: Date | null;
};

function timesOf(row: TimeColumns) {
  return row.isAllDay
    ? { isAllDay: true, start: dateFromDb(row.startDate!), end: dateFromDb(row.endDate!) }
    : { isAllDay: false, start: row.startAt!.toISOString(), end: row.endAt!.toISOString() };
}

const eventInclude = {
  owner: { select: { configKey: true } },
  exceptions: true,
} satisfies Prisma.EventInclude;

type EventRow = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

function toExportEvent(row: EventRow): ExportEvent {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    description: row.description,
    location: row.location,
    category: row.category,
    owner: row.ownerType === "SHARED" ? SHARED_OWNER : row.owner!.configKey,
    ...timesOf(row),
    timezone: row.timezone,
    rrule: row.rrule,
    exceptions: row.exceptions.map((exception) => ({
      originalStart: exception.originalStartAt
        ? exception.originalStartAt.toISOString()
        : dateFromDb(exception.originalStartDate!),
      isCancelled: exception.isCancelled,
      title: exception.title,
      description: exception.description,
      location: exception.location,
      category: exception.category,
      moved: exception.isAllDay === null ? null : timesOf(exception),
    })),
  };
}

/** The users' names and current colors, and the title wording, from config and messages. */
async function exportContext(): Promise<ExportContext> {
  const [users, sharedColor, t] = await Promise.all([
    listCalendarUsers(),
    getSharedColor(),
    translator(),
  ]);
  return {
    ownerNames: Object.fromEntries(users.map((user) => [user.configKey, user.displayName])),
    colors: {
      ...Object.fromEntries(users.map((user) => [user.configKey, user.color])),
      [SHARED_OWNER]: sharedColor,
    },
    ownedTitle: (owner, title) => t("ownedTitle", { owner, title }),
  };
}

/** The export's messages. Jobs also run outside a request, so not via getTranslations. */
async function translator() {
  const messages = (await import(`../../../messages/${appConfig.locale}.json`)).default;
  return createTranslator({ locale: appConfig.locale, messages, namespace: "googleExport" });
}
