import { describe, expect, it } from "vitest";
import { readCalendarPlace, viewNameOf, writeCalendarPlace } from "./url-state";

describe("readCalendarPlace", () => {
  it("reads the view and date from the URL", () => {
    expect(readCalendarPlace("?view=week&date=2026-11-05", false)).toEqual({
      view: "week",
      date: "2026-11-05",
    });
  });

  it("defaults to month view on a computer and day view on a phone, on today", () => {
    expect(readCalendarPlace("", false)).toEqual({ view: "month", date: null });
    expect(readCalendarPlace("", true)).toEqual({ view: "day", date: null });
  });

  it("keeps an explicit view on a phone", () => {
    expect(readCalendarPlace("?view=month", true).view).toBe("month");
  });

  it("ignores invalid values", () => {
    expect(readCalendarPlace("?view=year&date=2026-02-30", false)).toEqual({
      view: "month",
      date: null,
    });
    expect(readCalendarPlace("?view=toString&date=5.11.2026", true)).toEqual({
      view: "day",
      date: null,
    });
  });
});

describe("writeCalendarPlace", () => {
  it("writes the view and date, keeping other parameters", () => {
    expect(writeCalendarPlace("?filter=dor", { view: "day", date: "2026-11-05" })).toBe(
      "?filter=dor&view=day&date=2026-11-05",
    );
  });

  it("replaces existing values", () => {
    expect(
      writeCalendarPlace("?view=month&date=2026-01-01", { view: "week", date: "2026-11-05" }),
    ).toBe("?view=week&date=2026-11-05");
  });

  it("round-trips through readCalendarPlace", () => {
    const place = { view: "week", date: "2027-03-26" } as const;
    expect(readCalendarPlace(writeCalendarPlace("", place), false)).toEqual(place);
  });
});

describe("viewNameOf", () => {
  it("maps FullCalendar view types to URL names", () => {
    expect(viewNameOf("dayGridMonth")).toBe("month");
    expect(viewNameOf("timeGridWeek")).toBe("week");
    expect(viewNameOf("timeGridDay")).toBe("day");
    expect(viewNameOf("listWeek")).toBeNull();
  });
});
