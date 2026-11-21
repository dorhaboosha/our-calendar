import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createEvent, deleteEvent, updateEvent } from "@/modules/events/events";
import { type EventInput, validateEvent } from "@/modules/events/validation";
import { CALENDAR_DELETED, runExportJobs } from "@/modules/google-export/export-jobs";
import { googleEventId } from "@/modules/google-export/mapping";
import { enqueueTargetJob } from "@/modules/jobs/outbox";
import { FakeGoogle } from "./fake-google";

// The export against a fake Google: creating the calendar, exporting every event, keeping
// copies up to date (series and their occurrences too), recovering from edits made by
// hand in Google, and what each kind of failure does.

let dorId: string;
let google: FakeGoogle;

beforeEach(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  dorId = (await createUser("dor")).id;
  await createUser("maayan");
  google = new FakeGoogle();
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

const MINUTE = 60 * 1000;

/** Runs the due jobs until none are left, at a time from now. */
async function runAll(minutesLater = 0) {
  const now = () => new Date(Date.now() + minutesLater * MINUTE);
  for (let round = 0; round < 10; round++) {
    if ((await runExportJobs(() => google, { now })) === 0) return;
  }
  throw new Error("Jobs kept coming");
}

/** Dor connects the export: the connection, its target, and the job creating the calendar. */
async function connect() {
  const connection = await prisma.googleConnection.create({
    data: {
      userId: dorId,
      googleAccountId: "sub-dor",
      status: "ACTIVE",
      encryptedRefreshToken: "v1.iv.tag.ciphertext",
      grantedScopes: "https://www.googleapis.com/auth/calendar.app.created",
    },
  });
  const target = await prisma.googleExportTarget.create({
    data: { connectionId: connection.id, status: "ACTIVE" },
  });
  await enqueueTargetJob(prisma, target.id, "CREATE_CALENDAR");
  return target.id;
}

async function connected() {
  const targetId = await connect();
  await runAll();
  return targetId;
}

const dinner: EventInput = {
  title: "ארוחת ערב",
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

async function create(overrides: Partial<EventInput> = {}) {
  const result = await createEvent(draft(overrides), dorId);
  if (!result.ok) throw new Error(result.reason);
  return { id: result.event.id, googleId: googleEventId(result.event.id) };
}

const version = async (id: string) =>
  (await prisma.event.findUniqueOrThrow({ where: { id } })).version;

const jobs = () =>
  prisma.exportJob.findMany().then((rows) =>
    rows.map(({ type, status, attemptCount, lastError }) => ({
      type,
      status,
      attemptCount,
      lastError,
    })),
  );

const target = (id: string) =>
  prisma.googleExportTarget.findUniqueOrThrow({ where: { id }, include: { connection: true } });

describe("exporting", () => {
  it("connecting creates the calendar and exports every event, past ones too", async () => {
    const old = await create({
      title: "יום הולדת",
      startDate: "2025-03-01",
      endDate: "2025-03-01",
    });
    const dentist = await create({ title: "רופא שיניים", owner: "dor", category: "personal" });
    const targetId = await connect();
    await runAll();

    const calendar = google.only();
    expect(calendar).toMatchObject({ summary: "Our Calendar", timeZone: "Asia/Jerusalem" });
    expect(calendar.description).toContain("היומן שלנו");
    expect(google.event(old.googleId)).toMatchObject({ summary: "יום הולדת", status: "confirmed" });
    expect(google.event(dentist.googleId)).toMatchObject({ summary: "דור: רופא שיניים" });
    expect(calendar.events.size).toBe(2);

    expect(await prisma.eventExportMapping.findMany({ orderBy: { googleEventId: "asc" } })).toEqual(
      [old, dentist]
        .sort((a, b) => a.googleId.localeCompare(b.googleId))
        .map((event) =>
          expect.objectContaining({
            eventId: event.id,
            googleEventId: event.googleId,
            exportedVersion: 1,
            status: "EXPORTED",
          }),
        ),
    );
    expect(await target(targetId)).toMatchObject({
      googleCalendarId: expect.stringContaining("calendar-1"),
      lastSuccessfulExportAt: expect.any(Date),
      lastError: null,
    });
    expect(await jobs()).toEqual([]);
  });

  it("changes and deletions in the app reach Google", async () => {
    await connected();
    const { id, googleId } = await create();
    await runAll();
    expect(google.event(googleId)).toMatchObject({ summary: "ארוחת ערב" });

    await updateEvent(id, 1, draft({ title: "ארוחת ערב אצל ההורים", owner: "dor" }), dorId);
    await runAll();
    expect(google.event(googleId)).toMatchObject({
      summary: "דור: ארוחת ערב אצל ההורים",
      extendedProperties: { private: { version: "2", owner: "dor" } },
    });

    await deleteEvent(id, 2, dorId);
    await runAll();
    expect(google.event(googleId)).toMatchObject({ status: "cancelled" });
    expect(await prisma.eventExportMapping.findFirstOrThrow()).toMatchObject({
      status: "DELETED",
      exportedVersion: 3,
    });
    expect(google.calls.filter((call) => call.startsWith("insertEvent"))).toHaveLength(1);
  });

  it("a retry after a failure part way doesn't make a second copy", async () => {
    await connected();
    const series = await create({ repeat: { frequency: "daily", end: "never" } });
    await updateEvent(
      series.id,
      1,
      draft({ title: "מאוחר", startDate: "2026-11-06", endDate: "2026-11-06", repeat: undefined }),
      dorId,
      { scope: "this", originalStart: "2026-11-06T17:00:00.000Z" },
    );
    // The series is created, then updating its changed occurrence fails.
    google.failNext("updateEvent", 503, "backendError");
    await runAll();
    expect(await jobs()).toEqual([expect.objectContaining({ status: "PENDING", attemptCount: 1 })]);

    google.calls = [];
    await runAll(2);
    expect(google.calls).toEqual([
      `insertEvent ${series.googleId}`,
      `updateEvent ${series.googleId}`,
      `updateEvent ${series.googleId}_20261106T170000Z`,
    ]);
    expect(google.only().events.size).toBe(2);
    expect(await jobs()).toEqual([]);
  });

  it("export again brings back events deleted or edited by hand in Google", async () => {
    const targetId = await connected();
    const a = await create({ title: "א" });
    const b = await create({ title: "ב" });
    await runAll();
    google.deleteByHand(a.googleId);
    google.editByHand(b.googleId, { summary: "שונה ב-Google", location: "somewhere" });

    await enqueueTargetJob(prisma, targetId, "FULL_RECONCILE");
    await runAll();
    expect(google.event(a.googleId)).toMatchObject({ summary: "א", status: "confirmed" });
    expect(google.event(b.googleId)).toMatchObject({ summary: "ב", location: "" });
    expect(google.only().events.size).toBe(2);
  });

  it("a series: its occurrences changed, deleted, and changed back", async () => {
    await connected();
    const series = await create({ repeat: { frequency: "daily", end: "never" } });
    await runAll();
    expect(google.event(series.googleId)).toMatchObject({ recurrence: ["RRULE:FREQ=DAILY"] });
    const sixth = `${series.googleId}_20261106T170000Z`;
    const seventh = `${series.googleId}_20261107T170000Z`;
    const occurrence = (day: string, overrides: Partial<EventInput> = {}) =>
      draft({ startDate: day, endDate: day, repeat: undefined, ...overrides });

    await updateEvent(series.id, 1, occurrence("2026-11-06", { title: "מאוחר" }), dorId, {
      scope: "this",
      originalStart: "2026-11-06T17:00:00.000Z",
    });
    await deleteEvent(series.id, 2, dorId, {
      scope: "this",
      originalStart: "2026-11-07T17:00:00.000Z",
    });
    await runAll();
    expect(google.event(sixth)).toMatchObject({
      summary: "מאוחר",
      recurringEventId: series.googleId,
      status: "confirmed",
    });
    expect(google.event(seventh)).toMatchObject({ status: "cancelled" });
    expect((await prisma.eventExportMapping.findFirstOrThrow()).exportedOccurrences.sort()).toEqual(
      ["2026-11-06T17:00:00.000Z", "2026-11-07T17:00:00.000Z"],
    );

    // Changed back to the series' values: the occurrence gets them back in Google too.
    await updateEvent(series.id, 3, occurrence("2026-11-06"), dorId, {
      scope: "this",
      originalStart: "2026-11-06T17:00:00.000Z",
    });
    await runAll();
    expect(google.event(sixth)).toMatchObject({ summary: "ארוחת ערב", status: "confirmed" });

    // A new time for the whole series drops the changed occurrences; Google may have
    // kept them, so they are cancelled there (one already gone is fine).
    await updateEvent(
      series.id,
      await version(series.id),
      draft({ startTime: "20:00", endTime: "22:00", repeat: { frequency: "daily", end: "never" } }),
      dorId,
    );
    await runAll();
    expect(google.event(seventh)).toMatchObject({ status: "cancelled" });
    expect(google.event(series.googleId)).toMatchObject({
      start: { dateTime: "2026-11-05T20:00:00+02:00" },
    });
    expect((await prisma.eventExportMapping.findFirstOrThrow()).exportedOccurrences).toEqual([]);
    expect(await jobs()).toEqual([]);
  });
});

describe("failures", () => {
  it.each([
    [503, "backendError"],
    [429, "rateLimitExceeded"],
    [403, "userRateLimitExceeded"],
    [null, "ECONNRESET"],
  ])("a temporary failure (%s %s) is tried again later", async (status, reason) => {
    const targetId = await connected();
    const { googleId } = await create();
    google.failNext("insertEvent", status, reason);
    await runAll();
    const error = `google:${status ?? "network"} ${reason}`;
    expect(await jobs()).toEqual([
      { type: "SYNC_EVENT", status: "PENDING", attemptCount: 1, lastError: error },
    ]);
    expect(await target(targetId)).toMatchObject({ status: "ACTIVE", lastError: error });

    await runAll(2);
    expect(google.event(googleId)).toBeDefined();
    expect(await jobs()).toEqual([]);
    expect(await target(targetId)).toMatchObject({ lastError: null });
  });

  it("a missing event while the calendar is still there is tried again", async () => {
    await connected();
    await create();
    google.failNext("insertEvent", 404, "notFound");
    await runAll();
    expect(await jobs()).toEqual([expect.objectContaining({ status: "PENDING" })]);
  });

  it.each([
    [401, "authError"],
    [400, "invalid_grant"],
    [403, "insufficientPermissions"],
  ])("revoked access (%s %s) stops the export until connecting again", async (status, reason) => {
    const targetId = await connected();
    await create({ title: "א" });
    await create({ title: "ב" });
    google.failNext("insertEvent", status, reason);
    await runAll();

    expect(await target(targetId)).toMatchObject({
      status: "ACTIVE",
      connection: { status: "NEEDS_REAUTH", lastError: `google:${status} ${reason}` },
    });
    // The other event's job is dropped: connecting again exports everything.
    expect(await jobs()).toEqual([
      expect.objectContaining({
        status: "FAILED",
        lastError: `google:${status} ${reason} (reauth)`,
      }),
    ]);
    expect(google.only().events.size).toBe(0);
    await create({ title: "ג" });
    expect(await jobs()).toHaveLength(1);
  });

  it("a calendar deleted in Google waits for the user", async () => {
    const targetId = await connected();
    const { id } = await create();
    await runAll();
    google.deleteCalendarByHand();

    await updateEvent(id, 1, draft({ title: "חדש" }), dorId);
    await runAll();
    expect(await target(targetId)).toMatchObject({
      status: "NEEDS_ACTION",
      lastError: CALENDAR_DELETED,
    });
    expect(await jobs()).toEqual([
      expect.objectContaining({ status: "FAILED", lastError: CALENDAR_DELETED }),
    ]);
  });

  it("a request Google refuses fails its job only", async () => {
    const targetId = await connected();
    await create({ title: "א" });
    await create({ title: "ב" });
    google.failNext("insertEvent", 400, "invalid");
    await runAll();
    expect(await jobs()).toEqual([
      expect.objectContaining({ status: "FAILED", lastError: "google:400 invalid (permanent)" }),
    ]);
    expect(google.only().events.size).toBe(1);
    expect(await target(targetId)).toMatchObject({
      status: "ACTIVE",
      connection: { status: "ACTIVE" },
    });
  });

  it("a job for a calendar no longer exported to is dropped without calling Google", async () => {
    const targetId = await connected();
    await create();
    await prisma.googleExportTarget.update({
      where: { id: targetId },
      data: { status: "DISABLED" },
    });
    google.calls = [];
    await runAll();
    expect(google.calls).toEqual([]);
    expect(await jobs()).toEqual([]);
  });
});
