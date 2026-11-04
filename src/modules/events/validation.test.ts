import { describe, expect, it } from "vitest";
import messages from "../../../messages/he.json";
import { appConfig } from "@/config/app.config";
import {
  DESCRIPTION_MAX,
  EVENT_ERROR_CODES,
  type EventInput,
  TITLE_MAX,
  validateEvent,
} from "./validation";

const timed: EventInput = {
  title: "Dentist",
  owner: "dor",
  category: "personal",
  isAllDay: false,
  startDate: "2026-11-05",
  endDate: "2026-11-05",
  startTime: "10:00",
  endTime: "11:00",
};

const allDay: EventInput = {
  title: "Vacation",
  owner: "shared",
  category: "vacation",
  isAllDay: true,
  startDate: "2026-11-07",
  endDate: "2026-11-08",
};

function errorsOf(input: unknown) {
  const result = validateEvent(input);
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}

function draftOf(input: unknown) {
  const result = validateEvent(input);
  if (!result.ok) throw new Error(`expected a valid event: ${JSON.stringify(result.errors)}`);
  return result.draft;
}

describe("validateEvent: timed events", () => {
  it("turns local times into instants in Israel time", () => {
    const draft = draftOf(timed);
    expect(draft.time).toEqual({
      kind: "timed",
      startAt: new Date("2026-11-05T08:00:00Z"),
      endAt: new Date("2026-11-05T09:00:00Z"),
    });
    expect(draft.owner).toEqual({ type: "USER", userKey: "dor" });
    expect(draft.timezone).toBe("Asia/Jerusalem");
  });

  it("accepts an event that ends on a later day (crosses midnight)", () => {
    const draft = draftOf({
      ...timed,
      endDate: "2026-11-06",
      startTime: "22:00",
      endTime: "02:00",
    });
    expect(draft.time).toMatchObject({ endAt: new Date("2026-11-06T00:00:00Z") });
  });

  it("requires both times", () => {
    expect(errorsOf({ ...timed, startTime: undefined, endTime: "" })).toEqual({
      startTime: "timeRequired",
      endTime: "timeRequired",
    });
  });

  it("rejects malformed times", () => {
    expect(errorsOf({ ...timed, endTime: "25:00" })).toEqual({ endTime: "timeInvalid" });
  });

  it("rejects an end time not after the start on the same day", () => {
    expect(errorsOf({ ...timed, endTime: "10:00" })).toEqual({ endTime: "endNotAfterStart" });
    expect(errorsOf({ ...timed, endTime: "09:00" })).toEqual({ endTime: "endNotAfterStart" });
  });

  it("rejects an end date before the start date", () => {
    expect(errorsOf({ ...timed, endDate: "2026-11-04", endTime: "23:00" })).toEqual({
      endDate: "endBeforeStart",
    });
  });

  it("rejects an event longer than a year", () => {
    expect(errorsOf({ ...timed, endDate: "2027-11-06" })).toEqual({ endDate: "tooLong" });
  });

  it("measures the real length across a clock change", () => {
    // 00:00 to 03:00 on the night summer time ends is 4 real hours, and valid.
    const draft = draftOf({
      ...timed,
      startDate: "2026-10-25",
      endDate: "2026-10-25",
      startTime: "00:00",
      endTime: "03:00",
    });
    if (draft.time.kind !== "timed") throw new Error("expected timed");
    expect(draft.time.endAt.getTime() - draft.time.startAt.getTime()).toBe(4 * 3_600_000);
  });
});

describe("validateEvent: all-day events", () => {
  it("stores dates only, with the end as the day after the last day", () => {
    const draft = draftOf(allDay);
    expect(draft.time).toEqual({
      kind: "allDay",
      startDate: "2026-11-07",
      endDateExclusive: "2026-11-09",
    });
    expect(draft.owner).toEqual({ type: "SHARED" });
  });

  it("accepts a one-day event (last day = first day)", () => {
    expect(draftOf({ ...allDay, endDate: "2026-11-07" }).time).toMatchObject({
      endDateExclusive: "2026-11-08",
    });
  });

  it("ignores any times sent with an all-day event", () => {
    const draft = draftOf({ ...allDay, startTime: "99:99", endTime: "bad" });
    expect(draft.time.kind).toBe("allDay");
  });

  it("rejects a last day before the first day", () => {
    expect(errorsOf({ ...allDay, endDate: "2026-11-06" })).toEqual({ endDate: "endBeforeStart" });
  });

  it("rejects an event longer than a year", () => {
    expect(errorsOf({ ...allDay, endDate: "2027-11-08" })).toEqual({ endDate: "tooLong" });
  });
});

describe("validateEvent: fields", () => {
  it("trims text and turns empty optional fields into null", () => {
    const draft = draftOf({
      ...timed,
      title: "  Dentist  ",
      location: "  ",
      description: " notes ",
    });
    expect(draft.title).toBe("Dentist");
    expect(draft.location).toBeNull();
    expect(draft.description).toBe("notes");
  });

  it("requires a title that is not just spaces", () => {
    expect(errorsOf({ ...timed, title: "   " })).toEqual({ title: "titleRequired" });
  });

  it("limits the length of text fields", () => {
    expect(errorsOf({ ...timed, title: "x".repeat(TITLE_MAX + 1) })).toEqual({
      title: "titleTooLong",
    });
    expect(errorsOf({ ...timed, description: "x".repeat(DESCRIPTION_MAX + 1) })).toEqual({
      description: "descriptionTooLong",
    });
    expect(draftOf({ ...timed, title: "x".repeat(TITLE_MAX) }).title).toHaveLength(TITLE_MAX);
  });

  it("uses the default category when none is given", () => {
    expect(draftOf({ ...timed, category: undefined }).category).toBe(appConfig.defaultCategory);
  });

  it("accepts every configured category and owner, and nothing else", () => {
    for (const category of appConfig.categories) {
      expect(draftOf({ ...timed, category: category.key }).category).toBe(category.key);
    }
    for (const user of appConfig.users) {
      expect(draftOf({ ...timed, owner: user.key }).owner).toEqual({
        type: "USER",
        userKey: user.key,
      });
    }
    expect(errorsOf({ ...timed, category: "party" })).toEqual({ category: "categoryInvalid" });
    expect(errorsOf({ ...timed, owner: "someone" })).toEqual({ owner: "ownerInvalid" });
  });

  it("rejects impossible dates", () => {
    expect(errorsOf({ ...timed, startDate: "2026-02-30" })).toEqual({ startDate: "dateInvalid" });
    expect(errorsOf({ ...allDay, endDate: "08/11/2026" })).toEqual({ endDate: "dateInvalid" });
  });

  it("reports every invalid field at once", () => {
    expect(errorsOf({ ...timed, title: "", owner: "x", startDate: "bad" })).toEqual({
      title: "titleRequired",
      owner: "ownerInvalid",
      startDate: "dateInvalid",
    });
  });

  it("rejects input of the wrong shape without throwing", () => {
    expect(errorsOf(null)).toBeTruthy();
    expect(errorsOf({ ...timed, isAllDay: "yes" })).toEqual({ startDate: "dateInvalid" });
    expect(errorsOf({ ...timed, title: 42 })).toEqual({ title: "titleRequired" });
  });
});

describe("error messages", () => {
  it("has a Hebrew message for every error code", () => {
    for (const code of EVENT_ERROR_CODES) {
      expect(messages.events.errors[code], code).toBeTruthy();
    }
  });
});
