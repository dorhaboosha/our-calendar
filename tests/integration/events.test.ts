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
import type { Prisma } from "@/generated/prisma/client";

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
function eventsBetween(start: [string, string], end: [string, string]) {
  return listEvents(toInstant(...start, TZ), toInstant(...end, TZ), TZ);
}

async function titlesBetween(start: [string, string], end: [string, string]) {
  return (await eventsBetween(start, end)).map((event) => event.title);
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

  it("creates a repeating event with its rule", async () => {
    const event = await create({
      title: "Pilates",
      repeat: { frequency: "weekly", weekdays: ["TH"], end: "count", count: "3" },
    });
    expect(event.recurrence).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=TH;WKST=SU;COUNT=3",
      originalStart: "2026-11-05T08:00:00.000Z",
      changedOccurrences: [],
      remainingCount: 3,
    });
    expect(
      (await eventsBetween(["2026-11-01", "00:00"], ["2026-12-01", "00:00"])).map(
        (occurrence) => occurrence.start,
      ),
    ).toEqual(["2026-11-05T08:00:00.000Z", "2026-11-12T08:00:00.000Z", "2026-11-19T08:00:00.000Z"]);
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

describe("listEvents, repeating events", () => {
  // Saving a series from the form comes in a later step; until then the rule is set
  // directly in the database.
  async function createSeries(rrule: string, overrides: Partial<EventInput> = {}) {
    const event = await create(overrides);
    await prisma.event.update({ where: { id: event.id }, data: { rrule } });
    return event;
  }

  /** Thursdays at 10:00 from 5 November 2026: 5, 12, 19 and 26 November. */
  const weekly = (overrides: Partial<EventInput> = {}) =>
    createSeries("FREQ=WEEKLY;BYDAY=TH;WKST=SU", { title: "Pilates", ...overrides });

  const november = () => eventsBetween(["2026-11-01", "00:00"], ["2026-12-01", "00:00"]);
  const days = (events: { start: string }[]) => events.map((event) => event.start.slice(0, 10));

  /** An exception of the 12 November occurrence (10:00 in Israel), by Maayan. */
  const exceptionOf = (eventId: string, data: Partial<Prisma.EventExceptionUncheckedCreateInput>) =>
    prisma.eventException.create({
      data: {
        eventId,
        originalStartAt: new Date("2026-11-12T08:00:00Z"),
        updatedByUserId: maayanId,
        ...data,
      },
    });

  it("shows each occurrence in the range, each with its own key", async () => {
    const series = await weekly();
    await create({
      title: "Dentist",
      startDate: "2026-11-12",
      endDate: "2026-11-12",
      startTime: "09:00",
      endTime: "09:30",
    });
    const events = await november();
    expect(events.map((event) => [event.title, event.start])).toEqual([
      ["Pilates", "2026-11-05T08:00:00.000Z"],
      ["Dentist", "2026-11-12T07:00:00.000Z"],
      ["Pilates", "2026-11-12T08:00:00.000Z"],
      ["Pilates", "2026-11-19T08:00:00.000Z"],
      ["Pilates", "2026-11-26T08:00:00.000Z"],
    ]);
    const pilates = events.filter((event) => event.title === "Pilates");
    expect(new Set(pilates.map((event) => event.id))).toEqual(new Set([series.id]));
    expect(new Set(pilates.map((event) => event.key)).size).toBe(4);
    expect(pilates[1]).toMatchObject({
      key: `${series.id}@2026-11-12T08:00:00.000Z`,
      end: "2026-11-12T09:00:00.000Z",
      recurrence: {
        rrule: "FREQ=WEEKLY;BYDAY=TH;WKST=SU",
        originalStart: "2026-11-12T08:00:00.000Z",
      },
    });
    // A one-off event: no recurrence, and its id as its key.
    expect(events[1].recurrence).toBeNull();
    expect(events[1].key).toBe(events[1].id);
  });

  it("finds the occurrences of a series that started long before the range", async () => {
    await weekly();
    expect(await titlesBetween(["2030-01-01", "00:00"], ["2030-01-08", "00:00"])).toEqual([
      "Pilates",
    ]);
  });

  it("shows nothing before a series starts or after it ends, nor of a deleted series", async () => {
    await createSeries("FREQ=DAILY;COUNT=3", { title: "Three days" });
    const deleted = await weekly({ title: "Deleted" });
    await deleteEvent(deleted.id, 1, dorId);
    expect(await titlesBetween(["2026-11-01", "00:00"], ["2026-11-05", "00:00"])).toEqual([]);
    expect(await titlesBetween(["2026-11-08", "00:00"], ["2026-11-15", "00:00"])).toEqual([]);
  });

  it("leaves out a cancelled occurrence", async () => {
    const series = await weekly();
    await exceptionOf(series.id, { isCancelled: true });
    expect(days(await november())).toEqual(["2026-11-05", "2026-11-19", "2026-11-26"]);
  });

  it("shows a changed occurrence with its changes, and the series' details otherwise", async () => {
    const series = await weekly({ location: "Studio", description: "Bring a mat" });
    await exceptionOf(series.id, { title: "Pilates (guest teacher)", description: "" });
    let events = await november();
    // Changed by Maayan after Dor created the series.
    expect(events[1]).toMatchObject({
      title: "Pilates (guest teacher)",
      description: null,
      location: "Studio",
      start: "2026-11-12T08:00:00.000Z",
      createdBy: "dor",
      updatedBy: "maayan",
    });
    expect(events[2]).toMatchObject({
      title: "Pilates",
      description: "Bring a mat",
      updatedBy: "dor",
    });

    // Then Dor moves the series to the park: the change reaches this occurrence too, and
    // it's the latest change to it.
    await prisma.event.update({ where: { id: series.id }, data: { location: "Park" } });
    events = await november();
    expect(events[1]).toMatchObject({
      title: "Pilates (guest teacher)",
      location: "Park",
      updatedBy: "dor",
    });
  });

  it("shows a moved occurrence where it was moved to, even from outside the range", async () => {
    const series = await weekly();
    await exceptionOf(series.id, {
      isAllDay: false,
      startAt: new Date("2026-12-02T08:00:00Z"),
      endAt: new Date("2026-12-02T09:00:00Z"),
    });
    expect(days(await november())).toEqual(["2026-11-05", "2026-11-19", "2026-11-26"]);
    const december = await eventsBetween(["2026-12-01", "00:00"], ["2026-12-08", "00:00"]);
    expect(december.map((event) => [event.start, event.recurrence?.originalStart])).toEqual([
      ["2026-12-02T08:00:00.000Z", "2026-11-12T08:00:00.000Z"],
      ["2026-12-03T08:00:00.000Z", "2026-12-03T08:00:00.000Z"],
    ]);
  });

  it("shows an occurrence moved to before the series' first one", async () => {
    const series = await weekly();
    await exceptionOf(series.id, {
      originalStartAt: new Date("2026-11-05T08:00:00Z"),
      isAllDay: true,
      startDate: new Date("2026-11-02"),
      endDate: new Date("2026-11-03"),
    });
    const events = await eventsBetween(["2026-11-01", "00:00"], ["2026-11-04", "00:00"]);
    expect(events).toMatchObject([
      { title: "Pilates", isAllDay: true, start: "2026-11-02", end: "2026-11-03" },
    ]);
  });

  it("ignores an exception whose occurrence isn't in the series", async () => {
    const series = await weekly();
    // 13 November is a Friday.
    await exceptionOf(series.id, {
      originalStartAt: new Date("2026-11-13T08:00:00Z"),
      isAllDay: false,
      startAt: new Date("2026-11-13T08:00:00Z"),
      endAt: new Date("2026-11-13T09:00:00Z"),
    });
    expect(await titlesBetween(["2026-11-13", "00:00"], ["2026-11-14", "00:00"])).toEqual([]);
  });

  it("repeats all-day events, and cancels one of them by its date", async () => {
    const birthday = await createSeries("FREQ=YEARLY", {
      title: "Birthday",
      isAllDay: true,
      startDate: "2026-11-05",
      endDate: "2026-11-05",
    });
    await prisma.eventException.create({
      data: {
        eventId: birthday.id,
        originalStartDate: new Date("2027-11-05"),
        isCancelled: true,
        updatedByUserId: dorId,
      },
    });
    const inNovember = async (year: number) =>
      (await eventsBetween([`${year}-11-01`, "00:00"], [`${year}-12-01`, "00:00"])).map((event) => [
        event.start,
        event.end,
        event.key,
      ]);
    expect(await inNovember(2026)).toEqual([
      ["2026-11-05", "2026-11-06", `${birthday.id}@2026-11-05`],
    ]);
    expect(await inNovember(2027)).toEqual([]);
    expect(await inNovember(2028)).toEqual([
      ["2028-11-05", "2028-11-06", `${birthday.id}@2028-11-05`],
    ]);
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
