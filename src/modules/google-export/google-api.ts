// The few Google Calendar API calls the export makes, behind an interface: the real
// client (with the user's tokens) and the fake one in the tests both implement it.

import type { GoogleEvent, GoogleInstance } from "./mapping";

/**
 * A failed call. status is the HTTP status, or null if Google wasn't reached (network).
 * reason is Google's error reason ("rateLimitExceeded", "invalid_grant", ...). Neither
 * ever holds a token, so the message is safe to store and show.
 */
export class GoogleApiError extends Error {
  constructor(
    readonly status: number | null,
    readonly reason: string,
  ) {
    super(`google:${status ?? "network"} ${reason}`);
    this.name = "GoogleApiError";
  }
}

export type NewCalendar = { summary: string; description: string; timeZone: string };

export interface GoogleCalendarApi {
  /** Creates a secondary calendar; returns its id. */
  createCalendar(calendar: NewCalendar): Promise<{ id: string }>;
  /** Deletes a calendar the app created, with its events. 404 if it is already gone. */
  deleteCalendar(calendarId: string): Promise<void>;
  /** False if the calendar is gone (deleted by the user in Google). */
  calendarExists(calendarId: string): Promise<boolean>;
  /** Creates an event with the app's id. 409 if one with this id exists, even deleted. */
  insertEvent(calendarId: string, event: GoogleEvent): Promise<void>;
  /**
   * Replaces an event, or one occurrence of a series (by its instance id), with the
   * given fields; fields left out are cleared. Also brings back a deleted one.
   */
  updateEvent(
    calendarId: string,
    eventId: string,
    event: GoogleEvent | GoogleInstance,
  ): Promise<void>;
  /** Deletes an event or an occurrence. 404 or 410 if it is already gone. */
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

/**
 * What a failure means for the export:
 * - temporary: try again later (network, Google busy, rate limits).
 * - reauth: the access was revoked or expired; the user has to connect again.
 * - notFound / conflict / gone: 404 / 409 / 410, which the export handles where they
 *   are expected (a missing calendar is told apart by asking for it).
 * - permanent: the request itself is wrong; retrying won't help.
 */
export type FailureKind = "temporary" | "reauth" | "notFound" | "conflict" | "gone" | "permanent";

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"]);

export function failureKind(error: GoogleApiError): FailureKind {
  const { status, reason } = error;
  if (status === null || status === 429 || status >= 500) return "temporary";
  if (reason === "invalid_grant" || status === 401) return "reauth";
  if (status === 403) return RATE_LIMIT_REASONS.has(reason) ? "temporary" : "reauth";
  if (status === 404) return "notFound";
  if (status === 409) return "conflict";
  if (status === 410) return "gone";
  return "permanent";
}

/** Whether error is a Google failure of one of the given kinds. */
export function isFailure(error: unknown, ...kinds: FailureKind[]): error is GoogleApiError {
  return error instanceof GoogleApiError && kinds.includes(failureKind(error));
}
