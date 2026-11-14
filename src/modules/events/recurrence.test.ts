import { describe, expect, it } from "vitest";
import {
  type Repeat,
  type Series,
  fromRRule,
  occurrencesBetween,
  toRRule,
  weekdayOf,
} from "./recurrence";

const TZ = "Asia/Jerusalem";

// Israel clock changes used below:
// - 2026-10-25 02:00 summer time ends: clocks go back to 01:00 (01:00-02:00 happens twice).
// - 2027-03-26 02:00 summer time starts: clocks jump to 03:00 (02:00-03:00 doesn't exist).

const never = { kind: "never" } as const;
const repeat = (frequency: Repeat["frequency"], more: Partial<Repeat> = {}): Repeat => ({
  frequency,
  weekdays: [],
  end: never,
  ...more,
});

const timed = (rrule: string, start: string, end: string): Series => ({
  rrule,
  isAllDay: false,
  start: new Date(start).toISOString(),
  end: new Date(end).toISOString(),
  timezone: TZ,
});
const allDay = (rrule: string, start: string, end: string): Series => ({
  rrule,
  isAllDay: true,
  start,
  end,
  timezone: TZ,
});
const between = (series: Series, from: string, to: string) =>
  occurrencesBetween(series, new Date(from), new Date(to));
const starts = (series: Series, from: string, to: string) =>
  between(series, from, to).map((occurrence) => occurrence.start);

describe("toRRule / fromRRule", () => {
  it("writes each frequency; weeks start on Sunday", () => {
    expect(toRRule(repeat("daily"), false, TZ)).toBe("FREQ=DAILY");
    expect(toRRule(repeat("weekly", { weekdays: ["TU"] }), false, TZ)).toBe(
      "FREQ=WEEKLY;BYDAY=TU;WKST=SU",
    );
    // Days in week order, whatever order they were picked in.
    expect(toRRule(repeat("biweekly", { weekdays: ["TU", "SU"] }), false, TZ)).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,TU;WKST=SU",
    );
    expect(toRRule(repeat("monthly"), false, TZ)).toBe("FREQ=MONTHLY");
    expect(toRRule(repeat("yearly"), false, TZ)).toBe("FREQ=YEARLY");
  });

  it("ends after a number of times, or on a last date", () => {
    expect(toRRule(repeat("daily", { end: { kind: "count", count: 10 } }), false, TZ)).toBe(
      "FREQ=DAILY;COUNT=10",
    );
    // Timed: the last second of the last date in Israel, in UTC (winter, then summer).
    const until = (lastDate: string, isAllDay: boolean) =>
      toRRule(repeat("daily", { end: { kind: "until", lastDate } }), isAllDay, TZ);
    expect(until("2026-12-31", false)).toBe("FREQ=DAILY;UNTIL=20261231T215959Z");
    expect(until("2026-07-31", false)).toBe("FREQ=DAILY;UNTIL=20260731T205959Z");
    // All-day: a date.
    expect(until("2026-12-31", true)).toBe("FREQ=DAILY;UNTIL=20261231");
  });

  it("reads back what it writes", () => {
    const repeats: Repeat[] = [
      repeat("daily"),
      repeat("weekly", { weekdays: ["SU", "TH"] }),
      repeat("biweekly", { weekdays: ["MO"], end: { kind: "count", count: 5 } }),
      repeat("monthly", { end: { kind: "until", lastDate: "2027-06-30" } }),
      repeat("yearly", { end: { kind: "until", lastDate: "2030-01-01" } }),
    ];
    for (const isAllDay of [false, true]) {
      for (const original of repeats) {
        expect(fromRRule(toRRule(original, isAllDay, TZ), isAllDay, TZ)).toEqual(original);
      }
    }
  });

  it("rejects rules the form can't make", () => {
    expect(() => fromRRule("FREQ=WEEKLY;INTERVAL=3;BYDAY=MO", false, TZ)).toThrow();
    expect(() => fromRRule("FREQ=HOURLY", false, TZ)).toThrow();
  });

  it("knows the day of the week", () => {
    expect(weekdayOf("2026-11-01")).toBe("SU");
    expect(weekdayOf("2026-11-05")).toBe("TH");
    expect(weekdayOf("2026-11-07")).toBe("SA");
  });
});

