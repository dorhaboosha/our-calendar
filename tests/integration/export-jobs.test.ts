import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { type CalendarEvent, createEvent, deleteEvent, updateEvent } from "@/modules/events/events";
import { type EventInput, validateEvent } from "@/modules/events/validation";
import {
  MAX_ATTEMPTS,
  claimJobs,
  completeJob,
  enqueueEventExports,
  enqueueTargetJob,
  failJob,
  runDueJobs,
} from "@/modules/jobs/outbox";

// The export outbox: every change to an event queues its export, in the same
// transaction, once per active target; runners take due jobs without doubling up, and
// failures are retried with growing waits.

let dorId: string;
let maayanId: string;
let targetId: string;

beforeEach(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  dorId = (await createUser("dor")).id;
  maayanId = (await createUser("maayan")).id;
  targetId = await connect(dorId, { status: "ACTIVE" });
});

afterAll(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

function createUser(configKey: string) {
  return prisma.user.create({
    data: { id: randomUUID(), name: configKey, email: `${configKey}@example.com`, configKey },
  });
}

/** A Google connection with its export target; returns the target's id. */
async function connect(
  userId: string,
  {
    status,
    connectionStatus = "ACTIVE",
  }: {
    status: "ACTIVE" | "NEEDS_ACTION" | "DISABLED";
    connectionStatus?: "ACTIVE" | "NEEDS_REAUTH";
  },
) {
  const connection = await prisma.googleConnection.create({
    data: {
      userId,
      googleAccountId: `sub-${userId}`,
      status: connectionStatus,
      encryptedRefreshToken: "v1.iv.tag.ciphertext",
      grantedScopes: "https://www.googleapis.com/auth/calendar.app.created",
    },
  });
  const target = await prisma.googleExportTarget.create({
    data: { connectionId: connection.id, status, googleCalendarId: `calendar-${userId}` },
  });
  return target.id;
}

const dinner: EventInput = {
  title: "Dinner",
  owner: "shared",
  category: "couple",
  isAllDay: false,
  startDate: "2026-11-05",
  endDate: "2026-11-05",
  startTime: "19:00",
  endTime: "21:00",
};

function draft(overrides: Partial<EventInput> = {}) {
  const result = validateEvent({ ...dinner, ...overrides });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.draft;
}

async function create(overrides: Partial<EventInput> = {}): Promise<CalendarEvent> {
  const result = await createEvent(draft(overrides), dorId);
  if (!result.ok) throw new Error(result.reason);
  return result.event;
}

const jobs = () =>
  prisma.exportJob.findMany({ orderBy: { createdAt: "asc" } }).then((rows) =>
    rows.map(({ type, eventId, exportTargetId, status, attemptCount }) => ({
      type,
      eventId,
      exportTargetId,
      status,
      attemptCount,
    })),
  );

describe("queuing exports", () => {
  it("a new event queues one job per active target, and none for the others", async () => {
    const maayanTarget = await connect(maayanId, { status: "ACTIVE" });
    await prisma.googleExportTarget.update({
      where: { id: maayanTarget },
      data: { status: "NEEDS_ACTION" },
    });
    const event = await create();
    expect(await jobs()).toEqual([
      {
        type: "SYNC_EVENT",
        eventId: event.id,
        exportTargetId: targetId,
        status: "PENDING",
        attemptCount: 0,
      },
    ]);
  });

  it("nothing is queued with no connection, or one that needs signing in again", async () => {
    await prisma.googleConnection.updateMany({
      data: { status: "NEEDS_REAUTH", encryptedRefreshToken: null },
    });
    await create();
    expect(await jobs()).toEqual([]);
  });

  it("several changes in a row merge into one job, which a failure doesn't stop", async () => {
    const event = await create();
    await prisma.exportJob.updateMany({ data: { status: "FAILED", attemptCount: 8 } });
    const updated = await updateEvent(event.id, 1, draft({ title: "Dinner out" }), dorId);
    expect(updated.ok).toBe(true);
    await deleteEvent(event.id, 2, dorId);
    expect(await jobs()).toEqual([
      expect.objectContaining({ eventId: event.id, status: "PENDING", attemptCount: 0 }),
    ]);
  });

  it("a change to one occurrence, and a split series, queue their events", async () => {
    const series = await create({ repeat: { frequency: "daily", end: "never" } });
    await prisma.exportJob.deleteMany();
    const occurrence = { originalStart: "2026-11-06T17:00:00.000Z" };
    await updateEvent(
      series.id,
      1,
      draft({ title: "Late", startDate: "2026-11-06", endDate: "2026-11-06", repeat: undefined }),
      dorId,
      { scope: "this", ...occurrence },
    );
    expect((await jobs()).map((job) => job.eventId)).toEqual([series.id]);

    const split = await updateEvent(
      series.id,
      2,
      draft({
        startDate: "2026-11-08",
        endDate: "2026-11-08",
        repeat: { frequency: "daily", end: "never" },
      }),
      dorId,
      { scope: "following", originalStart: "2026-11-08T17:00:00.000Z" },
    );
    if (!split.ok) throw new Error(split.reason);
    expect(new Set((await jobs()).map((job) => job.eventId))).toEqual(
      new Set([series.id, split.event.id]),
    );
  });

  it("a change that is refused queues nothing", async () => {
    const event = await create();
    await prisma.exportJob.deleteMany();
    expect(await updateEvent(event.id, 7, draft(), dorId)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await jobs()).toEqual([]);
  });

  it("jobs for a whole target merge the same way", async () => {
    await enqueueTargetJob(prisma, targetId, "CREATE_CALENDAR");
    await enqueueTargetJob(prisma, targetId, "FULL_RECONCILE");
    await enqueueTargetJob(prisma, targetId, "FULL_RECONCILE");
    expect((await jobs()).map((job) => job.type)).toEqual(["CREATE_CALENDAR", "FULL_RECONCILE"]);
  });
});

describe("running jobs", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 18, 12, minutes));

  async function queued(count: number) {
    const ids = await Promise.all(
      Array.from({ length: count }, () => create().then((event) => event.id)),
    );
    await prisma.exportJob.deleteMany();
    await enqueueEventExports(prisma, ids, at(0));
    return ids;
  }

  it("two runners at once never take the same job", async () => {
    await queued(6);
    const [first, second] = await Promise.all([claimJobs(4, at(1)), claimJobs(4, at(1))]);
    const taken = [...first, ...second].map((job) => job.id);
    expect(taken).toHaveLength(6);
    expect(new Set(taken).size).toBe(6);
    expect(await claimJobs(4, at(2))).toEqual([]);
  });

  it("never takes more jobs than asked for", async () => {
    await queued(30);
    expect(await claimJobs(20, at(1))).toHaveLength(20);
    expect(await claimJobs(20, at(1))).toHaveLength(10);
  });

  it("takes only jobs that are due, and a lock left by a runner that died", async () => {
    await queued(1);
    expect(await claimJobs(5, new Date(at(0).getTime() - 1000))).toEqual([]);
    expect(await claimJobs(5, at(1))).toHaveLength(1);
    expect(await claimJobs(5, at(3))).toEqual([]);
    // Locked at 12:01; after five minutes the lock is stale.
    expect(await claimJobs(5, at(7))).toHaveLength(1);
  });

  it("a done job is deleted, unless it was queued again while it ran", async () => {
    const [eventId] = await queued(1);
    let [job] = await claimJobs(1, at(1));
    await completeJob(job);
    expect(await jobs()).toEqual([]);

    await enqueueEventExports(prisma, [eventId], at(2));
    [job] = await claimJobs(1, at(3));
    await enqueueEventExports(prisma, [eventId], at(4));
    await completeJob(job);
    expect(await claimJobs(1, at(5))).toHaveLength(1);
  });

  it("retries a temporary failure later each time, then stops", async () => {
    await queued(1);
    const waits: number[] = [];
    let now = at(1);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const [job] = await claimJobs(1, now);
      expect(job).toBeDefined();
      await failJob(job, "Google didn't answer", { retry: true }, now);
      const after = await prisma.exportJob.findFirstOrThrow();
      if (after.status === "FAILED") break;
      waits.push((after.nextAttemptAt.getTime() - now.getTime()) / 60000);
      now = after.nextAttemptAt;
    }
    expect(waits).toEqual([1, 5, 15, 60, 360, 360, 360]);
    expect(await prisma.exportJob.findFirstOrThrow()).toMatchObject({
      status: "FAILED",
      attemptCount: MAX_ATTEMPTS,
      lastError: "Google didn't answer",
      lockedAt: null,
    });
    expect(await claimJobs(1, at(59))).toEqual([]);
  });

  it("a permanent failure stops at once", async () => {
    await queued(1);
    const [job] = await claimJobs(1, at(1));
    await failJob(job, "access revoked", { retry: false }, at(1));
    expect(await prisma.exportJob.findFirstOrThrow()).toMatchObject({
      status: "FAILED",
      attemptCount: 1,
    });
  });

  it("a failure doesn't hold up a change queued while the job ran, even on its last attempt", async () => {
    const [eventId] = await queued(1);
    await prisma.exportJob.updateMany({ data: { attemptCount: MAX_ATTEMPTS - 1 } });
    const [job] = await claimJobs(1, at(1));
    await enqueueEventExports(prisma, [eventId], at(2));
    await failJob(job, "Google didn't answer", { retry: true }, at(3));
    expect(await prisma.exportJob.findFirstOrThrow()).toMatchObject({
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: at(2),
      lastError: null,
      lockedAt: null,
    });
    expect(await claimJobs(1, at(3))).toHaveLength(1);
  });

  it("runs a whole target's job first, alone, then the events' jobs a few at a time", async () => {
    const ids = await queued(10);
    await enqueueTargetJob(prisma, targetId, "FULL_RECONCILE", at(0));
    const order: string[] = [];
    let running = 0;
    let most = 0;
    const ran = await runDueJobs(
      async (job) => {
        running++;
        most = Math.max(most, running);
        order.push(job.eventId ?? job.type);
        await new Promise((resolve) => setTimeout(resolve, 20));
        running--;
        return { ok: true };
      },
      { concurrency: 3, now: () => at(1) },
    );
    expect(ran).toBe(11);
    expect(order[0]).toBe("FULL_RECONCILE");
    expect(new Set(order.slice(1))).toEqual(new Set(ids));
    expect(most).toBe(3);
    expect(await prisma.exportJob.count()).toBe(0);
  });

  it("runs due jobs with a handler, counting a throw as a temporary failure", async () => {
    const ids = await queued(3);
    const handled: string[] = [];
    const ran = await runDueJobs(
      async (job) => {
        handled.push(job.eventId!);
        if (job.eventId === ids[1]) return { ok: false, error: "busy", retry: true };
        if (job.eventId === ids[2]) throw new Error("boom");
        return { ok: true };
      },
      { now: () => at(1) },
    );
    expect(ran).toBe(3);
    expect(new Set(handled)).toEqual(new Set(ids));
    expect(
      (await prisma.exportJob.findMany({ orderBy: { lastError: "asc" } })).map((job) => [
        job.eventId,
        job.lastError,
        job.attemptCount,
      ]),
    ).toEqual([
      [ids[1], "busy", 1],
      [ids[2], "unexpected", 1],
    ]);
  });
});
