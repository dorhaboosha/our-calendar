import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  type CalendarEvent,
  type OccurrenceTarget,
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
} from "@/modules/events/events";
import { toInstant } from "@/modules/events/time";
import { type EventInput, validateEvent } from "@/modules/events/validation";

// Changing and deleting occurrences of a series: this one, this and following, or all.
// The series: pilates every Thursday 10:00-11:00 in Israel from 5 November 2026.

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

const pilates: EventInput = {
  title: "Pilates",
  owner: "maayan",
  category: "personal",
  isAllDay: false,
  startDate: "2026-11-05",
  endDate: "2026-11-05",
  startTime: "10:00",
  endTime: "11:00",
  location: "Studio",
  repeat: { frequency: "weekly", weekdays: ["TH"], end: "never" },
};

function draft(overrides: Partial<EventInput> = {}) {
  const result = validateEvent({ ...pilates, ...overrides });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.draft;
}

async function createSeries(overrides: Partial<EventInput> = {}) {
  const result = await createEvent(draft(overrides), maayanId);
  if (!result.ok) throw new Error(result.reason);
  return result.event;
}

/** 10:00 in Israel on a day of November 2026, as an occurrence's original start. */
const at = (day: number) =>
  toInstant(`2026-11-${String(day).padStart(2, "0")}`, "10:00", TZ).toISOString();
const target = (scope: OccurrenceTarget["scope"], day: number) => ({
  scope,
  originalStart: at(day),
});

/** The occurrences in November and early December, as "day title" (and the time if not 10:00). */
async function calendar() {
  const events = await listEvents(
    toInstant("2026-11-01", "00:00", TZ),
    toInstant("2026-12-15", "00:00", TZ),
    TZ,
  );
  return events.map(label);
}

function label(event: CalendarEvent) {
  const start = new Date(event.start);
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(start);
  return `${local} ${event.title}`;
}

const updated = async (
  series: CalendarEvent,
  overrides: Partial<EventInput>,
  occurrence?: OccurrenceTarget,
  version = series.version,
) => {
  const result = await updateEvent(series.id, version, draft(overrides), dorId, occurrence);
  if (!result.ok) throw new Error(result.reason);
  return result.event;
};

const version = async (id: string) =>
  (await prisma.event.findUniqueOrThrow({ where: { id } })).version;

describe("this occurrence", () => {
  it("changes one occurrence only, as an exception, and bumps the series' version", async () => {
    const series = await createSeries();
    const occurrence = await updated(
      series,
      {
        title: "Pilates (guest)",
        startDate: "2026-11-12",
        endDate: "2026-11-12",
        startTime: "12:00",
        endTime: "13:00",
      },
      target("this", 12),
    );
    expect(occurrence).toMatchObject({
      id: series.id,
      title: "Pilates (guest)",
      start: toInstant("2026-11-12", "12:00", TZ).toISOString(),
      updatedBy: "dor",
      recurrence: { originalStart: at(12) },
    });
    expect((await calendar()).slice(0, 3)).toEqual([
      "5 Nov, 10:00 Pilates",
      "12 Nov, 12:00 Pilates (guest)",
      "19 Nov, 10:00 Pilates",
    ]);
    expect(await version(series.id)).toBe(2);
    const exception = await prisma.eventException.findFirstOrThrow();
    // Only what differs is stored; the location still follows the series.
    expect(exception).toMatchObject({ title: "Pilates (guest)", location: null, isAllDay: false });
  });

  it("an occurrence changed back to the series has no exception any more", async () => {
    const series = await createSeries();
    await updated(
      series,
      { title: "Pilates (guest)", startDate: "2026-11-12", endDate: "2026-11-12" },
      target("this", 12),
    );
    await updated(
      series,
      { startDate: "2026-11-12", endDate: "2026-11-12" },
      target("this", 12),
      2,
    );
    expect(await prisma.eventException.count()).toBe(0);
  });

  it("keeps the series' owner, and stores a cleared location as cleared", async () => {
    const series = await createSeries();
    const occurrence = await updated(
      series,
      { owner: "dor", location: "", startDate: "2026-11-12", endDate: "2026-11-12" },
      target("this", 12),
    );
    expect(occurrence).toMatchObject({ owner: "maayan", location: null });
    expect(await prisma.eventException.findFirstOrThrow()).toMatchObject({ location: "" });
  });

  it("deletes one occurrence", async () => {
    const series = await createSeries();
    expect(await deleteEvent(series.id, 1, dorId, target("this", 12))).toEqual({ ok: true });
    expect((await calendar()).slice(0, 2)).toEqual([
      "5 Nov, 10:00 Pilates",
      "19 Nov, 10:00 Pilates",
    ]);
  });

  it("refuses a stale version, and an occurrence the series doesn't have", async () => {
    const series = await createSeries();
    await updated(series, { title: "Renamed" });
    const stale = await updateEvent(series.id, 1, draft(), dorId, target("this", 12));
    expect(stale).toEqual({ ok: false, reason: "conflict" });
    // 13 November is a Friday.
    expect(await deleteEvent(series.id, 2, dorId, target("this", 13))).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await prisma.eventException.count()).toBe(0);
  });
});

