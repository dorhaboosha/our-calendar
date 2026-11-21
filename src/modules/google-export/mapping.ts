// How an event of the app looks in a "Our Calendar" calendar in Google: the event itself
// (a series as one repeating event), and the occurrences that differ from their series.
// Pure: the export job loads the event and its context, and sends what this returns.

import { Temporal } from "temporal-polyfill";
import { type Occurrence, type Series, occurrenceAt } from "@/modules/events/recurrence";
import { isLocalDate } from "@/modules/events/time";
import { SHARED_OWNER } from "@/modules/events/validation";
import { colorDistance } from "@/modules/users/colors";

/** An event as the export reads it, in CalendarEvent's formats. */
export type ExportEvent = {
  id: string;
  version: number;
  title: string;
  description: string | null;
  location: string | null;
  category: string;
  /** A user key from app.config.ts, or "shared". */
  owner: string;
  isAllDay: boolean;
  /** Timed: ISO instants. All-day: "YYYY-MM-DD" dates with an exclusive end. */
  start: string;
  end: string;
  timezone: string;
  rrule: string | null;
  /** A series' occurrences that were changed or cancelled on their own. */
  exceptions: ExportException[];
};

export type ExportException = {
  /** The occurrence's start as the rule makes it: an ISO instant, or a date. */
  originalStart: string;
  isCancelled: boolean;
  /** null: as in the series. "" (description, location): cleared on this occurrence. */
  title: string | null;
  description: string | null;
  location: string | null;
  category: string | null;
  /** Where the occurrence was moved to, or null if it wasn't. */
  moved: { isAllDay: boolean; start: string; end: string } | null;
};

/** What the export needs besides the event: names, colors and the title's wording. */
export type ExportContext = {
  /** Display name of each user key. */
  ownerNames: Record<string, string>;
  /** The calendar color of each user key, and of "shared". */
  colors: Record<string, string>;
  /** A personal event's title in Google, from the messages: "דור: רופא שיניים". */
  ownedTitle: (owner: string, title: string) => string;
};

type GoogleTime = { dateTime: string; timeZone: string } | { date: string; timeZone: string };

/** The fields of an event resource of the Google Calendar API that the export sets. */
export type GoogleEvent = {
  id: string;
  status: "confirmed";
  summary: string;
  description: string;
  location: string;
  colorId: string;
  start: GoogleTime;
  end: GoogleTime;
  recurrence?: string[];
  extendedProperties: { private: Record<string, string> };
};

/** One occurrence of a series in Google, by its instance id. */
export type GoogleInstance = GoogleEvent & {
  recurringEventId: string;
  originalStartTime: GoogleTime;
};

/**
 * What to do with a series' occurrences in Google, beyond the series itself:
 * - change: the occurrence differs from the series, or differed and no longer does (it
 *   gets the series' values back).
 * - cancel: deleted in the app, or exported with changes before but no longer part of
 *   the series (Google may have kept it on its own); one Google no longer has is fine.
 */
export type InstanceUpdate =
  { kind: "change"; instance: GoogleInstance } | { kind: "cancel"; instanceId: string };

/**
 * Google's 11 event colors, as its apps show them today (the API's colors list still
 * returns older, paler shades for the same ids).
 */
export const GOOGLE_EVENT_COLORS: Record<string, string> = {
  "1": "#7986cb", // Lavender
  "2": "#33b679", // Sage
  "3": "#8e24aa", // Grape
  "4": "#e67c73", // Flamingo
  "5": "#f6bf26", // Banana
  "6": "#f4511e", // Tangerine
  "7": "#039be5", // Peacock
  "8": "#616161", // Graphite
  "9": "#3f51b5", // Blueberry
  "10": "#0b8043", // Basil
  "11": "#d50000", // Tomato
};

/** The id of Google's event color closest to a calendar color. */
export function nearestColorId(color: string): string {
  let best = "";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [id, google] of Object.entries(GOOGLE_EVENT_COLORS)) {
    const distance = colorDistance(color, google);
    if (distance < bestDistance) [best, bestDistance] = [id, distance];
  }
  return best;
}

/**
 * The event's id in Google, chosen by the app so that a retry can't create a second
 * copy: the local UUID's hex digits, which are valid in Google's base32hex ids.
 */
export function googleEventId(eventId: string): string {
  const id = eventId.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-v]{5,1024}$/.test(id)) throw new Error("Event id can't be a Google event id");
  return id;
}

/**
 * The id Google gives an occurrence of a repeating event: the series' id, then its
 * original start, in UTC ("20261105T170000Z") or as a date for an all-day series.
 */
