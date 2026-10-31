import { describe, expect, it } from "vitest";
import {
  addDays,
  compareDates,
  dateFromDb,
  dateToDb,
  exclusiveEndToLastDay,
  instantRangeToDates,
  isLocalDate,
  isLocalTime,
  lastDayToExclusiveEnd,
  toInstant,
  toLocal,
} from "./time";

const TZ = "Asia/Jerusalem";

// Israel clock changes used below:
// - 2026-10-25 02:00 summer time ends: clocks go back to 01:00 (01:00-02:00 happens twice).
// - 2027-03-26 02:00 summer time starts: clocks jump to 03:00 (02:00-03:00 doesn't exist).

describe("isLocalDate / isLocalTime", () => {
  it("accepts real dates and times", () => {
    expect(isLocalDate("2026-11-05")).toBe(true);
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalTime("00:00")).toBe(true);
    expect(isLocalTime("23:59")).toBe(true);
  });

  it("rejects malformed or impossible values", () => {
    for (const value of ["2026-02-30", "2027-02-29", "2026-13-01", "5.11.2026", "2026-11-5", ""]) {
      expect(isLocalDate(value), value).toBe(false);
    }
    for (const value of ["24:00", "9:00", "12:60", "12:00:00", ""]) {
      expect(isLocalTime(value), value).toBe(false);
    }
  });
});

describe("toInstant", () => {
  it("uses winter time (UTC+2) and summer time (UTC+3)", () => {
    expect(toInstant("2026-12-01", "10:00", TZ).toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(toInstant("2026-07-01", "10:00", TZ).toISOString()).toBe("2026-07-01T07:00:00.000Z");
  });

  it("switches offset on the day summer time starts", () => {
    expect(toInstant("2027-03-25", "10:00", TZ).toISOString()).toBe("2027-03-25T08:00:00.000Z");
    expect(toInstant("2027-03-26", "10:00", TZ).toISOString()).toBe("2027-03-26T07:00:00.000Z");
  });

  it("moves a time skipped by the clock change forward by the gap", () => {
    // 02:30 doesn't exist on 2027-03-26; it becomes 03:30 summer time.
    const instant = toInstant("2027-03-26", "02:30", TZ);
    expect(instant.toISOString()).toBe("2027-03-26T00:30:00.000Z");
    expect(toLocal(instant, TZ)).toEqual({ date: "2027-03-26", time: "03:30" });
  });

  it("takes the earlier of a time that happens twice", () => {
    // 01:30 happens twice on 2026-10-25; the first one is still summer time (UTC+3).
    expect(toInstant("2026-10-25", "01:30", TZ).toISOString()).toBe("2026-10-24T22:30:00.000Z");
  });
});

describe("toLocal", () => {
  it("is the inverse of toInstant for ordinary times", () => {
    for (const [date, time] of [
      ["2026-11-05", "09:15"],
      ["2026-07-01", "23:59"],
      ["2026-01-01", "00:00"],
    ]) {
      expect(toLocal(toInstant(date, time, TZ), TZ)).toEqual({ date, time });
    }
  });

  it("gives the local date, not the UTC date, near midnight", () => {
    // 23:30 UTC on 4 November is already 01:30 on 5 November in Israel.
    expect(toLocal(new Date("2026-11-04T23:30:00Z"), TZ)).toEqual({
      date: "2026-11-05",
      time: "01:30",
    });
  });
});

describe("events crossing midnight and clock changes", () => {
  it("keeps the real length of an event that crosses midnight", () => {
    const start = toInstant("2026-11-05", "22:00", TZ);
    const end = toInstant("2026-11-06", "02:00", TZ);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(4);
  });

  it("counts the extra hour when clocks go back during the event", () => {
    // 00:00 to 03:00 on 2026-10-25 lasts 4 real hours.
    const start = toInstant("2026-10-25", "00:00", TZ);
    const end = toInstant("2026-10-25", "03:00", TZ);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(4);
  });

  it("counts the lost hour when clocks go forward during the event", () => {
    // 00:00 to 04:00 on 2027-03-26 lasts 3 real hours.
    const start = toInstant("2027-03-26", "00:00", TZ);
    const end = toInstant("2027-03-26", "04:00", TZ);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(3);
  });
});

describe("all-day end dates", () => {
  it("stores the day after the last day, and shows the last day back", () => {
    expect(lastDayToExclusiveEnd("2026-11-08")).toBe("2026-11-09");
    expect(exclusiveEndToLastDay("2026-11-09")).toBe("2026-11-08");
  });

  it("handles month, year and leap-day boundaries", () => {
    expect(lastDayToExclusiveEnd("2026-11-30")).toBe("2026-12-01");
    expect(lastDayToExclusiveEnd("2026-12-31")).toBe("2027-01-01");
    expect(lastDayToExclusiveEnd("2028-02-28")).toBe("2028-02-29");
    expect(exclusiveEndToLastDay("2028-03-01")).toBe("2028-02-29");
  });

  it("does not depend on clock changes", () => {
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2027-03-25", 2)).toBe("2027-03-27");
  });

  it("compares dates", () => {
    expect(compareDates("2026-11-05", "2026-11-06")).toBeLessThan(0);
    expect(compareDates("2026-11-05", "2026-11-05")).toBe(0);
    expect(compareDates("2027-01-01", "2026-12-31")).toBeGreaterThan(0);
  });
});

describe("date-only database values", () => {
  it("round-trips through a UTC-midnight Date", () => {
    expect(dateToDb("2026-11-07").toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(dateFromDb(dateToDb("2026-11-07"))).toBe("2026-11-07");
  });
});

describe("instantRangeToDates", () => {
  it("covers the days of a month view that starts and ends at local midnight", () => {
    // FullCalendar asks for [start, end) at local midnights.
    const start = toInstant("2026-10-25", "00:00", TZ);
    const end = toInstant("2026-12-06", "00:00", TZ);
    expect(instantRangeToDates(start, end, TZ)).toEqual({
      startDate: "2026-10-25",
      endDate: "2026-12-06",
    });
  });

  it("includes the last day when the range ends in the middle of it", () => {
    const start = toInstant("2026-11-05", "08:00", TZ);
    const end = toInstant("2026-11-05", "20:00", TZ);
    expect(instantRangeToDates(start, end, TZ)).toEqual({
      startDate: "2026-11-05",
      endDate: "2026-11-06",
    });
  });

  it("uses Israel dates for a range given in UTC", () => {
    // 22:00 UTC on 4 November is midnight 5 November in Israel (winter, UTC+2).
    const start = new Date("2026-11-04T22:00:00Z");
    const end = new Date("2026-11-05T22:00:00Z");
    expect(instantRangeToDates(start, end, TZ)).toEqual({
      startDate: "2026-11-05",
      endDate: "2026-11-06",
    });
  });
});
