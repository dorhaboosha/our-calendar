// The export outbox: jobs that bring the "Our Calendar" calendars in Google up to date.
// A change to an event adds its job in the same transaction as the change, so a saved
// change always has its export queued. Jobs carry no data: they read the current state
// when they run, so several changes in a row merge into one job.
//
// The events module only calls enqueueEventExports; it knows nothing about Google.

import "server-only";
import { prisma } from "@/lib/prisma";
import type { ExportJob, ExportJobType, Prisma } from "@/generated/prisma/client";

/** Waits before each retry of a failed job: 1 minute, 5, 15, an hour, then 6 hours. */
export const RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 360] as const;
/** After this many failed attempts a job stops and waits for "try again". */
export const MAX_ATTEMPTS = 8;
/** A job locked longer than this was left by a runner that died; it may run again. */
export const STALE_LOCK_MINUTES = 5;

const MINUTE = 60 * 1000;

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Within the transaction that changed the events: queues an export of each to every
 * active target. A job already queued for an event and target is reset to run now
 * (also one that had failed), instead of adding another. Targets that aren't active
 * get nothing: reconnecting exports everything anyway. With exportTargetId, only to that
 * target (a full export of one calendar).
 */
export async function enqueueEventExports(
  tx: Db,
  eventIds: string[],
  now = new Date(),
  exportTargetId: string | null = null,
) {
  if (eventIds.length === 0) return;
  await tx.$executeRaw`
    INSERT INTO "export_job"
      ("id", "type", "exportTargetId", "eventId", "status", "attemptCount", "nextAttemptAt",
       "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, 'SYNC_EVENT', target."id", event."id", 'PENDING', 0,
           ${now}, ${now}, ${now}
      FROM "google_export_target" target
      JOIN "google_connection" connection ON connection."id" = target."connectionId"
     CROSS JOIN unnest(${eventIds}::text[]) AS event("id")
     WHERE target."status" = 'ACTIVE' AND connection."status" = 'ACTIVE'
       AND (${exportTargetId}::text IS NULL OR target."id" = ${exportTargetId})
    ON CONFLICT ("exportTargetId", "eventId") WHERE "eventId" IS NOT NULL
    DO UPDATE SET "status" = 'PENDING', "attemptCount" = 0, "nextAttemptAt" = ${now},
                  "lastError" = NULL, "updatedAt" = ${now}`;
}

/**
 * Queues a job for a whole target (creating its calendar, or exporting every event).
 * Like enqueueEventExports, one already queued is reset rather than doubled.
 */
export async function enqueueTargetJob(
  tx: Db,
  exportTargetId: string,
  type: Exclude<ExportJobType, "SYNC_EVENT">,
  now = new Date(),
) {
  await tx.$executeRaw`
    INSERT INTO "export_job"
      ("id", "type", "exportTargetId", "status", "attemptCount", "nextAttemptAt",
       "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${type}::"ExportJobType", ${exportTargetId}, 'PENDING', 0,
            ${now}, ${now}, ${now})
    ON CONFLICT ("exportTargetId", "type") WHERE "eventId" IS NULL
    DO UPDATE SET "status" = 'PENDING', "attemptCount" = 0, "nextAttemptAt" = ${now},
                  "lastError" = NULL, "updatedAt" = ${now}`;
}

/**
 * Takes up to limit jobs that are due, and locks them for this runner. Two runners at
 * once (a request and the periodic trigger) never take the same job: rows another
 * transaction is taking are skipped. A stale lock is taken over.
 */
export async function claimJobs(limit: number, now = new Date()): Promise<ExportJob[]> {
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MINUTES * MINUTE);
  return prisma.$queryRaw<ExportJob[]>`
    UPDATE "export_job" SET "lockedAt" = ${now}
     WHERE "id" IN (
       SELECT "id" FROM "export_job"
        WHERE "status" = 'PENDING' AND "nextAttemptAt" <= ${now}
          AND ("lockedAt" IS NULL OR "lockedAt" < ${staleBefore})
        ORDER BY "nextAttemptAt", "createdAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING *`;
}

/**
 * A job that succeeded is deleted, unless it was queued again while it ran (its
 * updatedAt moved on): then the newer change still has to be exported, so it is only
 * unlocked.
 */
export async function completeJob(job: ExportJob): Promise<void> {
  const { count } = await prisma.exportJob.deleteMany({
    where: { id: job.id, updatedAt: job.updatedAt },
  });
  if (count === 0) {
    await prisma.exportJob.updateMany({ where: { id: job.id }, data: { lockedAt: null } });
  }
}

/**
 * A job that failed. A temporary failure (network, Google busy) is retried later, with
 * longer waits each time, up to MAX_ATTEMPTS; a permanent one, or one that ran out of
 * attempts, stops as FAILED until someone tries again. error is a short description
 * for the settings page, never containing a token.
 *
 * Like completeJob: a job queued again while it ran (its updatedAt moved on) is only
 * unlocked, so the newer change runs now, with its attempts counted from zero.
 */
export async function failJob(
  job: ExportJob,
  error: string,
  { retry }: { retry: boolean },
  now = new Date(),
): Promise<void> {
  const attemptCount = job.attemptCount + 1;
  const delay = RETRY_DELAYS_MINUTES[Math.min(attemptCount, RETRY_DELAYS_MINUTES.length) - 1];
  const failed = !retry || attemptCount >= MAX_ATTEMPTS;
  const { count } = await prisma.exportJob.updateMany({
    where: { id: job.id, updatedAt: job.updatedAt },
    data: {
      attemptCount,
      lastError: error,
      lockedAt: null,
      ...(failed
        ? { status: "FAILED" }
        : { nextAttemptAt: new Date(now.getTime() + delay * MINUTE) }),
    },
  });
  if (count === 0) {
    await prisma.exportJob.updateMany({ where: { id: job.id }, data: { lockedAt: null } });
  }
}

/** What a job's handler reports. */
export type JobOutcome = { ok: true } | { ok: false; error: string; retry: boolean };

/**
 * Runs the jobs that are due, one at a time, with handle doing the work (the Google
 * export). A handler that throws counts as a temporary failure. Returns how many ran.
 */
export async function runDueJobs(
  handle: (job: ExportJob) => Promise<JobOutcome>,
  { limit = 20, now = () => new Date() }: { limit?: number; now?: () => Date } = {},
): Promise<number> {
  const jobs = await claimJobs(limit, now());
  for (const job of jobs) {
    let outcome: JobOutcome;
    try {
      outcome = await handle(job);
    } catch {
      outcome = { ok: false, error: "unexpected", retry: true };
    }
    if (outcome.ok) await completeJob(job);
    else await failJob(job, outcome.error, { retry: outcome.retry }, now());
  }
  return jobs.length;
}
