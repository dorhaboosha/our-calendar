// The real Google Calendar API client: the few REST calls of GoogleCalendarApi, with an
// access token from the connection's refresh token.

import type { GoogleConnection } from "@/generated/prisma/client";
import type { ApiFor } from "./export-jobs";
import { type GoogleCalendarApi, GoogleApiError } from "./google-api";
import { type Fetch, REQUEST_TIMEOUT_MS, refreshAccessToken } from "./oauth";
import { decryptToken } from "./token-crypto";

const API = "https://www.googleapis.com/calendar/v3";

/** Gives an access token; fresh: true asks for a new one (the old one was refused). */
export type AccessToken = (options?: { fresh?: boolean }) => Promise<string>;

/** The API with access tokens from accessToken. */
export function googleCalendarApi(
  accessToken: AccessToken,
  fetchFn: Fetch = fetch,
): GoogleCalendarApi {
  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    let response = await send(method, path, body, await accessToken());
    // An access token can be refused before its time (for example, after a password
    // change); one retry with a new one tells that apart from revoked access.
    if (response.status === 401) {
      response = await send(method, path, body, await accessToken({ fresh: true }));
    }
    if (!response.ok) throw await apiError(response);
    return response.status === 204 ? null : response.json();
  }

  async function send(method: string, path: string, body: unknown, token: string) {
    try {
      return await fetchFn(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined && { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GoogleApiError(null, "unreachable");
    }
  }

  const calendar = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}`;
  const event = (calendarId: string, eventId: string) =>
    `${calendar(calendarId)}/events/${encodeURIComponent(eventId)}`;

  return {
    async createCalendar(newCalendar) {
      const created = (await call("POST", "/calendars", newCalendar)) as { id: string };
      return { id: created.id };
    },
    async deleteCalendar(calendarId) {
      await call("DELETE", calendar(calendarId));
    },
    async calendarExists(calendarId) {
      try {
        await call("GET", calendar(calendarId));
        return true;
      } catch (error) {
        if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) {
          return false;
        }
        throw error;
      }
    },
    async insertEvent(calendarId, googleEvent) {
      await call("POST", `${calendar(calendarId)}/events`, googleEvent);
    },
    async updateEvent(calendarId, eventId, googleEvent) {
      await call("PUT", event(calendarId, eventId), googleEvent);
    },
    async deleteEvent(calendarId, eventId) {
      await call("DELETE", event(calendarId, eventId));
    },
  };
}

/** Google's error, as { error: { errors: [{ reason }], status } }, without the message. */
async function apiError(response: Response): Promise<GoogleApiError> {
  const json = (await response.json().catch(() => null)) as {
    error?: { errors?: { reason?: string }[]; status?: string };
  } | null;
  const reason =
    json?.error?.errors?.[0]?.reason ?? json?.error?.status ?? `http_${response.status}`;
  return new GoogleApiError(response.status, reason);
}

/**
 * Access tokens by connection, kept while they are valid, so the jobs of one run don't
 * each ask Google for one. Keyed by the stored refresh token too: connecting again
 * replaces it.
 */
const accessTokens = new Map<string, { refreshToken: string; token: string; expiresAt: number }>();

/** Asks for a new token this long before the old one expires. */
const EXPIRY_MARGIN_MS = 60_000;

export function connectionAccessToken(
  connection: Pick<GoogleConnection, "id" | "userId" | "encryptedRefreshToken">,
  fetchFn: Fetch = fetch,
  now = () => Date.now(),
): AccessToken {
  return async ({ fresh = false } = {}) => {
    const stored = connection.encryptedRefreshToken;
    if (!stored) throw new GoogleApiError(401, "no_refresh_token");
    const cached = accessTokens.get(connection.id);
    if (!fresh && cached?.refreshToken === stored && cached.expiresAt - EXPIRY_MARGIN_MS > now()) {
      return cached.token;
    }
    let refreshToken: string;
    try {
      refreshToken = decryptToken(stored, connection.userId);
    } catch {
      // Stored under another key (TOKEN_ENCRYPTION_KEY changed): connecting again fixes it.
      throw new GoogleApiError(401, "token_unreadable");
    }
    const { accessToken, expiresAt } = await refreshAccessToken(refreshToken, fetchFn);
    accessTokens.set(connection.id, { refreshToken: stored, token: accessToken, expiresAt });
    return accessToken;
  };
}

/** The real API for a connection, for runExportJobs. */
export const googleApiFor: ApiFor = (connection) =>
  googleCalendarApi(connectionAccessToken(connection));
