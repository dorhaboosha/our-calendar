import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/modules/auth/current-user";
import {
  disconnect,
  exportAgain,
  exportNeedsAction,
  getExportStatus,
  saveConnection,
} from "@/modules/google-export/connection";
import { FakeGoogle } from "./fake-google";
import { FLOW_COOKIE, decodeFlow, encodeFlow } from "@/modules/google-export/flow-cookie";
import { GoogleApiError } from "@/modules/google-export/google-api";
import { CALENDAR_SCOPE, type GrantedAccess } from "@/modules/google-export/oauth";
import { decryptToken } from "@/modules/google-export/token-crypto";

// Connecting the export: the two routes of the OAuth flow, and what saving a connection
// does (first time, again with the same account, with another account).

let signedIn: CurrentUser | null = null;
vi.mock("@/modules/auth/current-user", () => ({ getCurrentUser: async () => signedIn }));

const exchangeCode = vi.fn<(code: string, verifier: string) => Promise<GrantedAccess>>();
vi.mock("@/modules/google-export/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/google-export/oauth")>()),
  exchangeCode: (code: string, verifier: string) => exchangeCode(code, verifier),
}));

const connect = await import("@/app/api/integrations/google/connect/route");
const callback = await import("@/app/api/integrations/google/callback/route");

const BASE = "http://localhost:3000";
let dorId: string;

const access = (overrides: Partial<GrantedAccess> = {}): GrantedAccess => ({
  refreshToken: "refresh-1",
  grantedScopes: `openid ${CALENDAR_SCOPE}`,
  googleAccountId: "sub-dor",
  ...overrides,
});

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = `${BASE}/api/integrations/google/callback`;
});

beforeEach(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  const dor = await prisma.user.create({
    data: { id: randomUUID(), name: "dor", email: "dor@example.com", configKey: "dor" },
  });
  dorId = dor.id;
  signedIn = { id: dor.id, configKey: "dor", displayName: "דור", color: "#1d4ed8" };
  exchangeCode.mockReset();
});

