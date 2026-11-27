import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { connectionAccessToken, googleCalendarApi } from "./google-client";
import { encryptToken } from "./token-crypto";

const API = "https://www.googleapis.com/calendar/v3";

type Answer = { status: number; json?: unknown };

/** A fetch that gives these answers in turn, and records each request. */
function fakeFetch(...answers: Answer[]) {
  return vi.fn<typeof fetch>(async () => {
    const { status, json } = answers.shift() ?? { status: 200, json: {} };
    return status === 204 ? new Response(null, { status }) : Response.json(json ?? {}, { status });
  });
}

const request = (fetchFn: ReturnType<typeof fakeFetch>, index = 0) => {
  const [url, init] = fetchFn.mock.calls[index];
  return {
    url,
    method: init?.method,
    auth: (init?.headers as Record<string, string>).Authorization,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  };
};

const token = vi.fn(async ({ fresh = false } = {}) => (fresh ? "fresh-token" : "token"));

describe("the Calendar API calls", () => {
  it("creates a calendar", async () => {
    const fetchFn = fakeFetch({ status: 200, json: { id: "abc@group.calendar.google.com" } });
    const api = googleCalendarApi(token, fetchFn);
    const calendar = { summary: "Our Calendar", description: "d", timeZone: "Asia/Jerusalem" };
    expect(await api.createCalendar(calendar)).toEqual({ id: "abc@group.calendar.google.com" });
    expect(request(fetchFn)).toEqual({
      url: `${API}/calendars`,
      method: "POST",
      auth: "Bearer token",
      body: calendar,
    });
  });

  it("creates, replaces and deletes events, with ids in the path encoded", async () => {
    const fetchFn = fakeFetch({ status: 200 }, { status: 200 }, { status: 204 });
    const api = googleCalendarApi(token, fetchFn);
    const event = { id: "e1" } as never;
    await api.insertEvent("a@group.calendar.google.com", event);
    await api.updateEvent("a@group.calendar.google.com", "e1_20261106T170000Z", event);
    await api.deleteEvent("a@group.calendar.google.com", "e1");
    const calendar = `${API}/calendars/a%40group.calendar.google.com`;
    expect([0, 1, 2].map((index) => request(fetchFn, index))).toMatchObject([
      { url: `${calendar}/events`, method: "POST", body: { id: "e1" } },
      { url: `${calendar}/events/e1_20261106T170000Z`, method: "PUT", body: { id: "e1" } },
      { url: `${calendar}/events/e1`, method: "DELETE", body: undefined },
    ]);
  });

  it("tells a missing calendar apart", async () => {
    const api = googleCalendarApi(token, fakeFetch({ status: 404 }, { status: 200 }));
    expect(await api.calendarExists("gone")).toBe(false);
    expect(await api.calendarExists("there")).toBe(true);
  });

  it("an error keeps Google's reason", async () => {
    const api = googleCalendarApi(
      token,
      fakeFetch({
        status: 403,
        json: {
          error: {
            code: 403,
            message: "Rate Limit Exceeded",
            errors: [{ reason: "rateLimitExceeded" }],
          },
        },
      }),
    );
    await expect(api.insertEvent("c", { id: "e" } as never)).rejects.toMatchObject({
      status: 403,
      reason: "rateLimitExceeded",
      message: "google:403 rateLimitExceeded",
    });
  });

  it("a refused access token is replaced once; refused again, it is revoked access", async () => {
    const fetchFn = fakeFetch({ status: 401 }, { status: 200 });
    await googleCalendarApi(token, fetchFn).insertEvent("c", { id: "e" } as never);
    expect(request(fetchFn, 1).auth).toBe("Bearer fresh-token");

    const refused = googleCalendarApi(token, fakeFetch({ status: 401 }, { status: 401 }));
    await expect(refused.insertEvent("c", { id: "e" } as never)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("Google out of reach is a network failure", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(googleCalendarApi(token, offline).deleteEvent("c", "e")).rejects.toMatchObject({
      status: null,
      reason: "unreachable",
    });
  });
});

describe("changed occurrences", () => {
  it("lists every page, as the app's times, and leaves out events that aren't occurrences", async () => {
    const fetchFn = fakeFetch(
      {
        status: 200,
        json: {
          nextPageToken: "page-2",
          items: [
            {
              recurringEventId: "series1",
              originalStartTime: { dateTime: "2026-11-08T19:00:00+02:00" },
            },
            {},
          ],
        },
      },
      {
        status: 200,
        json: {
          items: [{ recurringEventId: "series2", originalStartTime: { date: "2026-11-12" } }],
        },
      },
    );
    const api = googleCalendarApi(async () => "token", fetchFn);
    expect(await api.listChangedOccurrences("cal@group")).toEqual([
      { seriesId: "series1", originalStart: "2026-11-08T17:00:00.000Z" },
      { seriesId: "series2", originalStart: "2026-11-12" },
    ]);
    const first = new URL(request(fetchFn, 0).url as string);
    expect(first.pathname).toBe("/calendar/v3/calendars/cal%40group/events");
    expect(first.searchParams.get("showDeleted")).toBe("true");
    expect(first.searchParams.get("singleEvents")).toBe("false");
    expect(first.searchParams.has("pageToken")).toBe(false);
    expect(new URL(request(fetchFn, 1).url as string).searchParams.get("pageToken")).toBe("page-2");
  });
});

describe("access tokens", () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:3000/callback";
  });

  const connection = (id: string) => ({
    id,
    userId: "user-1",
    encryptedRefreshToken: encryptToken("refresh", "user-1"),
  });

  it("are kept until shortly before they expire, unless a new one is asked for", async () => {
    const fetchFn = fakeFetch(
      { status: 200, json: { access_token: "first", expires_in: 3600 } },
      { status: 200, json: { access_token: "second", expires_in: 3600 } },
      { status: 200, json: { access_token: "third", expires_in: 3600 } },
    );
    let now = Date.now();
    const accessToken = connectionAccessToken(connection("c1"), fetchFn, () => now);
    expect(await accessToken()).toBe("first");
    expect(await accessToken()).toBe("first");
    expect(await accessToken({ fresh: true })).toBe("second");
    now += 3600 * 1000 - 30_000;
    expect(await accessToken()).toBe("third");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("jobs asking at once share one request for a new token", async () => {
    const fetchFn = fakeFetch({ status: 200, json: { access_token: "shared", expires_in: 3600 } });
    const accessToken = connectionAccessToken(connection("c4"), fetchFn);
    expect(await Promise.all([accessToken(), accessToken(), accessToken()])).toEqual([
      "shared",
      "shared",
      "shared",
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a refresh token that can't be read, or none, is revoked access", async () => {
    const unreadable = { ...connection("c2"), encryptedRefreshToken: "v1.a.b.c" };
    await expect(connectionAccessToken(unreadable, fakeFetch())()).rejects.toMatchObject({
      status: 401,
      reason: "token_unreadable",
    });
    const none = { ...connection("c3"), encryptedRefreshToken: null };
    await expect(connectionAccessToken(none, fakeFetch())()).rejects.toMatchObject({
      status: 401,
    });
  });

  it("Google refusing the refresh token is revoked access", async () => {
    const fetchFn = fakeFetch({ status: 400, json: { error: "invalid_grant" } });
    await expect(connectionAccessToken(connection("c4"), fetchFn)()).rejects.toMatchObject({
      status: 400,
      reason: "invalid_grant",
    });
  });
});