describe("this and following", () => {
  it("splits the series: the original ends before, a new series starts from the occurrence", async () => {
    const series = await createSeries();
    const split = await updated(
      series,
      { title: "Yoga", startDate: "2026-11-19", endDate: "2026-11-19" },
      target("following", 19),
    );
    expect(split.id).not.toBe(series.id);
    expect(await calendar()).toEqual([
      "5 Nov, 10:00 Pilates",
      "12 Nov, 10:00 Pilates",
      "19 Nov, 10:00 Yoga",
      "26 Nov, 10:00 Yoga",
      "3 Dec, 10:00 Yoga",
      "10 Dec, 10:00 Yoga",
    ]);
    const rows = await prisma.event.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => [row.rrule, row.splitFromEventId, row.version])).toEqual([
      ["FREQ=WEEKLY;BYDAY=TH;WKST=SU;UNTIL=20261119T075959Z", null, 2],
      ["FREQ=WEEKLY;BYDAY=TH;WKST=SU", series.id, 1],
    ]);
  });

  it("a series that ends after a number of times keeps its total", async () => {
    const series = await createSeries({ repeat: { ...pilates.repeat!, end: "count", count: "5" } });
    // The form offers what's left from the 19th: 3 of the 5.
    const occurrences = await listEvents(
      toInstant("2026-11-19", "00:00", TZ),
      toInstant("2026-11-20", "00:00", TZ),
      TZ,
    );
    expect(occurrences[0].recurrence?.remainingCount).toBe(3);
    await updated(
      series,
      {
        title: "Yoga",
        startDate: "2026-11-19",
        endDate: "2026-11-19",
        repeat: { ...pilates.repeat!, end: "count", count: "3" },
      },
      target("following", 19),
    );
    expect(await calendar()).toEqual([
      "5 Nov, 10:00 Pilates",
      "12 Nov, 10:00 Pilates",
      "19 Nov, 10:00 Yoga",
      "26 Nov, 10:00 Yoga",
      "3 Dec, 10:00 Yoga",
    ]);
  });

  it("moves later changes to the new series if the times stay, and drops them if not", async () => {
    const series = await createSeries();
    await updated(
      series,
      { title: "Early", startDate: "2026-11-12", endDate: "2026-11-12" },
      target("this", 12),
    );
    await updated(
      series,
      { title: "Late", startDate: "2026-11-26", endDate: "2026-11-26" },
      target("this", 26),
      2,
    );
    const sameTimes = await updated(
      series,
      { location: "Park", startDate: "2026-11-19", endDate: "2026-11-19" },
      target("following", 19),
      3,
    );
    expect(await calendar()).toEqual([
      "5 Nov, 10:00 Pilates",
      "12 Nov, 10:00 Early",
      "19 Nov, 10:00 Pilates",
      "26 Nov, 10:00 Late",
      "3 Dec, 10:00 Pilates",
      "10 Dec, 10:00 Pilates",
    ]);
    expect(
      (await prisma.eventException.findFirstOrThrow({ where: { title: "Late" } })).eventId,
    ).toBe(sameTimes.id);

    // Now an hour later from the 26th: the change on the 26th is dropped.
    await updated(
      sameTimes,
      {
        location: "Park",
        startDate: "2026-11-26",
        endDate: "2026-11-26",
        startTime: "11:00",
        endTime: "12:00",
      },
      target("following", 26),
    );
    expect((await calendar()).slice(3)).toEqual([
      "26 Nov, 11:00 Pilates",
      "3 Dec, 11:00 Pilates",
      "10 Dec, 11:00 Pilates",
    ]);
    expect(await prisma.eventException.count({ where: { title: "Late" } })).toBe(0);
    expect(await prisma.eventException.count({ where: { title: "Early" } })).toBe(1);
  });

  it("from the first occurrence, changes the whole series", async () => {
    const series = await createSeries();
    const result = await updated(series, { title: "Yoga" }, target("following", 5));
    expect(result.id).toBe(series.id);
    expect(await prisma.event.count()).toBe(1);
  });

  it("deletes this and the later occurrences, with their changes", async () => {
    const series = await createSeries();
    await updated(
      series,
      { title: "Late", startDate: "2026-11-26", endDate: "2026-11-26" },
      target("this", 26),
    );
    expect(await deleteEvent(series.id, 2, dorId, target("following", 19))).toEqual({ ok: true });
    expect(await calendar()).toEqual(["5 Nov, 10:00 Pilates", "12 Nov, 10:00 Pilates"]);
    expect(await prisma.eventException.count()).toBe(0);
  });

  it("deleting from the first occurrence deletes the series", async () => {
    const series = await createSeries();
    expect(await deleteEvent(series.id, 1, dorId, target("following", 5))).toEqual({ ok: true });
    expect(await calendar()).toEqual([]);
    expect((await prisma.event.findFirstOrThrow()).deletedAt).not.toBeNull();
  });
});

