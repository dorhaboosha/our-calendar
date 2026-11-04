import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createEvent,
  deleteEvent,
  getEvent,
  listEvents,
  updateEvent,
} from "@/modules/events/events";
import { toInstant } from "@/modules/events/time";
import { type EventInput, validateEvent } from "@/modules/events/validation";

const TZ = "Asia/Jerusalem";
let dorId: string;
let maayanId: string;

beforeEach(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  dorId = (await createUser("dor")).id;
  maayanId = (await createUser("maayan")).id;
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

const base: EventInput = {
  title: "Dentist",
  owner: "dor",
  category: "personal",
  isAllDay: false,
  startDate: "2026-11-05",
  endDate: "2026-11-05",
  startTime: "10:00",
  endTime: "11:00",
};

function draft(overrides: Partial<EventInput> = {}) {
  const result = validateEvent({ ...base, ...overrides });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.draft;
}

async function create(overrides: Partial<EventInput> = {}, actor = dorId) {
  const result = await createEvent(draft(overrides), actor);
  if (!result.ok) throw new Error(result.reason);
  return result.event;
}

/** The events in a range given as local Israel date-times. */
async function titlesBetween(start: [string, string], end: [string, string]) {
  const events = await listEvents(toInstant(...start, TZ), toInstant(...end, TZ), TZ);
  return events.map((event) => event.title);
}

describe("createEvent", () => {
  it("creates a timed event and returns it for the browser", async () => {
    const event = await create();
    expect(event).toMatchObject({
      title: "Dentist",
      owner: "dor",
      category: "personal",
      isAllDay: false,
      start: "2026-11-05T08:00:00.000Z",
      end: "2026-11-05T09:00:00.000Z",
      timezone: TZ,
      version: 1,
      createdBy: "dor",
      updatedBy: "dor",
    });
  });

  it("creates an all-day event with an exclusive end date", async () => {
    const event = await create({
      isAllDay: true,
      owner: "shared",
      startDate: "2026-11-07",
      endDate: "2026-11-08",
    });
    expect(event).toMatchObject({
      owner: "shared",
      isAllDay: true,
      start: "2026-11-07",
      end: "2026-11-09",
    });
  });

  it("lets one user create an event owned by the other", async () => {
    const event = await create({ owner: "maayan" }, dorId);
    expect(event).toMatchObject({ owner: "maayan", createdBy: "dor" });
  });

  it("refuses a personal event for a user who has never signed in", async () => {
    await prisma.user.delete({ where: { id: maayanId } });
    const result = await createEvent(draft({ owner: "maayan" }), dorId);
    expect(result).toEqual({ ok: false, reason: "ownerNotSignedIn", userKey: "maayan" });
    expect(await prisma.event.count()).toBe(0);
  });
});

describe("listEvents", () => {
  it("returns timed events that overlap the range, using half-open boundaries", async () => {
    await create({ title: "Inside", startTime: "10:00", endTime: "11:00" });
    await create({ title: "Ends at range start", startTime: "08:00", endTime: "09:00" });
    await create({ title: "Starts at range end", startTime: "12:00", endTime: "13:00" });
    await create({ title: "Overlaps the start", startTime: "08:30", endTime: "09:30" });
    expect(await titlesBetween(["2026-11-05", "09:00"], ["2026-11-05", "12:00"])).toEqual([
      "Overlaps the start",
      "Inside",
    ]);
  });

  it("finds an event that crosses midnight from either day", async () => {
    await create({ title: "Night", endDate: "2026-11-06", startTime: "22:00", endTime: "02:00" });
    expect(await titlesBetween(["2026-11-05", "00:00"], ["2026-11-06", "00:00"])).toEqual([
      "Night",
    ]);
    expect(await titlesBetween(["2026-11-06", "00:00"], ["2026-11-07", "00:00"])).toEqual([
      "Night",
    ]);
  });

  it("matches all-day events by local dates, treating the stored end as exclusive", async () => {
    await create({
      title: "Weekend",
      isAllDay: true,
      startDate: "2026-11-07",
      endDate: "2026-11-08",
    });
    // The days of the event.
    expect(await titlesBetween(["2026-11-08", "00:00"], ["2026-11-09", "00:00"])).toEqual([
      "Weekend",
    ]);
    // The day after its last day, and the day before its first day.
    expect(await titlesBetween(["2026-11-09", "00:00"], ["2026-11-10", "00:00"])).toEqual([]);
    expect(await titlesBetween(["2026-11-06", "00:00"], ["2026-11-07", "00:00"])).toEqual([]);
  });

  it("puts all-day events before timed events of the same day", async () => {
    await create({ title: "Timed" });
    await create({ title: "All day", isAllDay: true });
    expect(await titlesBetween(["2026-11-05", "00:00"], ["2026-11-06", "00:00"])).toEqual([
      "All day",
      "Timed",
    ]);
  });

  it("leaves out deleted events", async () => {
    const event = await create();
    await deleteEvent(event.id, event.version, dorId);
    expect(await titlesBetween(["2026-11-05", "00:00"], ["2026-11-06", "00:00"])).toEqual([]);
  });
});

describe("updateEvent", () => {
  it("replaces the event, records who changed it and bumps the version", async () => {
    const event = await create();
    const result = await updateEvent(
      event.id,
      1,
      draft({ title: "Dentist (moved)", owner: "shared" }),
      maayanId,
    );
    expect(result).toMatchObject({
      ok: true,
      event: {
        title: "Dentist (moved)",
        owner: "shared",
        version: 2,
        createdBy: "dor",
        updatedBy: "maayan",
      },
    });
  });

  it("can turn a timed event into an all-day event and back", async () => {
    const event = await create();
    const allDay = await updateEvent(event.id, 1, draft({ isAllDay: true }), dorId);
    expect(allDay).toMatchObject({
      ok: true,
      event: { isAllDay: true, start: "2026-11-05", end: "2026-11-06" },
    });
    const timedAgain = await updateEvent(event.id, 2, draft(), dorId);
    expect(timedAgain).toMatchObject({
      ok: true,
      event: { isAllDay: false, start: "2026-11-05T08:00:00.000Z" },
    });
  });

  it("refuses to overwrite a change someone else saved first", async () => {
    const event = await create();
    await updateEvent(event.id, 1, draft({ title: "Maayan's edit" }), maayanId);
    const result = await updateEvent(event.id, 1, draft({ title: "Dor's edit" }), dorId);
    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect((await getEvent(event.id))?.title).toBe("Maayan's edit");
  });

  it("reports a deleted or unknown event as not found", async () => {
    const event = await create();
    await deleteEvent(event.id, 1, maayanId);
    expect(await updateEvent(event.id, 2, draft(), dorId)).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(await updateEvent(randomUUID(), 1, draft(), dorId)).toEqual({
      ok: false,
      reason: "notFound",
    });
  });
});

describe("deleteEvent", () => {
  it("soft-deletes: hidden from the app, kept in the database with a new version", async () => {
    const event = await create();
    expect(await deleteEvent(event.id, 1, maayanId)).toEqual({ ok: true });
    expect(await getEvent(event.id)).toBeNull();
    const row = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.version).toBe(2);
    expect(row.updatedByUserId).toBe(maayanId);
  });

  it("does not delete an event changed since it was loaded", async () => {
    const event = await create();
    await updateEvent(event.id, 1, draft({ title: "Changed" }), maayanId);
    expect(await deleteEvent(event.id, 1, dorId)).toEqual({ ok: false, reason: "conflict" });
    expect(await getEvent(event.id)).not.toBeNull();
  });

  it("reports deleting twice as not found", async () => {
    const event = await create();
    await deleteEvent(event.id, 1, dorId);
    expect(await deleteEvent(event.id, 2, dorId)).toEqual({ ok: false, reason: "notFound" });
  });
});
