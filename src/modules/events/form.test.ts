import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "./events";
import {
  type EventFormValues,
  addMinutes,
  eventFormValues,
  newEventValues,
  nextFullHour,
  toEventInput,
  withAllDay,
  withStart,
} from "./form";
import { validateEvent } from "./validation";

const TZ = "Asia/Jerusalem";
// Thursday 5 November 2026, 09:20 in Israel.
const NOW = new Date("2026-11-05T09:20:00+02:00");
const base = { owner: "dor", category: "other", now: NOW, timeZone: TZ, today: "2026-11-05" };

const timed: EventFormValues = {
  title: "Dentist",
  category: "personal",
  owner: "dor",
  isAllDay: false,
  startDate: "2026-11-05",
  startTime: "10:00",
  endDate: "2026-11-05",
  endTime: "11:30",
  location: "",
  description: "",
};

describe("nextFullHour / addMinutes", () => {
  it("rounds up to the next full hour in Israel time", () => {
    expect(nextFullHour(NOW, TZ)).toEqual({ date: "2026-11-05", time: "10:00" });
    expect(nextFullHour(new Date("2026-11-05T10:00:00+02:00"), TZ)).toEqual({
      date: "2026-11-05",
      time: "11:00",
    });
    expect(nextFullHour(new Date("2026-11-05T23:30:00+02:00"), TZ)).toEqual({
      date: "2026-11-06",
      time: "00:00",
    });
  });

  it("adds minutes across midnight", () => {
    expect(addMinutes({ date: "2026-11-05", time: "23:30" }, 60)).toEqual({
      date: "2026-11-06",
      time: "00:30",
    });
  });
});

describe("newEventValues", () => {
  it("from the button: the next full hour, one hour long, owned by the creator", () => {
    expect(newEventValues(base)).toEqual({
      title: "",
      category: "other",
      owner: "dor",
      isAllDay: false,
      startDate: "2026-11-05",
      startTime: "10:00",
      endDate: "2026-11-05",
      endTime: "11:00",
      location: "",
      description: "",
    });
  });

  it("late at night, the button starts at midnight of the next day", () => {
    const values = newEventValues({ ...base, now: new Date("2026-11-05T23:30:00+02:00") });
    expect(values).toMatchObject({
      startDate: "2026-11-06",
      startTime: "00:00",
      endDate: "2026-11-06",
      endTime: "01:00",
    });
  });

  it("a day clicked in the month view: 09:00 on that day", () => {
    expect(newEventValues({ ...base, click: { kind: "day", date: "2026-11-12" } })).toMatchObject({
      isAllDay: false,
      startDate: "2026-11-12",
      startTime: "09:00",
      endTime: "10:00",
    });
  });

  it("today clicked in the month view: the next full hour, or 09:00 late at night", () => {
    expect(newEventValues({ ...base, click: { kind: "day", date: "2026-11-05" } })).toMatchObject({
      startDate: "2026-11-05",
      startTime: "10:00",
    });
    const late = { ...base, now: new Date("2026-11-05T23:30:00+02:00") };
    expect(newEventValues({ ...late, click: { kind: "day", date: "2026-11-05" } })).toMatchObject({
      startDate: "2026-11-05",
      startTime: "09:00",
    });
  });

  it("a time slot clicked in the week or day view: that time", () => {
    const click = { kind: "time", date: "2026-11-06", time: "14:30" } as const;
    expect(newEventValues({ ...base, click })).toMatchObject({
      startDate: "2026-11-06",
      startTime: "14:30",
      endTime: "15:30",
    });
  });

  it("the all-day row clicked: a one-day all-day event", () => {
    expect(
      newEventValues({ ...base, click: { kind: "allDay", date: "2026-11-06" } }),
    ).toMatchObject({
      isAllDay: true,
      startDate: "2026-11-06",
      endDate: "2026-11-06",
    });
  });
});

