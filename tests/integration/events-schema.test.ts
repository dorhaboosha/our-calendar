import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

// Database-level rules for events: the CHECK constraints added in the add_events
// migration, so even a bug in the app can't store an inconsistent event.

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