describe("occurrencesBetween, timed", () => {
  it("keeps the local time when summer time ends", () => {
    // Thursdays at 10:00: 07:00 UTC in summer time, 08:00 UTC after.
    const series = timed(
      "FREQ=WEEKLY;BYDAY=TH;WKST=SU",
      "2026-10-15T10:00+03:00",
      "2026-10-15T11:00+03:00",
    );
    expect(between(series, "2026-10-15T00:00+03:00", "2026-11-05T00:00+02:00")).toEqual([
      { start: "2026-10-15T07:00:00.000Z", end: "2026-10-15T08:00:00.000Z" },
      { start: "2026-10-22T07:00:00.000Z", end: "2026-10-22T08:00:00.000Z" },
      { start: "2026-10-29T08:00:00.000Z", end: "2026-10-29T09:00:00.000Z" },
    ]);
  });

  it("keeps the local time when summer time starts", () => {
    const series = timed(
      "FREQ=WEEKLY;BYDAY=TH;WKST=SU",
      "2027-03-18T10:00+02:00",
      "2027-03-18T11:00+02:00",
    );
    expect(starts(series, "2027-03-18T00:00+02:00", "2027-04-08T00:00+03:00")).toEqual([
      "2027-03-18T08:00:00.000Z",
      "2027-03-25T08:00:00.000Z",
      "2027-04-01T07:00:00.000Z",
    ]);
  });

  it("ends at the same local time, even on the night the clocks change", () => {
    // 22:00 to 06:00. On 24-25 October that's 9 hours, as the clocks go back.
    const series = timed("FREQ=DAILY", "2026-10-23T22:00+03:00", "2026-10-24T06:00+03:00");
    expect(between(series, "2026-10-24T12:00+03:00", "2026-10-25T12:00+02:00")).toEqual([
      { start: "2026-10-24T19:00:00.000Z", end: "2026-10-25T04:00:00.000Z" },
    ]);
  });

  it("leaves out a start time that doesn't exist, and takes the earlier of a repeated one", () => {
    // 02:30 doesn't exist on 26 March 2027 (RFC 5545: skip it).
    const gap = timed("FREQ=DAILY", "2027-03-25T02:30+02:00", "2027-03-25T03:00+02:00");
    expect(starts(gap, "2027-03-25T00:00+02:00", "2027-03-28T00:00+03:00")).toEqual([
      "2027-03-25T00:30:00.000Z",
      "2027-03-26T23:30:00.000Z",
    ]);
    // 01:30 happens twice on 25 October 2026: the first one, still in summer time.
    const twice = timed("FREQ=DAILY", "2026-10-24T01:30+03:00", "2026-10-24T01:45+03:00");
    expect(starts(twice, "2026-10-25T00:00+03:00", "2026-10-26T00:00+02:00")).toEqual([
      "2026-10-24T22:30:00.000Z",
    ]);
  });

  it("includes an occurrence that starts before the range and runs into it", () => {
    // Every night 23:00 to 01:00; the range is 3 November.
    const series = timed("FREQ=DAILY", "2026-11-01T23:00+02:00", "2026-11-02T01:00+02:00");
    expect(starts(series, "2026-11-03T00:00+02:00", "2026-11-04T00:00+02:00")).toEqual([
      "2026-11-02T21:00:00.000Z",
      "2026-11-03T21:00:00.000Z",
    ]);
  });

  it("every two weeks on Sunday and Tuesday counts weeks from Sunday", () => {
    // 1 November 2026 is a Sunday.
    const series = timed(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,TU;WKST=SU",
      "2026-11-01T09:00+02:00",
      "2026-11-01T10:00+02:00",
    );
    const days = starts(series, "2026-11-01T00:00+02:00", "2026-12-01T00:00+02:00").map((start) =>
      start.slice(0, 10),
    );
    expect(days).toEqual(["2026-11-01", "2026-11-03", "2026-11-15", "2026-11-17", "2026-11-29"]);
  });

  it("a monthly series on the 31st skips shorter months", () => {
    const series = timed("FREQ=MONTHLY", "2027-01-31T12:00+02:00", "2027-01-31T13:00+02:00");
    const days = starts(series, "2027-01-01T00:00+02:00", "2027-08-01T00:00+03:00").map((start) =>
      start.slice(0, 10),
    );
    expect(days).toEqual(["2027-01-31", "2027-03-31", "2027-05-31", "2027-07-31"]);
  });

  it("stops after a number of times, or after the last date", () => {
    const counted = timed("FREQ=DAILY;COUNT=3", "2026-11-05T10:00+02:00", "2026-11-05T11:00+02:00");
    expect(starts(counted, "2026-11-01T00:00+02:00", "2026-12-01T00:00+02:00")).toHaveLength(3);

    // The last date's occurrence at 23:00 is in, though it's already the next day in UTC.
    const until = timed(
      toRRule(repeat("daily", { end: { kind: "until", lastDate: "2026-11-07" } }), false, TZ),
      "2026-11-05T23:00+02:00",
      "2026-11-05T23:30+02:00",
    );
    expect(starts(until, "2026-11-01T00:00+02:00", "2026-12-01T00:00+02:00")).toEqual([
      "2026-11-05T21:00:00.000Z",
      "2026-11-06T21:00:00.000Z",
      "2026-11-07T21:00:00.000Z",
    ]);
  });

  it("finds occurrences years into an endless series", () => {
    const series = timed("FREQ=DAILY", "2026-11-05T07:00+02:00", "2026-11-05T07:30+02:00");
    // A month view's six weeks, ten years on.
    expect(starts(series, "2036-11-02T00:00+02:00", "2036-12-14T00:00+02:00")).toHaveLength(42);
  });
});

describe("occurrencesBetween, all-day", () => {
  it("repeats the days, including one that starts before the range", () => {
    // Thursday and Friday every week; the range starts on Friday 13 November.
    const series = allDay("FREQ=WEEKLY;BYDAY=TH;WKST=SU", "2026-11-05", "2026-11-07");
    expect(between(series, "2026-11-13T00:00+02:00", "2026-11-21T00:00+02:00")).toEqual([
      { start: "2026-11-12", end: "2026-11-14" },
      { start: "2026-11-19", end: "2026-11-21" },
    ]);
  });

  it("stops after the last date", () => {
    const birthday = allDay(
      toRRule(repeat("yearly", { end: { kind: "until", lastDate: "2028-11-05" } }), true, TZ),
      "2026-11-05",
      "2026-11-06",
    );
    expect(starts(birthday, "2026-01-01T00:00+02:00", "2031-01-01T00:00+02:00")).toEqual([
      "2026-11-05",
      "2027-11-05",
      "2028-11-05",
    ]);
  });
});
