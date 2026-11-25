import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GoogleApiError } from "./google-api";
import {
  CALENDAR_SCOPE,
  exchangeCode,
  hasCalendarScope,
  refreshAccessToken,
  revokeToken,
  startAuthorization,
} from "./oauth";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://localhost:3000/api/integrations/google/callback",
};

/** A fetch that answers once with this status and JSON, and records the request. */
function answer(status: number, json: unknown) {
  return vi.fn<typeof fetch>(async () => Response.json(json, { status }));
}

const idToken = (claims: object) =>
  `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

describe("starting", () => {
  it("asks Google for the app's calendars only, offline, with PKCE and a state", () => {
    const { url, state, verifier } = startAuthorization(config);
    const params = new URL(url).searchParams;
    expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    expect(Object.fromEntries(params)).toEqual({
      client_id: "client-id",
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: `openid ${CALENDAR_SCOPE}`,
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    expect(state).toMatch(/^[\w-]{43}$/);
    expect(startAuthorization(config).state).not.toBe(state);
  });
});

describe("the code Google sends back", () => {
  it("is redeemed with the verifier for a refresh token, the scopes and the account id", async () => {
    const fetchFn = answer(200, {
      access_token: "access",
      refresh_token: "refresh",
      scope: `${CALENDAR_SCOPE} openid`,
      id_token: idToken({ sub: "1234567890" }),
    });
    expect(await exchangeCode("the-code", "the-verifier", fetchFn, config)).toEqual({
      refreshToken: "refresh",
      grantedScopes: `${CALENDAR_SCOPE} openid`,
      googleAccountId: "1234567890",
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(init!.body as URLSearchParams)).toEqual({
      code: "the-code",
      code_verifier: "the-verifier",
      client_id: "client-id",
      client_secret: "client-secret",
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    });
  });

  it("without a refresh token or account id is refused", async () => {
    await expect(
      exchangeCode("c", "v", answer(200, { id_token: idToken({ sub: "1" }) }), config),
    ).rejects.toThrow("missing_token");
    await expect(
      exchangeCode("c", "v", answer(200, { refresh_token: "r", id_token: "bad" }), config),
    ).rejects.toThrow("missing_subject");
  });

  it("an error from Google keeps its reason, never its description", async () => {
    const error = await exchangeCode(
      "c",
      "v",
      answer(400, { error: "invalid_grant", error_description: "Bad Request" }),
      config,
    ).catch((caught) => caught);
    expect(error).toBeInstanceOf(GoogleApiError);
    expect(error).toMatchObject({ status: 400, reason: "invalid_grant" });
    expect(error.message).toBe("google:400 invalid_grant");
  });

  it("Google out of reach is a network failure", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(exchangeCode("c", "v", offline, config)).rejects.toMatchObject({
      status: null,
    });
  });

  it("an answer cut off before its body arrives is a network failure too", async () => {
    const cutOff = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            start: (controller) => controller.error(new TypeError("terminated")),
          }),
          { status: 200 },
        ),
    );
    await expect(refreshAccessToken("refresh", cutOff, config)).rejects.toMatchObject({
      status: null,
      reason: "unreachable",
    });
  });
});

describe("revoking", () => {
  it("succeeds with an empty answer", async () => {
    const empty = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    await expect(revokeToken("refresh", empty)).resolves.toBeUndefined();
  });
});

describe("access", () => {
  it("only counts with the calendar permission", () => {
    expect(hasCalendarScope(`openid ${CALENDAR_SCOPE}`)).toBe(true);
    expect(hasCalendarScope("openid")).toBe(false);
    expect(hasCalendarScope("")).toBe(false);
  });

  it("an access token comes from the refresh token, with its expiry", async () => {
    const fetchFn = answer(200, { access_token: "access", expires_in: 3599 });
    const before = Date.now();
    const { accessToken, expiresAt } = await refreshAccessToken("refresh", fetchFn, config);
    expect(accessToken).toBe("access");
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3599 * 1000);
    expect(Object.fromEntries(fetchFn.mock.calls[0][1]!.body as URLSearchParams)).toMatchObject({
      refresh_token: "refresh",
      grant_type: "refresh_token",
    });
  });
});