export function instanceId(seriesGoogleId: string, originalStart: string): string {
  const stamp = isLocalDate(originalStart)
    ? originalStart.replaceAll("-", "")
    : Temporal.Instant.from(originalStart)
        .toString({ smallestUnit: "second" })
        .replace(/[-:]/g, "");
  return `${seriesGoogleId}_${stamp}`;
}

/** A start or end in Google's format: local time with its offset, or a date. */
function googleTime(value: string, timeZone: string): GoogleTime {
  if (isLocalDate(value)) return { date: value, timeZone };
  const local = Temporal.Instant.from(value)
    .toZonedDateTimeISO(timeZone)
    .toString({ smallestUnit: "second", timeZoneName: "never" });
  return { dateTime: local, timeZone };
}

type Details = Pick<ExportEvent, "title" | "description" | "location" | "category">;

/** The fields shared by an event and its occurrences. */
function resource(
  event: ExportEvent,
  details: Details,
  times: { start: string; end: string },
  context: ExportContext,
  id: string,
): GoogleEvent {
  const ownerName = context.ownerNames[event.owner];
  const color = context.colors[event.owner];
  if (event.owner !== SHARED_OWNER && !ownerName) {
    throw new Error(`No name for owner ${event.owner}`);
  }
  if (!color) throw new Error(`No color for owner ${event.owner}`);
  return {
    id,
    // Also brings back an event deleted by hand in Google.
    status: "confirmed",
    summary:
      event.owner === SHARED_OWNER ? details.title : context.ownedTitle(ownerName, details.title),
    // Empty rather than left out, so an update clears a description removed in the app.
    description: details.description ?? "",
    location: details.location ?? "",
    colorId: nearestColorId(color),
    start: googleTime(times.start, event.timezone),
    end: googleTime(times.end, event.timezone),
    extendedProperties: {
      private: {
        ourCalendarEventId: event.id,
        version: String(event.version),
        owner: event.owner,
        category: details.category,
      },
    },
  };
}

/** The event in Google: a one-off event, or a series as one repeating event. */
export function toGoogleEvent(event: ExportEvent, context: ExportContext): GoogleEvent {
  return {
    ...resource(event, event, event, context, googleEventId(event.id)),
    ...(event.rrule && { recurrence: [`RRULE:${event.rrule}`] }),
  };
}

function seriesOf(event: ExportEvent): Series {
  const { rrule, isAllDay, start, end, timezone } = event;
  return { rrule: rrule!, isAllDay, start, end, timezone };
}

/** "" in an exception: cleared on this occurrence only. */
const text = (changed: string | null, ofSeries: string | null) =>
  changed === null ? ofSeries : changed || null;

/**
 * The updates a series' occurrences need in Google, and which occurrences will then
 * have changes of their own there (to pass back as exported next time). exported: the
 * original starts of the occurrences exported with changes last time. An exception whose
 * occurrence is no longer part of the series is ignored, as in the app.
 */
export function instanceUpdates(
  event: ExportEvent,
  context: ExportContext,
  exported: readonly string[],
): { updates: InstanceUpdate[]; exported: string[] } {
  if (!event.rrule) {
    return { updates: [], exported: [] };
  }
  const series = seriesOf(event);
  const seriesId = googleEventId(event.id);
  const instance = (
    original: Occurrence,
    details: Details,
    times: { start: string; end: string },
  ): GoogleInstance => {
    const id = instanceId(seriesId, original.start);
    return {
      ...resource(event, details, times, context, id),
      recurringEventId: seriesId,
      originalStartTime: googleTime(original.start, event.timezone),
    };
  };

  const updates: InstanceUpdate[] = [];
  const nowExported: string[] = [];
  for (const exception of event.exceptions) {
    const original = occurrenceAt(series, exception.originalStart);
    if (!original) continue;
    nowExported.push(original.start);
    if (exception.isCancelled) {
      updates.push({ kind: "cancel", instanceId: instanceId(seriesId, original.start) });
      continue;
    }
    const details = {
      title: exception.title ?? event.title,
      description: text(exception.description, event.description),
      location: text(exception.location, event.location),
      category: exception.category ?? event.category,
    };
    updates.push({
      kind: "change",
      instance: instance(original, details, exception.moved ?? original),
    });
  }

  const current = new Set(nowExported);
  for (const originalStart of exported) {
    if (current.has(originalStart)) continue;
    const original = occurrenceAt(series, originalStart);
    updates.push(
      original
        ? { kind: "change", instance: instance(original, event, original) }
        : { kind: "cancel", instanceId: instanceId(seriesId, originalStart) },
    );
  }
  return { updates, exported: nowExported };
}
