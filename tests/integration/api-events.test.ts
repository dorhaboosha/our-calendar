import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/modules/auth/current-user";
import { createEvent } from "@/modules/events/events";
import { validateEvent } from "@/modules/events/validation";

let signedIn: CurrentUser | null = null;

vi.mock("@/modules/auth/current-user", () => ({
  getCurrentUser: async () => signedIn,
}));

const { GET } = await import("@/app/api/events/route");

const URL_BASE = "http://localhost:3000/api/events";

function get(query: string) {
  return GET(new Request(`${URL_BASE}?${query}`));
}

beforeAll(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  const dor = await prisma.user.create({
    data: { id: randomUUID(), name: "dor", email: "dor@example.com", configKey: "dor" },
  });
  const validation = validateEvent({
    title: "Dentist",
    owner: "dor",
    category: "personal",
    isAllDay: false,
    startDate: "2026-11-05",
    endDate: "2026-11-05",
    startTime: "10:00",
    endTime: "11:00",
  });
  if (!validation.ok) throw new Error("invalid fixture");
  await createEvent(validation.draft, dor.id);
  signedIn = { id: dor.id, configKey: "dor", displayName: "דור", color: "#1d4ed8" };
});

afterAll(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe("GET /api/events", () => {
  it("returns the events in the range, never cached", async () => {
    // The month view of November 2026, as FullCalendar asks for it (local midnights).
    const response = await get("start=2026-10-25T00:00:00%2B02:00&end=2026-12-06T00:00:00%2B02:00");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ title: "Dentist", owner: "dor" });
  });

  it("returns nothing for a range without events", async () => {
    const response = await get("start=2026-11-06T00:00:00Z&end=2026-11-07T00:00:00Z");
    expect((await response.json()).events).toEqual([]);
  });

  it("refuses a request without a session", async () => {
    const saved = signedIn;
    signedIn = null;
    const response = await get("start=2026-11-01T00:00:00Z&end=2026-11-02T00:00:00Z");
    signedIn = saved;
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it.each([
    ["missing end", "start=2026-11-01T00:00:00Z"],
    ["not a date", "start=yesterday&end=2026-11-02T00:00:00Z"],
    ["no time zone", "start=2026-11-01T00:00:00&end=2026-11-02T00:00:00"],
    ["end before start", "start=2026-11-02T00:00:00Z&end=2026-11-01T00:00:00Z"],
    ["more than 100 days", "start=2026-01-01T00:00:00Z&end=2026-06-01T00:00:00Z"],
  ])("rejects an invalid range: %s", async (_label, query) => {
    const response = await get(query);
    expect(response.status).toBe(400);
  });
});