describe("eventFormValues", () => {
  const saved: CalendarEvent = {
    id: "1",
    title: "Dentist",
    description: null,
    location: "Herzl 1",
    category: "personal",
    owner: "maayan",
    isAllDay: false,
    start: "2026-11-05T08:00:00.000Z",
    end: "2026-11-05T09:30:00.000Z",
    timezone: TZ,
    version: 3,
    createdBy: "dor",
    updatedBy: "dor",
    updatedAt: "2026-11-01T10:00:00.000Z",
  };

  it("a timed event: its local dates and times, missing texts as empty fields", () => {
    expect(eventFormValues(saved, TZ)).toEqual({
      title: "Dentist",
      category: "personal",
      owner: "maayan",
      isAllDay: false,
      startDate: "2026-11-05",
      startTime: "10:00",
      endDate: "2026-11-05",
      endTime: "11:30",
      location: "Herzl 1",
      description: "",
    });
  });

  it("an all-day event: the last day itself, not the stored day after", () => {
    const vacation = { ...saved, isAllDay: true, start: "2026-11-12", end: "2026-11-14" };
    expect(eventFormValues(vacation, TZ)).toMatchObject({
      isAllDay: true,
      startDate: "2026-11-12",
      endDate: "2026-11-13",
      startTime: "09:00",
      endTime: "10:00",
    });
  });

  it("saving an event unchanged gives the server the same event", () => {
    const vacation = { ...saved, isAllDay: true, start: "2026-11-12", end: "2026-11-14" };
    for (const event of [saved, vacation]) {
      const result = validateEvent(toEventInput(eventFormValues(event, TZ)));
      expect(result.ok && result.draft.time).toEqual(
        event.isAllDay
          ? { kind: "allDay", startDate: event.start, endDateExclusive: event.end }
          : { kind: "timed", startAt: new Date(event.start), endAt: new Date(event.end) },
      );
    }
  });
});

describe("withStart", () => {
  it("moving the start moves the end, keeping the length", () => {
    expect(withStart(timed, "2026-11-05", "13:00")).toMatchObject({
      startTime: "13:00",
      endDate: "2026-11-05",
      endTime: "14:30",
    });
  });

  it("keeps the length across midnight and across days", () => {
    expect(withStart(timed, "2026-11-05", "23:00")).toMatchObject({
      endDate: "2026-11-06",
      endTime: "00:30",
    });
    expect(withStart(timed, "2026-11-10", "10:00")).toMatchObject({
      endDate: "2026-11-10",
      endTime: "11:30",
    });
  });

  it("uses one hour when the current end is not after the start", () => {
    const broken = { ...timed, endTime: "09:00" };
    expect(withStart(broken, "2026-11-05", "12:00")).toMatchObject({ endTime: "13:00" });
  });

  it("all-day: moves the end date by the same number of days", () => {
    const vacation = { ...timed, isAllDay: true, startDate: "2026-11-07", endDate: "2026-11-09" };
    expect(withStart(vacation, "2026-11-20", "")).toMatchObject({
      startDate: "2026-11-20",
      endDate: "2026-11-22",
    });
  });

  it("leaves the end alone while the start is being typed", () => {
    expect(withStart(timed, "", "10:00")).toMatchObject({ startDate: "", endTime: "11:30" });
  });
});

describe("withAllDay", () => {
  it("ticking keeps the dates", () => {
    expect(withAllDay(timed, true)).toMatchObject({
      isAllDay: true,
      startDate: "2026-11-05",
      endDate: "2026-11-05",
    });
  });

  it("unticking starts again from 09:00-10:00, not the old times", () => {
    const allDay = { ...withAllDay(timed, true), startTime: "22:00", endTime: "02:00" };
    expect(withAllDay(allDay, false)).toMatchObject({
      isAllDay: false,
      startTime: "09:00",
      endDate: "2026-11-05",
      endTime: "10:00",
    });
  });

  it("unticking a multi-day event ends it on the start day", () => {
    const vacation = { ...timed, isAllDay: true, startDate: "2026-11-07", endDate: "2026-11-09" };
    expect(withAllDay(vacation, false)).toMatchObject({ endDate: "2026-11-07" });
  });
});

describe("toEventInput", () => {
  it("produces input the server accepts", () => {
    expect(validateEvent(toEventInput(timed)).ok).toBe(true);
    expect(validateEvent(toEventInput(withAllDay(timed, true))).ok).toBe(true);
  });

  it("a new event only lacks a title for the server to accept it", () => {
    const fresh = newEventValues({ ...base, click: { kind: "allDay", date: "2026-11-06" } });
    expect(validateEvent(toEventInput(fresh))).toEqual({
      ok: false,
      errors: { title: "titleRequired" },
    });
    expect(validateEvent(toEventInput({ ...fresh, title: "Trip" })).ok).toBe(true);
  });

  it("leaves the times out of an all-day event", () => {
    const input = toEventInput(withAllDay(timed, true));
    expect(input).not.toHaveProperty("startTime");
    expect(input).not.toHaveProperty("endTime");
  });
});
