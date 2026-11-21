import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { enqueueEventExports, enqueueTargetJob } from "@/modules/jobs/outbox";
import { FakeGoogle } from "./fake-google";

// When export jobs run: right after a change (after the response), on page views at
// most once a minute, and on request from the periodic trigger; runs in one server
// never overlap.

const scheduled: (() => unknown)[] = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => unknown) => scheduled.push(callback),
}));
vi.mock("@/modules/google-export/google-client", () => ({
  googleApiFor: () => google,
}));

const { runExportsNow, exportSoon, exportWhenDue, IDLE_CHECK_INTERVAL_MS } =
  await import("@/modules/google-export/trigger");

let google: FakeGoogle;
let dorId: string;
let targetId: string;

beforeEach(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  scheduled.length = 0;
  google = new FakeGoogle();
  dorId = (
    await prisma.user.create({
      data: { id: randomUUID(), name: "dor", email: "dor@example.com", configKey: "dor" },
    })
  ).id;
  const connection = await prisma.googleConnection.create({
    data: {
      userId: dorId,
      googleAccountId: "sub-dor",
      status: "ACTIVE",
      encryptedRefreshToken: "v1.iv.tag.ciphertext",
      grantedScopes: "openid",
    },
  });
  targetId = (
    await prisma.googleExportTarget.create({
      data: { connectionId: connection.id, status: "ACTIVE" },
    })
  ).id;
});

afterAll(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

async function events(count: number) {
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const event = await prisma.event.create({
      data: {
        title: `e${index}`,
        ownerType: "SHARED",
        category: "other",
        isAllDay: true,
        startDate: new Date("2026-11-05"),
        endDate: new Date("2026-11-06"),
        createdByUserId: dorId,
        updatedByUserId: dorId,
      },
    });
    ids.push(event.id);
  }
  return ids;
}

describe("a run", () => {
  it("runs jobs until none are left, including the ones jobs queue", async () => {
    await events(2);
    await enqueueTargetJob(prisma, targetId, "CREATE_CALENDAR");
    // Create the calendar, export everything (queuing two jobs), then the two events.
    expect(await runExportsNow({ apiFor: () => google })).toBe(4);
    expect(google.only().events.size).toBe(2);
    expect(await prisma.exportJob.count()).toBe(0);
  });

  it("a second run while one is going joins it, and runs once more after it", async () => {
    const first = runExportsNow({ apiFor: () => google });
    const second = runExportsNow({ apiFor: () => google });
    expect(second).toBe(first);
    await first;
  });

  it("stops taking jobs when its time is up", async () => {
    await enqueueTargetJob(prisma, targetId, "CREATE_CALENDAR");
    await runExportsNow({ apiFor: () => google });
    await enqueueEventExports(prisma, await events(25), undefined, targetId);
    // One round takes 20 jobs; with no time left, the other 5 wait for the next run.
    expect(await runExportsNow({ apiFor: () => google, budgetMs: 0 })).toBe(20);
    expect(await prisma.exportJob.count()).toBe(5);
  });
});

describe("scheduling", () => {
  it("after a change, the run waits for the response to be sent", async () => {
    await enqueueTargetJob(prisma, targetId, "CREATE_CALENDAR");
    exportSoon();
    expect(scheduled).toHaveLength(1);
    expect(google.calls).toEqual([]);
    await scheduled[0]();
    expect(google.calendars.size).toBe(1);
  });

  it("page views look for due jobs at most once a minute", async () => {
    const now = Date.now() + 10 * IDLE_CHECK_INTERVAL_MS;
    exportWhenDue(now);
    exportWhenDue(now + 1000);
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    exportWhenDue(Date.now() + 2 * IDLE_CHECK_INTERVAL_MS);
    expect(scheduled).toHaveLength(2);
  });
});
