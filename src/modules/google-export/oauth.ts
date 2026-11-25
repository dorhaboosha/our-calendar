// The OAuth flow that connects a user's Google account to the export, separate from
// signing in: it asks only for the calendars the app creates (plus "openid", for the
// account's stable id), with PKCE and a state value, and keeps a refresh token.
// Plain fetch against Google's documented endpoints; no Google client library.

import { createHash, randomBytes } from "node:crypto";
import { GoogleApiError } from "./google-api";

/** Lets the app create calendars, and manage events only in the calendars it created. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const EXPORT_SCOPES = ["openid", CALENDAR_SCOPE] as const;

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Network calls give up after this long, and count as a network failure. */
export const REQUEST_TIMEOUT_MS = 15_000;

export type Fetch = typeof fetch;

type OAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

/** The OAuth client, from the environment. Throws if a value is missing. */
export function oauthConfig(env = process.env): OAuthConfig {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI are required",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

const base64url = (bytes: Buffer) => bytes.toString("base64url");

/**
 * Where to send the user to approve the export, and the two values to keep (in a short
 * cookie) until Google sends them back: state ties the answer to this request, and the
 * PKCE verifier proves the code is redeemed by whoever asked for it.
 */
export function startAuthorization(config = oauthConfig()) {
  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: EXPORT_SCOPES.join(" "),
    // A refresh token, so the export can run while the user is away; "consent" makes
    // Google issue a new one even if the app was approved before.
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), state, verifier };
}

/** Posts a form to Google's token endpoint; a failure is a GoogleApiError. */
async function postForm(url: string, body: Record<string, string>, fetchFn: Fetch) {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GoogleApiError(null, "unreachable");
  }
  // The body can still fail to arrive (the connection drops, or the time runs out): a
  // network failure, tried again. A body that isn't JSON (a revoke may send none) is {}.
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new GoogleApiError(null, "unreachable");
  }
  const json = parseObject(text);
  if (!response.ok) {
    // Token errors are { error: "invalid_grant", error_description: ... }.
    const reason = typeof json.error === "string" ? json.error : `http_${response.status}`;
    throw new GoogleApiError(response.status, reason);
  }
  return json;
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export type GrantedAccess = {
  refreshToken: string;
  /** The scopes the user actually granted (they may untick some), space-separated. */
  grantedScopes: string;
  /** The Google account's stable id ("sub"). */
  googleAccountId: string;
};

/**
 * Redeems the code Google sent back. The id token comes straight from Google's token
 * endpoint over TLS, so its claims can be read without checking its signature.
 */
export async function exchangeCode(
  code: string,
  verifier: string,
  fetchFn: Fetch = fetch,
  config = oauthConfig(),
): Promise<GrantedAccess> {
  const json = await postForm(
    TOKEN_URL,
    {
      code,
      code_verifier: verifier,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    },
    fetchFn,
  );
  const { refresh_token, scope, id_token } = json;
  if (typeof refresh_token !== "string" || typeof id_token !== "string") {
    throw new GoogleApiError(200, "missing_token");
  }
  const sub = idTokenSubject(id_token);
  if (!sub) throw new GoogleApiError(200, "missing_subject");
  return {
    refreshToken: refresh_token,
    grantedScopes: typeof scope === "string" ? scope : "",
    googleAccountId: sub,
  };
}

function idTokenSubject(idToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Whether the user granted the calendar permission (Google lets them untick it). */
export function hasCalendarScope(grantedScopes: string): boolean {
  return grantedScopes.split(" ").includes(CALENDAR_SCOPE);
}

/** A short-lived access token for the API, from the refresh token. */
export async function refreshAccessToken(
  refreshToken: string,
  fetchFn: Fetch = fetch,
  config = oauthConfig(),
): Promise<{ accessToken: string; expiresAt: number }> {
  const json = await postForm(
    TOKEN_URL,
    {
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    },
    fetchFn,
  );
  if (typeof json.access_token !== "string") throw new GoogleApiError(200, "missing_token");
  const lifetime = typeof json.expires_in === "number" ? json.expires_in : 3600;
  return { accessToken: json.access_token, expiresAt: Date.now() + lifetime * 1000 };
}

/** Revokes the user's grant to the app (on disconnect). */
export async function revokeToken(token: string, fetchFn: Fetch = fetch): Promise<void> {
  await postForm(REVOKE_URL, { token }, fetchFn);
}