describe("all occurrences", () => {
  it("a change to the details keeps changes to single occurrences", async () => {
    const series = await createSeries();
    await updated(
      series,
      { title: "Guest", startDate: "2026-11-12", endDate: "2026-11-12" },
      target("this", 12),
    );
    await updated(series, { title: "Yoga", location: "Park" }, target("all", 5), 2);
    expect((await calendar()).slice(0, 3)).toEqual([
      "5 Nov, 10:00 Yoga",
      "12 Nov, 10:00 Guest",
      "19 Nov, 10:00 Yoga",
    ]);
  });

  it("a change to the times or days drops them", async () => {
    const series = await createSeries();
    await updated(
      series,
      { title: "Guest", startDate: "2026-11-12", endDate: "2026-11-12" },
      target("this", 12),
    );
    await updated(series, { startTime: "18:00", endTime: "19:00" }, target("all", 5), 2);
    expect(await prisma.eventException.count()).toBe(0);
    expect((await calendar()).slice(0, 2)).toEqual([
      "5 Nov, 18:00 Pilates",
      "12 Nov, 18:00 Pilates",
    ]);
  });

  it("an earlier end drops only the changes of occurrences it no longer has", async () => {
    const series = await createSeries();
    await updated(
      series,
      { title: "Early", startDate: "2026-11-12", endDate: "2026-11-12" },
      target("this", 12),
    );
    await updated(
      series,
      { title: "Late", startDate: "2026-11-26", endDate: "2026-11-26" },
      target("this", 26),
      2,
    );
    await updated(
      series,
      { repeat: { ...pilates.repeat!, end: "until", until: "2026-11-19" } },
      target("all", 5),
      3,
    );
    expect(await prisma.eventException.findMany({ select: { title: true } })).toEqual([
      { title: "Early" },
    ]);
  });

  it("making the series a one-off event drops them", async () => {
    const series = await createSeries();
    await updated(
      series,
      { title: "Guest", startDate: "2026-11-12", endDate: "2026-11-12" },
      target("this", 12),
    );
    await updated(series, { repeat: undefined }, target("all", 5), 2);
    expect(await prisma.eventException.count()).toBe(0);
    expect(await calendar()).toEqual(["5 Nov, 10:00 Pilates"]);
  });

  it("deletes the whole series", async () => {
    const series = await createSeries();
    expect(await deleteEvent(series.id, 1, dorId, target("all", 19))).toEqual({ ok: true });
    expect(await calendar()).toEqual([]);
  });
});
