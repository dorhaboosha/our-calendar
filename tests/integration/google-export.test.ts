import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createEvent, deleteEvent, updateEvent } from "@/modules/events/events";
import { type EventInput, validateEvent } from "@/modules/events/validation";
import { disconnect } from "@/modules/google-export/connection";
import { CALENDAR_DELETED, runExportJobs } from "@/modules/google-export/export-jobs";
import { GoogleApiError } from "@/modules/google-export/google-api";
import { googleEventId, nearestColorId } from "@/modules/google-export/mapping";
import { enqueueTargetJob } from "@/modules/jobs/outbox";
import { updateSharedColor, updateUserColor } from "@/modules/users/users";
import { FakeGoogle } from "./fake-google";

// The export against a fake Google: creating the calendar, exporting every event, keeping
// copies up to date (series and their occurrences too), recovering from edits made by
// hand in Google, and what each kind of failure does.

let dorId: string;
let maayanId: string;
let google: FakeGoogle;

beforeEach(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await prisma.sharedSettings.deleteMany();
  dorId = (await createUser("dor")).id;
  maayanId = (await createUser("maayan")).id;
  google = new FakeGoogle();
});

afterAll(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await prisma.sharedSettings.deleteMany();
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

/** A user connects the export: the connection, its target, and the job creating the calendar. */
async function connect(userId = dorId) {
  const connection = await prisma.googleConnection.create({
    data: {
      userId,
      googleAccountId: `sub-${userId}`,
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
    expect(calendar.description).toContain("OurCalendar");
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

  it("connecting again keeps the calendar, or makes a new one if it was deleted", async () => {
    const targetId = await connected();
    const { googleId } = await create();
    await runAll();
    await enqueueTargetJob(prisma, targetId, "CREATE_CALENDAR");
    await runAll();
    expect(google.calendars.size).toBe(1);
    expect(google.calls.filter((call) => call === "createCalendar")).toHaveLength(1);

    google.deleteCalendarByHand();
    await enqueueTargetJob(prisma, targetId, "CREATE_CALENDAR");
    await runAll();
    expect(google.only().events.get(googleId)).toMatchObject({ status: "confirmed" });
    expect(await target(targetId)).toMatchObject({
      googleCalendarId: expect.stringContaining("calendar-2"),
    });
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

describe("occurrences changed by hand in Google", () => {
  it("export again undoes them, and keeps the app's own changes", async () => {
    const targetId = await connected();
    const daily = { frequency: "daily", end: "never" } as const;
    const series = await create({ repeat: daily });
    const occurrence = (day: string) => `${series.googleId}_202611${day}T170000Z`;
    await updateEvent(
      series.id,
      1,
      draft({ startDate: "2026-11-06", endDate: "2026-11-06", title: "מאוחר" }),
      dorId,
      { scope: "this", originalStart: "2026-11-06T17:00:00.000Z" },
    );
    await runAll();

    google.editOccurrenceByHand(occurrence("08"), {
      summary: "שונה ב-Google",
      start: { dateTime: "2026-11-08T08:00:00+02:00", timeZone: "Asia/Jerusalem" },
    });
    google.deleteOccurrenceByHand(occurrence("09"));
    google.editOccurrenceByHand(occurrence("06"), { summary: "גם זה" });

    // An ordinary change doesn't ask Google for its changed occurrences.
    google.calls = [];
    await create({ title: "אחר" });
    await runAll();
    expect(google.calls.filter((call) => call.startsWith("listChangedOccurrences"))).toEqual([]);
    expect(google.event(occurrence("08"))).toMatchObject({ summary: "שונה ב-Google" });

    await enqueueTargetJob(prisma, targetId, "FULL_RECONCILE");
    await runAll();
    const seriesValues = (day: string) => ({
      summary: "ארוחת ערב",
      status: "confirmed",
      recurringEventId: series.googleId,
      start: { dateTime: `2026-11-${day}T19:00:00+02:00` },
      end: { dateTime: `2026-11-${day}T21:00:00+02:00` },
    });
    expect(google.event(occurrence("08"))).toMatchObject(seriesValues("08"));
    expect(google.event(occurrence("09"))).toMatchObject(seriesValues("09"));
    // Changed in the app too: the app's version.
    expect(google.event(occurrence("06"))).toMatchObject({ summary: "מאוחר" });
    // Google keeps the ones set back as occurrences of their own, so they stay on the
    // series' list.
    const exportedOccurrences = async () =>
      (
        await prisma.eventExportMapping.findFirstOrThrow({
          where: { googleEventId: series.googleId },
        })
      ).exportedOccurrences;
    expect(await exportedOccurrences()).toEqual([
      "2026-11-06T17:00:00.000Z",
      "2026-11-08T17:00:00.000Z",
      "2026-11-09T17:00:00.000Z",
    ]);
    expect(await jobs()).toEqual([]);

    // A later change to the series reaches them too.
    await updateEvent(
      series.id,
      await version(series.id),
      draft({ title: "ארוחה", repeat: daily }),
      dorId,
    );
    await runAll();
    expect(google.event(occurrence("08"))).toMatchObject({ summary: "ארוחה" });
    expect(google.event(occurrence("09"))).toMatchObject({ summary: "ארוחה" });
    expect(google.event(occurrence("06"))).toMatchObject({ summary: "מאוחר" });

    // New times: no old copy is left behind.
    await updateEvent(
      series.id,
      await version(series.id),
      draft({ title: "ארוחה", repeat: daily, startTime: "20:00", endTime: "22:00" }),
      dorId,
    );
    await runAll();
    for (const day of ["06", "08", "09"]) {
      expect(google.event(occurrence(day))).toMatchObject({ status: "cancelled" });
    }
    expect(await exportedOccurrences()).toEqual([]);
    expect(await jobs()).toEqual([]);
  });

  it("an all-day series, and an occurrence no longer in the series", async () => {
    const targetId = await connected();
    const series = await create({
      isAllDay: true,
      startDate: "2026-11-05",
      endDate: "2026-11-05",
      startTime: undefined,
      endTime: undefined,
      repeat: { frequency: "weekly", weekdays: ["TH"], end: "never" },
    });
    await runAll();
    const twelfth = `${series.googleId}_20261112`;
    google.editOccurrenceByHand(twelfth, { summary: "שונה ב-Google" });
    // The series now repeats on Fridays: Thursday the 12th is no longer one of its days.
    await updateEvent(
      series.id,
      await version(series.id),
      draft({
        isAllDay: true,
        startDate: "2026-11-06",
        endDate: "2026-11-06",
        startTime: undefined,
        endTime: undefined,
        repeat: { frequency: "weekly", weekdays: ["FR"], end: "never" },
      }),
      dorId,
    );
    await runAll();
    expect(google.event(twelfth)).toMatchObject({ summary: "שונה ב-Google" });

    await enqueueTargetJob(prisma, targetId, "FULL_RECONCILE");
    await runAll();
    expect(google.event(twelfth)).toMatchObject({ status: "cancelled" });
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
    // Revoked access fails every call; the two events' jobs run at once.
    google.failNext("insertEvent", status, reason);
    google.failNext("insertEvent", status, reason);
    await runAll();

    expect(await target(targetId)).toMatchObject({
      status: "ACTIVE",
      connection: { status: "NEEDS_REAUTH", lastError: `google:${status} ${reason}` },
    });
    // Both stop; connecting again exports everything.
    const failed = expect.objectContaining({
      status: "FAILED",
      lastError: `google:${status} ${reason} (reauth)`,
    });
    expect(await jobs()).toEqual([failed, failed]);
    expect(google.only().events.size).toBe(0);
    // Nothing more is queued until then.
    await create({ title: "ג" });
    expect(await jobs()).toHaveLength(2);
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

  it("a job that fails after the user disconnected leaves the export disconnected", async () => {
    const targetId = await connected();
    await create();
    // While the job runs, the user disconnects and deletes the calendar.
    const api = Object.assign(Object.create(google) as FakeGoogle, {
      insertEvent: async () => {
        await prisma.googleExportTarget.update({
          where: { id: targetId },
          data: { status: "DISABLED" },
        });
        google.deleteCalendarByHand();
        throw new GoogleApiError(404, "notFound");
      },
    });
    await runExportJobs(() => api);
    expect(await target(targetId)).toMatchObject({ status: "DISABLED", lastError: null });
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

describe("edge cases", () => {
  it("an edit while its export runs is exported right after", async () => {
    await connected();
    const { id, googleId } = await create();
    // The other user saves a new title while Google is creating the event.
    const api = Object.assign(Object.create(google) as FakeGoogle, {
      insertEvent: async (calendarId: string, event: Parameters<FakeGoogle["insertEvent"]>[1]) => {
        await updateEvent(id, 1, draft({ title: "ארוחת ערב מאוחרת" }), maayanId);
        await google.insertEvent(calendarId, event);
      },
    });
    await runExportJobs(() => api);
    expect(google.event(googleId)).toMatchObject({ summary: "ארוחת ערב" });
    expect(await jobs()).toEqual([expect.objectContaining({ status: "PENDING" })]);

    await runAll();
    expect(google.event(googleId)).toMatchObject({
      summary: "ארוחת ערב מאוחרת",
      extendedProperties: { private: { version: "2" } },
    });
    expect(await jobs()).toEqual([]);
  });

  it("a series that becomes a one-off leaves no occurrences behind in Google", async () => {
    await connected();
    const series = await create({ repeat: { frequency: "daily", end: "never" } });
    await updateEvent(
      series.id,
      1,
      draft({ title: "מאוחר", startDate: "2026-11-06", endDate: "2026-11-06", repeat: undefined }),
      dorId,
      { scope: "this", originalStart: "2026-11-06T17:00:00.000Z" },
    );
    await runAll();
    const sixth = `${series.googleId}_20261106T170000Z`;
    expect(google.event(sixth)).toMatchObject({ summary: "מאוחר", status: "confirmed" });

    await updateEvent(series.id, await version(series.id), draft(), dorId);
    await runAll();
    const master = google.event(series.googleId)!;
    expect(master).toMatchObject({ summary: "ארוחת ערב", status: "confirmed" });
    expect(master.recurrence ?? []).toEqual([]);
    expect(google.event(sixth)).toMatchObject({ status: "cancelled" });
    expect((await prisma.eventExportMapping.findFirstOrThrow()).exportedOccurrences).toEqual([]);

    // And back into a series: one repeating event again.
    await updateEvent(
      series.id,
      await version(series.id),
      draft({ repeat: { frequency: "weekly", weekdays: ["TH"], end: "never" } }),
      dorId,
    );
    await runAll();
    expect(google.event(series.googleId)).toMatchObject({
      recurrence: [expect.stringContaining("FREQ=WEEKLY")],
      status: "confirmed",
    });
    expect(await jobs()).toEqual([]);
  });

  it("this and the following ones: the series ends, a new one starts, nothing is left over", async () => {
    await connected();
    const series = await create({ repeat: { frequency: "daily", end: "never" } });
    // A changed occurrence after the point where the series is split.
    await updateEvent(
      series.id,
      1,
      draft({ title: "מאוחר", startDate: "2026-11-09", endDate: "2026-11-09", repeat: undefined }),
      dorId,
      { scope: "this", originalStart: "2026-11-09T17:00:00.000Z" },
    );
    await runAll();

    const split = await updateEvent(
      series.id,
      2,
      draft({
        title: "ארוחת ערב חדשה",
        startDate: "2026-11-08",
        endDate: "2026-11-08",
        repeat: { frequency: "daily", end: "never" },
      }),
      dorId,
      { scope: "following", originalStart: "2026-11-08T17:00:00.000Z" },
    );
    if (!split.ok) throw new Error(split.reason);
    await runAll();

    expect(google.event(series.googleId)).toMatchObject({
      summary: "ארוחת ערב",
      recurrence: [expect.stringMatching(/^RRULE:FREQ=DAILY;UNTIL=/)],
    });
    // The original series' changed occurrence on the 9th is gone from Google.
    expect(google.event(`${series.googleId}_20261109T170000Z`)).toMatchObject({
      status: "cancelled",
    });
    expect(google.event(googleEventId(split.event.id))).toMatchObject({
      summary: "ארוחת ערב חדשה",
      recurrence: ["RRULE:FREQ=DAILY"],
      start: { dateTime: "2026-11-08T19:00:00+02:00" },
    });
    expect(await jobs()).toEqual([]);
  });

  it("a new color in settings reaches the owner's events in Google, and only theirs", async () => {
    await connected();
    const mine = await create({ owner: "dor", category: "personal" });
    const hers = await create({ owner: "maayan", category: "personal" });
    const shared = await create();
    await runAll();
    const hersBefore = google.event(hers.googleId)!.colorId;

    google.calls = [];
    expect(await updateUserColor(dorId, "dor", "#b45309", "משותף")).toMatchObject({ ok: true });
    await runAll();
    expect(google.event(mine.googleId)).toMatchObject({ colorId: nearestColorId("#b45309") });
    expect(google.calls).toEqual([`updateEvent ${mine.googleId}`]);

    google.calls = [];
    expect(await updateSharedColor("#0e7490")).toMatchObject({ ok: true });
    await runAll();
    expect(google.event(shared.googleId)).toMatchObject({ colorId: nearestColorId("#0e7490") });
    expect(google.calls).toEqual([`updateEvent ${shared.googleId}`]);

    // The same color again changes nothing.
    google.calls = [];
    await updateUserColor(dorId, "dor", "#b45309", "משותף");
    await updateSharedColor("#0e7490");
    await runAll();
    expect(google.calls).toEqual([]);
    expect(google.event(hers.googleId)!.colorId).toBe(hersBefore);
  });

  it("both connected: each gets every event, and one disconnecting leaves the other", async () => {
    const googles = new Map([
      [dorId, new FakeGoogle()],
      [maayanId, new FakeGoogle()],
    ]);
    const apiFor = (connection: { userId: string }) => googles.get(connection.userId)!;
    const runBoth = async () => {
      while ((await runExportJobs(apiFor)) > 0);
    };
    await connect(dorId);
    await connect(maayanId);
    await runBoth();
    const { id, googleId } = await create();
    await runBoth();
    for (const fake of googles.values()) {
      expect(fake.event(googleId)).toMatchObject({ summary: "ארוחת ערב", status: "confirmed" });
    }

    expect(
      await disconnect(maayanId, { deleteCalendar: false }, { apiFor, revoke: async () => {} }),
    ).toMatchObject({ ok: true });
    await updateEvent(id, 1, draft({ title: "ארוחת ערב אצל ההורים" }), dorId);
    await runBoth();
    expect(googles.get(dorId)!.event(googleId)).toMatchObject({ summary: "ארוחת ערב אצל ההורים" });
    expect(googles.get(maayanId)!.event(googleId)).toMatchObject({ summary: "ארוחת ערב" });
    expect(await jobs()).toEqual([]);
  });
});
