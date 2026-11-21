import {
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
  "createCalendar" | "calendarExists" | "insertEvent" | "updateEvent" | "deleteEvent";

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

  deleteCalendarByHand() {
    this.calendars.clear();
  }
}
