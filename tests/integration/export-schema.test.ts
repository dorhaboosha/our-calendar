import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

// Database-level rules for the Google export tables (the add_google_export migration):
// a connection's token, one job per event and target, and what goes when a user or an
// event goes.

let dorId: string;
let targetId: string;
let eventId: string;

beforeEach(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  dorId = (
    await prisma.user.create({
      data: { id: randomUUID(), name: "Dor", email: "dor@example.com", configKey: "dor" },
    })
  ).id;
  const connection = await prisma.googleConnection.create({ data: connectionData() });
  targetId = (
    await prisma.googleExportTarget.create({
      data: { connectionId: connection.id, status: "ACTIVE", googleCalendarId: "calendar-1" },
    })
  ).id;
  eventId = (
    await prisma.event.create({
      data: {
        title: "Dentist",
        ownerType: "SHARED",
        category: "personal",
        isAllDay: false,
        startAt: new Date("2026-11-05T08:00:00Z"),
        endAt: new Date("2026-11-05T09:00:00Z"),
        createdByUserId: dorId,
        updatedByUserId: dorId,
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

function connectionData(overrides: object = {}) {
  return {
    userId: dorId,
    googleAccountId: "google-sub-1",
    status: "ACTIVE" as const,
    encryptedRefreshToken: "v1.iv.tag.ciphertext",
    grantedScopes: "https://www.googleapis.com/auth/calendar.app.created",
    ...overrides,
  };
}

describe("google connection", () => {
  it("needs a token while active, and keeps none once disconnected", async () => {
    await prisma.googleConnection.deleteMany();
    await expect(
      prisma.googleConnection.create({ data: connectionData({ encryptedRefreshToken: null }) }),
    ).rejects.toThrow("google_connection_token_check");
    await expect(
      prisma.googleConnection.create({ data: connectionData({ status: "DISCONNECTED" }) }),
    ).rejects.toThrow("google_connection_token_check");
    await expect(
      prisma.googleConnection.create({ data: connectionData({ googleAccountId: " " }) }),
    ).rejects.toThrow("google_connection_account_not_blank_check");
    // Google refused the token: the user must connect again, with or without the old one.
    await prisma.googleConnection.create({
      data: connectionData({ status: "NEEDS_REAUTH", encryptedRefreshToken: null }),
    });
  });

  it("allows one connection per user, and goes with the user", async () => {
    await expect(prisma.googleConnection.create({ data: connectionData() })).rejects.toThrow();
    // The event still references the user, so delete it first, then the user.
    await prisma.event.deleteMany();
    await prisma.user.delete({ where: { id: dorId } });
    expect(await prisma.googleConnection.count()).toBe(0);
    expect(await prisma.googleExportTarget.count()).toBe(0);
  });
});

describe("export jobs", () => {
  it("name an event only when they sync one", async () => {
    await expect(
      prisma.exportJob.create({ data: { type: "SYNC_EVENT", exportTargetId: targetId } }),
    ).rejects.toThrow("export_job_event_check");
    await expect(
      prisma.exportJob.create({
        data: { type: "FULL_RECONCILE", exportTargetId: targetId, eventId },
      }),
    ).rejects.toThrow("export_job_event_check");
    await expect(
      prisma.exportJob.create({
        data: { type: "CREATE_CALENDAR", exportTargetId: targetId, attemptCount: -1 },
      }),
    ).rejects.toThrow("export_job_attempts_check");
  });

  it("allow one job per event and target, and one of each other type per target", async () => {
    const job = await prisma.exportJob.create({
      data: { type: "SYNC_EVENT", exportTargetId: targetId, eventId },
    });
    expect(job).toMatchObject({ status: "PENDING", attemptCount: 0, lockedAt: null });
    await expect(
      prisma.exportJob.create({ data: { type: "SYNC_EVENT", exportTargetId: targetId, eventId } }),
    ).rejects.toThrow("export_job_one_per_event_key");

    await prisma.exportJob.create({ data: { type: "FULL_RECONCILE", exportTargetId: targetId } });
    await prisma.exportJob.create({ data: { type: "CREATE_CALENDAR", exportTargetId: targetId } });
    await expect(
      prisma.exportJob.create({ data: { type: "FULL_RECONCILE", exportTargetId: targetId } }),
    ).rejects.toThrow("export_job_one_per_type_key");
  });

  it("go with their event", async () => {
    await prisma.exportJob.create({
      data: { type: "SYNC_EVENT", exportTargetId: targetId, eventId },
    });
    await prisma.event.delete({ where: { id: eventId } });
    expect(await prisma.exportJob.count()).toBe(0);
  });
});

describe("export mappings", () => {
  it("one per event and target, with a version of at least 1", async () => {
    const mapping = {
      eventId,
      exportTargetId: targetId,
      googleEventId: eventId.replaceAll("-", ""),
      status: "EXPORTED" as const,
      lastExportedAt: new Date(),
    };
    await expect(
      prisma.eventExportMapping.create({ data: { ...mapping, exportedVersion: 0 } }),
    ).rejects.toThrow("event_export_mapping_version_check");
    const created = await prisma.eventExportMapping.create({
      data: { ...mapping, exportedVersion: 1 },
    });
    expect(created.exportedOccurrences).toEqual([]);
    await expect(
      prisma.eventExportMapping.create({ data: { ...mapping, exportedVersion: 2 } }),
    ).rejects.toThrow();
  });
});
