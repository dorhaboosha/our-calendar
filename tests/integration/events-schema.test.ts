import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

// Database-level rules for events and their exceptions: the CHECK constraints added in
// the add_events and add_recurrence migrations, so even a bug in the app can't store an
// inconsistent event.

let dorId: string;

beforeAll(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  const dor = await prisma.user.create({
    data: { id: randomUUID(), name: "Dor", email: "dor@example.com", configKey: "dor" },
  });
  dorId = dor.id;
});

beforeEach(async () => {
  await prisma.event.deleteMany();
});

afterAll(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

function timed(overrides: Partial<Prisma.EventUncheckedCreateInput> = {}) {
  return {
    title: "Dentist",
    ownerType: "USER",
    ownerUserId: dorId,
    category: "personal",
    isAllDay: false,
    startAt: new Date("2026-11-05T08:00:00Z"),
    endAt: new Date("2026-11-05T09:00:00Z"),
    createdByUserId: dorId,
    updatedByUserId: dorId,
    ...overrides,
  } satisfies Prisma.EventUncheckedCreateInput;
}

function allDay(overrides: Partial<Prisma.EventUncheckedCreateInput> = {}) {
  return timed({
    title: "Vacation",
    isAllDay: true,
    startAt: null,
    endAt: null,
    startDate: new Date("2026-11-07"),
    endDate: new Date("2026-11-09"),
    ...overrides,
  });
}

/** Expects the insert to fail on the named CHECK constraint. */
async function expectRejected(data: Prisma.EventUncheckedCreateInput, constraint: string) {
  await expect(prisma.event.create({ data })).rejects.toThrow(constraint);
}

describe("event table", () => {
  it("stores a timed event with defaults", async () => {
    const event = await prisma.event.create({ data: timed() });
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.version).toBe(1);
    expect(event.timezone).toBe("Asia/Jerusalem");
    expect(event.deletedAt).toBeNull();
    expect(event.startDate).toBeNull();
  });

  it("stores an all-day event as dates only, with an exclusive end date", async () => {
    const event = await prisma.event.create({ data: allDay() });
    expect(event.startAt).toBeNull();
    // Two days, 7 and 8 November: the stored end is the day after the last day.
    expect(event.startDate?.toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(event.endDate?.toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });

  it("stores a shared event with no owner", async () => {
    const event = await prisma.event.create({
      data: timed({ ownerType: "SHARED", ownerUserId: null }),
    });
    expect(event.ownerUserId).toBeNull();
  });

  describe("rejects", () => {
    it("a timed event that also has dates", () =>
      expectRejected(timed({ startDate: new Date("2026-11-05") }), "event_time_kind_check"));

    it("an all-day event that also has times", () =>
      expectRejected(allDay({ startAt: new Date() }), "event_time_kind_check"));

    it("a timed event without an end", () =>
      expectRejected(timed({ endAt: null }), "event_time_kind_check"));

    it("a timed event that ends before it starts", () =>
      expectRejected(
        timed({ endAt: new Date("2026-11-05T07:00:00Z") }),
        "event_end_after_start_check",
      ));

    it("a timed event that ends when it starts", () =>
      expectRejected(
        timed({ endAt: new Date("2026-11-05T08:00:00Z") }),
        "event_end_after_start_check",
      ));

    it("an all-day event whose exclusive end is not after its start", () =>
      expectRejected(allDay({ endDate: new Date("2026-11-07") }), "event_end_after_start_check"));

    it("a personal event without an owner", () =>
      expectRejected(timed({ ownerUserId: null }), "event_owner_check"));

    it("a shared event with an owner", () =>
      expectRejected(timed({ ownerType: "SHARED" }), "event_owner_check"));

    it("a blank title", () =>
      expectRejected(timed({ title: "   " }), "event_title_not_blank_check"));

    it("a version below 1", () =>
      expectRejected(timed({ version: 0 }), "event_version_positive_check"));
  });

  it("does not let a user with events be deleted", async () => {
    await prisma.event.create({ data: timed() });
    await expect(prisma.user.delete({ where: { id: dorId } })).rejects.toThrow();
  });
});

describe("repeating events", () => {
  const series = () => timed({ rrule: "FREQ=DAILY" });

  it("stores a series' rule, and a split series points to the one it came from", async () => {
    const original = await prisma.event.create({ data: series() });
    const split = await prisma.event.create({
      data: timed({ rrule: "FREQ=DAILY", splitFromEventId: original.id }),
    });
    expect(original.rrule).toBe("FREQ=DAILY");
    expect(split.splitFromEventId).toBe(original.id);
  });

  it("rejects a blank rule", () =>
    expectRejected(timed({ rrule: " " }), "event_rrule_not_blank_check"));

  it("rejects a series split from itself", async () => {
    const event = await prisma.event.create({ data: series() });
    await expect(
      prisma.event.update({ where: { id: event.id }, data: { splitFromEventId: event.id } }),
    ).rejects.toThrow("event_not_split_from_itself_check");
  });
});

describe("event_exception table", () => {
  let eventId: string;

  beforeEach(async () => {
    eventId = (await prisma.event.create({ data: timed({ rrule: "FREQ=DAILY" }) })).id;
  });

  /** An exception of the 6 November occurrence, with no changes yet. */
  function exception(overrides: Partial<Prisma.EventExceptionUncheckedCreateInput> = {}) {
    return {
      eventId,
      originalStartAt: new Date("2026-11-06T08:00:00Z"),
      updatedByUserId: dorId,
      ...overrides,
    } satisfies Prisma.EventExceptionUncheckedCreateInput;
  }

  async function expectExceptionRejected(
    data: Prisma.EventExceptionUncheckedCreateInput,
    constraint: string,
  ) {
    await expect(prisma.eventException.create({ data })).rejects.toThrow(constraint);
  }

  it("stores a cancelled occurrence, and a moved and renamed one", async () => {
    const cancelled = await prisma.eventException.create({
      data: exception({ isCancelled: true }),
    });
    const moved = await prisma.eventException.create({
      data: exception({
        originalStartAt: new Date("2026-11-07T08:00:00Z"),
        title: "Dentist (moved)",
        isAllDay: false,
        startAt: new Date("2026-11-07T10:00:00Z"),
        endAt: new Date("2026-11-07T11:00:00Z"),
      }),
    });
    expect(cancelled.isCancelled).toBe(true);
    expect(moved.isCancelled).toBe(false);
    // Overrides left out keep the series' value.
    expect(moved.location).toBeNull();
  });

  it("stores an all-day series' occurrence by its date", async () => {
    const allDayId = (await prisma.event.create({ data: allDay({ rrule: "FREQ=YEARLY" }) })).id;
    const stored = await prisma.eventException.create({
      data: exception({
        eventId: allDayId,
        originalStartAt: null,
        originalStartDate: new Date("2027-11-07"),
        isCancelled: true,
      }),
    });
    expect(stored.originalStartDate?.toISOString()).toBe("2027-11-07T00:00:00.000Z");
  });

  it("allows one exception per occurrence", async () => {
    await prisma.eventException.create({ data: exception({ isCancelled: true }) });
    await expectExceptionRejected(exception({ title: "Again" }), "originalStartAt");
  });

  it("goes with its event when the event is removed", async () => {
    await prisma.eventException.create({ data: exception({ isCancelled: true }) });
    await prisma.event.delete({ where: { id: eventId } });
    expect(await prisma.eventException.count()).toBe(0);
  });

  describe("rejects", () => {
    it("an occurrence with both an original time and an original date", () =>
      expectExceptionRejected(
        exception({ originalStartDate: new Date("2026-11-06") }),
        "event_exception_original_start_check",
      ));

    it("an occurrence with no original start", () =>
      expectExceptionRejected(
        exception({ originalStartAt: null }),
        "event_exception_original_start_check",
      ));

    it("a new start without a new end", () =>
      expectExceptionRejected(
        exception({ isAllDay: false, startAt: new Date("2026-11-06T10:00:00Z") }),
        "event_exception_time_check",
      ));

    it("new times without saying whether it's all day", () =>
      expectExceptionRejected(
        exception({
          startAt: new Date("2026-11-06T10:00:00Z"),
          endAt: new Date("2026-11-06T11:00:00Z"),
        }),
        "event_exception_time_check",
      ));

    it("new times mixed with dates", () =>
      expectExceptionRejected(
        exception({
          isAllDay: false,
          startAt: new Date("2026-11-06T10:00:00Z"),
          endAt: new Date("2026-11-06T11:00:00Z"),
          startDate: new Date("2026-11-06"),
        }),
        "event_exception_time_check",
      ));

    it("new dates whose exclusive end is not after the start", () =>
      expectExceptionRejected(
        exception({
          isAllDay: true,
          startDate: new Date("2026-11-06"),
          endDate: new Date("2026-11-06"),
        }),
        "event_exception_time_check",
      ));

    it("a cancelled occurrence with changes", () =>
      expectExceptionRejected(
        exception({ isCancelled: true, title: "Dentist" }),
        "event_exception_cancelled_check",
      ));

    it("a blank title", () =>
      expectExceptionRejected(exception({ title: "  " }), "event_exception_title_not_blank_check"));
  });
});