afterAll(async () => {
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

const jobTypes = async () => (await prisma.exportJob.findMany()).map((job) => job.type);
const targetOf = () =>
  prisma.googleExportTarget.findFirstOrThrow({ include: { connection: true } });

describe("saving a connection", () => {
  it("the first time: an encrypted token, a target, and the calendar to create", async () => {
    await saveConnection(dorId, access());
    const target = await targetOf();
    expect(target).toMatchObject({
      status: "ACTIVE",
      googleCalendarId: null,
      connection: {
        status: "ACTIVE",
        googleAccountId: "sub-dor",
        grantedScopes: `openid ${CALENDAR_SCOPE}`,
      },
    });
    expect(target.connection.encryptedRefreshToken).not.toContain("refresh-1");
    expect(decryptToken(target.connection.encryptedRefreshToken!, dorId)).toBe("refresh-1");
    expect(await jobTypes()).toEqual(["CREATE_CALENDAR"]);
    expect((await getExportStatus(dorId)).state).toBe("exporting");
  });

  it("again with the same account keeps the calendar and what was exported", async () => {
    await saveConnection(dorId, access());
    const target = await targetOf();
    await prisma.googleExportTarget.update({
      where: { id: target.id },
      data: { googleCalendarId: "calendar-1" },
    });
    await prisma.googleConnection.update({
      where: { id: target.connectionId },
      data: { status: "NEEDS_REAUTH", lastError: "google:400 invalid_grant" },
    });
    expect((await getExportStatus(dorId)).state).toBe("needsReauth");

    await saveConnection(dorId, access({ refreshToken: "refresh-2" }));
    const again = await targetOf();
    expect(again).toMatchObject({
      id: target.id,
      googleCalendarId: "calendar-1",
      connection: { status: "ACTIVE", lastError: null },
    });
    expect(decryptToken(again.connection.encryptedRefreshToken!, dorId)).toBe("refresh-2");
    expect(await jobTypes()).toEqual(["CREATE_CALENDAR"]);
  });

  it("with another Google account starts over in a new calendar", async () => {
    await saveConnection(dorId, access());
    const target = await targetOf();
    await prisma.googleExportTarget.update({
      where: { id: target.id },
      data: { googleCalendarId: "calendar-1", lastSuccessfulExportAt: new Date() },
    });
    const event = await prisma.event.create({
      data: {
        title: "x",
        ownerType: "SHARED",
        category: "other",
        isAllDay: true,
        startDate: new Date("2026-11-05"),
        endDate: new Date("2026-11-06"),
        createdByUserId: dorId,
        updatedByUserId: dorId,
      },
    });
    await prisma.eventExportMapping.create({
      data: {
        eventId: event.id,
        exportTargetId: target.id,
        googleEventId: "abc123",
        exportedVersion: 1,
        status: "EXPORTED",
        lastExportedAt: new Date(),
      },
    });

    await saveConnection(dorId, access({ googleAccountId: "sub-other" }));
    expect(await targetOf()).toMatchObject({
      googleCalendarId: null,
      lastSuccessfulExportAt: null,
      connection: { googleAccountId: "sub-other" },
    });
    expect(await prisma.eventExportMapping.count()).toBe(0);
  });
});

describe("the export's state", () => {
  it("not connected, waiting, up to date, failed exports, and a deleted calendar", async () => {
    expect(await getExportStatus(dorId)).toEqual({
      state: "notConnected",
      pending: 0,
      failed: 0,
      setupFailed: null,
      lastSuccessfulExportAt: null,
      lastError: null,
      canDeleteCalendar: false,
    });
    await saveConnection(dorId, access());
    expect(await getExportStatus(dorId)).toMatchObject({ state: "exporting", pending: 1 });

    // Creating the calendar failed: nothing was exported, so it isn't up to date.
    await prisma.exportJob.updateMany({ data: { status: "FAILED" } });
    expect(await getExportStatus(dorId)).toMatchObject({
      state: "someFailed",
      pending: 0,
      failed: 0,
      setupFailed: "calendar",
    });

    // With the calendar there, a failed job for the whole target is the full export;
    // failed events are counted.
    await prisma.googleExportTarget.updateMany({ data: { googleCalendarId: "calendar-1" } });
    const target = await prisma.googleExportTarget.findFirstOrThrow();
    const event = await prisma.event.create({
      data: {
        title: "e",
        ownerType: "SHARED",
        category: "other",
        isAllDay: true,
        startDate: new Date("2026-11-05"),
        endDate: new Date("2026-11-06"),
        createdByUserId: dorId,
        updatedByUserId: dorId,
      },
    });
    await prisma.exportJob.create({
      data: {
        type: "SYNC_EVENT",
        exportTargetId: target.id,
        eventId: event.id,
        status: "FAILED",
        nextAttemptAt: new Date(),
      },
    });
    expect(await getExportStatus(dorId)).toMatchObject({
      state: "someFailed",
      failed: 1,
      setupFailed: "fullExport",
    });

    await prisma.exportJob.deleteMany({ where: { eventId: null } });
    expect(await getExportStatus(dorId)).toMatchObject({
      state: "someFailed",
      failed: 1,
      setupFailed: null,
    });

    await prisma.exportJob.deleteMany();
    expect(await getExportStatus(dorId)).toMatchObject({ state: "upToDate", failed: 0 });

    await prisma.googleExportTarget.updateMany({
      data: { status: "NEEDS_ACTION", lastError: "calendarDeleted" },
    });
    expect(await getExportStatus(dorId)).toMatchObject({
      state: "needsAction",
      lastError: "calendarDeleted",
    });
  });
});

describe("export again and disconnect", () => {
  let google: FakeGoogle;
  let calendarId: string;
  const revoke = vi.fn<(token: string) => Promise<void>>(async () => {});

  /** Connected, with the calendar created and one event exported. */
  async function exported() {
    await saveConnection(dorId, access());
    google = new FakeGoogle();
    calendarId = (await google.createCalendar({ summary: "c", description: "", timeZone: "UTC" }))
      .id;
    const target = await targetOf();
    await prisma.googleExportTarget.update({
      where: { id: target.id },
      data: { googleCalendarId: calendarId, lastSuccessfulExportAt: new Date() },
    });
    const event = await prisma.event.create({
      data: {
        title: "x",
        ownerType: "SHARED",
        category: "other",
        isAllDay: true,
        startDate: new Date("2026-11-05"),
        endDate: new Date("2026-11-06"),
        createdByUserId: dorId,
        updatedByUserId: dorId,
      },
    });
    await prisma.eventExportMapping.create({
      data: {
        eventId: event.id,
        exportTargetId: target.id,
        googleEventId: "abc123",
        exportedVersion: 1,
        status: "EXPORTED",
        lastExportedAt: new Date(),
      },
    });
    revoke.mockReset();
    return target.id;
  }

  const disconnectNow = (deleteCalendar: boolean) =>
    disconnect(dorId, { deleteCalendar }, { apiFor: () => google, revoke });

  it("export again queues the calendar check and the full export", async () => {
    const targetId = await exported();
    await prisma.exportJob.deleteMany();
    expect(await exportAgain(dorId)).toEqual({ ok: true });
    expect(await jobTypes()).toEqual(["CREATE_CALENDAR"]);
    expect((await getExportStatus(dorId)).canDeleteCalendar).toBe(true);

    // After the calendar was deleted in Google: back to active, to create it again.
    await prisma.googleExportTarget.update({
      where: { id: targetId },
      data: { status: "NEEDS_ACTION", lastError: "calendarDeleted" },
    });
    expect(await exportNeedsAction(dorId)).toBe(true);
    expect((await getExportStatus(dorId)).canDeleteCalendar).toBe(false);
    expect(await exportAgain(dorId)).toEqual({ ok: true });
    expect(await targetOf()).toMatchObject({ status: "ACTIVE", lastError: null });
    expect(await exportNeedsAction(dorId)).toBe(false);
  });

  it("export again waits for signing in again, and needs a connection", async () => {
    expect(await exportAgain(dorId)).toEqual({ ok: false, reason: "notConnected" });
    await exported();
    await prisma.googleConnection.updateMany({ data: { status: "NEEDS_REAUTH" } });
    expect(await exportNeedsAction(dorId)).toBe(true);
    expect(await exportAgain(dorId)).toEqual({ ok: false, reason: "needsReauth" });
  });

  it("disconnecting and keeping the calendar: access revoked, the calendar left as is", async () => {
    await exported();
    expect(await disconnectNow(false)).toEqual({ ok: true });
    expect(revoke).toHaveBeenCalledWith("refresh-1");
    expect(google.calendars.has(calendarId)).toBe(true);
    expect(await targetOf()).toMatchObject({
      status: "DISABLED",
      googleCalendarId: calendarId,
      connection: { status: "DISCONNECTED", encryptedRefreshToken: null },
    });
    expect(await prisma.exportJob.count()).toBe(0);
    expect(await prisma.eventExportMapping.count()).toBe(1);
    expect((await getExportStatus(dorId)).state).toBe("notConnected");
    expect(await exportAgain(dorId)).toEqual({ ok: false, reason: "notConnected" });
    expect(await disconnectNow(false)).toEqual({ ok: false, reason: "notConnected" });

    // Connecting the same account again picks the kept calendar up.
    await saveConnection(dorId, access());
    expect(await targetOf()).toMatchObject({ status: "ACTIVE", googleCalendarId: calendarId });
  });

  it("disconnecting and deleting the calendar", async () => {
    await exported();
    expect(await disconnectNow(true)).toEqual({ ok: true });
    expect(google.calendars.size).toBe(0);
    expect(revoke).toHaveBeenCalled();
    expect(await targetOf()).toMatchObject({ status: "DISABLED", googleCalendarId: null });
    expect(await prisma.eventExportMapping.count()).toBe(0);
  });

  it("a calendar already deleted in Google, or a failed revoke, doesn't stop a disconnect", async () => {
    await exported();
    google.deleteCalendarByHand();
    revoke.mockRejectedValueOnce(new GoogleApiError(400, "invalid_token"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await disconnectNow(true)).toEqual({ ok: true });
    expect(errors).toHaveBeenCalledWith(expect.any(String), "google:400 invalid_token");
    errors.mockRestore();
    expect((await targetOf()).connection.status).toBe("DISCONNECTED");
  });

  it("a calendar that couldn't be deleted leaves the export connected", async () => {
    await exported();
    google.failNext("deleteCalendar", 503, "backendError");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await disconnectNow(true)).toEqual({ ok: false, reason: "deleteFailed" });
    errors.mockRestore();
    expect(revoke).not.toHaveBeenCalled();
    expect(await targetOf()).toMatchObject({ status: "ACTIVE", connection: { status: "ACTIVE" } });
  });

  it("without access, the calendar can't be deleted, but disconnecting still works", async () => {
    await exported();
    await prisma.googleConnection.updateMany({ data: { status: "NEEDS_REAUTH" } });
    expect(await disconnectNow(true)).toEqual({ ok: false, reason: "needsReauth" });
    expect(await disconnectNow(false)).toEqual({ ok: true });
  });
});

describe("the connect route", () => {
  it("sends the user to Google, keeping the state in a short httpOnly cookie", async () => {
    const response = await connect.GET(new Request(`${BASE}/api/integrations/google/connect`));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://accounts.google.com");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\/api\/integrations\/google/);
    expect(cookie).toMatch(/Max-Age=600/);
    const flow = decodeFlow(cookie.split(";")[0].split("=")[1]);
    expect(flow).toMatchObject({ state: location.searchParams.get("state"), userId: dorId });
  });

  it("signed out, goes to the login page", async () => {
    signedIn = null;
    const response = await connect.GET(new Request(`${BASE}/api/integrations/google/connect`));
    expect(response.headers.get("location")).toBe(`${BASE}/login`);
  });
});

describe("the callback route", () => {
  const flow = () => ({ state: "the-state", verifier: "the-verifier", userId: dorId });

  function back(query: string, cookie: object | null = flow()) {
    return callback.GET(
      new NextRequest(`${BASE}/api/integrations/google/callback?${query}`, {
        headers: cookie ? { cookie: `${FLOW_COOKIE}=${encodeFlow(cookie as never)}` } : {},
      }),
    );
  }

  const result = (response: Response) =>
    new URL(response.headers.get("location")!).searchParams.get("google");

  it("saves the connection and returns to settings", async () => {
    exchangeCode.mockResolvedValue(access());
    const response = await back("code=the-code&state=the-state");
    expect(result(response)).toBe("connected");
    expect(exchangeCode).toHaveBeenCalledWith("the-code", "the-verifier");
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await getExportStatus(dorId)).state).toBe("exporting");
  });

  it.each([
    ["another state", "code=c&state=other", flow()],
    ["no state", "code=c", flow()],
    ["no cookie", "code=c&state=the-state", null],
    ["another user's flow", "code=c&state=the-state", { ...flow(), userId: "someone-else" }],
    ["a refusal with another state", "error=access_denied&state=other", flow()],
    ["a refusal with no state", "error=access_denied", flow()],
  ])("refuses an answer with %s, and keeps the flow", async (_case, query, cookie) => {
    const response = await back(query, cookie);
    expect(result(response)).toBe("failed");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(await prisma.googleConnection.count()).toBe(0);
  });

  it("an answer for the flow with no code ends it", async () => {
    const response = await back("state=the-state");
    expect(result(response)).toBe("failed");
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("a user who declined, or unticked the calendar permission, isn't connected", async () => {
    const declined = await back("error=access_denied&state=the-state");
    expect(result(declined)).toBe("denied");
    expect(declined.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    exchangeCode.mockResolvedValue(access({ grantedScopes: "openid" }));
    expect(result(await back("code=c&state=the-state"))).toBe("missingScope");
    expect(await prisma.googleConnection.count()).toBe(0);
  });

  it("a failed exchange is reported without details", async () => {
    exchangeCode.mockRejectedValue(new GoogleApiError(400, "invalid_grant"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(result(await back("code=c&state=the-state"))).toBe("failed");
    expect(errors).toHaveBeenCalledWith(expect.any(String), "google:400 invalid_grant");
    errors.mockRestore();
  });

  it("signed out, goes to the login page", async () => {
    signedIn = null;
    const response = await back("code=c&state=the-state");
    expect(response.headers.get("location")).toBe(`${BASE}/login`);
  });
});
