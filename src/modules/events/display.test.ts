import { describe, expect, it } from "vitest";
import { describeWhen } from "./display";

const TZ = "Asia/Jerusalem";
const LOCALE = "he-IL";

describe("describeWhen", () => {
  it("a timed event within one day: the date with its weekday, and the times", () => {
    expect(
      describeWhen(
        { isAllDay: false, start: "2026-11-05T08:00:00.000Z", end: "2026-11-05T09:30:00.000Z" },
        TZ,
        LOCALE,
      ),
    ).toEqual({ dates: "יום חמישי, 5 בנובמבר 2026", times: "10:00–11:30" });
  });

  it("a timed event across midnight: each end with its date", () => {
    expect(
      describeWhen(
        { isAllDay: false, start: "2026-11-05T20:00:00.000Z", end: "2026-11-05T23:00:00.000Z" },
        TZ,
        LOCALE,
      ),
    ).toEqual({ dates: "5 בנובמבר 2026, 22:00 – 6 בנובמבר 2026, 01:00", times: null });
  });

  it("uses Israel time across a clock change", () => {
    // 27 March 2027: summer time (UTC+3) since the day before.
    expect(
      describeWhen(
        { isAllDay: false, start: "2027-03-27T07:00:00.000Z", end: "2027-03-27T08:00:00.000Z" },
        TZ,
        LOCALE,
      ).times,
    ).toBe("10:00–11:00");
  });

  it("a one-day all-day event: just the date", () => {
    expect(
      describeWhen({ isAllDay: true, start: "2026-11-12", end: "2026-11-13" }, TZ, LOCALE),
    ).toEqual({ dates: "יום חמישי, 12 בנובמבר 2026", times: null });
  });

  it("a multi-day all-day event: first to last day (the stored end is the day after)", () => {
    expect(
      describeWhen({ isAllDay: true, start: "2026-11-12", end: "2026-11-14" }, TZ, LOCALE),
    ).toEqual({ dates: "12 בנובמבר 2026 – 13 בנובמבר 2026", times: null });
  });
});
