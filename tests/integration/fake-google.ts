import {
  type ChangedOccurrence,
  type GoogleCalendarApi,
  GoogleApiError,
  type NewCalendar,
} from "@/modules/google-export/google-api";
import type { GoogleEvent, GoogleInstance } from "@/modules/google-export/mapping";

// An in-memory Google Calendar that behaves as the spike found the real one does
// (docs/google-spike.md): the app's ids, 409 on creating an id that exists (also a
// deleted one), deleted events kept as cancelled, PUT brings one back, and occurrences
// of a series addressed by instance id.

type Stored = Omit<GoogleEvent | GoogleInstance, "status"> & {
  status: "confirmed" | "cancelled";
};

type Calendar = NewCalendar & { events: Map<string, Stored> };

type Operation =
  | "createCalendar"
  | "deleteCalendar"
  | "calendarExists"
  | "insertEvent"
  | "updateEvent"
  | "deleteEvent"
  | "listChangedOccurrences";

export class FakeGoogle implements GoogleCalendarApi {
  calendars = new Map<string, Calendar>();
  /** Every call, as "operation id". */
  calls: string[] = [];
  private failures: { operation: Operation | "any"; error: GoogleApiError }[] = [];
  private nextCalendar = 1;

  /** The next call of operation (or any call) fails with this status and reason. */
  failNext(operation: Operation | "any", status: number | null, reason: string) {
    this.failures.push({ operation, error: new GoogleApiError(status, reason) });
  }

  private call(operation: Operation, id = "") {
    this.calls.push(`${operation} ${id}`.trim());
    const index = this.failures.findIndex(
      (failure) => failure.operation === operation || failure.operation === "any",
    );
    if (index >= 0) throw this.failures.splice(index, 1)[0].error;
  }

  private calendar(calendarId: string): Calendar {
    const calendar = this.calendars.get(calendarId);
    if (!calendar) throw new GoogleApiError(404, "notFound");
    return calendar;
  }

  /** The series an instance id ("{seriesId}_{start}") belongs to, if it is a series. */
  private seriesOf(calendar: Calendar, eventId: string) {
    const series = calendar.events.get(eventId.split("_")[0]);
    return eventId.includes("_") && series?.recurrence ? series : undefined;
  }

  async createCalendar(calendar: NewCalendar) {
    this.call("createCalendar");
    const id = `calendar-${this.nextCalendar++}@group.calendar.google.com`;
    this.calendars.set(id, { ...calendar, events: new Map() });
    return { id };
  }

  async deleteCalendar(calendarId: string) {
    this.call("deleteCalendar", calendarId);
    this.calendar(calendarId);
    this.calendars.delete(calendarId);
  }

  async calendarExists(calendarId: string) {
    this.call("calendarExists", calendarId);
    return this.calendars.has(calendarId);
  }

  async insertEvent(calendarId: string, event: GoogleEvent) {
    this.call("insertEvent", event.id);
    const { events } = this.calendar(calendarId);
    if (events.has(event.id)) throw new GoogleApiError(409, "duplicate");
    events.set(event.id, structuredClone(event));
  }

  async updateEvent(calendarId: string, eventId: string, event: GoogleEvent | GoogleInstance) {
    this.call("updateEvent", eventId);
    const calendar = this.calendar(calendarId);
    if (!calendar.events.has(eventId) && !this.seriesOf(calendar, eventId)) {
      throw new GoogleApiError(404, "notFound");
    }
    calendar.events.set(eventId, structuredClone(event));
  }

  async deleteEvent(calendarId: string, eventId: string) {
    this.call("deleteEvent", eventId);
    const calendar = this.calendar(calendarId);
    const stored = calendar.events.get(eventId);
    if (stored?.status === "cancelled") throw new GoogleApiError(410, "deleted");
    if (stored) stored.status = "cancelled";
    else if (this.seriesOf(calendar, eventId)) {
      calendar.events.set(eventId, { status: "cancelled" } as Stored);
    } else throw new GoogleApiError(404, "notFound");
  }

  async listChangedOccurrences(calendarId: string): Promise<ChangedOccurrence[]> {
    this.call("listChangedOccurrences", calendarId);
    const { events } = this.calendar(calendarId);
    return [...events.keys()]
      .filter((id) => id.includes("_"))
      .map((id) => {
        const [seriesId, stamp] = id.split("_");
        return { seriesId, originalStart: fromStamp(stamp) };
      });
  }

  // ---- What the user does by hand in Google ----

  only(): Calendar {
    const [calendar] = [...this.calendars.values()];
    if (!calendar || this.calendars.size !== 1) throw new Error("Expected one calendar");
    return calendar;
  }

  event(eventId: string): Stored | undefined {
    return this.only().events.get(eventId);
  }

  editByHand(eventId: string, changes: Partial<GoogleEvent>) {
    Object.assign(this.event(eventId)!, changes);
  }

  deleteByHand(eventId: string) {
    this.event(eventId)!.status = "cancelled";
  }

  /** Changes one occurrence of a series (by its instance id) in Google only. */
  editOccurrenceByHand(instanceId: string, changes: Partial<GoogleEvent>) {
    const calendar = this.only();
    const series = this.seriesOf(calendar, instanceId)!;
    const current = calendar.events.get(instanceId) ?? {
      ...structuredClone(series),
      id: instanceId,
      recurrence: undefined,
      recurringEventId: series.id,
    };
    calendar.events.set(instanceId, { ...current, ...changes, status: "confirmed" });
  }

  /** Deletes one occurrence of a series (by its instance id) in Google only. */
  deleteOccurrenceByHand(instanceId: string) {
    const calendar = this.only();
    if (!this.seriesOf(calendar, instanceId)) throw new Error("Not an occurrence");
    calendar.events.set(instanceId, { status: "cancelled" } as Stored);
  }

  deleteCalendarByHand() {
    this.calendars.clear();
  }
}

/** An instance id's start ("20261105T170000Z", or "20261105" all day), as the app has it. */
function fromStamp(stamp: string): string {
  const date = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
  if (stamp.length === 8) return date;
  const time = `${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}`;
  return new Date(`${date}T${time}Z`).toISOString();
}
