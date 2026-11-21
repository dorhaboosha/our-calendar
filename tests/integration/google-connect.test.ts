import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/modules/auth/current-user";
import { getExportStatus, saveConnection } from "@/modules/google-export/connection";
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
      lastSuccessfulExportAt: null,
      lastError: null,
    });
    await saveConnection(dorId, access());
    expect(await getExportStatus(dorId)).toMatchObject({ state: "exporting", pending: 1 });

    await prisma.exportJob.updateMany({ data: { status: "FAILED" } });
    expect(await getExportStatus(dorId)).toMatchObject({
      state: "upToDate",
      pending: 0,
      failed: 1,
    });

    await prisma.googleExportTarget.updateMany({
      data: { status: "NEEDS_ACTION", lastError: "calendarDeleted" },
    });
    expect(await getExportStatus(dorId)).toMatchObject({
      state: "needsAction",
      lastError: "calendarDeleted",
    });
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
    ["no cookie", "code=c&state=the-state", null],
    ["another user's flow", "code=c&state=the-state", { ...flow(), userId: "someone-else" }],
    ["no code", "state=the-state", flow()],
  ])("refuses an answer with %s", async (_case, query, cookie) => {
    const response = await back(query, cookie);
    expect(result(response)).toBe("failed");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(await prisma.googleConnection.count()).toBe(0);
  });

  it("a user who declined, or unticked the calendar permission, isn't connected", async () => {
    expect(result(await back("error=access_denied&state=the-state"))).toBe("denied");
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
